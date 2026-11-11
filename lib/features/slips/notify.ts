import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  isWindowOrTagError,
  SendApiError,
  sendMessage,
  sendPaymentCard,
  sendText,
  pageTokenFor,
  type MessagingType,
  type PaymentCard,
} from '@/lib/integrations/facebook/client'
import type { Attachment } from '@/lib/types'
import type { ProcessedSlip } from '@/lib/features/slips/process'
import { sendWithMessageCredit } from '@/lib/message-quota'
import { renderSlipConfirmationTemplate } from '@/lib/features/slips/slip-confirmation-template'
import { customerSlipConfirmationTemplate } from '@/lib/features/slips/slip-confirmation-settings'

/** The exact same plain-text receipt is stored in chat and sent to Messenger. */
export function slipConfirmationText(
  amount: number | null,
  pageName?: string | null,
  template?: string | null,
): string {
  return renderSlipConfirmationTemplate(amount, pageName, template)
}

/** The message the customer gets for each verdict. Edit the wording here. */
export function slipReplyText(
  r: Pick<ProcessedSlip, 'status' | 'amount'>,
  pageName?: string | null,
): string {
  switch (r.status) {
    case 'valid':
      return slipConfirmationText(r.amount, pageName)
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

/** A chat customer, and the Page token of the tenant whose Page they wrote to. */
export type Recipient = { id: string; psid: string; token: string | null }

export class BotDeliveryBlockedError extends Error {
  readonly code = 'BOT_DELIVERY_BLOCKED'
  constructor(readonly reason: 'conversation_paused' | 'delivery_busy' | 'window_closed') {
    super(reason)
  }
}

/**
 * Send one bot message, at most once per `externalId`.
 * The row is claimed first (external_id is unique), so a repeated call stops at the insert and
 * never reaches the Send API. Returns false when it had already been sent.
 */
export async function deliverOnce(
  db: SupabaseClient,
  customer: Recipient,
  externalId: string,
  body: string,
  card?: PaymentCard,
) {
  return deliverTextOnce(db, customer, externalId, body, card)
}

/** Only notifySlipResult may grant the verified receipt exception; generic bot sends cannot. */
async function deliverTextOnce(
  db: SupabaseClient,
  customer: Recipient,
  externalId: string,
  body: string,
  card?: PaymentCard,
  verifiedSlipConfirmation = false,
) {
  return claimAndSend(
    db,
    customer,
    externalId,
    body,
    async (meter) =>
      meter(async () => {
        if (card) {
          // the card is nicer, but plain text works on every client and in more Page setups
          await sendPaymentCard(customer.token, customer.psid, card, externalId).catch((e) => {
            // A timeout may have delivered the card. Fall back only after an explicit rejection.
            if (!(e instanceof SendApiError) || e.status >= 500) throw e
            console.warn('[notify] payment card rejected, falling back to text', e)
            return sendText(customer.token, customer.psid, body, 'RESPONSE', externalId)
          })
        } else {
          await sendText(customer.token, customer.psid, body, 'RESPONSE', externalId)
        }
      }),
    [],
    verifiedSlipConfirmation,
  )
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
      for (const m of messages)
        await meter(() => sendMessage(customer.token, customer.psid, m, messagingType, externalId))
    },
    attachments,
  )
}

