import { after, NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { authorizeAuction, auctionReply, auctionFailure } from '@/lib/features/commerce/auction-api'
import { deliverAuctionNotifications } from '@/lib/features/commerce/auction-server'
import { UUID } from '@/lib/utils'

async function snapshot(tenantId: string, auctionId: string) {
  const db = supabaseAdmin()
  const result = await db.rpc('close_due_live_auction', {
    p_tenant: tenantId,
    p_auction: auctionId,
  })
  if (result.error) throw result.error
  const auction = await db.from('auctions')
    .select('id,status,ends_at,duration_seconds,order_id')
    .eq('tenant_id', tenantId).eq('id', auctionId).single()
  if (auction.error) throw auction.error
  // HTTP server UTC calibrates the browser display; only the DB decides expiry.
  if (auction.data.status === 'closed') {
    after(async () => {
      try { await deliverAuctionNotifications(auctionId) }
      catch { console.error('[auction/timer] notification pending', { auctionId }) }
    })
  }
  return auctionReply({ ...auction.data, resolution: result.data?.status, serverNow: new Date().toISOString() })
}

export async function GET(req: NextRequest) {
  try {
    const tenantId = req.nextUrl.searchParams.get('tenantId')
    const denied = await authorizeAuction(req, tenantId)
    if (denied) return denied
    const auctionId = req.nextUrl.searchParams.get('auctionId')
    if (!auctionId || !UUID.test(auctionId)) return auctionReply({ error: 'Invalid auction' }, 400)
    return await snapshot(tenantId!, auctionId)
  } catch (error) { return auctionFailure(error) }
}

export async function POST(req: NextRequest) {
  try {
    const input = await req.json()
    const denied = await authorizeAuction(req, input?.tenantId, true)
    if (denied) return denied
    if (!UUID.test(input?.auctionId ?? '') || !['expire', 'start'].includes(input?.action))
      return auctionReply({ error: 'Invalid timer request' }, 400)
    if (input.action === 'start') {
      const result = await supabaseAdmin().rpc('start_legacy_auction_timer', {
        p_tenant: input.tenantId, p_auction: input.auctionId,
      })
      if (result.error) throw result.error
    }
    return await snapshot(input.tenantId, input.auctionId)
  } catch (error) { return auctionFailure(error) }
}
