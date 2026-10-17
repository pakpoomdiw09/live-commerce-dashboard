/* eslint-disable @typescript-eslint/no-explicit-any */

export type SlipVerdict = Exclude<import('../domain-state').LegacySlipState, 'pending'>

export type SlipResult = {
  receiverVerifiedByProvider?: boolean
  verdict: SlipVerdict
  amount?: number
  transRef?: string
  /** receiver account as printed on the slip, usually masked (e.g. xxx-x-x1234-x) */
  receiverAccount?: string
  /** receiving bank as a numeric code (e.g. "006" for KTB) */
  receiverBank?: string
  receiverProxy?: string
  /**
   * SlipOK rejected the slip only because the receiver isn't the branch's main account (1014),
   * and sent the slip data along. With per-tenant accounts the caller decides instead.
   */
  branchReceiverMismatch?: boolean
  /**
   * The check failed for a reason that isn't the slip's: timeout, network error, an outage at
   * the bank / SlipOK, or our own SlipOK account setup. The tenant gets its credit back.
   */
  providerFault?: boolean
  note?: string
  raw: unknown
}

/**
 * SlipOK error codes that say nothing about the slip itself:
 * 1000-1004 request / branch / API key / package / quota problems on our side,
 * 1009 the bank's data service is down, 1010 the bank hasn't published the transfer yet.
 * (1005-1008 = not an image / no QR / not a payment QR: the customer's image, no refund.)
 */
const PROVIDER_FAULT_CODES = new Set([1000, 1001, 1002, 1003, 1004, 1009, 1010])

type Input = { file?: File; qr?: string; expectedAmount?: number; log?: boolean }

/**
 * SlipOK "Check Slip": https://slipok.com/api-documentation/check-slip/
 * log:true turns on SlipOK's own duplicate check (1012) and receiver-account check (1014).
 * For another provider (e.g. EasySlip) write a function with the same signature and map
 * its errors onto the same SlipVerdict values.
 */
export async function verifyWithSlipOK({ file, qr, expectedAmount, log = true }: Input): Promise<SlipResult> {
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
    const res = await fetch(`https://api.slipok.com/api/line/apikey/${process.env.SLIPOK_BRANCH_ID}`, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(20_000),
    })
    json = await res.json()
    if (!res.ok) return { verdict: 'error', note: 'ระบบตรวจสอบสลิปขัดข้อง กรุณาลองใหม่ภายหลัง', raw: json, providerFault: true }
  } catch (e) {
    // timeout, network error, or a non-JSON answer (gateway error page)
    return { verdict: 'error', note: 'ตรวจสอบสลิปผ่านระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', raw: String(e), providerFault: true }
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
    return { verdict: 'valid', ...slipData(json.data), receiverVerifiedByProvider: log && json.success === true && json.data.success === true, raw: json }
  }

  // Error codes: https://slipok.com/api-documentation/error-status-code/
  const base = { raw: json, note: typeof json?.message === 'string' ? json.message.replace(/slip\s*ok/gi, 'ระบบตรวจสอบสลิปอัตโนมัติ') : undefined }
  const slip = json?.data // 1012 also returns the original slip's data
  const code = Number(json?.code)
  switch (code) {
    case 1014:
      // the slip itself is genuine; only SlipOK's single-account receiver check failed
      if (slip?.receiver) return { ...base, verdict: 'wrong_receiver', ...slipData(slip), branchReceiverMismatch: true }
      return { ...base, verdict: 'wrong_receiver' }
    case 1012:
      return { ...base, verdict: 'duplicate', amount: slip?.amount != null ? Number(slip.amount) : undefined, transRef: slip?.transRef }
    case 1013:
      return { ...base, verdict: 'amount_mismatch' }
    case 1011:
      return { ...base, verdict: 'fake' } // QR expired or no such transfer
    default:
      // 1005-1008: ask for a clearer image; provider faults (and unknown answers): retry later
      return { ...base, verdict: 'error', providerFault: !Number.isFinite(code) || PROVIDER_FAULT_CODES.has(code) }
  }
}