/** Claim the row (external_id is unique), then send. Returns false when it had already been sent. */
async function claimAndSend(
  db: SupabaseClient,
  customer: Recipient,
  externalId: string,
  body: string,
  send: (meter: (work: () => Promise<void>) => Promise<void>) => Promise<void>,
  attachments: Attachment[] = [],
  verifiedSlipConfirmation = false,
) {
  let lease: string | null = null
  if (
    !verifiedSlipConfirmation &&
    !externalId.startsWith('bc:') &&
    !externalId.startsWith('slip-confirm:')
  ) {
    const started = await db.rpc('start_inbox_delivery', { p_customer: customer.id })
    if (started.error?.code === 'P0424') throw new BotDeliveryBlockedError('window_closed')
    if (started.error?.code === '40001' || started.error?.code === '55P03')
      throw new BotDeliveryBlockedError(
        started.error.code === '55P03' ? 'delivery_busy' : 'conversation_paused',
      )
    if (started.error || !started.data) throw new Error('Cannot acquire bot delivery lease')
    lease = started.data
  }
  try {
    const { data: row, error } = await db
      .from('messages')
      .insert({
        customer_id: customer.id,
        external_id: externalId,
        sender: 'bot',
        body,
        attachments,
        delivery_status: 'pending',
      })
      .select('id')
      .single()
    if (error?.code === '23505') return false
    if (error || !row)
      throw new Error(`bot message insert failed: ${error?.message ?? 'no row returned'}`)

    let completedParts = 0
    try {
      const checkedSend = async (work: () => Promise<void>) => {
        await (
          await import('@/lib/features/inbox/inbox-automation-window')
        ).assertAutomationWindow(db, customer.id)
        if (
          process.env.SNAPBOT_SAFETY_ENABLED === 'true' &&
          !externalId.startsWith('bc:') &&
          (!externalId.startsWith('slip-confirm:') || verifiedSlipConfirmation)
        ) {
          const scope = await db
            .from('customers')
            .select('tenant_id')
            .eq('id', customer.id)
            .single()
          if (scope.error || !scope.data?.tenant_id)
            throw new Error('AUTOMATION_SAFETY_UNAVAILABLE')
          await (
            await import('@/lib/automation-safety')
          ).assertAutomationRunning(db, scope.data.tenant_id)
        }
        await work()
        completedParts++
      }
      // Broadcasts already reserve/settle their batches in the authorized send route.
      if (externalId.startsWith('bc:')) await send(checkedSend)
      else {
        const { data: scope, error: scopeError } = await db
          .from('customers')
          .select('tenant_id')
          .eq('id', customer.id)
          .maybeSingle()
        if (scopeError || !scope?.tenant_id) throw new Error('Message tenant unavailable')
        await send(async (work) => {
          await sendWithMessageCredit(db, scope.tenant_id, () => checkedSend(work))
        })
      }
    } catch (e) {
      // A network timeout can happen after delivery. Keep the durable row and show uncertainty.
      const refused =
        completedParts === 0 &&
        (isWindowOrTagError(e) ||
          (e instanceof SendApiError && e.status < 500) ||
          ['MESSAGE_QUOTA_EXHAUSTED', 'AUTOMATION_STOPPED', 'MESSAGING_WINDOW_CLOSED'].includes(
            (e as { code?: string })?.code ?? '',
          ))
      await db
        .from('messages')
        .update({ delivery_status: refused ? 'failed' : 'unknown' })
        .eq('id', row.id)
      throw e
    }
    const saved = await db.from('messages').update({ delivery_status: 'sent' }).eq('id', row.id)
    if (saved.error) throw new Error('Bot message delivered but status could not be saved')
    return true
  } finally {
    if (lease) {
      const released = await db.rpc('end_inbox_delivery', {
        p_customer: customer.id,
        p_lease: lease,
      })
      if (released.error)
        console.error('[notify] delivery lease release failed', { code: released.error.code })
    }
  }
}

/** Automatic receipts only. Failed/unclear images remain visible to admins without bot replies. */
export async function notifySlipResult(
  db: SupabaseClient,
  slip: ProcessedSlip,
  customer: Recipient,
  shopName?: string | null,
) {
  // An ordinary photo or a provider failure must never trigger an unsolicited failure message.
  // Verified receipts keep their transactional exception to human takeover.
  if (slip.status !== 'valid') {
    console.info('[slip/confirmation] skipped', {
      slipId: slip.id,
      verdict: slip.status,
      reason: 'unverified_silent',
    })
    return false
  }
  if (!slip.id) {
    console.error('[slip/confirmation] skipped', { reason: 'missing_slip_id' })
    return
  }
  try {
    const verified = slip.status === 'valid'
    console.info('[slip/confirmation] started', { slipId: slip.id, verdict: slip.status })
    // Share the durable receipt key with the admin's confirmation button. Neither a webhook
    // replay nor clicking the button afterwards may deliver/charge for the same receipt twice.
    const externalId = verified ? `slip-confirm:${slip.id}` : `slip:${slip.id}`
    if (slip.tabBalance) {
      const latest = await db
        .from('customer_tabs')
        .select('id,total_amount,paid_amount,remaining_amount,status')
        .eq('id', slip.tabBalance.tabId)
        .eq('customer_id', customer.id)
        .single()
      if (latest.error) throw latest.error
      slip = {
        ...slip,
        tabBalance: {
          tabId: latest.data.id,
          totalAmount: Number(latest.data.total_amount),
          paidAmount: Number(latest.data.paid_amount),
          remainingAmount: Number(latest.data.remaining_amount),
          status: latest.data.status,
        },
      }
    }
    const body = slip.tabBalance
      ? `รับยอดโอน ${Number(slip.amount ?? 0).toLocaleString('th-TH')} บาท ตรวจสอบผ่านแล้วครับ\nยอดรวมสะสม ${Number(slip.tabBalance.totalAmount).toLocaleString('th-TH')} บาท\nโอนแล้ว ${Number(slip.tabBalance.paidAmount).toLocaleString('th-TH')} บาท\nยอดค้างชำระสุทธิ ${Number(slip.tabBalance.remainingAmount).toLocaleString('th-TH')} บาท\n${slip.tabBalance.remainingAmount === 0 ? 'ยอดครบถ้วนแล้ว ทางร้านเตรียมจัดส่งให้ครับ' : 'สามารถโอนส่วนที่เหลือเพิ่มเติมได้ครับ ขอบพระคุณครับ'}`
      : verified
        ? slipConfirmationText(
            slip.amount,
            shopName,
            await customerSlipConfirmationTemplate(db, customer.id),
          )
        : slipReplyText(slip, shopName)
    const sent = await deliverTextOnce(db, customer, externalId, body, undefined, verified)
    if (sent && verified)
      await db.from('slips').update({ confirmed_at: new Date().toISOString() }).eq('id', slip.id)
    console.info(sent ? '[slip/confirmation] sent' : '[slip/confirmation] skipped', {
      slipId: slip.id,
      verdict: slip.status,
      reason: sent ? 'meta_accepted' : 'already_processed',
    })
    return sent
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    const internalCode =
      typeof code === 'string' &&
      [
        'BOT_DELIVERY_BLOCKED',
        'MESSAGING_WINDOW_CLOSED',
        'AUTOMATION_STOPPED',
        'MESSAGE_QUOTA_EXHAUSTED',
      ].includes(code)
        ? code
        : undefined
    console.error('[slip/confirmation] delivery failed', {
      slipId: slip.id,
      verdict: slip.status,
      httpStatus: error instanceof SendApiError ? error.status : undefined,
      errorCode: error instanceof SendApiError ? error.code : internalCode,
      errorSubcode: error instanceof SendApiError ? error.subcode : undefined,
      message:
        error instanceof SendApiError
          ? (error.providerMessage ?? error.message)
          : internalCode && error instanceof Error
            ? error.message
            : 'unknown_or_network_failure',
    })
    // Verification is already persisted. Propagate only delivery failure to the webhook's
    // durable side-effect checkpoint; an ambiguous send must never be automatically retried.
    throw error
  }
}

