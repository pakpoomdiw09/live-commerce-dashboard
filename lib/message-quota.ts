import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { reserveCredits, settleCredits } from '@/lib/features/billing/billing'

export class MessageQuotaError extends Error {
  readonly code = 'MESSAGE_QUOTA_EXHAUSTED'
  constructor() { super('เครดิตข้อความหมดแล้ว กรุณาเติมเครดิตข้อความ Broadcast S/M/L ที่หน้า /billing') }
}

/** One accepted Meta message = one credit. Reservations are atomic across every sender. */
export async function sendWithMessageCredit(db: SupabaseClient, tenantId: string, send: () => Promise<void>) {
  const reservation = await reserveCredits(db, tenantId, 1)
  if (reservation.monthly + reservation.topup !== 1) {
    await settleCredits(db, tenantId, reservation, 0)
    throw new MessageQuotaError()
  }
  try { await send() } catch (error) {
    await settleCredits(db, tenantId, reservation, 0)
    throw error
  }
}
