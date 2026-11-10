import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { authorizeAuction, auctionReply, auctionFailure } from '@/lib/features/commerce/auction-api'
import { UUID } from '@/lib/utils'

export async function POST(req: NextRequest) {
  try {
    const input = await req.json()
    if (
      !input ||
      typeof input !== 'object' ||
      typeof input.auctionId !== 'string' ||
      !UUID.test(input.auctionId) ||
      typeof input.bidderId !== 'string' ||
      !/^\d{1,64}$/.test(input.bidderId)
    )
      return auctionReply({ error: 'ข้อมูลผู้ชนะไม่ถูกต้อง' }, 400)

    const denied = await authorizeAuction(req, input.tenantId, true)
    if (denied) return denied

    const result = await supabaseAdmin().rpc('designate_live_auction_winner', {
      p_auction: input.auctionId,
      p_tenant: input.tenantId,
      p_bidder: input.bidderId,
    })
    if (result.error) {
      if (result.error.message.includes('AUCTION_NOT_FOUND'))
        return auctionReply({ error: 'ไม่พบรอบประมูลนี้' }, 404)
      if (result.error.message.includes('AUCTION_WINNER_HAS_NO_VALID_BID'))
        return auctionReply({ error: 'ผู้ชนะต้องมีราคาเสนอที่ระบบรับแล้วในรอบนี้' }, 409)
      if (result.error.message.includes('AUCTION_WINNER_ALREADY_DESIGNATED'))
        return auctionReply({ error: 'กำหนดผู้ชนะไปแล้วและล็อกไว้' }, 409)
      if (result.error.message.includes('AUCTION_WINNER_DESIGNATION_CLOSED'))
        return auctionReply({ error: 'หมดเวลาหรือรอบนี้ยืนยันผู้ชนะไปแล้ว' }, 409)
      throw result.error
    }
    return auctionReply({ ...result.data, message: 'Winner selected and locked for this round.' })
  } catch (error) {
    return auctionFailure(error)
  }
}
