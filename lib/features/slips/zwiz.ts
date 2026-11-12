import 'server-only'
import type { SlipProviderDiagnostic, SlipResult, SlipVerificationInput } from './types'
import { findBank } from '@/lib/features/banking/banks'
import { isPaymentImage } from '@/lib/features/payments/payment-validation'

type ProviderRecord = Record<string, unknown>

const record = (value: unknown): ProviderRecord | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as ProviderRecord)
    : null

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

type ZwizDiagnostic = Omit<SlipProviderDiagnostic, 'provider'>

function safeProviderMessage(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  let message = value
    .trim()
    .replace(
      /((?:x-api-key|api[_ -]?key|authorization|token|secret|password)\s*[:=]\s*)[^\s,;"']+/gi,
      '$1[REDACTED]',
    )
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[REDACTED]')
    .replace(/\b\d{8,20}\b/g, '[REDACTED_ACCOUNT]')
  const apiKey = process.env.ZWIZ_API_KEY?.trim()
  if (apiKey) message = message.replaceAll(apiKey, '[REDACTED]')
  return message.slice(0, 300)
}

function providerFailure(note: string, detail?: ZwizDiagnostic): SlipResult {
  const diagnostic = detail ? { provider: 'zwiz' as const, ...detail } : undefined
  return {
    verdict: 'error',
    note,
    providerFault: true,
    ...(diagnostic ? { providerDiagnostic: diagnostic, raw: { provider_error: diagnostic } } : { raw: null }),
  }
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
      return 'ตั้งค่าระบบตรวจสลิปไม่ถูกต้อง กรุณาติดต่อผู้ดูแลระบบ'
    case 'QR_NOT_FOUND':
      return 'ไม่พบ QR Code สำหรับตรวจสอบ กรุณาส่งรูปสลิปที่ชัดเจน'
    case 'INSUFFICIENT_QUOTA':
      return 'โควตาตรวจสลิปไม่เพียงพอ กรุณาติดต่อผู้ดูแลระบบ'
    case 'VERIFY_FAILED':
      return 'ระบบตรวจสลิปไม่สำเร็จ กรุณาตรวจสอบรูปแล้วลองใหม่'
    default:
      return `ระบบตรวจสลิปไม่สำเร็จ${code ? ` (${code})` : ''} กรุณาลองใหม่`
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
    const diagnostic: ZwizDiagnostic = {
      stage: 'configuration',
      httpStatus: null,
      code: 'ZWIZ_API_KEY_MISSING',
      message: 'ZWIZ_API_KEY is not configured in this runtime',
    }
    console.error('[SLIP_AI_ERROR]', {
      provider: 'zwiz',
      ...diagnostic,
    })
    return providerFailure('ระบบตรวจสอบสลิปยังไม่พร้อม กรุณาติดต่อผู้ดูแล', diagnostic)
  }
  if (!file) {
    console.error('[SLIP_AI_ERROR]', {
      provider: 'zwiz',
      stage: 'request_validation',
      reason: 'IMAGE_FILE_REQUIRED',
    })
    return providerFailure('ระบบตรวจสลิปอัตโนมัติต้องใช้รูปสลิป กรุณาส่งรูปแทน QR', {
      stage: 'request_validation',
      httpStatus: null,
      code: 'IMAGE_FILE_REQUIRED',
      message: 'ZWIZ API v2 requires an image file',
    })
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
    return providerFailure('กรุณาส่งไฟล์ JPG, JPEG, PNG หรือ WebP ขนาดไม่เกิน 5 MB', {
      stage: 'request_validation',
      httpStatus: null,
      code: 'INVALID_IMAGE_FILE',
      message: 'Image signature, MIME type, or size is invalid',
    })
  }
  // Messenger/CDN and public-upload files may have a missing or generic MIME type.
  // Derive it from the image signature so multipart includes an explicit image/* Content-Type.
  const extension =
    image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType === 'image/png' ? 'png' : 'webp'
  // ZWIZ validates the multipart filename extension as well as Content-Type.
  // The Messenger vision downloader names files "image" without an extension.
  const uploadFile = new File([file], `slip.${extension}`, {
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
    return providerFailure('รหัสธนาคารหรือเลขบัญชีรับเงินไม่ถูกต้อง กรุณาตรวจสอบการตั้งค่าร้าน', {
      stage: 'request_validation',
      httpStatus: null,
      code: 'NO_SUPPORTED_RECEIVER_ACCOUNT',
      message: 'No configured receiving account could be mapped to a ZWIZ bank code',
    })
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
    return providerFailure('ตั้งค่าการเชื่อมต่อระบบตรวจสลิปไม่ถูกต้อง', {
      stage: 'configuration',
      httpStatus: null,
      code: 'ZWIZ_API_URL_INVALID',
      message: 'ZWIZ_API_URL is not a valid URL',
    })
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    console.error('[SLIP_AI_ERROR]', {
      provider: 'zwiz',
      stage: 'configuration',
      reason: 'ZWIZ_API_URL_UNSAFE',
      host: url.host,
    })
    return providerFailure('ตั้งค่าการเชื่อมต่อระบบตรวจสลิปไม่ถูกต้อง', {
      stage: 'configuration',
      httpStatus: null,
      code: 'ZWIZ_API_URL_UNSAFE',
      message: 'ZWIZ_API_URL must be a plain HTTPS URL',
    })
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
  let responseStatus: number | null = null
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
      body: form,
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    })
    responseStatus = response.status
    const responseText = await response.text()
    let payload: unknown
    try {
      payload = JSON.parse(responseText)
    } catch {
      const diagnostic: ZwizDiagnostic = {
        stage: 'response_parse',
        httpStatus: response.status,
        code: 'INVALID_JSON_RESPONSE',
        message: safeProviderMessage(responseText),
      }
      console.error('[SLIP_AI_ERROR]', {
        provider: 'zwiz',
        host: url.host,
        ...diagnostic,
      })
      console.error('[CALL_ZWIZ_RESULT]', diagnostic)
      return providerFailure('ระบบตรวจสอบสลิปขัดข้อง กรุณาลองใหม่อีกครั้ง', diagnostic)
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
      const candidateCode =
        typeof errorValue === 'string' || typeof errorValue === 'number'
          ? String(errorValue).slice(0, 80)
          : ''
      const errorCode =
        /^[A-Z0-9_]{1,80}$/i.test(candidateCode) &&
        candidateCode !== process.env.ZWIZ_API_KEY?.trim()
          ? candidateCode
          : ''
      const providerMessage = safeProviderMessage(
        providerError?.message ??
          providerError?.description ??
          (typeof envelope?.error === 'string' ? envelope.error : envelope?.message),
      ) ?? safeProviderMessage(response.statusText)
      const diagnostic: ZwizDiagnostic = {
        stage: 'provider_rejected_request',
        httpStatus: response.status,
        code: errorCode || null,
        message: providerMessage,
      }
      console.error('[SLIP_AI_ERROR]', {
        provider: 'zwiz',
        host: url.host,
        ...diagnostic,
      })
      console.error('[CALL_ZWIZ_RESULT]', diagnostic)
      return providerFailure(providerErrorMessage(errorCode), diagnostic)
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
      const diagnostic: ZwizDiagnostic = {
        stage: 'response_validation',
        httpStatus: response.status,
        code: 'UNKNOWN_VERIFICATION_RESULT',
        message: safeProviderMessage(verification || 'missing verification_result'),
      }
      console.error('[CALL_ZWIZ_RESULT]', diagnostic)
      return providerFailure('ระบบตรวจสลิปส่งผลที่ไม่รู้จัก กรุณาตรวจสอบภายหลัง', diagnostic)
    }

    const verify = record(result?.verify)
    const data = record(verify?.data)
    if (!data) {
      console.error('[SLIP_AI_ERROR]', {
        provider: 'zwiz',
        stage: 'response_validation',
        reason: 'VERIFIED_RESPONSE_DATA_MISSING',
      })
      const diagnostic: ZwizDiagnostic = {
        stage: 'response_validation',
        httpStatus: response.status,
        code: 'VERIFIED_RESPONSE_DATA_MISSING',
        message: 'Response marked successful but result.verify.data is missing',
      }
      console.error('[CALL_ZWIZ_RESULT]', diagnostic)
      return providerFailure('ระบบตรวจสอบสลิปตอบกลับข้อมูลไม่ครบถ้วน', diagnostic)
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
      const diagnostic: ZwizDiagnostic = {
        stage: 'response_validation',
        httpStatus: response.status,
        code: 'AMOUNT_OR_REFERENCE_INVALID',
        message: 'Verified response has no valid amount or transaction reference',
      }
      console.error('[CALL_ZWIZ_RESULT]', diagnostic)
      return providerFailure('ระบบตรวจสอบสลิปตอบกลับข้อมูลไม่ครบถ้วน', diagnostic)
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
    const errorObject = error as { code?: unknown; name?: unknown; message?: unknown } | null
    const errorCode =
      typeof errorObject?.code === 'string' && /^[A-Z0-9_]{1,80}$/i.test(errorObject.code)
        ? errorObject.code
        : typeof errorObject?.name === 'string' && /^[A-Z0-9_]{1,80}$/i.test(errorObject.name)
          ? errorObject.name
          : 'NETWORK_REQUEST_FAILED'
    const diagnostic: ZwizDiagnostic = {
      stage: 'request_failed',
      httpStatus: responseStatus,
      code: errorCode,
      message: safeProviderMessage(errorObject?.message),
    }
    console.error('[SLIP_AI_ERROR]', {
      provider: 'zwiz',
      host: url.host,
      ...diagnostic,
    })
    console.error('[CALL_ZWIZ_RESULT]', diagnostic)
    return providerFailure('ระบบตรวจสลิปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', diagnostic)
  }
}

