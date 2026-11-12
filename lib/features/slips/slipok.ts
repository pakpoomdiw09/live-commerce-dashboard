import { verifyWithZwiz } from './zwiz'
import type { SlipResult, SlipVerificationInput } from './types'
export type { SlipResult, SlipVerdict, SlipVerificationAccount, SlipVerificationInput } from './types'

type Input = SlipVerificationInput

const PROVIDER_FAULT_CODES = new Set([1000, 1001, 1002, 1003, 1004, 1009, 1010])

export function slipVerificationProvider(): 'slipok' | 'zwiz' | null {
  const configured = process.env.SLIP_VERIFICATION_PROVIDER?.trim().toLowerCase() || 'zwiz'
  return configured === 'slipok' || configured === 'zwiz' ? configured : null
}

/** ZWIZ bills verification against its provider account, not this tenant's local credit meter. */
export function usesCentralZwizQuota(): boolean {
  return slipVerificationProvider() === 'zwiz'
}

export function slipVerificationConfigured(): boolean {
  const provider = slipVerificationProvider()
  if (provider === 'zwiz') return !!process.env.ZWIZ_API_KEY?.trim()
  return (
    provider === 'slipok' &&
    !!process.env.SLIPOK_BRANCH_ID?.trim() &&
    !!process.env.SLIPOK_API_KEY?.trim()
  )
}

function providerFailure(note: string): SlipResult {
  return { verdict: 'error', note, providerFault: true, raw: null }
}


/**
 * Compatibility entry point for the globally selected SlipOK or ZWIZ verifier.
 * Results are normalized to SlipResult so payment flows keep their existing validation and ledgers.
 */
export async function verifySlip({
  file,
  qr,
  expectedAmount,
  log = true,
  bankAccounts,
  shopName,
}: Input): Promise<SlipResult> {
  const provider = slipVerificationProvider()
  if (provider === 'zwiz') return verifyWithZwiz({ file, expectedAmount, bankAccounts, shopName })
  if (provider !== 'slipok') {
    console.error('[slipok] request blocked: unsupported provider', { provider })
    return providerFailure('ตั้งค่าผู้ให้บริการตรวจสลิปไม่ถูกต้อง')
  }
  const hasApiKey = Boolean(process.env.SLIPOK_API_KEY?.trim())
  const hasBranchId = Boolean(process.env.SLIPOK_BRANCH_ID?.trim())
  console.info('[slipok] request prepared', {
    provider,
    hasApiKey,
    hasBranchId,
    inputType: qr ? 'qr' : file ? 'file' : 'missing',
    imageBytes: file?.size ?? null,
    expectedAmount: expectedAmount ?? null,
  })
  if (!slipVerificationConfigured()) {
    console.error('[slipok] request blocked: credentials are not configured', {
      hasApiKey,
      hasBranchId,
    })
    return providerFailure('ระบบตรวจสอบสลิปยังไม่พร้อม กรุณาติดต่อผู้ดูแล')
  }

  const headers: Record<string, string> = { 'x-authorization': process.env.SLIPOK_API_KEY! }
  let body: BodyInit

  if (qr) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify({ data: qr, log, ...(expectedAmount ? { amount: expectedAmount } : {}) })
  } else if (file) {
    const fd = new FormData()
    fd.append('files', file)
    fd.append('log', String(log))
    if (expectedAmount) fd.append('amount', String(expectedAmount))
    body = fd // no Content-Type header: fetch sets the multipart boundary
  } else {
    return { verdict: 'error', note: 'ไม่มีรูปหรือ QR', raw: null }
  }

  let json: any
  try {
    const res = await fetch(
      `https://api.slipok.com/api/line/apikey/${process.env.SLIPOK_BRANCH_ID}`,
      {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(20_000),
      },
    )
    json = await res.json()
    console.info('[slipok] response received', {
      httpStatus: res.status,
      success: json?.success === true && json?.data?.success === true,
      providerCode: Number.isFinite(Number(json?.code)) ? Number(json.code) : null,
      hasSlipData: Boolean(json?.data),
    })
    // SlipOK returns valid business verdicts (including 1012/1013/1014) with
    // HTTP 400. Parse those below; only an HTTP failure without a known API
    // result is a provider outage and should refund the verification credit.
    const responseCode = Number(json?.code)
    if (!res.ok && (!Number.isInteger(responseCode) || responseCode < 1000 || responseCode > 1014))
      return providerFailure('ระบบตรวจสอบสลิปขัดข้อง กรุณาลองใหม่ภายหลัง')
  } catch (e) {
    // timeout, network error, or a non-JSON answer (gateway error page)
    console.error('[slipok] request failed', {
      errorName: e instanceof Error ? e.name : 'UNKNOWN',
    })
    return {
      verdict: 'error',
      note: 'ตรวจสอบสลิปผ่านระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
      raw: String(e),
      providerFault: true,
    }
  }

  const slipData = (data: any) => {
    const receiver = data.receiver
    return {
      amount: data.amount != null ? Number(data.amount) : undefined,
      transRef: typeof data.transRef === 'string' ? data.transRef.trim() || undefined : undefined,
      receiverAccount: receiver?.account?.value || receiver?.proxy?.value || undefined,
      receiverProxy: receiver?.proxy?.value || undefined,
      receiverBank: data.receivingBank ? String(data.receivingBank) : undefined,
    }
  }

  if (json?.success && json?.data?.success) {
    return {
      verdict: 'valid',
      ...slipData(json.data),
      receiverVerifiedByProvider: log && json.success === true && json.data.success === true,
      raw: json,
    }
  }

  // Error codes: https://slipok.com/api-documentation/error-status-code/
  const base = {
    raw: json,
    note:
      typeof json?.message === 'string'
        ? json.message.replace(/slip\s*ok/gi, 'ระบบตรวจสอบสลิปอัตโนมัติ')
        : undefined,
  }
  const slip = json?.data // 1012 also returns the original slip's data
  const code = Number(json?.code)
  switch (code) {
    case 1014:
      // the slip itself is genuine; only SlipOK's single-account receiver check failed
      if (slip?.receiver)
        return {
          ...base,
          verdict: 'wrong_receiver',
          ...slipData(slip),
          branchReceiverMismatch: true,
        }
      return { ...base, verdict: 'wrong_receiver' }
    case 1012:
      return {
        ...base,
        verdict: 'duplicate',
        amount: slip?.amount != null ? Number(slip.amount) : undefined,
        transRef: slip?.transRef,
      }
    case 1013:
      return {
        ...base,
        verdict: 'amount_mismatch',
        ...(slip ? slipData(slip) : {}),
      }
    case 1011:
      return { ...base, verdict: 'fake' } // QR expired or no such transfer
    default:
      // 1005-1008: ask for a clearer image; provider faults (and unknown answers): retry later
      return {
        ...base,
        verdict: 'error',
        providerFault: !Number.isFinite(code) || PROVIDER_FAULT_CODES.has(code),
      }
  }
}

/** @deprecated Use verifySlip; retained for integrations still importing the legacy name. */
export const verifyWithSlipOK = verifySlip
