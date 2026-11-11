import 'server-only'
import type { SlipResult, SlipVerificationInput } from './types'

type ProviderRecord = Record<string, unknown>

const record = (value: unknown): ProviderRecord | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as ProviderRecord)
    : null

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

function providerFailure(note: string): SlipResult {
  return { verdict: 'error', note, providerFault: true, raw: null }
}

export async function verifyWithZwiz({
  file,
  expectedAmount,
  bankAccounts = [],
  shopName,
}: SlipVerificationInput): Promise<SlipResult> {
  const apiKey = process.env.ZWIZ_API_KEY?.trim()
  if (!apiKey) {
    console.error('[SLIP_AI_ERROR]', {
      provider: 'zwiz',
      stage: 'configuration',
      reason: 'ZWIZ_API_KEY_MISSING',
    })
    return providerFailure('ระบบตรวจสอบสลิปยังไม่พร้อม กรุณาติดต่อผู้ดูแล')
  }
  if (!file) {
    console.error('[SLIP_AI_ERROR]', {
      provider: 'zwiz',
      stage: 'request_validation',
      reason: 'IMAGE_FILE_REQUIRED',
    })
    return providerFailure('ZWIZ API v2 ต้องใช้รูปสลิป กรุณาส่งรูปแทน QR')
  }
  const matchAccounts = bankAccounts
    .map(({ accountNo, bankCode }) => ({
      account_no: accountNo.replace(/[\s-]/g, ''),
      code: bankCode.trim().toLowerCase() || 'promptpay',
    }))
    .filter(({ account_no }) => /^\d{3,20}$/.test(account_no))
  if (!matchAccounts.length) {
    console.error('[SLIP_AI_ERROR]', {
      provider: 'zwiz',
      stage: 'request_validation',
      reason: 'NO_ACTIVE_RECEIVER_ACCOUNT',
    })
    return providerFailure('ยังไม่มีบัญชีรับเงินที่ใช้ตรวจสอบสลิป กรุณาติดต่อผู้ดูแล')
  }

  const rawUrl =
    process.env.ZWIZ_API_URL?.trim() || 'https://api-sme-prod.zwiz.app/api/slips/v1/verify'
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    console.error('[SLIP_AI_ERROR]', {
      provider: 'zwiz',
      stage: 'configuration',
      reason: 'ZWIZ_API_URL_INVALID',
    })
    return providerFailure('ตั้งค่า ZWIZ API URL ไม่ถูกต้อง')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    console.error('[SLIP_AI_ERROR]', {
      provider: 'zwiz',
      stage: 'configuration',
      reason: 'ZWIZ_API_URL_UNSAFE',
      host: url.host,
    })
    return providerFailure('ตั้งค่า ZWIZ API URL ไม่ถูกต้อง')
  }

  const form = new FormData()
  form.append('image', file, file.name || 'slip')
  form.append('match_bank_account_list', JSON.stringify(matchAccounts))
  form.append(
    'requested_by',
    `SnapBot: ${(shopName?.trim() || 'ร้านค้า').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120)}`,
  )
  console.info('[SLIP_AI_TRACE]', {
    provider: 'zwiz',
    stage: 'request_started',
    host: url.host,
    hasApiKey: true,
    imageBytes: file.size,
    imageType: file.type,
    receiverAccountCount: matchAccounts.length,
    expectedAmount: expectedAmount ?? null,
  })
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
      body: form,
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    })
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      console.error('[SLIP_AI_ERROR]', {
        provider: 'zwiz',
        stage: 'response_parse',
        host: url.host,
        httpStatus: response.status,
        reason: 'INVALID_JSON_RESPONSE',
      })
      return providerFailure('ระบบตรวจสอบสลิปขัดข้อง กรุณาลองใหม่อีกครั้ง')
    }
    const envelope = record(payload)
    const providerResult = record(envelope?.result)
    console.info('[SLIP_AI_TRACE]', {
      provider: 'zwiz',
      stage: 'response_received',
      host: url.host,
      httpStatus: response.status,
      success: envelope?.success === true,
      verificationResult: text(providerResult?.verification_result) || null,
      hasResultData: Boolean(record(record(providerResult?.verify)?.data)),
    })
    if (!response.ok || envelope?.success !== true) {
      console.error('[SLIP_AI_ERROR]', {
        provider: 'zwiz',
        stage: 'provider_rejected_request',
        host: url.host,
        httpStatus: response.status,
        providerCode:
          typeof envelope?.code === 'string' || typeof envelope?.code === 'number'
            ? String(envelope.code).slice(0, 80)
            : null,
      })
      return providerFailure('ระบบตรวจสอบสลิปขัดข้อง กรุณาลองใหม่อีกครั้ง')
    }

    const result = providerResult
    const verification = text(result?.verification_result)
    if (verification === 'duplicated')
      return {
        verdict: 'duplicate',
        note: 'สลิปนี้เคยใช้งานไปแล้ว',
        raw: payload,
      }
    if (verification !== 'matched') {
      console.warn('[SLIP_AI_TRACE]', {
        provider: 'zwiz',
        stage: 'verification_rejected',
        verificationResult: verification || 'MISSING',
      })
      return {
        verdict: 'wrong_receiver',
        note: 'บัญชีผู้รับในสลิปไม่ตรงกับบัญชีรับเงินที่ตั้งค่าไว้',
        raw: payload,
      }
    }

    const verify = record(result?.verify)
    const data = record(verify?.data)
    if (!data) {
      console.error('[SLIP_AI_ERROR]', {
        provider: 'zwiz',
        stage: 'response_validation',
        reason: 'VERIFIED_RESPONSE_DATA_MISSING',
      })
      return providerFailure('ระบบตรวจสอบสลิปตอบกลับข้อมูลไม่ครบถ้วน')
    }
    const amountValue = data.amount
    const amount =
      typeof amountValue === 'number' || typeof amountValue === 'string'
        ? Number(amountValue)
        : Number.NaN
    const transRef = text(data.transRef)
    const transDate = text(data.transDate)
    const transTime = text(data.transTime)
    if (!Number.isFinite(amount) || amount <= 0 || !transRef) {
      console.error('[SLIP_AI_ERROR]', {
        provider: 'zwiz',
        stage: 'response_validation',
        reason: 'AMOUNT_OR_REFERENCE_INVALID',
        hasAmount: Number.isFinite(amount) && amount > 0,
        hasReference: Boolean(transRef),
      })
      return providerFailure('ระบบตรวจสอบสลิปตอบกลับข้อมูลไม่ครบถ้วน')
    }
    if (expectedAmount && amount + 0.005 < expectedAmount)
      return {
        verdict: 'amount_mismatch',
        amount,
        transRef,
        raw: payload,
      }

    const normalizedData: ProviderRecord = {
      success: true,
      amount,
      transRef,
      ...(transDate ? { transDate } : {}),
      ...(transTime ? { transTime } : {}),
      ...(data.transTimestamp ? { transTimestamp: data.transTimestamp } : {}),
      ...(data.sendingBank ? { sendingBank: data.sendingBank } : {}),
      ...(data.receivingBank ? { receivingBank: data.receivingBank } : {}),
      ...(data.sender ? { sender: data.sender } : {}),
      ...(data.receiver ? { receiver: data.receiver } : {}),
    }
    return {
      verdict: 'valid',
      amount,
      transRef,
      receiverVerifiedByProvider: true,
      matchedBankAccount: true,
      raw: { success: true, data: normalizedData, zwiz: payload },
    }
  } catch (error) {
    console.error('[SLIP_AI_ERROR]', {
      provider: 'zwiz',
      stage: 'request_failed',
      host: url.host,
      errorName: error instanceof Error ? error.name : 'UNKNOWN',
      code: (error as { code?: string } | null)?.code ?? null,
    })
    return providerFailure('ตรวจสอบสลิปผ่าน ZWIZ ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
  }
}

