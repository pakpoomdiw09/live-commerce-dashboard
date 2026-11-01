import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { providerPaidAt } from '@/lib/features/payments/payment-pro-core'

const SLIP_CLOCK_DRIFT_MS = 60_000

export class SlipTimestampError extends Error {
  readonly code = 'SLIP_TIMESTAMP_REJECTED'
  constructor(message: string) {
    super(message)
    this.name = 'SlipTimestampError'
  }
}

/** Verify provider/DB times for every order, before either payment pipeline accepts a slip. */
export async function assertSlipOrderTimestamp(
  db: SupabaseClient,
  raw: unknown,
  orderIds: string[],
  tenantId: string,
  customerId: string | null,
) {
  const transferredAt = providerPaidAt(raw)
  if (!transferredAt)
    throw new SlipTimestampError('ไม่พบเวลาทำรายการในสลิป ไม่สามารถยืนยันการชำระเงินได้')

  const ids = [...new Set(orderIds)]
  let query = db
    .from('orders')
    .select('id, created_at')
    .eq('tenant_id', tenantId)
    .eq('status', 'pending_payment')
    .in('id', ids)
  if (customerId) query = query.eq('customer_id', customerId)
  const { data, error } = await query
  if (error) throw new Error('อ่านเวลาสร้างออเดอร์ไม่ได้ กรุณาลองอีกครั้ง')
  if (
    !ids.length ||
    !data ||
    data.length !== ids.length ||
    !ids.every((id) => data.some((o) => o.id === id))
  )
    throw new SlipTimestampError(
      'ออเดอร์เปลี่ยนแปลงหรือไม่พบออเดอร์ที่ต้องชำระ กรุณาตรวจสอบอีกครั้ง',
    )

  const paidAt = Date.parse(transferredAt)
  for (const order of data) {
    const createdAt = typeof order.created_at === 'string' ? Date.parse(order.created_at) : NaN
    if (!Number.isFinite(createdAt))
      throw new SlipTimestampError('ไม่พบเวลาสร้างออเดอร์ ไม่สามารถยืนยันการชำระเงินได้')
    if (paidAt < createdAt - SLIP_CLOCK_DRIFT_MS)
      throw new SlipTimestampError('สลิปนี้ทำรายการก่อนสร้างออเดอร์ ไม่สามารถใช้ชำระเงินได้')
  }
}
