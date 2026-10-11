import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendPaymentCard, sendText, type PaymentCard } from '@/lib/facebook'
import type { ProcessedSlip } from './process'

const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** The message the customer gets for each verdict. Edit the wording here. */
export function slipReplyText(r: Pick<ProcessedSlip, 'status' | 'amount'>): string {
  switch (r.status) {
    case 'valid':
      return r.amount != null
        ? `ได้รับยอดโอน ${baht(r.amount)} บาทเรียบร้อยแล้วค่ะ ขอบคุณค่ะ 🙏`
        : 'ตรวจสลิปเรียบร้อย ได้รับยอดโอนแล้วค่ะ ขอบคุณค่ะ 🙏'
    case 'amount_mismatch':
      return 'ยอดเงินในสลิปไม่ตรงกับยอดที่ต้องชำระค่ะ แอดมินจะติดต่อกลับเพื่อตรวจสอบอีกครั้งนะคะ'
    case 'duplicate':
      return 'สลิปนี้เคยถูกใช้ไปแล้วค่ะ หากโอนใหม่ รบกวนส่งสลิปของรายการใหม่นะคะ'
    case 'wrong_receiver':
      return 'บัญชีผู้รับในสลิปไม่ใช่บัญชีของร้านค่ะ รบกวนตรวจสอบเลขบัญชีอีกครั้งนะคะ'
    case 'fake':
      return 'ไม่พบรายการโอนตามสลิปนี้ สลิปอาจไม่ถูกต้องค่ะ แอดมินจะตรวจสอบให้อีกครั้งนะคะ'
    default:
      // also covers photos that are not slips at all
      return 'ระบบยังอ่านสลิปจากรูปนี้ไม่ได้ค่ะ หากเป็นสลิปโอนเงิน รบกวนส่งรูปที่ชัดขึ้น หรือรอแอดมินตรวจสอบให้นะคะ'
  }
}

/** Card shown in Messenger for an accepted payment. */
export function paymentCard(slip: { amount: number | null; transRef: string | null }, shopName?: string | null): PaymentCard {
  const parts = [slip.amount != null ? `ยอด ${baht(slip.amount)} บาท` : null, slip.transRef ? `อ้างอิง ${slip.transRef}` : null]
  return {
    title: `✅ ชำระเงินสำเร็จ${shopName ? ` · ${shopName}` : ''}`,
    subtitle: parts.filter(Boolean).join(' · ') || 'ได้รับยอดโอนเรียบร้อยแล้ว ขอบคุณค่ะ',
  }
}

/** A chat customer, and the Page token of the tenant whose Page they wrote to. */
export type Recipient = { id: string; psid: string; token: string | null }

/**
 * Send one bot message, at most once per `externalId`.
 * The row is claimed first (external_id is unique), so a repeated call stops at the insert and
 * never reaches the Send API. Returns false when it had already been sent.
 */
export async function deliverOnce(db: SupabaseClient, customer: Recipient, externalId: string, body: string, card?: PaymentCard) {
  const { data: row, error } = await db
    .from('messages')
    .insert({ customer_id: customer.id, external_id: externalId, sender: 'bot', body })
    .select('id')
    .single()
  if (error?.code === '23505') return false
  if (error || !row) throw new Error(`bot message insert failed: ${error?.message ?? 'no row returned'}`)

  try {
    if (card) {
      // the card is nicer, but plain text works on every client and in more Page setups
      await sendPaymentCard(customer.token, customer.psid, card).catch((e) => {
        console.warn('[notify] payment card rejected, falling back to text', e)
        return sendText(customer.token, customer.psid, body)
      })
    } else {
      await sendText(customer.token, customer.psid, body)
    }
  } catch (e) {
    // keep the dashboard honest: the customer never got this message
    await db.from('messages').update({ body: `[ส่งไม่สำเร็จ] ${body}` }).eq('id', row.id)
    throw e
  }
  return true
}

/** Automatic reply with the verdict, right after a slip from chat was checked. */
export async function notifySlipResult(db: SupabaseClient, slip: ProcessedSlip, customer: Recipient, shopName?: string | null) {
  if (!slip.id) return
  const card = slip.status === 'valid' ? paymentCard(slip, shopName) : undefined
  const sent = await deliverOnce(db, customer, `slip:${slip.id}`, slipReplyText(slip), card)
  if (sent && slip.status === 'valid') await db.from('slips').update({ confirmed_at: new Date().toISOString() }).eq('id', slip.id)
}

/** Admin's "send payment confirmation" button. Returns false if a confirmation already went out. */
export async function sendSlipConfirmation(
  db: SupabaseClient,
  slip: { id: string; amount: number | null; trans_ref: string | null },
  customer: Recipient,
  shopName?: string | null,
) {
  const s = { amount: slip.amount, transRef: slip.trans_ref }
  const sent = await deliverOnce(db, customer, `slip-confirm:${slip.id}`, slipReplyText({ status: 'valid', amount: s.amount }), paymentCard(s, shopName))
  if (sent) await db.from('slips').update({ confirmed_at: new Date().toISOString() }).eq('id', slip.id)
  return sent
}
