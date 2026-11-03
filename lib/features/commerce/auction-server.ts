import 'server-only'
import { customerTabItemLabel } from './customer-tab-types'
import { supabaseAdmin } from '@/lib/supabase/server'
import {
  pageTokenFor,
  replyToComment,
  sendAuctionPrivateReply,
  resolveLiveCommentVideo,
} from '@/lib/integrations/facebook/client'
import { createLiveCfPaymentLink } from './live-cf-payment-link'
import { parseAuctionComment } from '@/lib/integrations/facebook/auction-comment-parser'
import { commentPostIds } from '@/lib/features/comments/live-comment-routing'
import type { WebhookExecution } from '@/lib/integrations/facebook/webhook-worker'
import type { Auction, AuctionResult } from './auction-types'
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
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && /^[A-Z0-9_]{1,80}$/i.test(code)
    ? code
    : 'AUCTION_DELIVERY_FAILED'
}

/** Claim each final notification atomically; never resend an ambiguous provider result. */
export async function deliverAuctionNotifications(auctionId?: string) {
  const db = supabaseAdmin({ timeoutMs: 15000 })
  const expired = await db
    .from('auction_deliveries')
    .update({ status: 'requires_review', error_code: 'DELIVERY_LEASE_EXPIRED' })
    .eq('status', 'sending')
    .lt('started_at', new Date(Date.now() - 5 * 60_000).toISOString())
    .select('auction_id,channel')
  if (expired.error) throw expired.error
  for (const delivery of expired.data ?? []) {
    if (delivery.channel !== 'private') continue
    const chat = await db
      .from('messages')
      .update({ delivery_status: 'unknown' })
      .eq('external_id', `auction-bill:${delivery.auction_id}`)
    if (chat.error) throw chat.error
  }
  let query = db
    .from('auction_deliveries')
    .select('id,auction_id,channel,comment_id')
    .eq('status', 'pending')
    .order('id')
    .limit(20)
  if (auctionId) query = query.eq('auction_id', auctionId)
  const pending = await query
  if (pending.error) throw pending.error
  // A public comment must never hold up the winning buyer's Messenger bill.
  const deliveries = [...(pending.data ?? [])].sort(
    (a, b) => Number(b.channel === 'private') - Number(a.channel === 'private'),
  )
  for (const delivery of deliveries) {
    const saved = await db.from('auctions').select('*').eq('id', delivery.auction_id).single()
    if (saved.error) throw saved.error
    const auction = saved.data as Auction
    // Also fail closed while the confirmation migration is being deployed.
    if (auction.session_automation?.closeKeywords && !auction.winner_confirmation_comment_id)
      continue
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
            price: money(auction.current_price),
            min_step: money(auction.min_step),
            ...publicValues,
          },
        )
      : `ปิดประมูล ${auction.item_name} ยังไม่มีผู้เสนอราคา`
    const message =
      delivery.channel === 'private'
        ? `🎉 ยินดีด้วยครับ! คุณชนะการประมูล\nรายการ: ${auction.item_name}\nยอดประมูล: ${money(auction.current_price)} บาท\nค่าจัดส่ง: ${money(auction.shipping_fee)} บาท\nยอดรวม: ${money(Number(auction.current_price) + Number(auction.shipping_fee))} บาท\nชำระเงิน / แนบสลิป: ${link}`
        : summary
    let billMessage = message
    let buttonMessage = message
    if (delivery.channel === 'private' && auction.order_id) {
      const { tabForOrder, customerTabSummary } = await import('./customer-tabs-server')
      const tab = await tabForOrder(db, auction.order_id)
      if (!tab && auction.session_automation) throw new Error('AUCTION_TAB_UNAVAILABLE')
      if (tab) {
        const bill = await customerTabSummary(db, tab)
        const privateTemplate =
          auction.session_automation &&
          (!auction.private_reply_template ||
            auction.private_reply_template === AUCTION_PRIVATE_TEMPLATE)
            ? SESSION_WINNER_TEMPLATE
            : auction.private_reply_template || AUCTION_PRIVATE_TEMPLATE
        const values = {
          product_name: auction.item_name,
          price: money(auction.current_price),
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
          : `[ประมูล] ${auction.item_name} • ${money(auction.current_price)} บาท`
        const shipping = `ค่าจัดส่งครั้งเดียว: ${money(tab.shipping_fee ?? 0)} บาท`
        const fullFooter = `${itemLines}\n${shipping}\n${compact}`
        const footer =
          fullFooter.length <= 638
            ? fullFooter
            : `[ประมูล] ${auction.item_name.slice(0, 80)} • ${money(auction.current_price)} บาท\nดูรายการทั้งหมดในบิล\n${shipping}\n${compact}`
        // Keep ledger totals and the signed link intact when fitting Messenger's button limit.
        const greeting = rendered.replaceAll(bill.link, '').trim()
        buttonMessage = `${greeting.slice(0, Math.max(0, 638 - footer.length))}\n\n${footer}`.trim()
      }
    }
    const claimed = await db
      .from('auction_deliveries')
      .update({ status: 'sending', started_at: new Date().toISOString() })
      .eq('id', delivery.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (claimed.error) throw claimed.error
    if (!claimed.data) continue
    try {
      if (delivery.channel === 'private') {
        const receipt = await sendAuctionPrivateReply(
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
            body: receipt?.auctionText ?? billMessage,
            delivery_status: 'sent',
            attachments: [{ type: 'link', payload: { url: link! } }],
            ...(receipt?.message_id ? { provider_message_id: receipt.message_id } : {}),
          })
          .eq('external_id', `auction-bill:${auction.id}`)
        if (chat.error) throw chat.error
      } else {
        await replyToComment(token, delivery.comment_id, message)
      }
      const completed = await db
        .from('auction_deliveries')
        .update({ status: 'sent', completed_at: new Date().toISOString() })
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
          .update({ body: billMessage, delivery_status: 'unknown' })
          .eq('external_id', `auction-bill:${auction.id}`)
        if (chat.error)
          console.error('[auction/delivery] Inbox status update failed', {
            auctionId: auction.id,
            code: safeCode(chat.error),
          })
      }
      console.error('[auction/delivery] requires review', {
        auctionId: auction.id,
        channel: delivery.channel,
        code,
        recorded: !failed.error,
      })
      // The sale stays closed even when Meta refuses or times out.
    }
  }
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
  if (typeof value.message !== 'string' || typeof value.comment_id !== 'string') return false
  const ids = commentPostIds(value)
  if (!ids.length) return false
  const db = supabaseAdmin({ timeoutMs: 15000 })
  type ScopedAuction = Auction & { live_post_aliases: string[] }
  let schemaMissing = false
  const findAuction = async (postIds: string[]): Promise<ScopedAuction | undefined> => {
    // commentPostIds and the resolver output are restricted to numeric Meta IDs,
    // so no untrusted PostgREST filter syntax can enter this expression.
    const liveIds = [...new Set(postIds.map((id) => id.split('_').at(-1)!))]
    const scope = `live_post_id.in.(${liveIds.join(',')}),live_post_aliases.ov.{${postIds.join(',')}}`
    const query = () =>
      db
        .from('auctions')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('page_id', pageId)
        .or(scope)
        .lte('created_at', execution.event.created_at)
        .order('created_at', { ascending: false })
        .limit(1)
    const active = await query().eq('status', 'active')
    // An unapplied optional auction migration must not break existing Live CF shops.
    if (active.error && ['42P01', 'PGRST205'].includes(active.error.code)) {
      schemaMissing = true
      return undefined
    }
    if (active.error) throw active.error
    if (active.data?.length) return active.data[0] as ScopedAuction
    // Keep closed rounds scoped to this live too: late bids must not become CF orders.
    // The event-time fence also lets queued comments find the preceding round.
    const historical = await query()
    if (historical.error) throw historical.error
    return historical.data?.[0] as ScopedAuction | undefined
  }
  let auction = await findAuction(ids)
  if (schemaMissing) return false
  // Meta can send a Page-post ID while setup uses its attached Video ID.
  // Custom bid/close keywords need not match the legacy parser. Check existence
  // without fetching Page-wide history, then resolve and repeat the scoped lookup.
  if (!auction) {
    const exists = await db
      .from('auctions')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('page_id', pageId)
      .lte('created_at', execution.event.created_at)
      .limit(1)
    if (exists.error) throw exists.error
    const resolved = exists.data?.length ? await resolveLiveCommentVideo(token, ids[0]) : null
    const resolvedIds = (resolved?.ids ?? []).filter((id) => /^\d+(?:_\d+)?$/.test(id))
    if (resolvedIds.length) auction = await findAuction(resolvedIds)
    if (auction) {
      const aliases = [...new Set([...auction.live_post_aliases, ...ids])]
      const linked = await db
        .from('auctions')
        .update({ live_post_aliases: aliases })
        .eq('id', auction.id)
        .eq('tenant_id', tenantId)
      if (linked.error) throw linked.error
    }
  }
  if (!auction) return false
  const author = value.from as { id?: unknown } | undefined
  if (typeof author?.id !== 'string') {
    console.warn('[auction/comment] missing author', {
      auctionId: auction.id,
      eventId: execution.event.id,
    })
    return true
  }
  const isHost = author.id === pageId || auction.host_ids.includes(author.id)
  if (!isHost) {
    // A winner may confirm while the next round is already accepting bids.
    // Use the closed round's frozen keyword settings and winner, never client data.
    const latest = await db
      .from('auctions')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('page_id', pageId)
      .eq('live_post_id', auction.live_post_id)
      .eq('status', 'closed')
      .lte('created_at', execution.event.created_at)
      .order('closed_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
    if (latest.error) throw latest.error
    const closed = latest.data?.[0] as Auction | undefined
    if (
      closed?.session_automation?.closeKeywords &&
      parseAuctionComment(value.message, false, closed.session_automation).type === 'STEP_BID' &&
      (auction.status !== 'active' ||
        (closed.leading_bidder_id === author.id && !closed.winner_confirmation_comment_id))
    ) {
      await execution.assertLease()
      const confirmed = await db.rpc('confirm_live_auction_winner', {
        p_auction: closed.id,
        p_tenant: tenantId,
        p_event: execution.event.id,
      })
      if (confirmed.error) throw confirmed.error
      const status = (confirmed.data as AuctionResult).status
      if (status === 'confirmed' || status === 'already_confirmed')
        await deliverAuctionNotifications(closed.id)
      return true
    }
  }
  const parsed = parseAuctionComment(value.message, isHost, auction.session_automation)
  if (parsed.type === 'IGNORE') return !auction.session_automation?.closeKeywords
  await execution.assertLease()
  const processed = await db.rpc('process_live_auction_comment', {
    p_auction: auction.id,
    p_tenant: tenantId,
    p_event: execution.event.id,
    p_kind: parsed.type,
    p_amount: parsed.type === 'NUMERIC_BID' ? parsed.amount : null,
    p_control:
      parsed.type === 'HOST_CONTROL' ? (parsed.action === 'close' ? 'close' : parsed.count) : null,
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
    if (parsed.action === 'close') await deliverAuctionNotifications(auction.id)
    return true
  }
  // The simplified seller workspace records bids silently; only the winner is notified.
  if (auction.session_automation?.closeKeywords) return true
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
