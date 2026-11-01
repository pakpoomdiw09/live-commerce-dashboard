import type { SlipResult } from '@/lib/features/slips/slipok'
import { amountSatang, providerPaidAt } from '@/lib/features/payments/payment-pro-core'
import { accountMatches, receiverMatchesAny } from '@/lib/features/slips/receiver-matching'

export type StandaloneSlipData = {
  transRef: string
  amount: number
  sender: string
  senderBank: string | null
  receiver: string
  receiverAccount: string | null
  transTimestamp: string
}
export type StandaloneSlipResult =
  | { success: true; message: string; data: StandaloneSlipData }
  | { success: false; reason: string; message: string }

export const standaloneFailure = (reason: string, message: string): StandaloneSlipResult => ({
  success: false,
  reason,
  message,
})
export const standaloneDuplicate = () => standaloneFailure('duplicate', 'สลิปนี้เคยส่งตรวจแล้ว')
const field = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, 200) : '')

/** Only verified provider fields authorize a ledger entry; a photo/caption is never proof. */
export function validateStandaloneSlip(
  result: SlipResult,
  accounts: { bank_code: string; account_number: string; is_active: boolean }[],
  options: { expectedReceivingAccount?: string; maxAgeHours?: number; now?: number } = {},
): StandaloneSlipResult {
  if (result.verdict === 'duplicate') return standaloneDuplicate()
  if (result.providerFault)
    return standaloneFailure(
      'provider_unavailable',
      'ระบบตรวจสอบสลิปขัดข้องชั่วคราว กรุณารอแอดมินตรวจสอบ',
    )
  const explicitAccount = options.expectedReceivingAccount?.trim()
  const hasReceiver = !!explicitAccount || accounts.some((a) => a.is_active)
  const receiverMatches = explicitAccount
    ? accountMatches(explicitAccount, result.receiverAccount) ||
      accountMatches(explicitAccount, result.receiverProxy)
    : receiverMatchesAny(
        accounts,
        result.receiverBank,
        result.receiverAccount,
        result.receiverProxy,
      )
  const verified =
    result.verdict === 'valid' ||
    (result.verdict === 'wrong_receiver' &&
      result.branchReceiverMismatch === true &&
      hasReceiver &&
      receiverMatches)
  if (!verified)
    return standaloneFailure(
      result.verdict,
      result.verdict === 'wrong_receiver'
        ? 'สลิปนี้ไม่ได้โอนเข้าบัญชีของทางร้าน'
        : result.verdict === 'fake'
          ? 'ไม่พบรายการโอนที่ถูกต้องจากสลิปนี้'
          : 'ไม่สามารถตรวจสอบสลิปนี้ได้ กรุณาส่งรูปสลิปที่ชัดเจนหรือรอแอดมินตรวจสอบ',
    )
  if (hasReceiver && !receiverMatches)
    return standaloneFailure('wrong_receiver', 'สลิปนี้ไม่ได้โอนเข้าบัญชีของทางร้าน')

  const transTimestamp = providerPaidAt(result.raw)
  if (!transTimestamp)
    return standaloneFailure(
      'invalid_timestamp',
      'ไม่พบเวลาทำรายการที่ถูกต้องในสลิป ไม่สามารถยืนยันสลิปได้',
    )
  const now = options.now ?? Date.now()
  const transferredAt = Date.parse(transTimestamp)
  const maxAgeHours = options.maxAgeHours ?? 24
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0 || maxAgeHours > 24)
    return standaloneFailure(
      'invalid_configuration',
      'กำหนดอายุสลิปได้มากกว่า 0 และไม่เกิน 24 ชั่วโมง',
    )
  if (transferredAt > now + 60_000)
    return standaloneFailure(
      'future_timestamp',
      'เวลาทำรายการในสลิปอยู่ในอนาคต ไม่สามารถยืนยันสลิปได้',
    )
  if (now - transferredAt > maxAgeHours * 3_600_000)
    return standaloneFailure(
      'expired',
      `สลิปนี้มีอายุเกิน ${maxAgeHours} ชั่วโมง ไม่สามารถใช้งานได้`,
    )
  const transRef = field(result.transRef)
  const satang = amountSatang(result.amount)
  if (
    !transRef ||
    result.transRef!.trim().length > 200 ||
    satang === null ||
    satang > 999_999_999_999
  )
    return standaloneFailure(
      'invalid_evidence',
      'ข้อมูลยอดเงินหรือรหัสอ้างอิงในสลิปไม่ครบถ้วน ไม่สามารถยืนยันสลิปได้',
    )

  const data = (result.raw as { data?: Record<string, unknown> } | null)?.data
  const sender = data?.sender as { displayName?: unknown; name?: unknown } | undefined
  const receiver = data?.receiver as { displayName?: unknown; name?: unknown } | undefined
  return {
    success: true,
    message: 'ตรวจสอบสลิปถูกต้องเรียบร้อย',
    data: {
      transRef,
      amount: satang / 100,
      sender: field(sender?.displayName) || field(sender?.name) || 'ไม่ระบุชื่อ',
      senderBank: field(data?.sendingBank) || null,
      receiver: field(receiver?.displayName) || field(receiver?.name) || 'ไม่ระบุชื่อ',
      receiverAccount: result.receiverAccount || result.receiverProxy || null,
      transTimestamp,
    },
  }
}

export function standaloneSlipReply(result: StandaloneSlipResult): string {
  if (!result.success) return `⚠️ ตรวจสอบสลิปไม่สำเร็จ\nสาเหตุ: ${result.message}`
  const d = result.data
  return [
    '✅ ตรวจสอบสลิปถูกต้องเรียบร้อย',
    `💰 ยอดโอน: ${d.amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`,
    `👤 ผู้โอน: ${d.sender}`,
    `⏰ เวลาที่โอน: ${new Date(d.transTimestamp).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`,
    `📌 รหัสอ้างอิง: ${d.transRef}`,
    'บันทึกประวัติการตรวจสลิปเรียบร้อยแล้ว',
  ].join('\n')
}
