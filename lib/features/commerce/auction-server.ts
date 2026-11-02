import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/server'
import {
  pageTokenFor,
  replyToComment,
  sendPrivateReply,
  resolveLiveCommentVideo,
} from '@/lib/integrations/facebook/client'
import { createLiveCfPaymentLink } from './live-cf-payment-link'
import { parseAuctionComment } from '@/lib/integrations/facebook/auction-comment-parser'
import { commentPostIds } from '@/lib/features/comments/live-comment-routing'
import type { WebhookExecution } from '@/lib/integrations/facebook/webhook-worker'
import type { Auction, AuctionResult } from './auction-types'

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
  if (expired.error) throw expired.error
  let query = db
    .from('auction_deliveries')
    .select('id,auction_id,channel,comment_id')
    .eq('status', 'pending')
    .order('id')
    .limit(20)
  if (auctionId) query = query.eq('auction_id', auctionId)
  const pending = await query
  if (pending.error) throw pending.error
  for (const delivery of pending.data ?? []) {
    const saved = await db.from('auctions').select('*').eq('id', delivery.auction_id).single()
    if (saved.error) throw saved.error
    const auction = saved.data as Auction
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
    const summary = auction.leading_bidder_id
      ? `ปิดประมูล ${auction.item_name} ผู้ชนะ: ${auction.leading_bidder_name || 'ลูกค้า'} ราคา ${money(auction.current_price)} บาท`
      : `ปิดประมูล ${auction.item_name} ยังไม่มีผู้เสนอราคา`
    const message =
      delivery.channel === 'private'
        ? `🎉 ยินดีด้วยครับ! คุณชนะการประมูล\nรายการ: ${auction.item_name}\nยอดประมูล: ${money(auction.current_price)} บาท\nค่าจัดส่ง: ${money(auction.shipping_fee)} บาท\nยอดรวม: ${money(Number(auction.current_price) + Number(auction.shipping_fee))} บาท\nชำระเงิน / แนบสลิป: ${link}`
        : summary
    let billMessage = message
    let tabCustomerId: string | null = null
    if (delivery.channel === 'private' && auction.order_id) {
      const { tabForOrder, customerTabSummary } = await import('./customer-tabs-server')
      const tab = await tabForOrder(db, auction.order_id)
      if (tab) {
        billMessage = (
          await customerTabSummary(
            db,
            tab,
            `ยินดีด้วยครับ! รับรายการใหม่ ${auction.item_name} พร้อมสรุปยอดสะสมครับ`,
          )
        ).privateText
        tabCustomerId = tab.customer_id
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
      if (delivery.channel === 'private')
        await sendPrivateReply(token, delivery.comment_id, billMessage, auction.page_id)
      else await replyToComment(token, delivery.comment_id, message)
      if (tabCustomerId) {
        const chat = await db
          .from('messages')
          .insert({
            customer_id: tabCustomerId,
            external_id: `auction-bill:${auction.id}`,
            sender: 'bot',
            body: billMessage,
            delivery_status: 'sent',
          })
        if (chat.error && chat.error.code !== '23505') throw chat.error
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
  const saved = await db
    .from('auctions')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('page_id', pageId)
    .lte('created_at', execution.event.created_at)
    .order('created_at', { ascending: false })
    .limit(100)
  // An unapplied optional auction migration must not break existing Live CF shops.
  if (saved.error && ['42P01', 'PGRST205'].includes(saved.error.code)) return false
  if (saved.error) throw saved.error
  const candidates = (saved.data ?? []) as (Auction & { live_post_aliases: string[] })[]
  let auction = candidates.find((a) =>
    ids.some((id) => id.split('_').at(-1) === a.live_post_id || a.live_post_aliases.includes(id)),
  )
  // Meta can send a Page-post ID while setup uses its attached Video ID.
  // Resolve only plausible auction intents and only when this Page has rounds.
  if (
    !auction &&
    candidates.length &&
    (parseAuctionComment(value.message).type !== 'IGNORE' ||
      parseAuctionComment(value.message, true).type !== 'IGNORE')
  ) {
    const resolved = await resolveLiveCommentVideo(token, ids[0])
    auction = candidates.find((a) =>
      resolved.ids.some((id) => id.split('_').at(-1) === a.live_post_id),
    )
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
  const parsed = parseAuctionComment(value.message, isHost)
  if (parsed.type === 'IGNORE') return true
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
  let message: string | null = null
  if (result.status === 'accepted')
    message = `✅ ยืนยันคุณ ${result.name || 'ลูกค้า'} ${result.isOpening ? 'เปิดประมูล' : 'เสนอราคา'}ที่ ${money(result.amount!)} บาท (ผู้นำปัจจุบัน) เคาะขั้นต่ำ +${money(auction.min_step)} บาท`
  if (result.status === 'already_opened' || result.status === 'too_low')
    message = `มีผู้เปิดประมูลแล้วหรือราคาต่ำกว่าขั้นต่ำ กรุณาเสนอ ${money(result.minimum!)} บาทขึ้นไป`
  if (result.status === 'closed') message = 'รายการนี้ปิดประมูลแล้วครับ'
  if (message)
    await execution.once('auction-bid-public-reply', () =>
      replyToComment(token, value.comment_id as string, message!),
    )
  return true
}
