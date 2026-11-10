import 'server-only'
import { resolveCommentSettings, composeBillingMessage } from './comment-config'
import { customerTabItemLabel } from './customer-tab-types'
import { supabaseAdmin } from '@/lib/supabase/server'
import {
  pageTokenFor,
  replyToComment,
  sendAuctionPrivateReply,
  sendAuctionInvoiceWithReceipt,
  SendApiError,
  needsMessengerSession,
} from '@/lib/integrations/facebook/client'
import { createLiveCfPaymentLink } from './live-cf-payment-link'
import { parseAuctionComment } from '@/lib/integrations/facebook/auction-comment-parser'
import { commentPostIds } from '@/lib/features/comments/live-comment-routing'
import type { WebhookExecution } from '@/lib/integrations/facebook/webhook-worker'
import type { Auction, AuctionResult } from './auction-types'
import { auctionPrivateMessagePlan, isOnDemandWinnerFlow } from './session-automation'
import {
  AUCTION_PRIVATE_TEMPLATE,
  SESSION_WINNER_TEMPLATE,
  AUCTION_BID_TEMPLATE,
  AUCTION_CLOSE_TEMPLATE,
  SESSION_PUBLIC_WINNER_TEMPLATE,
  renderAuctionTemplate,
  auctionPrivateMessage,
} from './auction-templates'

const money = (value: number) => Number(value).toLocaleString('th-TH', { maximumFractionDigits: 2 })
const safeCode = (error: unknown) => {
  if (needsMessengerSession(error)) return 'MESSENGER_SESSION_REQUIRED'
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && /^[A-Z0-9_]{1,80}$/i.test(code)
    ? code
    : 'AUCTION_DELIVERY_FAILED'
}
const billMessageKey = (delivery: {
  auction_id: string
  claim_id?: string
  claim_revision?: number
}) =>
  delivery.claim_id
    ? `auction-claim:${delivery.claim_id}:${delivery.claim_revision}`
    : `auction-bill:${delivery.auction_id}`

