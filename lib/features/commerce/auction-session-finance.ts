import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

const moneySum = (values: number[]) =>
  values.reduce((total, value) => total + Math.round(value * 100), 0) / 100

/** Session-scoped live-auction gross bids and receipts allocated to auction orders. */
export async function auctionSessionFinance(
  db: SupabaseClient,
  tenantId: string,
  sessionId: string,
) {
  const result = await db
    .from('orders')
    .select('amount,item_amount,paid_amount,status')
    .eq('tenant_id', tenantId)
    .eq('live_session_id', sessionId)
    .eq('source', 'live_auction')
    .neq('status', 'cancelled')
  if (result.error) throw result.error

  const orders = result.data ?? []
  const auctionSales = moneySum(orders.map((order) => Math.max(0, Number(order.item_amount) || 0)))
  const paidStatuses = new Set(['paid', 'preparing', 'shipped', 'completed'])
  const auctionPaid = moneySum(orders.map((order) => {
    const amount = Math.max(0, Number(order.amount) || 0)
    const recorded = Math.max(0, Number(order.paid_amount) || 0)
    return Math.min(amount, Math.max(recorded, paidStatuses.has(order.status) ? amount : 0))
  }))

  return { auctionSales, auctionPaid }
}
