import { NextRequest } from 'next/server'
import { getActor } from '@/lib/auth'
import { auctionHostIds } from '@/lib/features/commerce/auction-hosts'
import { supabaseAdmin } from '@/lib/supabase/server'
import { authorizeAuction, auctionReply, auctionFailure } from '@/lib/features/commerce/auction-api'
import { extractFacebookLiveId } from '@/lib/features/commerce/live-cf-setup'
import { liveCfPaymentLinksReady } from '@/lib/features/commerce/live-cf-payment-link'
import { UUID } from '@/lib/utils'
import {
  AUCTION_PRIVATE_TEMPLATE,
  AUCTION_BID_TEMPLATE,
  AUCTION_CLOSE_TEMPLATE,
  validAuctionTemplate,
  storeAuctionTemplate,
} from '@/lib/features/commerce/auction-templates'

export async function GET(req: NextRequest) {
  try {
    const tenantId = req.nextUrl.searchParams.get('tenantId')
    const denied = await authorizeAuction(req, tenantId)
    if (denied) return denied
    const db = supabaseAdmin()
    const livePostId = req.nextUrl.searchParams.get('livePostId')
    const pageId = req.nextUrl.searchParams.get('pageId')
    if ((livePostId && !/^\d{1,64}$/.test(livePostId)) || (pageId && !/^\d{1,64}$/.test(pageId)))
      return auctionReply({ error: 'รหัสไลฟ์ไม่ถูกต้อง' }, 400)
    let query = db
      .from('auctions')
      .select(
        'id,tenant_id,page_id,live_post_id,live_post_aliases,item_name,start_price,min_step,shipping_fee,current_price,leading_bidder_id,leading_bidder_name,leading_comment_id,host_ids,host_count,bank_account_id,status,closed_at,close_event_id,order_id,created_at,private_reply_enabled,public_reply_enabled,private_reply_template,bid_reply_template,close_reply_template,session_automation,duration_seconds,timer_started_at,ends_at,winner_locked_at,previous_auction_id,winner_confirmation_comment_id,winner_confirmation_event_id,winner_confirmed_at',
      )
      .eq('tenant_id', tenantId!)
    if (livePostId) query = query.eq('live_post_id', livePostId)
    if (pageId) query = query.eq('page_id', pageId)
    const auctions = await query.order('created_at', { ascending: false }).limit(10)
    if (auctions.error) throw auctions.error
    const selected =
      req.nextUrl.searchParams.get('id') ||
      auctions.data.find((a) => a.status === 'active')?.id ||
      auctions.data[0]?.id
    if (selected && !auctions.data.some((a) => a.id === selected))
      return auctionReply({ error: 'ไม่พบรายการ' }, 404)
    const [bids, deliveries] = selected
      ? await Promise.all([
          db
            .from('auction_bids')
            .select('id,bidder_name,comment_text,bid_amount,is_opening,status,created_at')
            .eq('auction_id', selected)
            .order('created_at', { ascending: false })
            .limit(30),
          db
            .from('auction_deliveries')
            .select('channel,status,error_code')
            .eq('auction_id', selected),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
        ]
    if (bids.error || deliveries.error) throw bids.error || deliveries.error
    return auctionReply({
      selectedAuctionId: selected,
      auctions: auctions.data,
      bids: bids.data,
      deliveries: deliveries.data,
    })
  } catch (error) {
    return auctionFailure(error)
  }
}

const price = (value: unknown, allowZero = false, max = 999_999_999) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= (allowZero ? 0 : 0.01) &&
  value <= max &&
  Math.abs(value * 100 - Math.round(value * 100)) < 0.00001

export async function POST(req: NextRequest) {
  try {
    const input = await req.json()
    if (!input || typeof input !== 'object') return auctionReply({ error: 'ข้อมูลไม่ถูกต้อง' }, 400)
    const denied = await authorizeAuction(req, input.tenantId, true)
    if (denied) return denied
    const postId = extractFacebookLiveId(input.livePostId)?.split('_').at(-1)
    const hostIds: unknown = input.hostIds ?? []
    const privateReply = input.privateReply ?? true
    const publicReply = input.publicReply ?? true
    const privateText = input.privateText ?? AUCTION_PRIVATE_TEMPLATE
    const bidText = input.bidText ?? AUCTION_BID_TEMPLATE
    const closeText = input.closeText ?? AUCTION_CLOSE_TEMPLATE
    if (
      typeof privateReply !== 'boolean' ||
      typeof publicReply !== 'boolean' ||
      !validAuctionTemplate(privateText, 'private') ||
      !validAuctionTemplate(bidText, 'public') ||
      !validAuctionTemplate(closeText, 'public')
    )
      return auctionReply(
        { error: 'กรุณาตรวจสอบสวิตช์ ข้อความ และตัวแปรที่ใช้ในข้อความตอบกลับ' },
        400,
      )
    if (
      !postId ||
      typeof input.itemName !== 'string' ||
      !input.itemName.trim() ||
      input.itemName.trim().length > 200 ||
      !price(input.startPrice) ||
      !price(input.minStep) ||
      !price(input.shippingFee, true, 999_999) ||
      typeof input.bankAccountId !== 'string' ||
      !UUID.test(input.bankAccountId) ||
      !Array.isArray(hostIds) ||
      hostIds.length > 20 ||
      hostIds.some((id) => typeof id !== 'string' || !/^\d{1,64}$/.test(id))
    )
      return auctionReply(
        { error: 'กรุณาระบุรายการ ไลฟ์ ราคา สเต็ป ค่าส่ง และบัญชีรับเงินให้ถูกต้อง' },
        400,
      )
    if (privateReply && !liveCfPaymentLinksReady())
      return auctionReply(
        { error: 'กรุณาตั้งค่า LIVE_CF_APP_URL และ LIVE_CF_PAYMENT_LINK_SECRET ก่อนเปิดประมูล' },
        503,
      )
    const db = supabaseAdmin()
    const [tenant, bank] = await Promise.all([
      db.from('tenants').select('page_id').eq('id', input.tenantId).eq('is_active', true).single(),
      db
        .from('bank_accounts')
        .select('id')
        .eq('id', input.bankAccountId)
        .eq('tenant_id', input.tenantId)
        .eq('is_active', true)
        .maybeSingle(),
    ])
    if (tenant.error || bank.error) throw tenant.error || bank.error
    if (!tenant.data.page_id || !bank.data)
      return auctionReply({ error: 'กรุณาเชื่อมต่อเพจและเลือกบัญชีของร้านนี้' }, 400)
    if (input.pageId !== undefined && input.pageId !== tenant.data.page_id)
      return auctionReply({ error: 'เพจที่เลือกไม่ตรงกับร้านนี้ กรุณาเลือกเพจใหม่' }, 400)
    const actor = await getActor(req)
    if (!actor || actor.kind !== 'user') return auctionReply({ error: 'กรุณาเข้าสู่ระบบ' }, 403)
    let verifiedHostIds: string[]
    try {
      verifiedHostIds = await auctionHostIds(db, actor.id, tenant.data.page_id)
    } catch (error) {
      if (error instanceof Error && error.message === 'AUCTION_HOST_FACEBOOK_REQUIRED')
        return auctionReply(
          {
            error:
              'กรุณาเชื่อมต่อ Facebook ของคุณกับเพจนี้อีกครั้ง เพื่อใช้บัญชีส่วนตัวสั่งปิดรอบประมูล',
          },
          400,
        )
      throw error
    }
    const saved = await db
      .from('auctions')
      .insert({
        tenant_id: input.tenantId,
        page_id: tenant.data.page_id,
        live_post_id: postId,
        item_name: input.itemName.trim(),
        start_price: input.startPrice,
        min_step: input.minStep,
        shipping_fee: input.shippingFee,
        bank_account_id: bank.data.id,
        host_ids: [...new Set([...hostIds, ...verifiedHostIds])],
        private_reply_enabled: privateReply,
        public_reply_enabled: publicReply,
        private_reply_template: storeAuctionTemplate(privateText),
        bid_reply_template: storeAuctionTemplate(bidText),
        close_reply_template: storeAuctionTemplate(closeText),
      })
      .select('id')
      .single()
    if (saved.error) throw saved.error
    console.info('[auction/open] created', {
      auctionId: saved.data.id,
      tenantId: input.tenantId,
      postId,
    })
    return auctionReply({ id: saved.data.id }, 201)
  } catch (error) {
    return auctionFailure(error)
  }
}
