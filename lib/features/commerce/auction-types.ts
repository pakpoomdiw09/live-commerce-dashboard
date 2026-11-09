import type { SessionAutomation } from './session-automation'
export type Auction = {
  id: string
  tenant_id: string
  page_id: string
  live_post_id: string
  item_name: string
  start_price: number
  min_step: number
  shipping_fee: number
  bank_account_id?: string
  current_price: number
  leading_bidder_id: string | null
  leading_bidder_name: string | null
  leading_comment_id: string | null
  host_ids: string[]
  host_count: string | null
  status: 'active' | 'closed' | 'cancelled'
  closed_at: string | null
  order_id: string | null
  created_at: string
  ends_at?: string | null
  duration_seconds?: number | null
  private_reply_enabled?: boolean
  public_reply_enabled?: boolean
  private_reply_template?: string
  bid_reply_template?: string
  close_reply_template?: string
  session_automation?: SessionAutomation | null
  winner_confirmation_comment_id?: string | null
  winner_locked_at?: string | null
}

export type AuctionBid = {
  id: string
  bidder_name: string | null
  comment_text: string
  bid_amount: number | null
  is_opening: boolean
  status: string
  created_at: string
}

export type AuctionResult = {
  auctionId?: string
  nextAuctionId?: string | null
  status: string
  amount?: number
  minimum?: number
  name?: string | null
  isOpening?: boolean
  orderId?: string | null
  claimId?: string
}
