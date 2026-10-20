import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isWindowOrTagError, SendApiError, sendMessage, sendPaymentCard, sendText, type MessagingType, type PaymentCard } from '@/lib/integrations/facebook/client'
import type { Attachment } from '@/lib/types'
import type { ProcessedSlip } from '@/lib/features/slips/process'
import { sendWithMessageCredit } from '@/lib/message-quota'

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

export class BotDeliveryBlockedError extends Error {
  readonly code = 'BOT_DELIVERY_BLOCKED'
  constructor(readonly reason: 'conversation_paused' | 'delivery_busy' | 'window_closed') { super(reason) }
}

/**
 * Send one bot message, at most once per `externalId`.
 * The row is claimed first (external_id is unique), so a repeated call stops at the insert and
 * never reaches the Send API. Returns false when it had already been sent.
 */
export async function deliverOnce(db: SupabaseClient, customer: Recipient, externalId: string, body: string, card?: PaymentCard) {
  return claimAndSend(db, customer, externalId, body, async (meter) => meter(async () => {
    if (card) {
      // the card is nicer, but plain text works on every client and in more Page setups
      await sendPaymentCard(customer.token, customer.psid, card).catch((e) => {
        // A timeout may have delivered the card. Fall back only after an explicit rejection.
        if (!(e instanceof SendApiError) || e.status >= 500) throw e
        console.warn('[notify] payment card rejected, falling back to text', e)
        return sendText(customer.token, customer.psid, body)
      })
    } else {
      await sendText(customer.token, customer.psid, body)
    }
  }))
}

/**
 * deliverOnce for messages built by the caller (image, quick replies, several parts in order).
 * `body` is what the dashboard shows for them. UPDATE for messages the Page starts itself.
 */
export async function deliverRichOnce(
  db: SupabaseClient,
  customer: Recipient,
  externalId: string,
  body: string,
  messages: object[],
  messagingType: MessagingType = 'RESPONSE',
  attachments: Attachment[] = [],
) {
  return claimAndSend(
    db,
    customer,
    externalId,
    body,
    async (meter) => {
      for (const m of messages) await meter(() => sendMessage(customer.token, customer.psid, m, messagingType))
    },
    attachments,
  )
}

/** Claim the row (external_id is unique), then send. Returns false when it had already been sent. */
async function claimAndSend(db: SupabaseClient, customer: Recipient, externalId: string, body: string, send: (meter: (work: () => Promise<void>) => Promise<void>) => Promise<void>, attachments: Attachment[] = []) {
  let lease: string | null = null
  if (!externalId.startsWith('bc:') && !externalId.startsWith('slip-confirm:')) {
    const started = await db.rpc(externalId.startsWith('handover:') ? 'start_inbox_handover' : 'start_inbox_delivery', { p_customer: customer.id })
    if (started.error?.code === 'P0424') throw new BotDeliveryBlockedError('window_closed')
    if (started.error?.code === '40001' || started.error?.code === '55P03') throw new BotDeliveryBlockedError(started.error.code === '55P03' ? 'delivery_busy' : 'conversation_paused')
    if (started.error || !started.data) throw new Error('Cannot acquire bot delivery lease')
    lease = started.data
  }
  try {
  const { data: row, error } = await db
    .from('messages')
    .insert({ customer_id: customer.id, external_id: externalId, sender: 'bot', body, attachments, delivery_status: 'pending' })
    .select('id')
    .single()
  if (error?.code === '23505') return false
  if (error || !row) throw new Error(`bot message insert failed: ${error?.message ?? 'no row returned'}`)

  let completedParts = 0
  try {
    const checkedSend = async (work: () => Promise<void>) => {
      await (await import('@/lib/features/inbox/inbox-automation-window')).assertAutomationWindow(db,customer.id)
      if (process.env.SNAPBOT_SAFETY_ENABLED === 'true' && !externalId.startsWith('bc:') && !externalId.startsWith('slip-confirm:')) {
        const scope = await db.from('customers').select('tenant_id').eq('id', customer.id).single()
        if (scope.error || !scope.data?.tenant_id) throw new Error('AUTOMATION_SAFETY_UNAVAILABLE')
        await (await import('@/lib/automation-safety')).assertAutomationRunning(db, scope.data.tenant_id)
      }
      await work()
      completedParts++
    }
    // Broadcasts already reserve/settle their batches in the authorized send route.
    if (externalId.startsWith('bc:')) await send(checkedSend)
    else {
      const { data: scope, error: scopeError } = await db.from('customers').select('tenant_id').eq('id', customer.id).maybeSingle()
      if (scopeError || !scope?.tenant_id) throw new Error('Message tenant unavailable')
      await send(async work => { await sendWithMessageCredit(db, scope.tenant_id, () => checkedSend(work)) })
    }
  } catch (e) {
    // A network timeout can happen after delivery. Keep the durable row and show uncertainty.
    const refused = completedParts === 0 && (isWindowOrTagError(e) || e instanceof SendApiError && e.status < 500 || ['MESSAGE_QUOTA_EXHAUSTED','AUTOMATION_STOPPED','MESSAGING_WINDOW_CLOSED'].includes((e as {code?:string})?.code ?? ''))
    await db.from('messages').update({ delivery_status: refused ? 'failed' : 'unknown' }).eq('id', row.id)
    throw e
  }
  const saved = await db.from('messages').update({ delivery_status: 'sent' }).eq('id', row.id)
  if (saved.error) throw new Error('Bot message delivered but status could not be saved')
  return true
  } finally {
    if (lease) {
      const released = await db.rpc('end_inbox_delivery', { p_customer: customer.id, p_lease: lease })
      if (released.error) console.error('[notify] delivery lease release failed', { code: released.error.code })
    }
  }
}

/** Automatic reply with the verdict, right after a slip from chat was checked. */
export async function notifySlipResult(db: SupabaseClient, slip: ProcessedSlip, customer: Recipient, shopName?: string | null) {
  if (slip.paymentPro && !slip.automationAllowed) return
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
