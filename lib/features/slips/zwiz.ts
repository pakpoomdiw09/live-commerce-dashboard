import 'server-only'
import type { SlipResult, SlipVerificationInput } from './types'
import { findBank } from '@/lib/features/banking/banks'
import { isPaymentImage } from '@/lib/features/payments/payment-validation'

type ProviderRecord = Record<string, unknown>

const record = (value: unknown): ProviderRecord | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as ProviderRecord)
    : null

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

function providerFailure(note: string): SlipResult {
  return { verdict: 'error', note, providerFault: true, raw: null }
}

const ZWIZ_MAX_IMAGE_BYTES = 5 * 1024 * 1024
const ZWIZ_IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])

function zwizBankCode(value: string): string | null {
  const code = value.trim().toLowerCase()
  if (code === 'promptpay' || code === 'prompt pay') return 'promptpay'
  if (['ew002', 'truemoney', 'true money', 'truemoney wallet'].includes(code)) return 'ew002'
  if (/^\d{3}$/.test(code)) return code
  const bank = findBank(code)
  return bank?.slipCode ?? null
}

function providerErrorMessage(code: string): string {
  switch (code) {
    case 'INVALID_API_KEY':
      return 'คีย์ ZWIZ API ไม่ถูกต้อง กรุณาตรวจสอบการตั้งค่า'
    case 'QR_NOT_FOUND':
      return 'ไม่พบ QR Code สำหรับตรวจสอบ กรุณาส่งรูปสลิปที่ชัดเจน'
    case 'INSUFFICIENT_QUOTA':
      return 'โควตาตรวจสลิป ZWIZ ไม่เพียงพอ กรุณาติดต่อผู้ดูแลระบบ'
    case 'VERIFY_FAILED':
      return 'ZWIZ ตรวจสอบสลิปไม่สำเร็จ กรุณาตรวจสอบรูปแล้วลองใหม่'
    default:
      return `ZWIZ ตรวจสอบสลิปไม่สำเร็จ${code ? ` (${code})` : ''} กรุณาลองใหม่`
  }
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
  const image = await isPaymentImage(file)
  if (
    file.size > ZWIZ_MAX_IMAGE_BYTES ||
    !image.isValid ||
    !image.mimeType ||
    !ZWIZ_IMAGE_TYPES.has(image.mimeType)
  ) {
    console.error('[SLIP_AI_ERROR]', {
      provider: 'zwiz',
      stage: 'request_validation',
      reason: 'INVALID_IMAGE_FILE',
      imageBytes: file.size,
      declaredImageType: file.type || null,
      detectedImageType: image.mimeType,
    })
    return providerFailure('กรุณาส่งไฟล์ JPG, JPEG, PNG หรือ WebP ขนาดไม่เกิน 5 MB')
  }
  // Messenger/CDN and public-upload files may have a missing or generic MIME type.
  // Derive it from the image signature so multipart includes an explicit image/* Content-Type.
  const uploadFile =
    file.type.toLowerCase() === image.mimeType
      ? file
      : new File([file], file.name || 'slip', {
          type: image.mimeType,
          lastModified: file.lastModified,
        })
  const matchAccounts = bankAccounts.flatMap(({ accountNo, bankCode }) => {
    const account = accountNo.replace(/[\s-]/g, '')
    const code = zwizBankCode(bankCode)
    return /^\d{3,20}$/.test(account) && code ? [{ account_no: account, code }] : []
  })
  if (bankAccounts.length > 0 && matchAccounts.length === 0) {
    console.error('[SLIP_AI_ERROR]', {
      provider: 'zwiz',
      stage: 'request_validation',
      reason: 'NO_SUPPORTED_RECEIVER_ACCOUNT',
      suppliedAccountCount: bankAccounts.length,
    })
    return providerFailure('รหัสธนาคารหรือเลขบัญชีรับเงินไม่ถูกต้อง กรุณาตรวจสอบการตั้งค่าร้าน')
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
  form.append('image', uploadFile, uploadFile.name || 'slip')
  form.append('match_bank_account_list', JSON.stringify(matchAccounts))
  form.append(
    'requested_by',
    (shopName?.trim() || 'SnapBot').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 100),
  )
  console.info('[SLIP_AI_TRACE]', {
    provider: 'zwiz',
    stage: 'request_started',
    host: url.host,
    hasApiKey: true,
    imageBytes: uploadFile.size,
    imageType: uploadFile.type,
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
      const providerError = record(envelope?.error)
      const errorValue = providerError?.code ?? envelope?.code
      const errorCode =
        typeof errorValue === 'string' || typeof errorValue === 'number'
          ? String(errorValue).slice(0, 80)
          : ''
      console.error('[SLIP_AI_ERROR]', {
        provider: 'zwiz',
        stage: 'provider_rejected_request',
        host: url.host,
        httpStatus: response.status,
        providerCode: errorCode || null,
      })
      return {
        ...providerFailure(providerErrorMessage(errorCode)),
        raw: payload,
      }
    }

    const result = providerResult
    const verification = text(result?.verification_result)
    if (verification === 'duplicated')
      return {
        verdict: 'duplicate',
        note: 'สลิปนี้เคยถูกใช้งานในระบบแล้ว',
        raw: payload,
      }
    if (verification === 'not_matched') {
      console.warn('[SLIP_AI_TRACE]', {
        provider: 'zwiz',
        stage: 'verification_rejected',
        verificationResult: verification,
      })
      return {
        verdict: 'wrong_receiver',
        note: 'บัญชีผู้รับโอนไม่ตรงกับบัญชีของทางร้าน',
        raw: payload,
      }
    }
    if (verification !== 'matched' && verification !== 'skipped') {
      console.error('[SLIP_AI_ERROR]', {
        provider: 'zwiz',
        stage: 'response_validation',
        reason: 'UNKNOWN_VERIFICATION_RESULT',
        verificationResult: verification || null,
      })
      return providerFailure('ZWIZ ส่งผลตรวจสลิปที่ไม่รู้จัก กรุณาตรวจสอบภายหลัง')
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
    const amount = Number(data.amount || data.paidLocalAmount || 0)
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
      receiverVerifiedByProvider: verification === 'matched',
      matchedBankAccount: verification === 'matched',
      receiverCheckSkipped: verification === 'skipped',
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

