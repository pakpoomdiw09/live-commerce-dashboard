import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MESSAGING_WINDOW_MS, type BroadcastSegment, type BroadcastWindow, type MessageTag } from '@/lib/chatbot'

export type AudienceMember = { id: string; platform_user_id: string; display_name: string | null; last_message_at: string | null }

export type Audience = {
  /** everyone matching the segment and tags */
  total: number
  /** the ones a broadcast may reach (see canReach); the rest are skipped */
  reachable: AudienceMember[]
}

const PAGE = 1000 // PostgREST's default row cap

/** Every row of a query, page by page. */
export async function fetchAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) return rows
  }
}

/**
 * Legacy display-only estimate. Never authorizes transport: broadcast-policy
 * and the database claims require scoped inbound evidence and current rights.
 * Outside-window routes and all tags are closed here as well.
 */
export function canReach(lastMessageAt: string | null, window: BroadcastWindow, tag: MessageTag | null, now = Date.now()) {
  if (!lastMessageAt || window !== 'within_24h' || tag) return false
  const at = Date.parse(lastMessageAt)
  return Number.isFinite(at) && at <= now && now - at < MESSAGING_WINDOW_MS
}

/** Customers of a tenant matching a broadcast's segment and tags (any of them). */
export async function broadcastAudience(
  db: SupabaseClient,
  tenantId: string,
  segment: BroadcastSegment,
  tags: string[],
  window: BroadcastWindow = 'within_24h',
  messageTag: MessageTag | null = null,
): Promise<Audience> {
  const customers = await fetchAll<AudienceMember>((from, to) => {
    let q = db.from('customers').select('id, platform_user_id, display_name, last_message_at').eq('tenant_id', tenantId)
    if (tags.length) q = q.overlaps('tags', tags)
    return q.order('id').range(from, to)
  })

  let members = customers
  if (segment !== 'all') {
    const statuses = segment === 'pending_payment' ? ['pending_payment'] : ['paid', 'shipped']
    const orders = await fetchAll<{ customer_id: string }>((from, to) =>
      db.from('orders').select('customer_id').eq('tenant_id', tenantId).in('status', statuses).order('id').range(from, to),
    )
    const ids = new Set(orders.map((o) => o.customer_id))
    members = customers.filter((c) => ids.has(c.id))
  }
  const now = Date.now()
  return { total: members.length, reachable: members.filter((c) => canReach(c.last_message_at, window, messageTag, now)) }
}

export const BROADCAST_SEGMENT_VALUES: BroadcastSegment[] = ['all', 'pending_payment', 'paid_before']
export const BROADCAST_WINDOW_VALUES: BroadcastWindow[] = ['within_24h', 'outside_24h']
