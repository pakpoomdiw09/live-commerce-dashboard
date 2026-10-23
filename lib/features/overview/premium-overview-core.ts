import type {
  ActivityPoint,
  HourActivityPoint,
  CustomerGenderSummary,
} from '@/lib/features/overview/overview-activity-core'

export type OverviewRange = '7' | '30' | '90' | 'all'
export const PREMIUM_OVERVIEW_FLAGS = { premium_overview_enabled: true } as const
export type OverviewFilters = {
  range: OverviewRange
  page: number
  q: string
  from: string | null
  to: string
  previousFrom: string | null
}
export function overviewFilters(
  input: { range?: string | null; page?: string | null; q?: string | null },
  now = new Date(),
): OverviewFilters {
  const range = input.range ?? '30'
  if (!['7', '30', '90', 'all'].includes(range)) throw new Error('INVALID_RANGE')
  const page = Number(input.page ?? '1'),
    q = (input.q ?? '').trim()
  if (!Number.isInteger(page) || page < 1 || page > 1000 || q.length > 100)
    throw new Error('INVALID_FILTER')
  const day = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
  const midnight = new Date(`${day}T00:00:00+07:00`).getTime()
  const from =
    range === 'all' ? null : new Date(midnight - (Number(range) - 1) * 86400000).toISOString()
  return {
    range: range as OverviewRange,
    page,
    q,
    from,
    to: now.toISOString(),
    previousFrom: from
      ? new Date(new Date(from).getTime() - Number(range) * 86400000).toISOString()
      : null,
  }
}
/** Direct-table overview is available by default; retain the explicit basic-view rollback. */
export function premiumOverviewEnabled() {
  return process.env.PREMIUM_OVERVIEW_ENABLED !== 'false'
}
export type OverviewPoint = {
  day: string
  amount: number
  count: number
  previousAmount: number | null
  previousCount: number | null
}
export type {
  ActivityPoint,
  HourActivityPoint,
} from '@/lib/features/overview/overview-activity-core'
export type OverviewSlip = {
  id: string
  created_at: string
  customer: string | null
  avatar_url: string | null
  amount: number | null
  result: 'passed' | 'pending' | 'rejected' | 'error'
  note: string | null
}
export type OverviewChat = {
  id: string
  name: string | null
  avatar_url: string | null
  body: string | null
  last_message_at: string | null
  unread_count: number
  owner: string
}
export type PremiumOverviewData = {
  shop: { id: string; name: string }
  updatedAt: string
  filters: OverviewFilters
  access: { slips: boolean; customers: boolean; ai: boolean }
  metrics: {
    reconciledRevenue: null
    messages: number | null
    incomingMessages: number | null
    uniqueCustomers: number | null
    approved: number | null
    totalSlips: number | null
    pending: number | null
    slipCredits: number | null
    verifiedSlipAmount: number | null
  }
  previous: { approved: number; totalSlips: number; verifiedSlipAmount: number } | null
  results: { passed: number; pending: number; rejected: number; error: number } | null
  customerGenders: CustomerGenderSummary | null
  series: OverviewPoint[]
  bucket: 'day' | 'month'
  activity: ActivityPoint[] | null
  hourActivity: HourActivityPoint[] | null
  slips: OverviewSlip[]
  slipMatches: number
  chats: OverviewChat[]
  chatMatches: number
  ai: {
    replies: number
    conversations: number
    handoffs: number
    usage: number | null
    limit: number | null
  } | null
  health: { name: string; status: 'active' | 'setup'; detail: string; setupHref: string }[]
}
/** Development-only empty dataset so the Pro Dashboard still renders when the RPC is missing or fails locally. */
export function emptyPremiumOverview(
  shop: { id: string; name: string },
  filters: OverviewFilters,
  detail: string,
): PremiumOverviewData {
  return {
    shop,
    updatedAt: new Date().toISOString(),
    filters,
    access: { slips: true, customers: true, ai: true },
    metrics: {
      reconciledRevenue: null,
      messages: 0,
      incomingMessages: 0,
      uniqueCustomers: 0,
      approved: 0,
      totalSlips: 0,
      pending: 0,
      slipCredits: null,
      verifiedSlipAmount: 0,
    },
    previous: filters.previousFrom ? { approved: 0, totalSlips: 0, verifiedSlipAmount: 0 } : null,
    results: { passed: 0, pending: 0, rejected: 0, error: 0 },
    customerGenders: null,
    series: [],
    bucket: filters.from ? 'day' : 'month',
    activity: [],
    hourActivity: [],
    slips: [],
    slipMatches: 0,
    chats: [],
    chatMatches: 0,
    ai: { replies: 0, conversations: 0, handoffs: 0, usage: null, limit: null },
    health: [{ name: 'ฐานข้อมูลร้านค้า', status: 'setup', detail, setupHref: '/settings' }],
  }
}
