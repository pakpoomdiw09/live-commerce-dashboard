import { supabaseAdmin } from '@/lib/supabase/server'
import {
  getCustomerProfile,
  getPageTokenStatus,
  resolveLiveCommentVideo,
  pageTokenFor,
  privateReply,
  replyToComment,
  sendPrivateReply,
  type OutgoingMessage,
} from '@/lib/integrations/facebook/client'
import {
  RULE_COLUMNS,
  LIVE_CF_RULE_COLUMNS,
  liveRuleCode,
  ruleMatches,
  type CommentRule,
} from '@/lib/features/comments/comment-rules'
import {
  commentPostIds,
  liveRuleCandidates,
  liveRulePostId,
} from '@/lib/features/comments/live-comment-routing'
import { answerChat, loadBotSettings } from '@/lib/features/agents/chatbot-server'
import { pendingOrders, placeCfOrder } from '@/lib/features/commerce/orders'
import { replyToMessengerProduct } from '@/lib/features/commerce/messenger-product-server'
import { handleLiveCfComment } from '@/lib/features/commerce/live-cf-comment'
import { handleAuctionComment } from '@/lib/features/commerce/auction-server'
import { createLiveCfPaymentLink } from '@/lib/features/commerce/live-cf-payment-link'
import { createLiveCfMetaAdapter } from '@/lib/integrations/facebook/live-cf-adapter'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { findBank } from '@/lib/features/banking/banks'
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
  page_name: string | null
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
      'id, name, page_name, account_name, account_number, bank_code, page_id, page_access_token, auto_reply_enabled, auto_verify_enabled',
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
  const configuredPageId = process.env.FB_PAGE_ID?.trim()
  console.info('[facebook-webhook/page] resolved', {
    eventId: execution.event.id,
    pageId,
    tenantId: tenant?.id ?? null,
    configuredPageId: configuredPageId || null,
    matchesConfiguredPage: configuredPageId ? String(pageId) === configuredPageId : null,
    routing: 'tenant_page_id',
    blockedByConfiguredPage: false,
    hasPageToken: Boolean(pageTokenFor(tenant)),
    reason: tenant ? 'PAGE_LINKED' : pageId === '0' ? 'PLACEHOLDER_PAGE_ID' : 'PAGE_NOT_LINKED',
  })
  if (!tenant)
    console.warn(
      '[facebook-webhook/handler] no active tenant for Page; message will not appear in tenant Inbox',
      { eventId: execution.event.id, pageId },
    )
  if (kind === 'message') await onMessage(payload, pageId, tenant, execution)
  else if (
    (payload.field === 'feed' || payload.field === 'live_comments') &&
    payload.value?.item === 'comment' &&
    payload.value?.verb === 'add'
  ) {
    await onComment(payload.value, pageId, tenant, execution)
  } else if (kind === 'change') {
    console.info('[live-cf/comment] skipped', {
      reason: 'NOT_NEW_COMMENT',
      pageId,
      field: payload.field,
      item: payload.value?.item,
      verb: payload.value?.verb,
    })
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
      console.info('[fb webhook] inbound message evidence saved', {
        tenantId: tenant.id,
        pageId,
        eventId: evidence.event_id,
        interactedAt: evidence.interacted_at,
      })
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
  // Route the entire message once. Completing one order payment must not turn
  // another image from that message into a standalone verification on a retry.
  const slipRoute =
    tenant.auto_verify_enabled && images.length > 0
      ? await execution.once('slip-image-route', async () => {
          const pending = await pendingOrders(db, customer.id, tenant.id)
          if (pending.ids.length) {
            if (!Number.isFinite(pending.total) || pending.total <= 0)
              throw new Error('PENDING_PAYMENT_TOTAL_INVALID')
            return 'order' as const
          }
          // Standalone replies honor the existing shop/chat automation controls.
          return autoReply ? ('standalone' as const) : ('none' as const)
        })
      : 'none'
  const verifySlipImages = slipRoute === 'order'
  const verifyStandaloneImages = slipRoute === 'standalone'
  const visionRoute =
    verifySlipImages || verifyStandaloneImages
      ? false
      : await queueMessengerVision(db, tenant.id, customer.id, message.id, images)
  const visionQueued = visionRoute === true
  const imageAssistantDisabled = visionRoute === 'disabled'
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
    !verifySlipImages &&
    !verifyStandaloneImages &&
    !visionQueued &&
    !imageAssistantDisabled &&
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
      slipVerification: verifySlipImages,
      standaloneVerification: verifyStandaloneImages,
      dedicatedVision: visionQueued,
      imageAssistantDisabled,
      chatVision: imageChat,
    })
  if (verifySlipImages) {
    for (const url of images) {
      await onSlipImage(url, { ...recipient, messageId: message.id }, tenant, execution)
    }
  }
  if (verifyStandaloneImages) {
    for (const url of images)
      await onStandaloneSlipImage(
        url,
        { ...recipient, messageId: message.id },
        tenant.id,
        execution,
      )
    return
  }

  if (visionQueued || (!m.text && !imageChat)) return
  if (!autoReply) return
  const currentBot = await db
    .from('customers')
    .select('bot_enabled')
    .eq('id', customer.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle()
  if (currentBot.error) throw currentBot.error
  if (!currentBot.data?.bot_enabled) return
  // Product inquiries answer with a sales-page card; live comments retain their CF order flow.
  if (
    m.text &&
    (await execution.once('product-reply', () =>
      replyToMessengerProduct(db, tenant.id, recipient, message.id, m.text),
    ))
  )
    return
  await execution.once('followup-observation', async () => {
    await observeFollowUpMessage(db, tenant.id, customer.id, message.id)
    return null
  })
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

/** Standalone verification and delivery have separate durable checkpoints. */
async function onStandaloneSlipImage(
  url: string,
  customer: Recipient & { messageId: string },
  tenantId: string,
  execution: WebhookExecution,
) {
  const { processStandaloneSlip } = await import('@/lib/features/slips/standalone-verifier')
  const { standaloneSlipReply } = await import('@/lib/features/slips/standalone-slip')
  const key = (await import('node:crypto')).createHash('sha256').update(url).digest('hex')
  const db = supabaseAdmin({ timeoutMs: 15000 })
  const result = await execution.once(`standalone-slip:${key}`, () =>
    processStandaloneSlip(db, {
      tenantId,
      slipImageUrl: url,
      customerId: customer.id,
      messageId: customer.messageId,
    }),
  )
  await execution.once(`standalone-slip-reply:${key}`, async () => {
    await deliverOnce(
      db,
      customer,
      `standalone-slip:${customer.messageId}:${key}`,
      standaloneSlipReply(result),
    )
    return null
  })
}

/** Automatic verification is pending-order-only; only verified receipts may notify the customer. */
async function onSlipImage(
  url: string,
  customer: Recipient & { messageId: string },
  tenant: PageTenant,
  execution: WebhookExecution,
) {
  const db = supabaseAdmin({ timeoutMs: 15000 })
  await execution.once(
    `slip:${(await import('node:crypto')).createHash('sha256').update(url).digest('hex')}`,
    async () => {
      // Recheck each image: the previous image in an album may already have paid the order.
      const pending = await pendingOrders(db, customer.id, tenant.id)
      if (!pending.ids.length || !Number.isFinite(pending.total) || pending.total <= 0) {
        console.info('[slip/automatic] skipped', {
          messageId: customer.messageId,
          reason: 'no_pending_payment',
        })
        return null
      }
      const file = await downloadSlipImage(url)
      if (!file) throw new Error('SLIP_DOWNLOAD_UNAVAILABLE')
      // Shared verification loads this customer's outstanding order total from the database.
      const r = await processSlip(db, {
        file,
        customerId: customer.id,
        messageId: customer.messageId,
        tenant,
      })
      if (r.failure) throw new Error('SLIP_PERSISTENCE_FAILED')
      if (r.status === 'valid')
        await notifySlipResult(db, r, customer, tenant.page_name?.trim() || tenant.name)
      else console.info('[slip/automatic] silent result', { slipId: r.id, verdict: r.status })
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
  // Auction host commands must be routed before filtering the Page's own replies.
  if (
    tenant &&
    isFeatureEnabled('live_cf') &&
    (await handleAuctionComment({
      value: v,
      tenantId: tenant.id,
      pageId,
      token: pageTokenFor(tenant),
      execution,
    }))
  )
    return
  // the Page's own replies (including the auto-replies below): never answer them, or rules would loop
  if (v.from?.id === pageId) {
    console.info('[live-cf/comment] skipped', {
      reason: 'PAGE_OWN_COMMENT',
      commentId: v.comment_id,
    })
    return
  }
  // Meta leaves out `from` when the app lacks pages_read_engagement / Page Public Content Access,
  // or (in Development mode) when the commenter has no role on the app
  if (!v.from)
    console.warn(
      '[live-cf/comment] NO_COMMENT_AUTHOR; check Page permissions and Meta delivery payload:',
      v.comment_id,
    )

  if (typeof v.comment_id !== 'string' || !v.comment_id) {
    console.warn('[live-cf/comment] skipped', { reason: 'MISSING_COMMENT_ID', pageId })
    return
  }
  const stored = await execution.persistRecord(tenant?.id ?? null)
  if (stored.duplicate || !stored.id) {
    console.info('[live-cf/comment] skipped', {
      reason: stored.duplicate ? 'DUPLICATE_COMMENT' : 'COMMENT_NOT_STORED',
      commentId: v.comment_id,
    })
    return
  }
  if (typeof v.message !== 'string' || !tenant) {
    console.warn('[live-cf/comment] skipped', {
      reason: !tenant ? 'NO_TENANT' : 'NO_TEXT',
      commentId: v.comment_id,
    })
    return
  }
  const db = supabaseAdmin({ timeoutMs: 15000 })
  const rules = await loadCommentRules(db, tenant.id, pageId)
  const psid = typeof v.from?.id === 'string' ? v.from.id : null
  const liveEnabled = isFeatureEnabled('live_cf')
  const liveRules = rules.filter((r) => r.mode === 'live_cf')
  const matches = liveRules.map((rule) => ({ rule, code: liveRuleCode(rule, v.message) }))
  const possibleLive = liveEnabled ? matches.filter((m) => m.code).map((m) => m.rule) : []
  console.info('[live-cf/match] evaluated', {
    eventId: execution.event.id,
    commentId: v.comment_id,
    pageId,
    tenantId: tenant.id,
    liveEnabled,
    textLength: v.message.length,
    activeRuleCount: rules.length,
    liveRules: matches.map(({ rule, code }) => ({
      ruleId: rule.id,
      matchType: rule.match_mode ?? rule.match_type,
      keywordCount: rule.keywords.length,
      matchedCode: code,
      productId: rule.live_product_id,
      variantId: rule.live_variant_id,
      livePostId: rule.live_post_id,
      privateEnabled: rule.inbox_enabled,
      publicEnabled: rule.reply_enabled,
    })),
  })
  if (psid && stored.customer) {
    const token = pageTokenFor(tenant)
    let ids = commentPostIds(v)
    let live = execution.event.payload.field === 'live_comments'
    let candidates = liveRuleCandidates(possibleLive, v.message, ids, live)
    // Read-only lookup stays outside durable side-effect checkpoints, so a
    // transient Graph failure can be retried without creating another order.
    if (!candidates.length && possibleLive.length && ids.length) {
      const resolved = await resolveLiveCommentVideo(token, ids[0])
      ids = [...new Set([...ids, ...resolved.ids])]
      live ||= resolved.live
      candidates = liveRuleCandidates(possibleLive, v.message, ids, live)
    }
    const selection = await execution.once('comment-live-selection', async () => {
      if (candidates.length > 1) return { ambiguous: true, ruleId: '', code: '', postId: null }
      return candidates.length
        ? {
            ambiguous: false,
            ruleId: candidates[0].rule.id,
            code: candidates[0].code,
            postId: liveRulePostId(candidates[0].rule, ids),
          }
        : null
    })
    console.info('[live-cf/session] evaluated', {
      eventId: execution.event.id,
      commentId: v.comment_id,
      pageId,
      postIds: ids,
      liveEvidence: live,
      candidateCount: candidates.length,
      selection,
    })
    if (selection?.ambiguous) {
      console.warn('[live-cf] ambiguous rules; no order created', { commentId: v.comment_id })
      return
    }
    if (selection) {
      const selectedRule = possibleLive.find((rule) => rule.id === selection.ruleId)
      if (!selectedRule) {
        console.warn('[live-cf/comment] skipped', {
          commentId: v.comment_id,
          reason: 'SELECTED_RULE_CHANGED',
          ruleId: selection.ruleId,
        })
        return
      }
      if (!selectedRule.inbox_enabled && !selectedRule.reply_enabled)
        console.warn('[live-cf/reply] disabled', {
          commentId: v.comment_id,
          ruleId: selectedRule.id,
          reason: 'BOTH_REPLY_CHANNELS_DISABLED',
        })
      const saved = await db
        .from('comments')
        .update({ rule_id: selection.ruleId })
        .eq('id', stored.id)
        .eq('tenant_id', tenant.id)
      if (saved.error) throw saved.error
      const meta = createLiveCfMetaAdapter({
        privateText: async (commentId, message) =>
          sendPrivateReply(token, commentId, message, pageId),
        publicText: async (commentId, message) => replyToComment(token, commentId, message),
      })
      const handled = await handleLiveCfComment(
        { text: v.message, commentId: v.comment_id, code: selection.code },
        {
          placeOrder: async (code) => {
            const order = await execution.once('comment-cf-order', () =>
              placeCfOrder(db, {
                tenantId: tenant.id,
                customerId: stored.customer!.id,
                commentId: v.comment_id,
                source: 'live_comment',
                ruleId: selection.ruleId,
                pageId,
                postId: selection.postId ?? liveRulePostId(selectedRule, ids),
                code,
              }),
            )
            console.info('[live-cf/order]', {
              commentId: v.comment_id,
              ruleId: selection.ruleId,
              postId: selection.postId,
              status: order.status,
            })
            return order
          },
          getPayment: () => primaryBankPayment(db, tenant.id, selectedRule.live_bank_account_id),
          getPendingTotal: async () =>
            (await pendingOrders(db, stored.customer!.id, tenant.id)).total,
          getPaymentLink: (orderId) => createLiveCfPaymentLink(orderId),
          privateTemplate: selectedRule.inbox_text,
          publicTemplate: selectedRule.reply_text,
          sendPrivateReply: selectedRule.inbox_enabled
            ? (message) =>
                execution.once('comment-cf-private-reply', async () => {
                  console.info('[live-cf/reply] started', {
                    commentId: v.comment_id,
                    ruleId: selectedRule.id,
                    channel: 'private',
                    recipientType: 'comment_id',
                  })
                  await sendWithMessageCredit(db, tenant.id, () =>
                    meta.sendPrivateText(v.comment_id, message),
                  )
                  console.info('[live-cf/reply] succeeded', {
                    commentId: v.comment_id,
                    channel: 'private',
                  })
                  return null
                })
            : undefined,
          replyToComment: selectedRule.reply_enabled
            ? (message) =>
                execution.once('comment-cf-public-reply', async () => {
                  console.info('[live-cf/reply] started', {
                    commentId: v.comment_id,
                    ruleId: selectedRule.id,
                    channel: 'public',
                    recipientType: 'comment_id',
                  })
                  await sendWithMessageCredit(db, tenant.id, () =>
                    meta.sendPublicText(v.comment_id, message),
                  )
                  console.info('[live-cf/reply] succeeded', {
                    commentId: v.comment_id,
                    channel: 'public',
                  })
                  return null
                })
            : undefined,
        },
      )
      if (handled) return
      // A selected live rule that was disabled/changed must not fall through to another bot.
      return
    }
    console.info('[live-cf/comment] skipped', {
      commentId: v.comment_id,
      reason: !liveEnabled
        ? 'LIVE_CF_DISABLED'
        : !liveRules.length
          ? 'NO_ACTIVE_LIVE_RULES'
          : !possibleLive.length
            ? 'NO_MATCHING_LIVE_KEYWORD'
            : 'NO_MATCHING_LIVE_SESSION',
      postIds: ids,
    })
  } else if (possibleLive.length) {
    console.warn('[live-cf/comment] skipped', {
      commentId: v.comment_id,
      reason: !psid ? 'NO_COMMENT_AUTHOR' : 'NO_CUSTOMER_RECORD',
    })
  }
  await runCommentRules(
    stored.id,
    v,
    tenant,
    execution,
    rules.filter((r) => r.mode !== 'live_cf'),
  )
}

async function primaryBankPayment(
  db: ReturnType<typeof supabaseAdmin>,
  tenantId: string,
  accountId?: string | null,
) {
  let query = db
    .from('bank_accounts')
    .select('id,bank_code,account_name,account_number')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
  query = accountId ? query.eq('id', accountId) : query.eq('is_primary', true)
  const account = await query.maybeSingle()
  if (account.error) throw account.error
  if (!account.data) return null
  return {
    bankName: findBank(account.data.bank_code)?.name ?? account.data.bank_code,
    accountName: account.data.account_name,
    accountNumber: account.data.account_number,
  }
}

async function loadCommentRules(
  db: ReturnType<typeof supabaseAdmin>,
  tenantId: string,
  pageId: string,
) {
  const { data, error } = await db
    .from('comment_rules')
    .select(isFeatureEnabled('live_cf') ? LIVE_CF_RULE_COLUMNS : RULE_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .contains('page_ids', [pageId])
    .order('created_at')
  if (error) {
    console.error('[live-cf/rules] lookup failed', {
      tenantId,
      pageId,
      code: error.code,
      message: error.message,
    })
    throw new Error(
      `comment rules: ${error.message} (did you run supabase/comment-rules.sql and platform.sql?)`,
    )
  }
  return (data ?? []) as unknown as CommentRule[]
}

/** General replies never create orders. Live rules have their own explicit execution path. */
async function runCommentRules(
  commentRowId: string,
  v: any,
  tenant: PageTenant,
  execution: WebhookExecution,
  rules: CommentRule[],
) {
  const db = supabaseAdmin({ timeoutMs: 15000 })
  // without `from` the Page's own auto-replies can't be recognised above: don't answer our own reply text
  if (!v.from && rules.some((r) => r.reply_text?.trim() === v.message.trim())) return
  const rule = rules.find((r) => ruleMatches(r, v.message))
  console.log(
    `[fb webhook] comment ${v.comment_id} → ${rule ? `rule "${rule.name}"` : 'no matching rule'}`,
  )
  if (!rule) return
  const saved = await db
    .from('comments')
    .update({ rule_id: rule.id })
    .eq('id', commentRowId)
    .eq('tenant_id', tenant.id)
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
