import { supabaseAdmin } from '@/lib/supabase/server'
import {
  getCustomerProfile,
  getPageTokenStatus,
  pageTokenFor,
  privateReply,
  replyToComment,
  type OutgoingMessage,
} from '@/lib/integrations/facebook/client'
import { RULE_COLUMNS, ruleMatches, type CommentRule } from '@/lib/features/comments/comment-rules'
import { answerChat, loadBotSettings } from '@/lib/features/agents/chatbot-server'
import {
  cfCode,
  orderSummaryText,
  pendingOrders,
  placeCfOrder,
  soldOutText,
} from '@/lib/features/commerce/orders'
import { processSlip } from '@/lib/features/slips/process'
import { deliverOnce, notifySlipResult, type Recipient } from '@/lib/features/slips/notify'
import { downloadSlipImage, slipCandidates } from '@/lib/features/slips/image'
import { sendWithMessageCredit } from '@/lib/message-quota'
import { observeFollowUpMessage } from '@/lib/features/follow-ups/followup-ai'
import { queueMessengerVision } from '@/lib/features/vision/vision'
import { inboundBroadcastEvidence } from '@/lib/features/broadcast/broadcast-policy'
import { facebookInboundMessage } from '@/lib/integrations/facebook/message-window'
import { InboxAutomationWindowError } from '@/lib/features/inbox/inbox-automation-window'

import type { WebhookExecution } from '@/lib/integrations/facebook/webhook-worker'

/** Tenant settings the webhook needs. A Page not linked to a tenant in Settings gets null. */
type PageTenant = {
  id: string
  name: string
  account_name: string | null
  account_number: string
  bank_code: string
  page_id: string
  page_access_token: string | null
  auto_reply_enabled: boolean
  auto_verify_enabled: boolean
}

async function tenantForPage(pageId: string): Promise<PageTenant | null> {
  const { data, error } = await supabaseAdmin({ timeoutMs: 15000 })
    .from('tenants')
    .select(
      'id, name, account_name, account_number, bank_code, page_id, page_access_token, auto_reply_enabled, auto_verify_enabled',
    )
    .eq('page_id', pageId)
    .eq('is_active', true)
    .maybeSingle()
  // fail closed: without the tenant nothing automatic runs (no SlipOK credit, no replies)
  if (error) throw error
  return (data as PageTenant | null) ?? null
}

export async function handleFacebookWebhookEvent(execution: WebhookExecution) {
  const { page_id: pageId, kind, payload } = execution.event
  const tenant = await tenantForPage(pageId)
  if (!tenant)
    console.warn(
      '[facebook-webhook/handler] no active tenant for Page; message will not appear in tenant Inbox',
      { eventId: execution.event.id, pageId },
    )
  if (kind === 'message') await onMessage(payload, pageId, tenant, execution)
  else if (
    payload.field === 'feed' &&
    payload.value?.item === 'comment' &&
    payload.value?.verb === 'add'
  ) {
    await onComment(payload.value, pageId, tenant, execution)
  }
}

