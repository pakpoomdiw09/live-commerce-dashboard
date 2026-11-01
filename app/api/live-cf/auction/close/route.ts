import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { authorizeAuction, auctionReply, auctionFailure } from '@/lib/features/commerce/auction-api'
import { deliverAuctionNotifications } from '@/lib/features/commerce/auction-server'
import { UUID } from '@/lib/utils'

export async function POST(req: NextRequest) {
  try {
    const input = await req.json()
    if (!input || typeof input !== 'object') return auctionReply({ error: 'ข้อมูลไม่ถูกต้อง' }, 400)
    const denied = await authorizeAuction(req, input.tenantId, true)
    if (denied) return denied
    if (typeof input.auctionId !== 'string' || !UUID.test(input.auctionId))
      return auctionReply({ error: 'รายการไม่ถูกต้อง' }, 400)
    const closed = await supabaseAdmin().rpc('finalize_live_auction', {
      p_auction: input.auctionId,
      p_tenant: input.tenantId,
      p_cancel: input.cancel === true,
    })
    if (closed.error) throw closed.error
    console.info('[auction/close] finalized', {
      auctionId: input.auctionId,
      status: closed.data?.status,
      orderId: closed.data?.orderId,
    })
    try {
      await deliverAuctionNotifications(input.auctionId)
    } catch {
      console.error('[auction/close] notification pending', { auctionId: input.auctionId })
    }
    return auctionReply(closed.data)
  } catch (error) {
    return auctionFailure(error)
  }
}
