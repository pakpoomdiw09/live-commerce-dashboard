import { supabaseAdmin } from '@/lib/supabase/server'
import {
  resolveCommentSettings,
  renderCommentTemplate,
} from '@/lib/features/commerce/comment-config'
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
  commentRuleTargetsPost,
  commentPostIds,
  liveRuleCandidates,
  liveRulePostId,
} from '@/lib/features/comments/live-comment-routing'
import { answerChat, loadBotSettings } from '@/lib/features/agents/chatbot-server'
import { pendingOrders, placeCfOrder } from '@/lib/features/commerce/orders'
import { replyToMessengerProduct } from '@/lib/features/commerce/messenger-product-server'
import { handleLiveCfComment } from '@/lib/features/commerce/live-cf-comment'
import { liveCfQuantity } from '@/lib/features/commerce/live-cf-codes'
import { handleAuctionComment } from '@/lib/features/commerce/auction-server'
import { createLiveCfPaymentLink } from '@/lib/features/commerce/live-cf-payment-link'
import { createLiveCfMetaAdapter } from '@/lib/integrations/facebook/live-cf-adapter'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { findBank } from '@/lib/features/banking/banks'
import { processSlip } from '@/lib/features/slips/process'
import {
  deliverOnce,
  notifySlipAmountMismatch,
  notifySlipResult,
  type Recipient,
} from '@/lib/features/slips/notify'
import { downloadSlipImage, slipCandidates } from '@/lib/features/slips/image'
import { sendWithMessageCredit } from '@/lib/message-quota'
import { observeFollowUpMessage } from '@/lib/features/follow-ups/followup-ai'
import { queueMessengerVision } from '@/lib/features/vision/vision'
import { inboundBroadcastEvidence } from '@/lib/features/broadcast/broadcast-policy'
import {
  facebookInboundMessage,
  facebookMessageEcho,
  isFacebookSystemDisclosure,
} from '@/lib/integrations/facebook/message-window'
import { InboxAutomationWindowError } from '@/lib/features/inbox/inbox-automation-window'
import { isPaymentQuestion, redactAgentText } from '@/lib/features/agents/agent-control-core'

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
  send_payment_link: boolean
}
type AuctionSlipTarget =
  | { kind: 'none' | 'ambiguous' | 'unmatched' }
  | { kind: 'auction'; auctionId: string; customerTabId: string; amount: number }

async function auctionSlipTarget(
  db: ReturnType<typeof supabaseAdmin>,
  tenantId: string,
  pageId: string,
  customerId: string,
  senderId: string,
): Promise<AuctionSlipTarget> {
  const pending = await db
    .from('orders')
    .select('id,source_id,customer_tab_id,live_auction_id')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .eq('source', 'live_auction')
    .eq('status', 'pending_payment')
  if (pending.error) throw new Error('อ่านยอดรวมออเดอร์ไม่ได้ กรุณาลองอีกครั้ง')
  const orders = pending.data ?? []
  if (!orders.length) return { kind: 'none' }

  const orderIds = orders.map((order) => order.id).filter((id): id is string => !!id)
  if (!orderIds.length) return { kind: 'unmatched' }
  const result = await db
    .from('auctions')
    .select('id,order_id,status,leading_bidder_id')
    .eq('tenant_id', tenantId)
    .eq('page_id', pageId)
    .in('order_id', orderIds)
  if (result.error) {
    if (['42P01', 'PGRST205'].includes(result.error.code)) return { kind: 'unmatched' }
    throw result.error
  }
  const claimOrders = orders.filter((order) => order.live_auction_id)
  let claimMatches: { orderId: string; auctionId: string }[] = []
  if (claimOrders.length) {
    const claims = await db
      .from('auction_winner_claims')
      .select('order_id,auction_id')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .eq('bidder_id', senderId)
      .in(
        'order_id',
        claimOrders.map((order) => order.id),
      )
    if (claims.error) throw claims.error
    const rounds = await db
      .from('auctions')
      .select('id,status')
      .eq('tenant_id', tenantId)
      .eq('page_id', pageId)
      .in(
        'id',
        claimOrders.map((order) => order.live_auction_id),
      )
    if (rounds.error) throw rounds.error
    claimMatches = (claims.data ?? []).flatMap((claim) => {
      const order = claimOrders.find(
        (item) => item.id === claim.order_id && item.live_auction_id === claim.auction_id,
      )
      return order &&
        rounds.data?.some(
          (round) => round.id === claim.auction_id && ['active', 'closed'].includes(round.status),
        )
        ? [{ orderId: order.id, auctionId: claim.auction_id }]
        : []
    })
  }
  const matches = orders.flatMap((order) => {
    const claim = claimMatches.find((item) => item.orderId === order.id)
    if (claim && typeof order.customer_tab_id === 'string')
      return [{ auctionId: claim.auctionId, customerTabId: order.customer_tab_id }]
    const auction = (result.data ?? []).find((candidate) => candidate.order_id === order.id)
    if (
      !auction ||
      auction.status !== 'closed' ||
      auction.leading_bidder_id !== senderId ||
      typeof order.customer_tab_id !== 'string'
    )
      return []
    return [{ auctionId: auction.id as string, customerTabId: order.customer_tab_id }]
  })
  if (!matches.length || matches.length !== orders.length) return { kind: 'unmatched' }
  const tabIds = [...new Set(matches.map((match) => match.customerTabId))]
  if (tabIds.length !== 1) return { kind: 'ambiguous' }
  const tab = await db
    .from('customer_tabs')
    .select('id,remaining_amount')
    .eq('id', tabIds[0])
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .maybeSingle()
  if (tab.error) throw tab.error
  const amount = Number(tab.data?.remaining_amount)
  if (!tab.data || !Number.isFinite(amount) || amount <= 0) return { kind: 'unmatched' }
  return {
    kind: 'auction',
    auctionId: matches[0].auctionId,
    customerTabId: tab.data.id as string,
    amount,
  }
}