/** Only signed Meta events for this Page/customer can mark outgoing messages delivered/read. */
async function recordReceipt(ev: any, tenantId: string, pageId: string) {
  if (String(ev.recipient?.id) !== pageId || typeof ev.sender?.id !== 'string') return
  const db = supabaseAdmin({ timeoutMs: 15000 })
  const customer = await db
    .from('customers')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('platform_user_id', ev.sender.id)
    .eq('platform', 'facebook')
    .maybeSingle()
  if (customer.error) throw customer.error
  if (!customer.data) return
  if (ev.delivery?.mids?.length) {
    const mids = ev.delivery.mids.filter((id: unknown) => typeof id === 'string').slice(0, 100)
    const broadcast = await db
      .from('broadcast_deliveries')
      .update({ status: 'delivered' })
      .eq('tenant_id', tenantId)
      .eq('customer_id', customer.data.id)
      .in('provider_message_id', mids)
      .eq('status', 'accepted')
    if (broadcast.error) throw broadcast.error
    const result = await db
      .from('messages')
      .update({ delivery_status: 'delivered' })
      .eq('customer_id', customer.data.id)
      .in('provider_message_id', mids)
      .in('delivery_status', ['sent', 'pending'])
    if (result.error) throw result.error
  }
  if (
    typeof ev.read?.watermark === 'number' &&
    Number.isFinite(ev.read.watermark) &&
    ev.read.watermark <= Date.now() + 120000 &&
    ev.read.watermark > 0
  ) {
    const broadcast = await db
      .from('broadcast_deliveries')
      .update({ status: 'read' })
      .eq('tenant_id', tenantId)
      .eq('customer_id', customer.data.id)
      .lte('accepted_at', new Date(ev.read.watermark).toISOString())
      .in('status', ['accepted', 'delivered'])
    if (broadcast.error) throw broadcast.error
    const result = await db
      .from('messages')
      .update({ delivery_status: 'read' })
      .eq('customer_id', customer.data.id)
      .neq('sender', 'customer')
      .not('provider_message_id', 'is', null)
      .lte('created_at', new Date(ev.read.watermark).toISOString())
      .in('delivery_status', ['sent', 'delivered'])
    if (result.error) throw result.error
  }
}

