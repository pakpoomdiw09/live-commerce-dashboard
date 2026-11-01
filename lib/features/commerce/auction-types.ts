export type Auction = {
  id: string
  tenant_id: string
  page_id: string
  live_post_id: string
  item_name: string
  start_price: number
  min_step: number
  shipping_fee: number
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
  status: string
  amount?: number
  minimum?: number
  name?: string | null
  isOpening?: boolean
  orderId?: string | null
}