async function tenantForPage(pageId: string): Promise<PageTenant | null> {
  const { data, error } = await supabaseAdmin({ timeoutMs: 15000 })
    .from('tenants')
    .select(
      'id, name, page_name, account_name, account_number, bank_code, page_id, page_access_token, auto_reply_enabled, auto_verify_enabled, send_payment_link',
    )
    .eq('page_id', pageId)
    .eq('is_active', true)
    .maybeSingle()
  // Fail closed: without the tenant nothing automatic runs (no slip verification or replies).
  if (error) throw error
  return (data as PageTenant | null) ?? null
}

export async function handleFacebookWebhookEvent(execution: WebhookExecution) {
  const { page_id: pageId, kind, payload } = execution.event
  const value = payload.value
  const isCommentPayload = kind === 'change' &&
    (value?.item === 'comment' || typeof value?.comment_id === 'string' ||
      ['comments', 'live_comments'].includes(payload.field ?? ''))
  const hasFrom = Boolean(value?.from && typeof value.from === 'object')
  const hasFromId = typeof value?.from?.id === 'string' && value.from.id.length > 0
  const isNewComment = kind === 'change' && value?.verb === 'add' &&
    value?.deleted !== true && value?.item === 'comment'
  const supportedCommentField = payload.field === 'feed' || payload.field === 'live_comments' ||
    ['live_videos', 'comments'].includes(payload.field ?? '')
  const legacyCommentFieldsValid = typeof value?.comment_id === 'string' && !!value.comment_id &&
    typeof value?.message === 'string' && !!value.message.trim() && hasFromId
  const canRouteComment = isNewComment && supportedCommentField &&
    (payload.field === 'feed' || payload.field === 'live_comments' || legacyCommentFieldsValid)
  const commentSkipReason = value?.verb !== 'add' ? 'NOT_ADD'
    : value?.deleted === true ? 'DELETED'
    : value?.item !== 'comment' ? 'NOT_COMMENT_ITEM'
    : !supportedCommentField ? 'UNSUPPORTED_FIELD'
    : !value?.comment_id ? 'MISSING_COMMENT_ID'
    : typeof value?.message !== 'string' || !value.message.trim() ? 'MISSING_MESSAGE'
    : !hasFromId ? 'MISSING_FROM_ID' : 'COMMENT_FILTERED'
  if (isCommentPayload) console.info('[live-cf/comment] payload diagnostic', {
    has_from: hasFrom,
    has_from_id: hasFromId,
    decision: canRouteComment ? 'sent_to_comment_handler' : 'skipped',
    reason: canRouteComment ? null : commentSkipReason,
  })
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
  else if (canRouteComment) {
    await onComment(value, pageId, tenant, execution)
  } else if (kind === 'change') {
    console.info('[live-cf/comment] skipped', {
      has_from: hasFrom,
      has_from_id: hasFromId,
      decision: 'skipped',
      reason: isCommentPayload ? commentSkipReason : 'NOT_NEW_COMMENT',
    })
  }
}

/** Only signed Meta events for this Page/customer can mark outgoing messages delivered/read. */
export async function recordReceipt(ev: any, tenantId: string, pageId: string) {
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
  if (Array.isArray(ev.delivery?.mids) && ev.delivery.mids.length) {
    const mids = ev.delivery.mids.filter((id: unknown) => typeof id === 'string').slice(0, 100)
    const result = await db
      .from('messages')
      .update({ delivery_status: 'delivered' })
      .eq('customer_id', customer.data.id)
      .in('provider_message_id', mids)
      .in('delivery_status', ['sent', 'pending', 'unknown'])
    if (result.error) throw result.error
    const broadcast = await db
      .from('broadcast_deliveries')
      .update({ status: 'delivered' })
      .eq('tenant_id', tenantId)
      .eq('customer_id', customer.data.id)
      .in('provider_message_id', mids)
      .eq('status', 'accepted')
    if (broadcast.error) {
      console.error('[facebook-webhook/receipt] broadcast delivery update failed', {
        code: broadcast.error.code,
      })
      throw broadcast.error
    }
  }
  if (
    typeof ev.read?.watermark === 'number' &&
    Number.isSafeInteger(ev.read.watermark) &&
    ev.read.watermark <= Date.now() + 120000 &&
    ev.read.watermark > 0
  ) {
    const result = await db
      .from('messages')
      .update({ delivery_status: 'read' })
      .eq('customer_id', customer.data.id)
      .neq('sender', 'customer')
      .not('provider_message_id', 'is', null)
      .lte('created_at', new Date(ev.read.watermark).toISOString())
      .in('delivery_status', ['sent', 'delivered', 'pending', 'unknown'])
    if (result.error) throw result.error
    const broadcast = await db
      .from('broadcast_deliveries')
      .update({ status: 'read' })
      .eq('tenant_id', tenantId)
      .eq('customer_id', customer.data.id)
      .lte('accepted_at', new Date(ev.read.watermark).toISOString())
      .in('status', ['accepted', 'delivered'])
    if (broadcast.error) {
      console.error('[facebook-webhook/receipt] broadcast read update failed', {
        code: broadcast.error.code,
      })
      throw broadcast.error
    }
  }
}

