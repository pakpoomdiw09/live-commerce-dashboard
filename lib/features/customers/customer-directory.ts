import type { CustomerRow, OrderStatus } from '@/lib/types'
import { ORDER_STATUSES } from '@/lib/status'

export type CustomerListRow = Pick<
  CustomerRow,
  | 'id'
  | 'display_name'
  | 'avatar_url'
  | 'platform_user_id'
  | 'last_message_at'
  | 'phone'
  | 'address'
  | 'tags'
  | 'order_status'
> & { paidTotal: number; paidCount: number }
export type CustomerFilters = { page: number; q: string; status: OrderStatus | 'all'; tag: string }
export type CustomerDirectory = {
  rows: CustomerListRow[]
  total: number
  totalPaid: number
  page: number
  pages: number
  pageSize: number
  tags: string[]
}
export function customerFilters(
  input: Record<string, string | string[] | undefined>,
): CustomerFilters {
  const value = (key: string, fallback: string) => {
    const item = input[key] ?? fallback
    if (typeof item !== 'string') throw new Error('ตัวกรองไม่ถูกต้อง')
    return item
  }
  const rawPage = value('page', '1'),
    q = value('q', '').trim(),
    tag = value('tag', ''),
    status = value('status', 'all')
  if (
    !/^[1-9]\d{0,5}$/.test(rawPage) ||
    Number(rawPage) > 100000 ||
    q.length > 100 ||
    tag.length > 100 ||
    (status !== 'all' && !ORDER_STATUSES.includes(status as OrderStatus))
  )
    throw new Error('ตัวกรองไม่ถูกต้อง')
  return { page: Number(rawPage), q, tag, status: status as CustomerFilters['status'] }
}
export function customerDirectoryUrl(
  filters: CustomerFilters,
  changes: Partial<CustomerFilters> = {},
) {
  const next = { ...filters, ...changes },
    query = new URLSearchParams()
  if (next.page > 1) query.set('page', String(next.page))
  if (next.q) query.set('q', next.q)
  if (next.status !== 'all') query.set('status', next.status)
  if (next.tag) query.set('tag', next.tag)
  return '/customers' + (query.size ? '?' + query.toString() : '')
}
