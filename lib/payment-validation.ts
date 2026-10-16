import 'server-only'
import { BANKS, findBank } from '@/lib/banks'
import type { SlipResult } from '@/lib/slip/slipok'

export const PAYMENT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const PAYMENT_MAX_BYTES = 5 * 1024 * 1024

export type PaymentSession = {
  price_baht: number
  created_at: string
  expires_at: string
  receiver_promptpay_id: string
  receiver_account_no: string
  receiver_bank_code: string
}

export type PaymentSlipValidation =
  | { ok: true; transRef: string; paidAt: string; amount: number }
  | { ok: false; error: string; status: number }

const fail = (error: string, status = 422): PaymentSlipValidation => ({ ok: false, error, status })
const object = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null

/** FormData MIME is client-controlled; require the matching image signature as well. */
export async function isPaymentImage(file: File): Promise<boolean> {
  if (!PAYMENT_IMAGE_TYPES.includes(file.type) || file.size <= 0 || file.size > PAYMENT_MAX_BYTES) return false
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  if (file.type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (file.type === 'image/png') {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    return bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte)
  }
  return bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
}

function satang(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null
  const amount = Number(value)
  const rounded = Math.round(amount * 100)
  return Number.isFinite(amount) && amount > 0 && Number.isSafeInteger(rounded)
    && Math.abs(amount * 100 - rounded) < 0.000001 ? rounded : null
}

function bankCode(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const code = String(value).trim().toUpperCase()
  return /^\d{1,3}$/.test(code) ? code.padStart(3, '0') : (findBank(code) ?? BANKS.find(bank => bank.name === String(value).trim()))?.slipCode ?? null
}

/** At least four visible account digits, in their correct positions, from bank-verified data. */
function accountMatches(expected: string, printed: unknown): boolean {
  const full = expected.replace(/[\s-]/g, '')
  if (!/^\d{4,20}$/.test(full) || typeof printed !== 'string' || !/^[\dxX*\s-]+$/.test(printed)) return false
  const masked = printed.replace(/[\s-]/g, '').replace(/\*/g, 'x').toLowerCase()
  if (masked.replace(/x/g, '').length < 4) return false
  if (masked.length === full.length) {
    return [...masked].every((digit, index) => digit === 'x' || digit === full[index])
  }
  const parts = /^(\d*)x+(\d*)$/.exec(masked)
  return !!parts && parts[1].length + parts[2].length <= full.length && full.startsWith(parts[1]) && full.endsWith(parts[2])
}

/** Thai mobile proxies normalize their country prefix; national/wallet IDs match exactly. */
function promptPayId(value: unknown): string | null {
  if (typeof value !== 'string' || !/^[\d+()\s-]+$/.test(value)) return null
  const digits = value.replace(/\D/g, '')
  if (/^0066\d{9}$/.test(digits)) return `0${digits.slice(4)}`
  if (/^66\d{9}$/.test(digits)) return `0${digits.slice(2)}`
  return /^0\d{9}$/.test(digits) || /^\d{13}$/.test(digits) || /^\d{15}$/.test(digits) ? digits : null
}