async function onMessage(
  ev: any,
  pageId: string,
  tenant: PageTenant | null,
  execution: WebhookExecution,
) {
  if (tenant && facebookMessageEcho(ev, pageId, execution.event.created_at)) {
    await execution.assertLease()
    const result = await supabaseAdmin({ timeoutMs: 15000 }).rpc('persist_facebook_message_echo', {
      p_event: execution.event.id,
      p_claim: execution.event.claim_token,
      p_tenant: tenant.id,
      p_app: (process.env.FB_APP_ID || process.env.NEXT_PUBLIC_FB_APP_ID || '').trim(),
    })
    if (result.error) {
      console.error('[facebook-webhook/echo] persistence failed', {
        eventId: execution.event.id,
        code: result.error.code,
      })
      throw result.error
    }
    if (!result.data || (!result.data.id && result.data.ignored !== true))
      throw new Error('ECHO_PERSISTENCE_INVALID')
    console.info('[facebook-webhook/echo] persisted', {
      eventId: execution.event.id,
      recordId: result.data?.id,
      ignored: result.data?.ignored,
      reason: result.data?.reason,
    })
    return
  }
  if (tenant && (ev.delivery || ev.read)) {
    await recordReceipt(ev, tenant.id, pageId)
    return
  }
  const incoming = facebookInboundMessage(ev, pageId, execution.event.created_at)
  if (!incoming) {
    console.info('[facebook-webhook/message] skipped', {
      parsed: false,
      reason: isFacebookSystemDisclosure(ev?.message?.text)
        ? 'FACEBOOK_SYSTEM_DISCLOSURE'
        : 'INELIGIBLE',
    })
    await execution.persistRecord(tenant?.id ?? null)
    return
  }
  if (!tenant) {
    const error = Object.assign(new Error('Facebook Page is not linked to an active tenant'), {
      code: 'PAGE_NOT_LINKED',
    })
    // The signed event is already durable. Retry after the Page is connected;
    // never acknowledge persistence into an invisible tenant_id=null conversation.
    throw error
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
  if (stored.ignored) {
    console.info('[facebook-webhook/message] not inserted', {
      parsed: true,
      outcome: 'ignored',
    })
    return
  }
  let customer = stored.customer
  if (!customer || !stored.id) throw new Error('MESSAGE_PERSISTENCE_INVALID')
  console.info('[facebook-webhook/message] persisted', {
    duplicate: stored.duplicate,
    parsed: true,
    has_sender: Boolean(incoming.senderId),
    has_message_id: Boolean(incoming.messageId),
    has_text: typeof m.text === 'string' && m.text.trim().length > 0,
    attachment_count: Array.isArray(m.attachments) ? m.attachments.length : 0,
  })
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

  let shippingHandled = false
  // Load the optional shipping module only for address-like text or its confirmation button.
  if (
    tenant &&
    typeof m.text === 'string' &&
    (/ที่อยู่|ตำบล|ต\.|แขวง|อำเภอ|อ\.|เขต|จังหวัด|จ\.|รหัสไปรษณีย์|[๐-๙]{5}|\d{5}|(?:^|\s)(?:0[1-9][\d\s-]{7,12}|\+66)/.test(
      m.text,
    ) ||
      String(m.quick_reply?.payload || '').startsWith('SHIPPING_CONFIRM:'))
  ) {
    const { shippingMessageIntent, handleShippingMessage } =
      await import('@/lib/features/shipping/shipping-messenger')
    if (shippingMessageIntent(m.text, m.quick_reply?.payload))
      shippingHandled = await handleShippingMessage({
        db,
        tenantId: tenant.id,
        pageId,
        recipient: { id: customer.id, psid, token },
        messageId: message.id,
        text: m.text,
        quickReply: m.quick_reply?.payload,
        mayReply: customer.bot_enabled && tenant.auto_reply_enabled,
        execution,
      })
    if (shippingHandled && !m.attachments?.length) return
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
            code: profileError.code,
          })
        } else if (savedProfile) {
          console.log('[fb webhook] customer profile saved', {
            tenantId: savedProfile.tenant_id,
            namePresent: Boolean(savedProfile.display_name),
            avatarPresent: Boolean(savedProfile.avatar_url),
            updatedFields: Object.keys(profile),
          })
        } else {
          console.warn('[fb webhook] customer profile not saved: no matching tenant/PSID', {
            tenantId: tenant.id,
          })
        }
      } else {
        console.warn('[fb webhook] customer profile unchanged: Graph returned no usable profile', {
          tenantId: tenant.id,
        })
      }
    } catch {
      console.warn('[fb webhook] customer profile refresh failed')
    }
  }

  // A Page not linked to a tenant has no configured receiver or billing context.
  // Keep the message for a platform admin and stop before verification or replies.
  if (!tenant) return

  // Auto-reply is on when the tenant allows it and the admin hasn't taken this chat over
  const autoReply = customer.bot_enabled && tenant.auto_reply_enabled
  if (typeof m.text === 'string' && isPaymentQuestion(m.text)) {
    console.log('[DEBUG_AI_TRACE]', {
      stage: 'webhook_ingest',
      message: redactAgentText(m.text).slice(0, 160),
      intent: 'payment',
      customerId: customer.id,
      tenantId: tenant.id,
      hasOrders: null,
      error: autoReply
        ? null
        : !customer.bot_enabled
          ? 'CUSTOMER_BOT_DISABLED'
          : 'TENANT_AUTO_REPLY_DISABLED',
    })
  }
  if (!autoReply)
    console.info('[facebook-webhook/ai] auto-reply skipped', {
      messageId: message.id,
      reason: !customer.bot_enabled
        ? 'CUSTOMER_BOT_DISABLED_OR_HUMAN_HANDOVER'
        : 'TENANT_AUTO_REPLY_DISABLED',
    })
  const recipient: Recipient = { id: customer.id, psid, token }

  // Slip verification follows Auto-Pilot and billing state, independently of AI/human chat takeover.
  // Queue checkpoints prevent duplicate verification or replies after a worker retry.
  const images = m.sticker_id ? [] : slipCandidates(m.attachments)
  if (images.length > 0) {
    console.info('[WEBHOOK_SLIP_START]', {
      eventId: execution.event.id,
      messageId: message.id,
      tenantId: tenant.id,
      customerId: customer.id,
      hasText: typeof m.text === 'string' && m.text.trim().length > 0,
      imageCount: images.length,
      autoVerifyEnabled: tenant.auto_verify_enabled,
      customerBotEnabled: customer.bot_enabled,
      tenantAutoReplyEnabled: tenant.auto_reply_enabled,
    })
  }
  if (Array.isArray(m.attachments) && m.attachments.length) {
    console.info('[slip/webhook] image candidates inspected', {
      eventId: execution.event.id,
      messageId: message.id,
      tenantId: tenant.id,
      customerId: customer.id,
      attachmentCount: m.attachments.length,
      imageCandidateCount: images.length,
      attachmentTypes: m.attachments.map((attachment: any) => attachment?.type ?? 'invalid'),
      autoVerifyEnabled: tenant.auto_verify_enabled,
      reason: m.sticker_id
        ? 'STICKER_IGNORED'
        : images.length
          ? 'IMAGE_CANDIDATES_FOUND'
          : 'NO_IMAGE_TYPE_OR_URL',
    })
  }
  // Route the entire message once. Completing one order payment must not turn
  // another image from that message into a standalone verification on a retry.
  const slipRoute: AuctionSlipTarget | { kind: 'order' | 'standalone' | 'none' } =
    tenant.auto_verify_enabled && images.length > 0
      ? await execution.once('slip-image-route', async () => {
          const auction = await auctionSlipTarget(db, tenant.id, pageId, customer.id, psid)
          if (auction.kind !== 'none') return auction
          const pending = await pendingOrders(db, customer.id, tenant.id)
          if (pending.ids.length) {
            if (!Number.isFinite(pending.total) || pending.total <= 0)
              throw new Error('PENDING_PAYMENT_TOTAL_INVALID')
            return { kind: 'order' } as const
          }
          // No pending bill: verify the image as a standalone slip even when AI is off
          // or the admin has taken over this conversation.
          return { kind: 'standalone' } as const
        })
      : { kind: 'none' }
  if (images.length) {
    console.info('[slip/webhook] verification route selected', {
      messageId: message.id,
      tenantId: tenant.id,
      customerId: customer.id,
      autoVerifyEnabled: tenant.auto_verify_enabled,
      route: slipRoute.kind,
      reason: !tenant.auto_verify_enabled
        ? 'AUTO_VERIFY_DISABLED'
        : slipRoute.kind === 'none'
          ? 'NO_PENDING_BILL_OR_STANDALONE_CHAT_AUTOMATION_DISABLED'
          : slipRoute.kind.toUpperCase(),
    })
  }
  const verifyAuctionSlipImages = slipRoute.kind === 'auction'
  const verifySlipImages = slipRoute.kind === 'order'
  const verifyStandaloneImages = slipRoute.kind === 'standalone'
  const visionRoute =
    verifyStandaloneImages ||
    verifyAuctionSlipImages ||
    slipRoute.kind === 'ambiguous' ||
    slipRoute.kind === 'unmatched' ||
    verifySlipImages
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
    !verifyAuctionSlipImages &&
    slipRoute.kind !== 'ambiguous' &&
    slipRoute.kind !== 'unmatched' &&
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
      slipVerification: verifySlipImages || verifyAuctionSlipImages,
      auctionSlipVerification: verifyAuctionSlipImages,
      auctionSlipAmbiguous: slipRoute.kind === 'ambiguous',
      auctionSlipUnmatched: slipRoute.kind === 'unmatched',
      standaloneVerification: verifyStandaloneImages,
      dedicatedVision: visionQueued,
      imageAssistantDisabled,
      chatVision: imageChat,
    })
  if (verifyAuctionSlipImages && slipRoute.kind === 'auction') {
    for (const url of images) {
      await onAuctionSlipImage(
        url,
        { ...recipient, messageId: message.id },
        tenant,
        execution,
        slipRoute,
      )
    }
  }
  if (slipRoute.kind === 'ambiguous' || slipRoute.kind === 'unmatched')
    console.info('[slip/auction] skipped', {
      messageId: message.id,
      reason:
        slipRoute.kind === 'ambiguous' ? 'MULTIPLE_PENDING_BILLS' : 'SENDER_NOT_AUCTION_WINNER',
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

  if (shippingHandled || visionQueued || (!m.text && !imageChat)) return
  if (!autoReply) return
  const currentBot = await db
    .from('customers')
    .select('bot_enabled')
    .eq('id', customer.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle()
  if (typeof m.text === 'string' && isPaymentQuestion(m.text)) {
    console.log('[DEBUG_AI_TRACE]', {
      stage: 'webhook_dispatch_gate',
      message: redactAgentText(m.text).slice(0, 160),
      intent: 'payment',
      customerId: customer.id,
      tenantId: tenant.id,
      hasOrders: null,
      error: currentBot.error?.code ?? (!currentBot.data?.bot_enabled ? 'CUSTOMER_BOT_DISABLED_AFTER_INGEST' : null),
    })
  }
  if (currentBot.error) throw currentBot.error
  if (!currentBot.data?.bot_enabled) {
    console.info('[facebook-webhook/ai] auto-reply skipped', {
      messageId: message.id,
      reason: 'CUSTOMER_BOT_DISABLED_AFTER_INGEST',
    })
    return
  }
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
        pageId,
        sendPaymentLink: tenant.send_payment_link,
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
  console.info('[slip/standalone] verification started', {
    messageId: customer.messageId,
    tenantId,
    customerId: customer.id,
    hasImageUrl: Boolean(url),
  })
  const { processStandaloneSlip } = await import('@/lib/features/slips/standalone-verifier')
  const { standaloneSlipReply } = await import('@/lib/features/slips/standalone-slip')
  const { notifyStandaloneSlipResult } = await import('@/lib/features/slips/notify')
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
  console.info('[slip/standalone] verification completed', {
    messageId: customer.messageId,
    tenantId,
    customerId: customer.id,
    verdict: result.success ? 'valid' : result.reason,
    ledgerRecorded: result.success,
  })
  await execution.once(`standalone-slip-reply:${key}`, async () => {
    if (result.success) {
      await notifyStandaloneSlipResult(db, result, customer)
    } else {
      await deliverOnce(
        db,
        customer,
        `standalone-slip:${customer.messageId}:${key}`,
        standaloneSlipReply(result),
      )
    }
    return null
  })
}

/** Auction receipts belong to this Messenger sender and may settle in partial transfers. */
async function onAuctionSlipImage(
  url: string,
  customer: Recipient & { messageId: string },
  tenant: PageTenant,
  execution: WebhookExecution,
  target: Extract<AuctionSlipTarget, { kind: 'auction' }>,
) {
  const db = supabaseAdmin({ timeoutMs: 15000 })
  const key = (await import('node:crypto')).createHash('sha256').update(url).digest('hex')
  console.info('[slip/auction] verification started', {
    messageId: customer.messageId,
    tenantId: tenant.id,
    customerId: customer.id,
    auctionId: target.auctionId,
    expectedAmount: target.amount,
    hasImageUrl: Boolean(url),
  })
  const result = await execution.once(`auction-slip-verify:${key}`, async () => {
    const file = await downloadSlipImage(url)
    if (!file) throw new Error('AUCTION_SLIP_DOWNLOAD_UNAVAILABLE')
    const slip = await processSlip(db, {
      file,
      customerId: customer.id,
      messageId: customer.messageId,
      tenant,
      expectedAmount: target.amount,
      customerTabId: target.customerTabId,
      requireAuctionSender: true,
      auctionSenderId: customer.psid,
    })
    if (slip.failure) throw new Error('AUCTION_SLIP_PERSISTENCE_FAILED')
    return slip
  })
  if (result.status !== 'valid' || !result.id) {
    console.info('[slip/auction] not paid', {
      messageId: customer.messageId,
      auctionId: target.auctionId,
      slipId: result.id ?? null,
      verdict: result.status,
    })
    if (result.status === 'amount_mismatch') {
      await execution.once(`auction-slip-mismatch-notify:${result.id ?? key}`, async () => {
        await notifySlipAmountMismatch(
          db,
          result,
          customer,
          result.tabBalance?.remainingAmount ?? target.amount,
        )
        return null
      })
    }
    return
  }
  if (!result.tabBalance || !['pending_payment', 'fully_paid'].includes(result.tabBalance.status))
    throw new Error('AUCTION_PAYMENT_NOT_SETTLED')
  await execution.once(`auction-slip-notify:${result.id}`, async () => {
    await notifySlipResult(db, result, customer, tenant.page_name?.trim() || tenant.name)
    return null
  })
  console.info('[slip/auction] paid', {
    messageId: customer.messageId,
    auctionId: target.auctionId,
    customerTabId: target.customerTabId,
    slipId: result.id,
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
  console.info('[slip/automatic] verification started', {
    messageId: customer.messageId,
    tenantId: tenant.id,
    customerId: customer.id,
    hasImageUrl: Boolean(url),
  })
  await execution.once(
    `slip:${(await import('node:crypto')).createHash('sha256').update(url).digest('hex')}`,
    async () => {
      // Recheck each image: the previous image in an album may already have paid the order.
      const pending = await pendingOrders(db, customer.id, tenant.id)
      if (!pending.ids.length || !Number.isFinite(pending.total) || pending.total <= 0) {
        console.warn('[slip/automatic] skipped', {
          messageId: customer.messageId,
          reason: 'no_pending_payment',
          pendingOrderCount: pending.ids.length,
          expectedAmount: Number.isFinite(pending.total) ? pending.total : null,
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
      console.info('[slip/automatic] verification completed', {
        messageId: customer.messageId,
        tenantId: tenant.id,
        customerId: customer.id,
        slipId: r.id ?? null,
        verdict: r.status,
        amount: r.amount,
        expectedAmount: pending.total,
      })
      if (r.status === 'valid') {
        await notifySlipResult(db, r, customer, tenant.page_name?.trim() || tenant.name)
      } else if (r.status === 'amount_mismatch') {
        await notifySlipAmountMismatch(db, r, customer, r.tabBalance?.remainingAmount ?? pending.total)
      } else {
        console.warn('[slip/automatic] requires review', {
          slipId: r.id ?? null,
          verdict: r.status,
          hasNote: Boolean(r.note),
          reason: 'NOT_A_VERIFIED_PAYMENT',
        })
      }
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
  if (!tenant) {
    console.warn('[live-cf/comment] skipped', { reason: 'NO_TENANT', pageId })
    return
  }
  const db = supabaseAdmin({ timeoutMs: 15000 })
  const context = await db.rpc('facebook_comment_context', {
    p_tenant: tenant.id,
    p_page: pageId,
    p_posts: commentPostIds(v),
  })
  if (context.error) throw context.error
  const settings = resolveCommentSettings(context.data?.session ?? {}, context.data?.settings ?? {})
  const mode = context.data?.mode ?? settings.mode
  // Auctions exclusively own bids and winner confirmations, including rejected confirmations.
  // Tag matching is delegated to the round/session settings, never to a keyword in this handler.
  // Route before customer/comment persistence and product CF matching to prevent double billing.
  if (
    mode !== 'cf' &&
    mode !== 'auto' &&
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
  if (mode === 'auction') {
    console.info('[live-cf/comment] skipped', {
      has_from: Boolean(v.from && typeof v.from === 'object'),
      has_from_id: typeof v.from?.id === 'string' && v.from.id.length > 0,
      decision: 'skipped',
      reason: 'AUCTION_HANDLER_DID_NOT_MATCH',
    })
    return
  }
  // the Page's own replies (including the auto-replies below): never answer them, or rules would loop
  if (v.from?.id === pageId) {
    console.info('[live-cf/comment] skipped', {
      reason: 'PAGE_OWN_COMMENT',
    })
    return
  }
  // Meta leaves out `from` when the app lacks pages_read_engagement / Page Public Content Access,
  // or (in Development mode) when the commenter has no role on the app
  if (!v.from) console.warn('[live-cf/comment] author missing', {
    has_from: false,
    has_from_id: false,
    decision: 'customer_matching_skipped',
    reason: 'NO_COMMENT_AUTHOR',
  })

  if (typeof v.comment_id !== 'string' || !v.comment_id) {
    console.warn('[live-cf/comment] skipped', { reason: 'MISSING_COMMENT_ID', pageId })
    return
  }
  const stored = await execution.persistRecord(tenant?.id ?? null)
  if (stored.duplicate || !stored.id) {
    console.info('[live-cf/comment] skipped', {
      reason: stored.duplicate ? 'DUPLICATE_COMMENT' : 'COMMENT_NOT_STORED',
    })
    return
  }
  if (typeof v.message !== 'string') {
    console.warn('[live-cf/comment] skipped', {
      reason: 'NO_TEXT',
    })
    return
  }
  const rules = await loadCommentRules(db, tenant.id, pageId)
  const psid = typeof v.from?.id === 'string' ? v.from.id : null
  if (!psid && v.from) console.warn('[live-cf/comment] author id missing', {
    has_from: true,
    has_from_id: false,
    decision: 'customer_matching_skipped',
    reason: 'NO_COMMENT_AUTHOR_ID',
  })
  const liveEnabled = mode !== 'auto' && isFeatureEnabled('live_cf')
  const liveRules = rules.filter((r) => r.mode === 'live_cf')
  const matches = liveRules.map((rule) => ({ rule, code: liveRuleCode(rule, v.message) }))
  const possibleLive = liveEnabled ? matches.filter((m) => m.code).map((m) => m.rule) : []
  console.info('[live-cf/match] evaluated', {
    eventId: execution.event.id,
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
      pageId,
      postIds: ids,
      liveEvidence: live,
      candidateCount: candidates.length,
      selection,
    })
    if (selection?.ambiguous) {
      console.warn('[live-cf] ambiguous rules; no order created')
      return
    }
    if (selection) {
      const selectedRule = possibleLive.find((rule) => rule.id === selection.ruleId)
      if (!selectedRule) {
        console.warn('[live-cf/comment] skipped', {
          reason: 'SELECTED_RULE_CHANGED',
          ruleId: selection.ruleId,
        })
        return
      }
      if (!selectedRule.inbox_enabled && !selectedRule.reply_enabled)
        console.warn('[live-cf/reply] disabled', {
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
        { text: v.message, commentId: v.comment_id, code: selection.code, quantity: liveCfQuantity(v.message) },
        {
          placeOrder: async (code, quantity) => {
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
                quantity,
              }),
            )
            console.info('[live-cf/order]', {
              ruleId: selection.ruleId,
              postId: selection.postId,
              status: order.status,
              requestedQuantity: quantity,
              acceptedQuantity: order.status === 'created' ? order.quantity : null,
              quantityClamped: order.status === 'created' && order.quantityClamped,
            })
            return order
          },
          getPayment: () => primaryBankPayment(db, tenant.id, selectedRule.live_bank_account_id),
          getPendingTotal: async () =>
            (await pendingOrders(db, stored.customer!.id, tenant.id)).total,
          getPaymentLink: (orderId) =>
            tenant.send_payment_link ? createLiveCfPaymentLink(orderId) : null,
          includePaymentLink: tenant.send_payment_link === true,
          getCumulativeBill: async (orderId) => {
            const { tabForOrder, customerTabSummary } =
              await import('@/lib/features/commerce/customer-tabs-server')
            const tab = await tabForOrder(db, orderId)
            if (!tab) return null
            return (
              await customerTabSummary(
                db,
                tab,
                'รับรายการ CF ใหม่แล้วครับ สรุปยอดสะสมในไลฟ์นี้ดังนี้',
                tenant.send_payment_link,
              )
            ).privateText
          },
          privateTemplate: selectedRule.inbox_text,
          publicTemplate: selectedRule.reply_text,
          customerName: v.from?.name ?? '',
          sendPrivateReply: selectedRule.inbox_enabled
            ? (message) =>
                execution
                  .once('comment-cf-private-reply', async () => {
                    const sentText = message.normalize('NFC').trim().slice(0, 2000)
                    console.info('[live-cf/reply] started', {
                      ruleId: selectedRule.id,
                      channel: 'private',
                      recipientType: 'comment_id',
                    })
                    await sendWithMessageCredit(db, tenant.id, () =>
                      meta.sendPrivateText(v.comment_id, sentText),
                    )
                    return sentText
                  })
                  .then((sentText) =>
                    execution.once('comment-cf-private-history', async () => {
                      const chat = await db.from('messages').insert({
                        customer_id: stored.customer!.id,
                        external_id: `cf-bill:${v.comment_id}`,
                        sender: 'bot',
                        // Old completed checkpoints returned null; new ones retain the exact sent text.
                        body: sentText ?? message.normalize('NFC').trim().slice(0, 2000),
                        delivery_status: 'sent',
                      })
                      if (chat.error && chat.error.code !== '23505') throw chat.error
                      console.info('[live-cf/reply] succeeded', {
                        channel: 'private',
                      })
                      return null
                    }),
                  )
            : undefined,
          replyToComment: selectedRule.reply_enabled
            ? (message) =>
                execution.once('comment-cf-public-reply', async () => {
                  console.info('[live-cf/reply] started', {
                    ruleId: selectedRule.id,
                    channel: 'public',
                    recipientType: 'comment_id',
                  })
                  await sendWithMessageCredit(db, tenant.id, () =>
                    meta.sendPublicText(v.comment_id, message),
                  )
                  console.info('[live-cf/reply] succeeded', {
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
      reason: !psid ? 'NO_COMMENT_AUTHOR' : 'NO_CUSTOMER_RECORD',
    })
  }
  if (mode !== 'auto' && psid && stored.customer && isFeatureEnabled('live_cf')) {
    const catalog = await execution.once('comment-catalog-order', async () => {
      const result = await db.rpc('place_facebook_catalog_order', {
        p_tenant: tenant.id,
        p_customer: stored.customer!.id,
        p_page: pageId,
        p_post: commentPostIds(v)[0] ?? null,
        p_comment: v.comment_id,
        p_text: v.message,
      })
      if (result.error) throw result.error
      return result.data?.[0] ?? { r_status: 'no_match' }
    })
    if (catalog.r_status !== 'no_match') {
      const meta = createLiveCfMetaAdapter({
        privateText: (id, text) => sendPrivateReply(pageTokenFor(tenant), id, text, pageId),
        publicText: (id, text) => replyToComment(pageTokenFor(tenant), id, text),
      })
      await handleLiveCfComment(
        { text: v.message, commentId: v.comment_id, code: catalog.r_code },
        {
          placeOrder: async () => ({
            status: catalog.r_status,
            orderId: catalog.r_order_id,
            name: catalog.r_name,
            code: catalog.r_code,
            amount: Number(catalog.r_amount),
            variantLabel: catalog.r_variant_label,
          }),
          getPayment: () => primaryBankPayment(db, tenant.id),
          getPendingTotal: async () =>
            (await pendingOrders(db, stored.customer!.id, tenant.id)).total,
          getPaymentLink: (orderId) =>
            tenant.send_payment_link ? createLiveCfPaymentLink(orderId) : null,
          includePaymentLink: tenant.send_payment_link === true,
          privateTemplate: settings.private_reply_template as string | undefined,
          publicTemplate: settings.public_reply_template as string | undefined,
          customerName: v.from?.name ?? '',
          sendPrivateReply:
            settings.privateReply === false
              ? undefined
              : async (message) => {
                  const sent = await execution.once('catalog-private-send', async () => {
                    await sendWithMessageCredit(db, tenant.id, () =>
                      meta.sendPrivateText(v.comment_id, message),
                    )
                    return message.normalize('NFC').trim().slice(0, 2000)
                  })
                  await execution.once('catalog-private-history', async () => {
                    const result = await db.from('messages').insert({
                      customer_id: stored.customer!.id,
                      external_id: `catalog-reply:${v.comment_id}`,
                      sender: 'bot',
                      body: sent,
                      delivery_status: 'sent',
                    })
                    if (result.error && result.error.code !== '23505') throw result.error
                    return null
                  })
                },
          replyToComment:
            settings.publicReply === false
              ? undefined
              : (message) =>
                  execution.once('catalog-public-send', async () => {
                    await sendWithMessageCredit(db, tenant.id, () =>
                      meta.sendPublicText(v.comment_id, message),
                    )
                    return null
                  }),
        },
      )
      return
    }
  }
  if (stored.customer) {
    await execution.once('general-comment-history', async () => {
      const saved = await db.from('messages').insert({
        customer_id: stored.customer!.id,
        external_id: `facebook-comment:${v.comment_id}`,
        sender: 'customer',
        body: v.message,
      })
      if (saved.error && saved.error.code !== '23505') throw saved.error
      return null
    })
  }
  await runCommentRules(
    stored.id,
    v,
    tenant,
    execution,
    rules.filter((r) => r.mode !== 'live_cf'),
    stored.customer?.id,
    pageId,
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
  customerId?: string,
  pageId = '',
) {
  const db = supabaseAdmin({ timeoutMs: 15000 })
  // without `from` the Page's own auto-replies can't be recognised above: don't answer our own reply text
  if (!v.from && rules.some((r) => r.reply_text?.trim() === v.message.trim())) return
  const postIds = commentPostIds(v)
  const scopedRules = rules.filter((rule) => commentRuleTargetsPost(rule, postIds, pageId))
  const rule = scopedRules.find((r) => ruleMatches(r, v.message))
  console.log('[fb webhook] comment rule evaluated', {
    matched: Boolean(rule),
    activeRuleCount: rules.length,
    postScopedRuleCount: scopedRules.length,
    hasPostId: postIds.length > 0,
  })
  if (!rule) return
  const saved = await db
    .from('comments')
    .update({ rule_id: rule.id })
    .eq('id', commentRowId)
    .eq('tenant_id', tenant.id)
  if (saved.error) throw saved.error

  const token = pageTokenFor(tenant)
  const values = {
    bidder_name: v.from?.name ?? '',
    product_name: '',
    price: '',
    total: '',
    bank_account: '',
  }
  if (rule.inbox_text?.includes('{bank_account}') || rule.reply_text?.includes('{bank_account}')) {
    const bank = await primaryBankPayment(db, tenant.id)
    values.bank_account = bank
      ? `${bank.bankName} ${bank.accountNumber}${bank.accountName ? ` (${bank.accountName})` : ''}`
      : ''
  }
  const jobs: (() => Promise<unknown>)[] = []
  if (rule.reply_enabled && rule.reply_text)
    jobs.push(() =>
      execution.once('comment-public-reply', async () => {
        await sendWithMessageCredit(db, tenant.id, () =>
          replyToComment(token, v.comment_id, renderCommentTemplate(rule.reply_text!, values)),
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
          ? { text: renderCommentTemplate(rule.inbox_text, values) }
          : null
    if (message)
      jobs.push(() =>
        execution
          .once('comment-private-reply', async () => {
            await sendWithMessageCredit(db, tenant.id, () =>
              privateReply(token, v.comment_id, message),
            )
            return null
          })
          .then(() =>
            customerId
              ? execution.once('general-private-history', async () => {
                  const saved = await db.from('messages').insert({
                    customer_id: customerId,
                    external_id: `comment-private:${v.comment_id}`,
                    sender: 'bot',
                    body: 'text' in message ? message.text : null,
                    attachments: 'attachment' in message ? [message.attachment] : [],
                    delivery_status: 'sent',
                  })
                  if (saved.error && saved.error.code !== '23505') throw saved.error
                  return null
                })
              : null,
          ),
      )
  }
  // independent: a failed public reply must not stop the inbox message, and the other way round
  const outcomes = await Promise.allSettled(jobs.map((work) => work()))
  const failed = outcomes.find((result) => result.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
}
