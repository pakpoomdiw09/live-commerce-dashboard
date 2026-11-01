import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { authorizeAuction, auctionReply, auctionFailure } from '@/lib/features/commerce/auction-api'
import { extractFacebookLiveId } from '@/lib/features/commerce/live-cf-setup'
import { liveCfPaymentLinksReady } from '@/lib/features/commerce/live-cf-payment-link'
import { UUID } from '@/lib/utils'

export async function GET(req: NextRequest) {
  try {
    const tenantId = req.nextUrl.searchParams.get('tenantId')
    const denied = await authorizeAuction(req, tenantId)
    if (denied) return denied
    const db = supabaseAdmin()
    const auctions = await db
      .from('auctions')
      .select('*')
      .eq('tenant_id', tenantId!)
      .order('created_at', { ascending: false })
      .limit(10)
    if (auctions.error) throw auctions.error
    const selected = req.nextUrl.searchParams.get('id') || auctions.data[0]?.id
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
    return auctionReply({ auctions: auctions.data, bids: bids.data, deliveries: deliveries.data })
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
    if (!liveCfPaymentLinksReady())
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
        host_ids: hostIds,
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