/** Reject invalid dates instead of allowing Date.parse to roll February 30 into March. */
function transferTime(data: Record<string, unknown>): number | null {
  if (typeof data.transDate !== 'string' || typeof data.transTime !== 'string'
    || !/^\d{8}$/.test(data.transDate) || !/^\d{2}:\d{2}:\d{2}$/.test(data.transTime)) return null
  const date = data.transDate
  const time = data.transTime
  const formatted = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time}`
  const timestamp = Date.parse(`${formatted}+07:00`)
  if (!Number.isFinite(timestamp)) return null
  const roundtrip = new Date(timestamp + 7 * 60 * 60 * 1000).toISOString().slice(0, 19)
  return roundtrip === formatted ? timestamp : null
}

/**
 * Validate a platform package transfer against the server's immutable receiver/price snapshot.
 * SlipOK verifies the transfer; this server checks the configured platform receiver.
 * The caller must persist proof through the shared transfer/image ledgers before activation.
 */
export function validatePaymentSlip(result: SlipResult, session: PaymentSession, now = Date.now(), minimumAmount = false, receiverCheck: 'local' | 'provider' = 'local'): PaymentSlipValidation {
  const created = Date.parse(session.created_at)
  const expires = Date.parse(session.expires_at)
  const price = satang(session.price_baht)
  const expectedBank = bankCode(session.receiver_bank_code)
  if (!Number.isFinite(created) || !Number.isFinite(expires) || expires <= created || !Number.isFinite(now)
    || price === null || (receiverCheck === 'local' && !expectedBank)) return fail('ข้อมูลการชำระเงินไม่ถูกต้อง กรุณาสร้างรายการใหม่', 500)
  if (now > expires) return fail('รายการชำระเงินหมดอายุแล้ว กรุณาสร้างรายการใหม่', 409)
  if (result.verdict === 'duplicate') return fail('สลิปนี้เคยถูกใช้แล้ว กรุณาตรวจสอบประวัติการชำระเงิน', 409)
  if (result.branchReceiverMismatch) return fail('SlipOK แจ้งว่าบัญชีผู้รับไม่ตรงกับบัญชีที่ตั้งค่าในสาขา กรุณาให้ผู้ดูแลตรวจสอบบัญชีกรุงไทยและพร้อมเพย์ใน SlipOK ก่อนลองอีกครั้ง')
  if (result.verdict === 'wrong_receiver') return fail('บัญชีผู้รับเงินในสลิปไม่ตรงกับบัญชีของแพลตฟอร์ม')
  if (result.verdict === 'amount_mismatch') return fail('ยอดเงินในสลิปไม่ตรงกับยอดของรายการนี้')
  if (result.verdict === 'fake') return fail('ไม่พบธุรกรรมของสลิปนี้ กรุณาตรวจสอบสลิป')
  if (result.verdict !== 'valid') return fail('ตรวจสอบสลิปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', result.providerFault ? 503 : 422)

  const raw = object(result.raw)
  const data = object(raw?.data)
  if (Number(raw?.code) === 1014) return fail('บัญชีผู้รับเงินในสลิปไม่ตรงกับบัญชีของแพลตฟอร์ม')
  if (raw?.success !== true || data?.success !== true || !data) return fail('ไม่สามารถยืนยันผลการตรวจสลิปได้')
  const amount = satang(result.amount)
  if (amount === null || satang(data.amount) !== amount) return fail('ไม่สามารถยืนยันยอดเงินในสลิปได้ กรุณาตรวจสอบสลิปแล้วลองอีกครั้ง')
  if (minimumAmount ? amount < price : amount !== price) {
    return fail(`ยอดเงินในสลิป ${(amount / 100).toFixed(2)} บาท ${minimumAmount ? 'น้อยกว่า' : 'ไม่ตรงกับ'}ยอดชำระ ${session.price_baht.toFixed(2)} บาท กรุณาแนบสลิปที่มียอด${minimumAmount ? 'ไม่น้อยกว่า' : 'ตรงกับ'}ยอดชำระ`)
  }
  const reference = typeof result.transRef === 'string' ? result.transRef.trim() : ''
  if (!reference || reference.length > 200 || /[\u0000-\u001f\u007f]/.test(reference)
    || typeof data.transRef !== 'string' || data.transRef.trim() !== reference) return fail('ไม่พบเลขอ้างอิงธุรกรรมที่ถูกต้องในสลิป')

  if (receiverCheck === 'provider' && result.receiverVerifiedByProvider !== true) {
    return fail('SlipOK ยังไม่ได้ยืนยันบัญชีผู้รับเงิน กรุณาตรวจสอบการตั้งค่าสาขาแล้วลองอีกครั้ง')
  }
  if (receiverCheck === 'local') {
  const receiver = object(data.receiver)
  const account = object(receiver?.account)
  const proxy = object(receiver?.proxy)
  const expectedProxy = promptPayId(session.receiver_promptpay_id)
  // Slip formats may place the receiving phone in account.value instead of proxy.value.
  const values = [account?.value, proxy?.value]
  const exactProxyMatch = expectedProxy !== null && values.some(value => promptPayId(value) === expectedProxy)
  const proxyMatch = expectedProxy !== null && values.some(value => promptPayId(value) === expectedProxy || accountMatches(expectedProxy, value))
  const bankAccountMatch = values.some(value => accountMatches(session.receiver_account_no, value))
    // A complete registered PromptPay ID identifies the receiver independently of the bank label.
    // Masked digits or bank account numbers still require the expected bank.
    if (bankCode(data.receivingBank) !== expectedBank && !exactProxyMatch) {
      return fail('ธนาคารผู้รับเงินไม่ตรงกับธนาคารของแพลตฟอร์ม และไม่พบหมายเลขพร้อมเพย์ที่ลงทะเบียนไว้ตรงกัน')
    }
    if (!bankAccountMatch && !proxyMatch) {
      return fail('บัญชีผู้รับเงินในสลิปไม่ตรงกับบัญชีของแพลตฟอร์ม')
    }

  }
  const paidAt = transferTime(data)
  const tolerance = 2 * 60 * 1000
  if (paidAt === null) return fail('ไม่พบวันเวลาที่ถูกต้องของธุรกรรมในสลิป')
  if (paidAt < created - tolerance || paidAt > expires || paidAt > now + tolerance) {
    return fail('วันเวลาของสลิปอยู่นอกช่วงชำระเงินของรายการนี้')
  }
  return { ok: true, transRef: reference, paidAt: new Date(paidAt).toISOString(), amount: amount / 100 }
}
