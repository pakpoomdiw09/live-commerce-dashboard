import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  OverviewFilters,
  PremiumOverviewData,
} from '@/lib/features/overview/premium-overview-core'
import { InboxError } from '@/lib/features/inbox/inbox-server'
import { recoverOverview } from './overview-recovery'
import { logOverviewError } from './overview-diagnostics'

type Summary = Omit<PremiumOverviewData, 'filters' | 'health'>

/** Authenticated callers verify tenant membership before this service-role RPC. */
export async function overviewFromTables(
  db: SupabaseClient,
  tenantId: string,
  filters: OverviewFilters,
): Promise<{ summary: Summary; notices: string[] }> {
  let [shop, response] = await Promise.all([
    db
      .from('tenants')
      .select('id,name,slip_quota,slip_used,slip_quota_credits')
      .eq('id', tenantId)
      .eq('is_active', true)
      .maybeSingle(),
    db.rpc('overview_dashboard_stats', {
      p_tenant: tenantId,
      p_from: filters.from,
      p_to: filters.to,
      p_previous: filters.previousFrom,
      p_page: filters.page,
      p_query: filters.q,
    }),
  ])
  const notices: string[] = []
  let creditAvailable = true
  if (shop.error) {
    logOverviewError('tenants.credit_columns', shop.error, { tenantId, status: shop.status })
    // A missing optional credit column must not hide messages/customer statistics.
    const minimal = await db
      .from('tenants')
      .select('id,name')
      .eq('id', tenantId)
      .eq('is_active', true)
      .maybeSingle()
    if (!minimal.error && minimal.data) {
      shop = {
        ...minimal,
        data: { ...minimal.data, slip_quota: 0, slip_used: 0, slip_quota_credits: 0 },
      }
      notices.push('ยังอ่านเครดิตตรวจสลิปไม่ได้')
      creditAvailable = false
    }
  }
  if (shop.error || !shop.data) {
    logOverviewError('tenants.active', shop.error ?? new Error('ACTIVE_TENANT_NOT_FOUND'), {
      tenantId,
      status: shop.status,
    })
    throw new InboxError(
      'โหลดภาพรวมไม่ได้ กรุณาตรวจสอบการติดตั้งฐานข้อมูลหรือลองใหม่',
      503,
      'OVERVIEW_UNAVAILABLE',
    )
  }
  if (response.error || !response.data) {
    logOverviewError(
      'rpc.overview_dashboard_stats',
      response.error ?? new Error('EMPTY_RPC_RESPONSE'),
      { tenantId, status: response.status },
    )
    // Permission denials must never be bypassed with the service-role recovery reader.
    if (response.error?.code === '42501' || response.status === 401 || response.status === 403)
      throw new InboxError('ไม่มีสิทธิ์อ่านข้อมูลภาพรวมของร้านค้า', 403, 'OVERVIEW_FORBIDDEN')
    return recoverOverview(db, { id: shop.data.id, name: shop.data.name }, filters)
  }
  type Stats = {
    access: Summary['access']
    totals: { totalSlips: number; approved: number; pending: number; verifiedSlipAmount: number }
    previous: Summary['previous']
    results: Summary['results']
    series: Summary['series']
    slips: Summary['slips']
    slipMatches: number
    chats: Summary['chats']
    chatMatches: number
    messages: number
    uniqueCustomers: number
    customerGenders: Summary['customerGenders']
    ai: Summary['ai']
    activity: { key: string; messages: number; customers: number }[]
    hours: { bin: number; messages: number }[]
  }
  const stats = response.data as Stats
  if (
    !stats.access ||
    !['slips', 'customers', 'ai'].every(
      (key) => typeof stats.access[key as keyof Stats['access']] === 'boolean',
    )
  ) {
    logOverviewError('rpc.overview_dashboard_stats.shape', new Error('INVALID_ACCESS_SHAPE'), {
      tenantId,
    })
    return recoverOverview(db, { id: shop.data.id, name: shop.data.name }, filters)
  }
  let numericFallback = false
  const n = (value: unknown) => {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value)
    numericFallback = true
    return 0
  }
  if (
    !stats.totals ||
    !Array.isArray(stats.activity) ||
    !Array.isArray(stats.hours) ||
    !Array.isArray(stats.slips) ||
    !Array.isArray(stats.chats)
  ) {
    logOverviewError('rpc.overview_dashboard_stats.shape', new Error('INCOMPLETE_STATS'), {
      tenantId,
    })
    notices.push('ข้อมูลสถิติบางส่วนยังไม่ครบ ค่า 0 ในส่วนที่โหลดไม่ได้เป็นค่าชั่วคราว')
  }
  const access = stats.access,
    bucket = filters.from ? 'day' : 'month'
  const activity = (Array.isArray(stats.activity) ? stats.activity : [])
    .filter((point) => {
      const valid =
        typeof point?.key === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(point.key) &&
        Number.isFinite(Date.parse(point.key + 'T12:00:00+07:00'))
      if (!valid) {
        logOverviewError('rpc.activity.date', new Error('INVALID_ACTIVITY_DATE'), { tenantId })
        notices.push('วันที่กราฟบางรายการไม่ถูกต้อง')
      }
      return valid
    })
    .map((point) => ({
      ...point,
      messages: n(point.messages),
      customers: n(point.customers),
      label: new Intl.DateTimeFormat(
        'th-TH',
        bucket === 'day'
          ? { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' }
          : { timeZone: 'Asia/Bangkok', month: 'short', year: '2-digit' },
      ).format(new Date(point.key + 'T12:00:00+07:00')),
    }))
  const result: { summary: Summary; notices: string[] } = {
    notices,
    summary: {
      shop: { id: shop.data.id, name: shop.data.name },
      updatedAt: filters.to,
      access,
      metrics: {
        reconciledRevenue: null,
        messages: access.customers ? n(stats.messages) : null,
        incomingMessages: access.customers ? n(stats.messages) : null,
        uniqueCustomers: access.customers ? n(stats.uniqueCustomers) : null,
        totalSlips: access.slips ? n(stats.totals?.totalSlips) : null,
        approved: access.slips ? n(stats.totals?.approved) : null,
        pending: access.slips ? n(stats.totals?.pending) : null,
        verifiedSlipAmount: access.slips ? n(stats.totals?.verifiedSlipAmount) : null,
        slipCredits:
          access.slips && creditAvailable
            ? Math.max(
                0,
                Number(shop.data.slip_quota) +
                  Number(shop.data.slip_quota_credits ?? 0) -
                  Number(shop.data.slip_used),
              )
            : null,
      },
      previous: access.slips ? stats.previous : null,
      results: access.slips
        ? {
            passed: n(stats.results?.passed),
            pending: n(stats.results?.pending),
            rejected: n(stats.results?.rejected),
            error: n(stats.results?.error),
          }
        : null,
      series: access.slips && Array.isArray(stats.series) ? stats.series : [],
      bucket,
      slips: access.slips && Array.isArray(stats.slips) ? stats.slips : [],
      slipMatches: access.slips ? n(stats.slipMatches) : 0,
      chats: access.customers && Array.isArray(stats.chats) ? stats.chats : [],
      chatMatches: access.customers ? n(stats.chatMatches) : 0,
      customerGenders: access.customers
        ? {
            male: n(stats.customerGenders?.male),
            female: n(stats.customerGenders?.female),
            unspecified: n(stats.customerGenders?.unspecified),
          }
        : null,
      activity: access.customers ? activity : null,
      hourActivity: access.customers
        ? (Array.isArray(stats.hours) ? stats.hours : [])
            .filter((point) => Number.isInteger(point?.bin) && point.bin >= 0 && point.bin <= 7)
            .map(({ bin, messages }) => ({
              label:
                String(bin * 3).padStart(2, '0') +
                ':00–' +
                String((bin + 1) * 3).padStart(2, '0') +
                ':00',
              messages: n(messages),
            }))
        : null,
      ai: access.ai ? stats.ai : null,
    },
  }
  if (numericFallback) {
    logOverviewError(
      'rpc.overview_dashboard_stats.numbers',
      new Error('INCOMPLETE_NUMERIC_STATS'),
      { tenantId },
    )
    notices.push('สถิติบางรายการยังโหลดไม่ครบ ค่า 0 ในส่วนนั้นเป็นค่าชั่วคราว')
  }
  return result
}
