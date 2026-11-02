import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WebhookExecution } from '@/lib/integrations/facebook/webhook-worker'
import { deliverOnce, deliverRichOnce, type Recipient } from '@/lib/features/slips/notify'
import { assertInboxPolicy } from '@/lib/features/inbox/inbox-policy-server'
import {
  parseThaiShippingAddress,
  isShippingConfirmation,
  addressConfirmationText,
} from './thai-address'
import type { ShippingAddress } from './shipping-types'

const optionalMissing = (error: { code?: string } | null) =>
  error && ['42P01', 'PGRST202', 'PGRST205', '42883'].includes(error.code ?? '')
export function shippingMessageIntent(text: string, payload?: unknown) {
  return (
    (typeof payload === 'string' && payload.startsWith('SHIPPING_CONFIRM:')) ||
    isShippingConfirmation(text) ||
    /ตำบล|ต\.|แขวง|อำเภอ|อ\.|เขต|จังหวัด|จ\.|รหัสไปรษณีย์|[๐-๙]{5}|\d{5}|(?:^|\s)(?:0[1-9][\d\s-]{7,12}|\+66)/.test(
      text,
    )
  )
}
export async function handleShippingMessage(input: {
  db: SupabaseClient
  tenantId: string
  pageId: string
  recipient: Recipient
  messageId: string
  text: string
  quickReply?: unknown
  mayReply: boolean
  execution: WebhookExecution
}): Promise<boolean> {
  const { db, tenantId, pageId, recipient, messageId, text, quickReply, execution } = input
  if (!shippingMessageIntent(text, quickReply)) return false
  const confirmation =
    typeof quickReply === 'string'
      ? quickReply.match(/^SHIPPING_CONFIRM:([a-f0-9-]{36})$/i)?.[1]
      : undefined
  let result: {
    handled: boolean
    confirmed?: boolean
    candidateId?: string
    address?: ShippingAddress
  }
  if (confirmation || isShippingConfirmation(text)) {
    result = await execution.once('shipping-address-confirm', async () => {
      const saved = await db.rpc('confirm_shipping_address', {
        p_tenant: tenantId,
        p_customer: recipient.id,
        p_message: messageId,
        p_candidate: confirmation ?? null,
      })
      if (optionalMissing(saved.error)) return { handled: false }
      if (saved.error) throw saved.error
      return saved.data
    })
  } else {
    let address = parseThaiShippingAddress(text)
    if (!address) {
      const recent = await db
        .from('messages')
        .select('body,created_at')
        .eq('customer_id', recipient.id)
        .eq('sender', 'customer')
        .gte('created_at', new Date(Date.now() - 30 * 60_000).toISOString())
        .order('created_at', { ascending: false })
        .limit(6)
      if (recent.error) throw recent.error
      address = parseThaiShippingAddress(
        (recent.data ?? [])
          .slice()
          .reverse()
          .map((message) => message.body || '')
          .join('\n'),
      )
    }
    if (!address) return false
    const extracted = address
    result = await execution.once('shipping-address-capture', async () => {
      const saved = await db.rpc('capture_shipping_address', {
        p_tenant: tenantId,
        p_customer: recipient.id,
        p_message: messageId,
        p_address: extracted,
      })
      if (optionalMissing(saved.error)) return { handled: false }
      if (saved.error) throw saved.error
      return saved.data
    })
  }
  if (!result.handled) return !!confirmation // A stale quick reply must never confirm a different, newer address.
  if (!input.mayReply || process.env.AGENT_CONTROL_KILL_SWITCH === 'true' || !recipient.token)
    return true
  const controls = await db
    .from('customers')
    .select('bot_enabled,agent_opted_out')
    .eq('id', recipient.id)
    .eq('tenant_id', tenantId)
    .single()
  if (controls.error) throw controls.error
  if (!controls.data.bot_enabled || controls.data.agent_opted_out) return true
  await execution.once('shipping-address-reply', async () => {
    await assertInboxPolicy(db, tenantId, recipient.id, pageId, recipient.token!, false)
    if (result.confirmed) {
      await deliverOnce(
        db,
        recipient,
        `shipping-confirmed:${messageId}`,
        'ยืนยันที่อยู่จัดส่งแล้วครับ ทางร้านจะจัดเตรียมรายการที่ชำระครบตามที่อยู่นี้ ขอบพระคุณครับ',
      )
    } else if (result.address && result.candidateId) {
      const key = `shipping-address:${result.candidateId}`
      const body = addressConfirmationText(result.address)
      const sent = await deliverRichOnce(db, recipient, key, body, [
        {
          text: body,
          quick_replies: [
            {
              content_type: 'text',
              title: 'ยืนยันที่อยู่',
              payload: `SHIPPING_CONFIRM:${result.candidateId}`,
            },
          ],
        },
      ])
      if (!sent) {
        const recorded = await db
          .from('messages')
          .select('delivery_status')
          .eq('customer_id', recipient.id)
          .eq('external_id', key)
          .maybeSingle()
        if (recorded.error) throw recorded.error
        if (!['sent', 'delivered', 'read'].includes(recorded.data?.delivery_status ?? ''))
          return null
      }
      const notified = await db
        .from('shipping_address_candidates')
        .update({ notified_at: new Date().toISOString() })
        .eq('id', result.candidateId)
        .eq('tenant_id', tenantId)
        .eq('customer_id', recipient.id)
        .is('notified_at', null)
      if (notified.error) throw notified.error
    }
    return null
  })
  return true
}
