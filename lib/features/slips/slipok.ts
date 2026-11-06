export type SlipVerdict = Exclude<import('@/lib/domain-state').LegacySlipState, 'pending'>

export type SlipResult = {
  receiverVerifiedByProvider?: boolean
  /** The selected provider explicitly matched the receiving-account list sent with the request. */
  matchedBankAccount?: boolean
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
   * the bank/provider, or our own provider setup. The tenant gets its credit back.
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

export type SlipVerificationAccount = { accountNo: string; bankCode: string }

type Input = {
  file?: File
  qr?: string
  expectedAmount?: number
  log?: boolean
  bankAccounts?: readonly SlipVerificationAccount[]
  shopName?: string
}

type ProviderRecord = Record<string, unknown>

const record = (value: unknown): ProviderRecord | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as ProviderRecord)
    : null

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export function slipVerificationProvider(): 'slipok' | 'zwiz' | null {
  const configured = process.env.SLIP_VERIFICATION_PROVIDER?.trim().toLowerCase() || 'slipok'
  return configured === 'slipok' || configured === 'zwiz' ? configured : null
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

async function verifyWithZwiz({
  file,
  expectedAmount,
  bankAccounts = [],
  shopName,
}: Input): Promise<SlipResult> {
  const apiKey = process.env.ZWIZ_API_KEY?.trim()
  if (!apiKey) return providerFailure('ระบบตรวจสอบสลิปยังไม่พร้อม กรุณาติดต่อผู้ดูแล')
  if (!file) return providerFailure('ZWIZ API v2 ต้องใช้รูปสลิป กรุณาส่งรูปแทน QR')
  const matchAccounts = bankAccounts
    .map(({ accountNo, bankCode }) => ({
      account_no: accountNo.replace(/[\s-]/g, ''),
      code: bankCode.trim().toLowerCase() || 'promptpay',
    }))
    .filter(({ account_no }) => /^\d{3,20}$/.test(account_no))
  if (!matchAccounts.length)
    return providerFailure('ยังไม่มีบัญชีรับเงินที่ใช้ตรวจสอบสลิป กรุณาติดต่อผู้ดูแล')

  const rawUrl =
    process.env.ZWIZ_API_URL?.trim() || 'https://api-sme-prod.zwiz.app/api/slips/v1/verify'
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return providerFailure('ตั้งค่า ZWIZ API URL ไม่ถูกต้อง')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    return providerFailure('ตั้งค่า ZWIZ API URL ไม่ถูกต้อง')

  const form = new FormData()
  form.append('image', file, file.name || 'slip')
  form.append('match_bank_account_list', JSON.stringify(matchAccounts))
  form.append(
    'requested_by',
    `SnapBot: ${(shopName?.trim() || 'ร้านค้า').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120)}`,
  )
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
      return providerFailure('ระบบตรวจสอบสลิปขัดข้อง กรุณาลองใหม่อีกครั้ง')
    }
    const envelope = record(payload)
    if (!response.ok || envelope?.success !== true)
      return providerFailure('ระบบตรวจสอบสลิปขัดข้อง กรุณาลองใหม่อีกครั้ง')

    const result = record(envelope.result)
    const verification = text(result?.verification_result)
    if (verification === 'duplicated')
      return {
        verdict: 'duplicate',
        note: 'สลิปนี้เคยใช้งานไปแล้ว',
        raw: payload,
      }
    if (verification !== 'matched')
      return {
        verdict: 'wrong_receiver',
        note: 'บัญชีผู้รับในสลิปไม่ตรงกับบัญชีรับเงินที่ตั้งค่าไว้',
        raw: payload,
      }

    const verify = record(result?.verify)
    const data = record(verify?.data)
    if (!data) return providerFailure('ระบบตรวจสอบสลิปตอบกลับข้อมูลไม่ครบถ้วน')
    const amountValue = data.amount
    const amount =
      typeof amountValue === 'number' || typeof amountValue === 'string'
        ? Number(amountValue)
        : Number.NaN
    const transRef = text(data.transRef)
    const transDate = text(data.transDate)
    const transTime = text(data.transTime)
    if (!Number.isFinite(amount) || amount <= 0 || !transRef)
      return providerFailure('ระบบตรวจสอบสลิปตอบกลับข้อมูลไม่ครบถ้วน')
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
  } catch {
    return providerFailure('ตรวจสอบสลิปผ่าน ZWIZ ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
  }
}

/**
 * Compatibility entry point for the globally selected SlipOK or ZWIZ verifier.
 * Results are normalized to SlipResult so payment flows keep their existing validation and ledgers.
 */
export async function verifyWithSlipOK({
  file,
  qr,
  expectedAmount,
  log = true,
  bankAccounts,
  shopName,
}: Input): Promise<SlipResult> {
  const provider = slipVerificationProvider()
  if (provider === 'zwiz') return verifyWithZwiz({ file, expectedAmount, bankAccounts, shopName })
  if (provider !== 'slipok') return providerFailure('ตั้งค่าผู้ให้บริการตรวจสลิปไม่ถูกต้อง')
  if (!slipVerificationConfigured())
    return providerFailure('ระบบตรวจสอบสลิปยังไม่พร้อม กรุณาติดต่อผู้ดูแล')

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
    if (!res.ok)
      return {
        verdict: 'error',
        note: 'ระบบตรวจสอบสลิปขัดข้อง กรุณาลองใหม่ภายหลัง',
        raw: json,
        providerFault: true,
      }
  } catch (e) {
    // timeout, network error, or a non-JSON answer (gateway error page)
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
      return { ...base, verdict: 'amount_mismatch' }
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