export type SlipConfirmationStatus = 'sent' | 'already_processed' | 'not_applicable' | 'failed'

/** Run after verification commits. A failed notification must not invalidate payment evidence. */
export async function notifyVerifiedSlipForCustomer(
  db: SupabaseClient,
  slip: ProcessedSlip,
  customerId: string | null,
  tenantId: string,
): Promise<SlipConfirmationStatus> {
  if (slip.status !== 'valid' || !slip.id || !customerId) return 'not_applicable'
  try {
    const customer = await db
      .from('customers')
      .select('id,platform,platform_user_id')
      .eq('id', customerId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (customer.error) throw new Error('SLIP_CONFIRMATION_CUSTOMER_LOOKUP_FAILED')
    if (!customer.data) throw new Error('SLIP_CONFIRMATION_CUSTOMER_NOT_FOUND')
    if (customer.data.platform !== 'facebook') return 'not_applicable'
    if (!/^\d+$/.test(customer.data.platform_user_id ?? ''))
      throw new Error('SLIP_CONFIRMATION_PSID_INVALID')
    const tenant = await db
      .from('tenants')
      .select('name,page_name,page_id,page_access_token')
      .eq('id', tenantId)
      .eq('is_active', true)
      .maybeSingle()
    if (tenant.error) throw new Error('SLIP_CONFIRMATION_PAGE_LOOKUP_FAILED')
    if (!tenant.data?.page_id) throw new Error('SLIP_CONFIRMATION_PAGE_NOT_FOUND')
    const token = pageTokenFor(tenant.data)
    if (!token) throw new Error('SLIP_CONFIRMATION_PAGE_TOKEN_MISSING')
    const sent = await notifySlipResult(
      db,
      slip,
      { id: customer.data.id, psid: customer.data.platform_user_id, token },
      tenant.data.page_name?.trim() || tenant.data.name,
    )
    return sent ? 'sent' : 'already_processed'
  } catch (error) {
    const reason =
      error instanceof Error && /^SLIP_CONFIRMATION_[A-Z_]+$/.test(error.message)
        ? error.message
        : 'SLIP_CONFIRMATION_DELIVERY_FAILED'
    console.error('[slip/confirmation] post-verification failed', { slipId: slip.id, reason })
    return 'failed'
  }
}

/** Admin's "send payment confirmation" button. Returns false if a confirmation already went out. */
export async function sendSlipConfirmation(
  db: SupabaseClient,
  slip: { id: string; amount: number | null; trans_ref: string | null },
  customer: Recipient,
  shopName?: string | null,
) {
  const body = slipConfirmationText(
    slip.amount,
    shopName,
    await customerSlipConfirmationTemplate(db, customer.id),
  )
  const sent = await deliverOnce(db, customer, `slip-confirm:${slip.id}`, body)
  if (sent)
    await db.from('slips').update({ confirmed_at: new Date().toISOString() }).eq('id', slip.id)
  return sent
}
