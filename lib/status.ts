import type { OrderStatus, SlipStatus } from './types'

/** Status tones are reserved for state: never reuse them for decoration. Always shown with a label. */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export const SLIP_STATUS: Record<SlipStatus, { label: string; tone: Tone }> = {
  pending: { label: 'กำลังตรวจ', tone: 'info' },
  valid: { label: 'ยอดถูกต้อง', tone: 'success' },
  amount_mismatch: { label: 'ยอดไม่ตรง', tone: 'warning' },
  duplicate: { label: 'สลิปซ้ำ', tone: 'danger' },
  fake: { label: 'ไม่พบรายการโอน', tone: 'danger' },
  wrong_receiver: { label: 'บัญชีผู้รับไม่ตรง', tone: 'danger' },
  error: { label: 'ตรวจไม่สำเร็จ', tone: 'neutral' },
}

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: Tone }> = {
  new: { label: 'ลูกค้าใหม่', tone: 'neutral' },
  pending_review: { label: 'รอตรวจสลิป', tone: 'warning' },
  paid: { label: 'ชำระเงินแล้ว', tone: 'success' },
  approved: { label: 'อนุมัติแล้ว', tone: 'success' },
  shipped: { label: 'ส่งของแล้ว', tone: 'neutral' },
}

export const ORDER_STATUSES = Object.keys(ORDER_STATUS) as OrderStatus[]

/** A slip still being checked wins over the stored order status: that's what the admin needs to see. */
export function chatBadge(order: OrderStatus, latestSlip?: SlipStatus | null) {
  if (latestSlip === 'pending') return { label: 'รอตรวจสลิป', tone: 'info' as Tone }
  return ORDER_STATUS[order] ?? ORDER_STATUS.new
}

/**
 * A check still 'pending' after this long was cut off (the function hit its time limit before it
 * could save a verdict), so it may be checked again. Shared by the inbox button and the API.
 */
export const STALE_PENDING_MS = 3 * 60_000

/** Slip statuses an admin may still approve by hand (e.g. a bank delay made it 'fake'). */
export const APPROVABLE: SlipStatus[] = ['valid', 'amount_mismatch', 'wrong_receiver', 'fake', 'error']