/** Claim each final notification atomically; never resend an ambiguous provider result. */
export async function deliverAuctionNotifications(auctionId?: string, claimId?: string) {
  const db = supabaseAdmin({ timeoutMs: 15000 })
  const expired = await db
    .from('auction_deliveries')
    .update({ status: 'requires_review', error_code: 'DELIVERY_LEASE_EXPIRED' })
    .eq('status', 'sending')
    .lt('started_at', new Date(Date.now() - 5 * 60_000).toISOString())
    .select('auction_id,channel,claim_id,claim_revision')
  if (expired.error) throw expired.error
  for (const delivery of expired.data ?? []) {
    if (delivery.channel !== 'private') continue
    const chat = await db
      .from('messages')
      .update({ delivery_status: 'unknown' })
      .eq('external_id', billMessageKey(delivery))
    if (chat.error) throw chat.error
  }
  let query = db
    .from('auction_deliveries')
    .select(
      'id,auction_id,channel,comment_id,claim_id,claim_revision,private_plan,latest_sent_at,latest_recipient_id',
    )
    .eq('status', 'pending')
    .lte('next_attempt_at', new Date().toISOString())
    .order('id')
    .limit(20)
  if (auctionId) query = query.eq('auction_id', auctionId)
  if (claimId) query = query.eq('claim_id', claimId)
  const pending = await query
  if (pending.error) throw pending.error
  // A public comment must never hold up the winning buyer's Messenger bill.
  const deliveries = [...(pending.data ?? [])].sort(
    (a, b) => Number(b.channel === 'private') - Number(a.channel === 'private'),
  )
  for (const delivery of deliveries) {
    const saved = await db.from('auctions').select('*').eq('id', delivery.auction_id).single()
    if (saved.error) throw saved.error
    let auction = saved.data as Auction
    let invoiceItemPrice = Number(auction.current_price)
    if (delivery.claim_id) {
      const claim = await db
        .from('auction_winner_claims')
        .select('*')
        .eq('id', delivery.claim_id)
        .eq('auction_id', auction.id)
        .eq('tenant_id', auction.tenant_id)
        .single()
      if (claim.error) throw claim.error
      if (
        Number(claim.data.revision) !== Number(delivery.claim_revision) ||
        (delivery.channel === 'public' && auction.public_reply_enabled === false)
      ) {
        const superseded = await db
          .from('auction_deliveries')
          .update({ status: 'superseded' })
          .eq('id', delivery.id)
          .eq('status', 'pending')
        if (superseded.error) throw superseded.error
        continue
      }
      invoiceItemPrice = Number(claim.data.highest_amount)
      auction = {
        ...auction,
        order_id: claim.data.order_id,
        current_price: invoiceItemPrice,
        leading_bidder_id: claim.data.bidder_id,
        leading_bidder_name: claim.data.bidder_name,
      }
    } else if (auction.winner_confirmation_comment_id) {
      if (!auction.order_id) {
        const held = await db
          .from('auction_deliveries')
          .update({ status: 'requires_review', error_code: 'WINNER_ORDER_MISSING' })
          .eq('id', delivery.id)
          .eq('status', 'pending')
        if (held.error) throw held.error
        continue
      }
      const winningOrder = await db
        .from('orders')
        .select('item_amount')
        .eq('id', auction.order_id)
        .eq('tenant_id', auction.tenant_id)
        .single()
      if (winningOrder.error) throw winningOrder.error
      if (winningOrder.data.item_amount == null) {
        const held = await db
          .from('auction_deliveries')
          .update({ status: 'requires_review', error_code: 'WINNING_PRICE_MISSING' })
          .eq('id', delivery.id)
          .eq('status', 'pending')
        if (held.error) throw held.error
        continue
      }
      invoiceItemPrice = Number(winningOrder.data.item_amount)
      auction = { ...auction, current_price: invoiceItemPrice }
    }
    const tenant = await db
      .from('tenants')
      .select('page_id,page_access_token')
      .eq('id', auction.tenant_id)
      .eq('page_id', auction.page_id)
      .eq('is_active', true)
      .single()
    if (tenant.error) {
      console.warn('[auction/delivery] Page unavailable; pending', {
        auctionId: auction.id,
        code: safeCode(tenant.error),
      })
      continue
    }
    const token = pageTokenFor(tenant.data)
    // Prepare everything before claiming. Configuration errors remain safe to retry.
    const link = auction.order_id ? createLiveCfPaymentLink(auction.order_id) : null
    if (!token || (delivery.channel === 'private' && !link)) {
      console.warn('[auction/delivery] configuration missing; pending', {
        auctionId: auction.id,
        channel: delivery.channel,
      })
      continue
    }
    let publicValues: Record<string, string> = {}
    if (
      delivery.channel === 'public' &&
      auction.session_automation?.closeKeywords &&
      auction.order_id
    ) {
      const { tabForOrder, customerTabAccount } = await import('./customer-tabs-server')
      const tab = await tabForOrder(db, auction.order_id)
      if (!tab) throw new Error('AUCTION_TAB_UNAVAILABLE')
      publicValues = {
        total: money(tab.total_amount),
        bank_account: await customerTabAccount(db, tab),
      }
    }
    const summary = auction.leading_bidder_id
      ? renderAuctionTemplate(
          auction.session_automation?.closeKeywords
            ? auction.bid_reply_template || SESSION_PUBLIC_WINNER_TEMPLATE
            : auction.close_reply_template || AUCTION_CLOSE_TEMPLATE,
          {
            product_name: auction.item_name,
            bidder_name: auction.leading_bidder_name || 'ลูกค้า',
            price: money(invoiceItemPrice),
            min_step: money(auction.min_step),
            ...publicValues,
          },
        )
      : `ปิดประมูล ${auction.item_name} ยังไม่มีผู้เสนอราคา`
    const message =
      delivery.channel === 'private'
        ? `🎉 ยินดีด้วยครับ! คุณชนะการประมูล\nรายการ: ${auction.item_name}\nยอดประมูล: ${money(invoiceItemPrice)} บาท\nค่าจัดส่ง: ${money(auction.shipping_fee)} บาท\nยอดรวม: ${money(Number(invoiceItemPrice) + Number(auction.shipping_fee))} บาท\nชำระเงิน / แนบสลิป: ${link}`
        : summary
    let billMessage = message
    let buttonMessage = message
    let splitMessages: string[] | null = null
    let splitCustomer: { id: string; fbId: string } | null = null
    // Comment-scoped sender IDs are not necessarily Messenger PSIDs. Resolve the
    // recipient through the order's customer ledger before using the Send API.
    let invoiceRecipient: string | null = null
    if (delivery.channel === 'private' && auction.order_id) {
      const { tabForOrder, customerTabSummary } = await import('./customer-tabs-server')
      const tab = await tabForOrder(db, auction.order_id)
      if (!tab && auction.session_automation) throw new Error('AUCTION_TAB_UNAVAILABLE')
      if (tab) {
        invoiceRecipient = tab.customer_fb_id
        const bill = await customerTabSummary(db, tab)
        const privateTemplate =
          auction.session_automation &&
          (!auction.private_reply_template ||
            auction.private_reply_template === AUCTION_PRIVATE_TEMPLATE)
            ? SESSION_WINNER_TEMPLATE
            : auction.private_reply_template || AUCTION_PRIVATE_TEMPLATE
        const values = {
          product_name: auction.item_name,
          price: money(invoiceItemPrice),
          total: money(auction.session_automation ? tab.total_amount : tab.remaining_amount),
          remaining: money(tab.remaining_amount),
          paid: money(tab.paid_amount),
          payment_link: bill.link,
          bank_account: bill.account,
          bidder_name: auction.leading_bidder_name || 'ลูกค้า',
          min_step: money(auction.min_step),
        }
        const compact = `ยอดรวมสะสม ${money(tab.total_amount)} บาท\nโอนแล้ว ${money(tab.paid_amount)} บาท\nยอดค้างสุทธิ ${money(tab.remaining_amount)} บาท\n${bill.account}\nรายการทั้งหมด / QR / แนบสลิป: ${bill.link}`
        billMessage = auctionPrivateMessage(privateTemplate, values, bill.privateText, compact)
        const rendered = renderAuctionTemplate(privateTemplate, values)
        const items = (tab.customer_tab_items ?? []).filter((item) => !item.cancelled)
        const itemLines = items.length
          ? items
              .map((item) => `${customerTabItemLabel(item)} • ${money(item.amount)} บาท`)
              .join('\n')
          : `[ประมูล] ${auction.item_name} • ${money(invoiceItemPrice)} บาท`
        const shipping = `ค่าจัดส่งครั้งเดียว: ${money(tab.shipping_fee ?? 0)} บาท`
        const fullFooter = `${itemLines}\n${shipping}\n${compact}`
        const footer =
          fullFooter.length <= 638
            ? fullFooter
            : `[ประมูล] ${auction.item_name.slice(0, 80)} • ${money(invoiceItemPrice)} บาท\nดูรายการทั้งหมดในบิล\n${shipping}\n${compact}`
        // Keep ledger totals and the signed link intact when fitting Messenger's button limit.
        const greeting = rendered.replaceAll(bill.link, '').trim()
        buttonMessage = `${greeting.slice(0, Math.max(0, 638 - footer.length))}\n\n${footer}`.trim()
        if (isOnDemandWinnerFlow(auction.session_automation)) {
          const unpaid = await db
            .from('orders')
            .select('id,amount,item_amount,paid_amount')
            .eq('tenant_id', auction.tenant_id)
            .eq('customer_id', tab.customer_id)
            .eq('customer_tab_id', tab.id)
            .eq('live_session_id', tab.live_session_id)
            .eq('status', 'pending_payment')
          if (unpaid.error) throw unpaid.error
          const pendingOrders = (unpaid.data ?? []).filter(
            (order) => Number(order.amount) > Number(order.paid_amount ?? 0),
          )
          const latestOrder = pendingOrders.find((order) => order.id === auction.order_id)
          const latestShipping = latestOrder
            ? Math.max(0, Number(latestOrder.amount) - Number(latestOrder.item_amount))
            : 0
          const singleValues = {
            ...values,
            total: money(Number(invoiceItemPrice) + latestShipping),
            remaining: money(
              latestOrder ? Number(latestOrder.amount) - Number(latestOrder.paid_amount ?? 0) : 0,
            ),
            paid: money(Number(latestOrder?.paid_amount ?? 0)),
          }
          const single = auctionPrivateMessage(
            privateTemplate,
            singleValues,
            '',
            `ยอดประมูลชิ้นนี้: ${money(invoiceItemPrice)} บาท\n🚚 ค่าจัดส่งชิ้นนี้: ${money(latestShipping)} บาท\n🏦 บัญชีโอนเงิน: ${bill.account}\n🔗 ลิงก์ชำระเงิน/แนบสลิป: ${bill.link}`,
          )
          const plan = auctionPrivateMessagePlan({
            enabled:
              !auction.winner_confirmation_comment_id &&
              (!!delivery.private_plan ||
                auction.session_automation?.auto_accumulate_summary !== false),
            hasPreviousUnpaid:
              !!delivery.private_plan ||
              pendingOrders.some((order) => order.id !== auction.order_id),
            name: auction.leading_bidder_name || 'ลูกค้า',
            item: auction.item_name,
            price: Number(invoiceItemPrice),
            shipping:
              pendingOrders.reduce(
                (sum, order) =>
                  sum + Math.round((Number(order.amount) - Number(order.item_amount)) * 100),
                0,
              ) / 100,
            remaining: Number(tab.remaining_amount),
            paid:
              pendingOrders.reduce(
                (sum, order) => sum + Math.round(Number(order.paid_amount ?? 0) * 100),
                0,
              ) / 100,
            items: items
              .filter((item) => pendingOrders.some((order) => order.id === item.order_id))
              .map((item) => ({ name: customerTabItemLabel(item), amount: Number(item.amount) })),
            account: bill.account,
            link: bill.link,
            singleMessage: single,
          })
          if (plan.length === 2) {
            splitMessages = plan
            splitCustomer = { id: tab.customer_id, fbId: tab.customer_fb_id }
            billMessage = plan[1]
          } else {
            billMessage = plan[0]
            buttonMessage = plan[0]
          }
        }
        if (auction.winner_confirmation_comment_id) {
          // A winner confirmation is one complete receipt, even with a custom/short template.
          const billingFooter = [
            `ยืนยันผู้ชนะประมูล: ${auction.leading_bidder_name || 'ลูกค้า'}`,
            `รายการ: ${auction.item_name}`,
            `ราคาประมูลที่ชนะ: ${money(invoiceItemPrice)} บาท`,
            `ค่าจัดส่งของบิล: ${money(tab.shipping_fee ?? auction.shipping_fee)} บาท`,
            `ยอดค้างชำระรวม: ${money(tab.remaining_amount)} บาท`,
            `บัญชีรับเงิน: ${bill.account}`,
            `QR / ชำระเงิน / แนบสลิป: ${bill.link}`,
          ].join('\n')
          billMessage = composeBillingMessage(
            renderAuctionTemplate(privateTemplate, values),
            billingFooter,
          )
          buttonMessage = billMessage
          splitMessages = null
          splitCustomer = null
        }
      }
    }
    // A first-contact private reply must include the full invoice/link in one message.
    // Do not consume its one reply on the first half of a legacy split plan.
    if (splitMessages && splitCustomer && !delivery.latest_sent_at) {
      const customer = await db
        .from('customers')
        .select('window_expires_at')
        .eq('id', splitCustomer.id)
        .eq('tenant_id', auction.tenant_id)
        .eq('platform', 'facebook')
        .eq('platform_user_id', splitCustomer.fbId)
        .maybeSingle()
      if (customer.error) throw customer.error
      if (!(Date.parse(customer.data?.window_expires_at ?? '') > Date.now())) {
        billMessage = splitMessages[1]
        splitMessages = null
        splitCustomer = null
      }
    }
    const claimed = delivery.claim_id
      ? await db.rpc('claim_auction_bill_delivery', {
          p_delivery: delivery.id,
          p_revision: delivery.claim_revision,
        })
      : await db
          .from('auction_deliveries')
          .update({ status: 'sending', started_at: new Date().toISOString() })
          .eq('id', delivery.id)
          .eq('status', 'pending')
          .select('id')
          .maybeSingle()
    if (claimed.error) throw claimed.error
    if (!claimed.data) continue
    let latestSent = !!delivery.latest_sent_at
    try {
      if (delivery.channel === 'private') {
        if (splitMessages && splitCustomer) {
          let summaryReceipt: string | null = null
          let recipient = delivery.latest_recipient_id || splitCustomer.fbId
          if (!delivery.latest_sent_at) {
            const latestText = splitMessages[0]
            const snapshot = await db
              .from('auction_deliveries')
              .update({ private_plan: [latestText, splitMessages[1]] })
              .eq('id', delivery.id)
              .eq('status', 'sending')
            if (snapshot.error) throw snapshot.error
            const summaryQueued = await db
              .from('messages')
              .update({ body: splitMessages[1] })
              .eq('external_id', billMessageKey(delivery))
              .eq('delivery_status', 'pending')
            if (summaryQueued.error) throw summaryQueued.error
            const queued = await db.from('messages').upsert(
              {
                customer_id: splitCustomer.id,
                external_id: `${billMessageKey(delivery)}:latest`,
                sender: 'bot',
                body: latestText,
                delivery_status: 'pending',
              },
              { onConflict: 'external_id', ignoreDuplicates: true },
            )
            if (queued.error) throw queued.error
            const receipt = await sendAuctionInvoiceWithReceipt(
              token,
              recipient,
              latestText,
              {
                id: delivery.comment_id,
                pageId: auction.page_id,
                invoiceText: splitMessages[1],
              },
              `${billMessageKey(delivery)}:latest`,
            )
            if (receipt.privateReply) summaryReceipt = receipt.message_id
            recipient = receipt.recipient_id || recipient
            const progress = await db
              .from('auction_deliveries')
              .update({ latest_sent_at: new Date().toISOString(), latest_recipient_id: recipient })
              .eq('id', delivery.id)
              .eq('status', 'sending')
            if (progress.error) throw progress.error
            latestSent = true
            const latest = await db.from('messages').upsert(
              {
                customer_id: splitCustomer.id,
                external_id: `${billMessageKey(delivery)}:latest`,
                sender: 'bot',
                body: latestText,
                delivery_status: receipt.privateReply ? 'failed' : 'sent',
                provider_message_id: receipt.privateReply ? null : receipt.message_id,
              },
              { onConflict: 'external_id' },
            )
            if (latest.error) throw latest.error
          }
          // Transactional summaries use their own tag; a private reply never
          // fabricates an inbound window for subsequent ordinary chat messages.
          const messageId =
            summaryReceipt ??
            (
              await sendAuctionInvoiceWithReceipt(
                token,
                recipient,
                splitMessages[1],
                {
                  id: delivery.comment_id,
                  pageId: auction.page_id,
                },
                billMessageKey(delivery),
              )
            ).message_id
          const chat = await db
            .from('messages')
            .update({
              body: splitMessages[1],
              delivery_status: 'sent',
              provider_message_id: messageId,
              attachments: [{ type: 'link', payload: { url: link! } }],
            })
            .eq('external_id', billMessageKey(delivery))
          if (chat.error) throw chat.error
        } else {
          const receipt = invoiceRecipient
            ? await sendAuctionInvoiceWithReceipt(
                token,
                invoiceRecipient,
                billMessage,
                {
                  id: delivery.comment_id,
                  pageId: auction.page_id,
                },
                billMessageKey(delivery),
              )
            : await sendAuctionPrivateReply(
                token,
                delivery.comment_id,
                billMessage,
                buttonMessage,
                link!,
                auction.page_id,
              )
          const chat = await db
            .from('messages')
            .update({
              body: 'auctionText' in receipt ? receipt.auctionText : billMessage,
              delivery_status: 'sent',
              attachments: [{ type: 'link', payload: { url: link! } }],
              ...(receipt?.message_id ? { provider_message_id: receipt.message_id } : {}),
            })
            .eq('external_id', billMessageKey(delivery))
          if (chat.error) throw chat.error
        }
      } else {
        await replyToComment(token, delivery.comment_id, message)
      }
      const completed = await db
        .from('auction_deliveries')
        .update({ status: 'sent', completed_at: new Date().toISOString(), error_code: null })
        .eq('id', delivery.id)
        .eq('status', 'sending')
      if (completed.error) throw completed.error
      console.info('[auction/delivery] sent', { auctionId: auction.id, channel: delivery.channel })
    } catch (error) {
      const code = safeCode(error)
      const failed = await db
        .from('auction_deliveries')
        .update({ status: 'requires_review', error_code: code })
        .eq('id', delivery.id)
      if (delivery.channel === 'private') {
        const chat = await db
          .from('messages')
          .update({
            body: billMessage,
            delivery_status: splitMessages && !latestSent ? 'pending' : 'unknown',
          })
          .eq('external_id', billMessageKey(delivery))
        if (chat.error)
          console.error('[auction/delivery] Inbox status update failed', {
            auctionId: auction.id,
            code: safeCode(chat.error),
          })
      }
      if (delivery.channel === 'private' && splitMessages && !latestSent) {
        await db
          .from('messages')
          .update({ delivery_status: 'unknown' })
          .eq('external_id', `${billMessageKey(delivery)}:latest`)
      }
      console.error('[auction/delivery] requires review', {
        auctionId: auction.id,
        channel: delivery.channel,
        code,
        // Meta's own explanation (providerMessage never contains the token or outgoing text).
        metaStatus: error instanceof SendApiError ? error.status : null,
        metaCode: error instanceof SendApiError ? error.code : null,
        metaSubcode: error instanceof SendApiError ? error.subcode : null,
        metaMessage: error instanceof SendApiError ? error.providerMessage : null,
        recorded: !failed.error,
      })
      // The sale stays closed even when Meta refuses or times out.
    }
  }
}