async function onMessage(
  ev: any,
  pageId: string,
  tenant: PageTenant | null,
  execution: WebhookExecution,
) {
  if (tenant && (ev.delivery || ev.read)) {
    await recordReceipt(ev, tenant.id, pageId)
    return
  }
  const incoming = facebookInboundMessage(ev, pageId, execution.event.created_at)
  if (!incoming) {
    await execution.persistRecord(tenant?.id ?? null)
    return
  }
  const m = ev.message
  const psid = incoming.senderId
  const db = supabaseAdmin({ timeoutMs: 15000 })
  const token = pageTokenFor(tenant ?? { page_id: pageId, page_access_token: null })
  // persistRecord atomically stores the inbound message, last_message_at and
  // window_expires_at = latest verified Meta message time + 24 hours. Never use
  // worker processing time: delayed/replayed webhooks cannot renew an old window.
  // Persist before any optional Graph diagnostics or profile requests.
  const stored = await execution.persistRecord(tenant?.id ?? null)
  if (stored.duplicate || stored.ignored) return
  let customer = stored.customer
  if (!customer || !stored.id) throw new Error('MESSAGE_PERSISTENCE_INVALID')
  const message = { id: stored.id }

  // Profile lookup is optional. Give every persisted Facebook customer a useful
  // identity before calling Graph so a missing permission, expired token or
  // provider timeout can never leave the Inbox dependent on profile delivery.
  if (!customer.display_name?.trim()) {
    const fallbackName = `ลูกค้า Facebook (${psid.slice(-4)})`
    try {
      let fallbackUpdate = db
        .from('customers')
        .update({ display_name: fallbackName })
        .eq('id', customer.id)
        .eq('platform', 'facebook')
        .eq('platform_user_id', psid)
        // Do not overwrite a real name saved concurrently by Graph or an admin.
        .or('display_name.is.null,display_name.eq.')
      fallbackUpdate = tenant
        ? fallbackUpdate.eq('tenant_id', tenant.id)
        : fallbackUpdate.is('tenant_id', null)
      const fallback = await fallbackUpdate.select('id, display_name').maybeSingle()
      if (fallback.error) {
        console.warn('[fb webhook] customer fallback name save failed', {
          tenantId: tenant?.id ?? null,
          senderId: psid,
          code: fallback.error.code,
        })
      } else if (fallback.data?.display_name) {
        customer = { ...customer, display_name: fallback.data.display_name }
      }
    } catch {
      // The message was already committed by persistRecord. Profile decoration
      // must never turn a successful inbound delivery into a failed webhook.
      console.warn('[fb webhook] customer fallback name refresh failed', {
        tenantId: tenant?.id ?? null,
        senderId: psid,
      })
    }
  }
  if (process.env.FB_DEBUG === 'true') {
    console.log('[fb webhook] customer profile token source', {
      pageId,
      tenantId: tenant?.id ?? null,
      source: tenant?.page_access_token?.trim()
        ? 'tenants.page_access_token'
        : token
          ? 'environment fallback'
          : 'missing',
      tokenPresent: Boolean(token),
    })
    if (token) {
      try {
        console.log('[fb webhook] customer profile token status', {
          pageId,
          status: await getPageTokenStatus(token, pageId),
        })
      } catch {
        console.warn('[fb webhook] optional token diagnostics failed', { pageId })
      }
    }
  }

  if (tenant) {
    const evidence = inboundBroadcastEvidence(ev, pageId, Date.parse(execution.event.created_at))
    if (evidence) {
      const saved = await db
        .from('broadcast_messaging_events')
        .upsert(
          { ...evidence, tenant_id: tenant.id, customer_id: customer.id },
          { onConflict: 'tenant_id,event_id', ignoreDuplicates: true },
        )
      if (saved.error) throw saved.error
    }
  }

  if (tenant) {
    try {
      const profile = await getCustomerProfile(token, psid)
      if (Object.keys(profile).length) {
        const { data: savedProfile, error: profileError } = await db
          .from('customers')
          .update(profile)
          .eq('id', customer.id)
          .eq('platform', 'facebook')
          .eq('platform_user_id', psid)
          .eq('tenant_id', tenant.id)
          .select('id, tenant_id, platform_user_id, display_name, avatar_url')
          .maybeSingle()
        if (profileError) {
          console.error('[fb webhook] customer profile save failed', {
            tenantId: tenant.id,
            senderId: psid,
            code: profileError.code,
            message: profileError.message,
          })
        } else if (savedProfile) {
          console.log('[fb webhook] customer profile saved', {
            customerId: savedProfile.id,
            tenantId: savedProfile.tenant_id,
            senderId: savedProfile.platform_user_id,
            namePresent: Boolean(savedProfile.display_name),
            avatarPresent: Boolean(savedProfile.avatar_url),
            updatedFields: Object.keys(profile),
          })
        } else {
          console.warn('[fb webhook] customer profile not saved: no matching tenant/PSID', {
            customerId: customer.id,
            tenantId: tenant.id,
            senderId: psid,
          })
        }
      } else {
        console.warn('[fb webhook] customer profile unchanged: Graph returned no usable profile', {
          tenantId: tenant.id,
          senderId: psid,
        })
      }
    } catch {
      console.warn('[fb webhook] customer profile refresh failed')
    }
  }

  // A Page not linked to a tenant: we don't know whose account a slip should go to, who pays for
  // the SlipOK credit, or what to answer. Keep the message for a platform admin and stop.
  if (!tenant) return

  // Auto-reply is on when the tenant allows it and the admin hasn't taken this chat over
  const autoReply = customer.bot_enabled && tenant.auto_reply_enabled
  const recipient: Recipient = { id: customer.id, psid, token }

  // Slip images sent in chat (SlipOK Auto-Pilot): same pipeline as /api/slips/verify.
  // With Auto-Pilot off the images stay in the chat and an admin can verify them from the dashboard.
  // Queue checkpoints prevent duplicate verification or replies after a worker retry.
  const images = m.sticker_id ? [] : slipCandidates(m.attachments)
  const visionQueued = await queueMessengerVision(db, tenant.id, customer.id, message.id, images)
  if (visionQueued) {
    const expected = images.map((_, index) => `${message.id}:${index}`)
    const queued = await db
      .from('vision_jobs')
      .select('idempotency_key')
      .eq('tenant_id', tenant.id)
      .eq('message_id', message.id)
      .eq('source', 'messenger')
      .in('idempotency_key', expected)
    if (queued.error) throw queued.error
    if (new Set((queued.data ?? []).map((job) => job.idempotency_key)).size !== expected.length)
      throw new Error('VISION_INGESTION_INCOMPLETE')
  }
  const imageChat =
    !visionQueued &&
    autoReply &&
    images.length > 0 &&
    (await loadBotSettings(db, tenant.id))?.reply_mode === 'ai'
  if (Array.isArray(m.attachments) && m.attachments.length)
    console.log('[AI VISION] webhook route', {
      messageId: message.id,
      tenantId: tenant.id,
      imageCount: images.length,
      attachmentTypes: m.attachments.map((a: any) => a?.type ?? 'invalid'),
      sticker: !!m.sticker_id,
      autoReply,
      dedicatedVision: visionQueued,
      chatVision: imageChat,
    })
  if (tenant.auto_verify_enabled && !visionQueued && !imageChat) {
    for (const url of images) {
      await onSlipImage(
        url,
        { ...recipient, messageId: message.id, notify: autoReply },
        tenant,
        execution,
      )
    }
  }

  if (visionQueued || (!m.text && !imageChat)) return
  // CF: the customer typed a product code ("1", "A12", "cf 3")
  if (
    m.text &&
    (await execution.once('cf-order', () =>
      onCfOrder(m.text, recipient, message.id, tenant, autoReply),
    ))
  )
    return
  if (!autoReply) return
  await execution.once('followup-observation', async () => {
    await observeFollowUpMessage(db, tenant.id, customer.id, message.id)
    return null
  })
  const currentBot = await db
    .from('customers')
    .select('bot_enabled')
    .eq('id', customer.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle()
  if (currentBot.error) throw currentBot.error
  if (!currentBot.data?.bot_enabled) return
  await execution.once('chat-answer', async () => {
    try {
      await answerChat(db, {
        tenant,
        customer,
        recipient,
        messageId: message.id,
        text: m.text || 'ช่วยตรวจสอบสินค้าในภาพนี้',
        imageUrls: imageChat ? images : undefined,
      })
    } catch (error) {
      if (error instanceof InboxAutomationWindowError) return null
      throw error
    }
    return null
  })
}

/** true when the text was a product code of this tenant (the order is placed even with auto-reply off). */
async function onCfOrder(
  text: string,
  customer: Recipient,
  messageId: string,
  tenant: PageTenant,
  autoReply: boolean,
) {
  const code = cfCode(text)
  if (!code) return false
  const db = supabaseAdmin({ timeoutMs: 15000 })
  const r = await placeCfOrder(db, {
    tenantId: tenant.id,
    customerId: customer.id,
    messageId,
    code,
  })
  if (r.status === 'no_match') return false
  console.log(`[fb webhook] CF "${code}" → ${r.status}`)
  if (!autoReply) return true // the admin answers this chat by hand; the order is in the dashboard
  const body =
    r.status === 'created'
      ? tenant.account_number && tenant.bank_code
        ? orderSummaryText(r, (await pendingOrders(db, customer.id)).total, tenant)
        : 'รับออเดอร์แล้วค่ะ ขณะนี้ร้านยังไม่มีบัญชีรับเงินที่เปิดใช้งาน กรุณารอแอดมินแจ้งวิธีชำระเงินก่อนโอน'
      : soldOutText(r)
  await deliverOnce(db, customer, `order:${messageId}`, body)
  return true
}

/** notify: reply with the verdict in Messenger (off when auto-reply is off for the tenant or this chat) */
async function onSlipImage(
  url: string,
  customer: Recipient & { messageId: string; notify: boolean },
  tenant: PageTenant,
  execution: WebhookExecution,
) {
  const file = await downloadSlipImage(url)
  if (!file) throw new Error('SLIP_DOWNLOAD_UNAVAILABLE')
  const db = supabaseAdmin({ timeoutMs: 15000 })
  await execution.once(
    `slip:${(await import('node:crypto')).createHash('sha256').update(url).digest('hex')}`,
    async () => {
      // Shared verification loads this customer's outstanding order total from the database.
      const r = await processSlip(db, {
        file,
        customerId: customer.id,
        messageId: customer.messageId,
        tenant,
      })
      if (r.failure) throw new Error('SLIP_PERSISTENCE_FAILED')
      if (customer.notify) await notifySlipResult(db, r, customer, tenant.name)
      return null
    },
  )
}

async function onComment(
  v: any,
  pageId: string,
  tenant: PageTenant | null,
  execution: WebhookExecution,
) {
  // the Page's own replies (including the auto-replies below): never answer them, or rules would loop
  if (v.from?.id === pageId) return
  // Meta leaves out `from` when the app lacks pages_read_engagement / Page Public Content Access,
  // or (in Development mode) when the commenter has no role on the app
  if (!v.from)
    console.warn(
      '[fb webhook] comment has no `from` (check app permissions / Live mode):',
      v.comment_id,
    )

  if (typeof v.comment_id !== 'string' || !v.comment_id) return
  const stored = await execution.persistRecord(tenant?.id ?? null)
  if (stored.duplicate || !stored.id) return
  if (v.message && tenant) await runCommentRules(stored.id, v, pageId, tenant, execution)
}

/** First active rule (oldest first) of this tenant, for this Page, whose keywords match the comment. */
async function runCommentRules(
  commentRowId: string,
  v: any,
  pageId: string,
  tenant: PageTenant,
  execution: WebhookExecution,
) {
  const db = supabaseAdmin({ timeoutMs: 15000 })
  const { data, error } = await db
    .from('comment_rules')
    .select(RULE_COLUMNS)
    .eq('tenant_id', tenant.id)
    .eq('is_active', true)
    .contains('page_ids', [pageId])
    .order('created_at')
  if (error)
    throw new Error(
      `comment rules: ${error.message} (did you run supabase/comment-rules.sql and platform.sql?)`,
    )
  const rules = data as CommentRule[]
  // without `from` the Page's own auto-replies can't be recognised above: don't answer our own reply text
  if (!v.from && rules.some((r) => r.reply_text?.trim() === v.message.trim())) return
  const rule = rules.find((r) => ruleMatches(r, v.message))
  console.log(
    `[fb webhook] comment ${v.comment_id} → ${rule ? `rule "${rule.name}"` : 'no matching rule'}`,
  )
  if (!rule) return
  const saved = await db.from('comments').update({ rule_id: rule.id }).eq('id', commentRowId)
  if (saved.error) throw saved.error

  const token = pageTokenFor(tenant)
  const jobs: (() => Promise<unknown>)[] = []
  if (rule.reply_enabled && rule.reply_text)
    jobs.push(() =>
      execution.once('comment-public-reply', async () => {
        await sendWithMessageCredit(db, tenant.id, () =>
          replyToComment(token, v.comment_id, rule.reply_text!),
        )
        return null
      }),
    )
  if (rule.inbox_enabled) {
    const message: OutgoingMessage | null =
      rule.inbox_type === 'image'
        ? rule.inbox_image_url
          ? {
              attachment: {
                type: 'image',
                payload: { url: rule.inbox_image_url, is_reusable: true },
              },
            }
          : null
        : rule.inbox_text
          ? { text: rule.inbox_text }
          : null
    if (message)
      jobs.push(() =>
        execution.once('comment-private-reply', async () => {
          await sendWithMessageCredit(db, tenant.id, () =>
            privateReply(token, v.comment_id, message),
          )
          return null
        }),
      )
  }
  // independent: a failed public reply must not stop the inbox message, and the other way round
  const outcomes = await Promise.allSettled(jobs.map((work) => work()))
  const failed = outcomes.find((result) => result.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
}