/** Match an auction by its primary live post id or any recorded alias (ids are digits/underscore only). */
function postFilter(ids: string[]) {
  const safe = ids.filter((id) => /^\d+(?:_\d+)?$/.test(id))
  return `live_post_id.in.(${safe.join(',')}),live_post_aliases.ov.{${safe.join(',')}}`
}

/** Returns true for an auction-scoped comment, so ordinary CF rules cannot also run. */
export async function handleAuctionComment(input: {
  value: Record<string, unknown>
  tenantId: string
  pageId: string
  token: string | null
  execution: WebhookExecution
}): Promise<boolean> {
  const { value, tenantId, pageId, token, execution } = input
  const hasFrom = Boolean(value.from && typeof value.from === 'object')
  const senderId = (value.from as { id?: unknown } | undefined)?.id
  const hasFromId = typeof senderId === 'string' && /^\d{1,64}$/.test(senderId)
  const skipped = (reason: string, details: Record<string, unknown> = {}) =>
    console.info('[auction/comment] skipped', {
      eventId: execution.event.id,
      tenantId,
      pageId,
      has_from: hasFrom,
      has_from_id: hasFromId,
      decision: 'skipped',
      reason,
      ...details,
    })
  if (typeof value.message !== 'string' || typeof value.comment_id !== 'string') {
    skipped('COMMENT_FIELDS_MISSING', {
      hasMessage: typeof value.message === 'string',
      hasCommentId: typeof value.comment_id === 'string',
    })
    return false
  }
  const ids = commentPostIds(value)
  if (!ids.length) {
    skipped('COMMENT_POST_ID_MISSING')
    return false
  }
  const db = supabaseAdmin({ timeoutMs: 15000 })
  const loadSessionTags = async (round: Auction) => {
    const session = await db
      .from('live_sessions')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('page_id', pageId)
      .eq('live_post_id', round.live_post_id)
      .maybeSingle()
    if (session.error && !['42P01', 'PGRST205'].includes(session.error.code)) throw session.error
    const automation = {
      ...round.session_automation,
      ...resolveCommentSettings(session.data ?? {}, round.session_automation ?? {}),
    } as NonNullable<Auction['session_automation']>
    return {
      ...round,
      session_automation: automation,
      private_reply_template:
        automation.private_reply_template ?? automation.privateText ?? round.private_reply_template,
      bid_reply_template:
        automation.public_reply_template ?? automation.bidText ?? round.bid_reply_template,
    }
  }
  const findAuction = async (postIds: string[]): Promise<Auction | undefined> => {
    const query = () =>
      db
        .from('auctions')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('page_id', pageId)
        .or(postFilter(postIds))
        .order('created_at', { ascending: false })
        .limit(1)
    const active = await query().eq('status', 'active')
    if (active.error && ['42P01', 'PGRST205'].includes(active.error.code)) return undefined
    if (active.error) throw active.error
    const candidate = active.data?.[0] as Auction | undefined
    return candidate && Date.parse(candidate.created_at) > Date.parse(execution.event.created_at)
      ? undefined
      : candidate
  }
  let auction: Auction | undefined
  if (typeof senderId === 'string' && senderId !== pageId) {
    const waiting = await db
      .from('auctions')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('page_id', pageId)
      .or(postFilter(ids))
      .eq('status', 'closed')
      .not('winner_locked_at', 'is', null)
      .is('winner_confirmed_at', null)
      .gte('closed_at', new Date(Date.now() - 5 * 60_000).toISOString())
      .order('closed_at', { ascending: false })
      .limit(1)
    if (waiting.error && !['42P01', 'PGRST205'].includes(waiting.error.code)) throw waiting.error
    if (waiting.data?.[0]) {
      const candidate = await loadSessionTags(waiting.data[0] as Auction)
      if (
        parseAuctionComment(value.message, false, candidate.session_automation, true).type ===
        'CONFIRM_BID'
      )
        auction = candidate
    }
  }
  auction ??= await findAuction(ids)
  if (!auction) {
    // Closed rounds still own late bid/confirmation text, even after the live session ends.
    const historical = await db
      .from('auctions')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('page_id', pageId)
      .or(postFilter(ids))
      .in('status', ['closed', 'cancelled'])
      .order('closed_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
    if (historical.error) {
      if (!['42P01', 'PGRST205'].includes(historical.error.code)) throw historical.error
      skipped('AUCTION_SCHEMA_MISSING', { code: historical.error.code })
      return false
    }
    auction = (historical.data?.[0] as Auction | undefined) ?? undefined
    if (auction && Date.parse(auction.created_at) > Date.parse(execution.event.created_at))
      auction = undefined
  }
  if (!auction) {
    // Never drop silently: show which active rounds exist so a post-id mismatch is diagnosable.
    const active = await db
      .from('auctions')
      .select('id,live_post_id,live_post_aliases')
      .eq('tenant_id', tenantId)
      .eq('page_id', pageId)
      .eq('status', 'active')
      .limit(5)
    console.warn('[auction/comment] NO_MATCHING_AUCTION: comment post does not match any round', {
      eventId: execution.event.id,
      tenantId,
      pageId,
      postIds: ids,
      activeRounds: active.error ? `lookup failed (${active.error.code})` : active.data,
    })
    return false
  }
  const author = value.from as { id?: unknown } | undefined
  if (typeof author?.id !== 'string' || !hasFromId) {
    console.warn('[auction/comment] missing author', {
      has_from: hasFrom,
      has_from_id: hasFromId,
      decision: 'auction_processing_skipped',
      reason: 'NO_COMMENT_AUTHOR_ID',
    })
    return true
  }
  const isHost = author.id === pageId || auction.host_ids.includes(author.id)
  // Session settings are the current dashboard configuration; old rounds retain a snapshot fallback.
  auction = await loadSessionTags(auction)
  if (auction.session_automation?.mode === 'cf' || auction.session_automation?.mode === 'auto')
    return false
  const parsed = parseAuctionComment(
    value.message,
    isHost,
    auction.session_automation,
    auction.status === 'closed',
  )
  const awaitingWinner =
    auction.status === 'closed' &&
    auction.winner_locked_at &&
    !auction.winner_confirmation_comment_id &&
    parsed.type === 'CONFIRM_BID'
  if (auction.status !== 'active' && !awaitingWinner) {
    skipped('AUCTION_ALREADY_CLOSED', { auctionId: auction.id })
    // Late bids/confirmations belong to this auction, never to product CF rules.
    return parsed.type === 'NUMERIC_BID' || parsed.type === 'CONFIRM_BID'
  }
  if (parsed.type === 'IGNORE') {
    skipped('NO_MATCHING_AUCTION_KEYWORD', {
      auctionId: auction.id,
      status: auction.status,
      isHost,
    })
    return true
  }
  await execution.assertLease()
  const processed = await db.rpc('process_live_auction_comment', {
    p_auction: auction.id,
    p_tenant: tenantId,
    p_event: execution.event.id,
    p_kind: parsed.type,
    p_amount: parsed.type === 'NUMERIC_BID' ? parsed.amount : null,
    p_control: parsed.type === 'HOST_CONTROL' ? 'close' : null,
  })
  if (processed.error) throw processed.error
  const result = processed.data as AuctionResult
  console.info('[auction/comment] processed', {
    auctionId: auction.id,
    eventId: execution.event.id,
    kind: parsed.type,
    status: result.status,
    amount: result.amount,
  })
  if (parsed.type === 'HOST_CONTROL') {
    // Closing locks bids; billing is released only by the recorded winner's confirmation.
    return true
  }
  if (parsed.type === 'CONFIRM_BID') {
    // Supabase accepts the first eligible bidder confirmation and invoices that bidder’s highest bid in this round.
    if (result.status === 'confirmed' || result.status === 'already_confirmed')
      await deliverAuctionNotifications(result.auctionId ?? auction.id)
    return true
  }
  // The simplified seller workspace records bids silently; only the winner is notified.
  if (isOnDemandWinnerFlow(auction.session_automation)) return true
  if (auction.public_reply_enabled === false) return true
  let message: string | null = null
  if (result.status === 'accepted')
    message = renderAuctionTemplate(auction.bid_reply_template || AUCTION_BID_TEMPLATE, {
      product_name: auction.item_name,
      bidder_name: result.name || 'ลูกค้า',
      price: money(result.amount!),
      min_step: money(auction.min_step),
    })
  if (result.status === 'already_opened' || result.status === 'too_low')
    message = `มีผู้เปิดประมูลแล้วหรือราคาต่ำกว่าขั้นต่ำ กรุณาเสนอ ${money(result.minimum!)} บาทขึ้นไป`
  if (result.status === 'closed') message = 'รายการนี้ปิดประมูลแล้วครับ'
  if (message)
    await execution.once('auction-bid-public-reply', () =>
      replyToComment(token, value.comment_id as string, message!),
    )
  return true
}
