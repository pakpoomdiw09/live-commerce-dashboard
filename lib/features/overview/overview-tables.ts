import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { OverviewFilters, PremiumOverviewData } from '@/lib/features/overview/premium-overview-core'
import { InboxError } from '@/lib/features/inbox/inbox-server'

type Summary = Omit<PremiumOverviewData, 'filters' | 'health'>

/** Authenticated callers verify tenant membership before this service-role RPC. */
export async function overviewFromTables(db: SupabaseClient, tenantId: string, filters: OverviewFilters): Promise<{ summary: Summary; notices: string[] }> {
  const [shop, response] = await Promise.all([
    db.from('tenants').select('id,name,slip_quota,slip_used,slip_quota_credits').eq('id', tenantId).eq('is_active', true).maybeSingle(),
    db.rpc('overview_dashboard_stats', { p_tenant: tenantId, p_from: filters.from, p_to: filters.to, p_previous: filters.previousFrom, p_page: filters.page, p_query: filters.q }),
  ])
  if (shop.error || !shop.data || response.error || !response.data) {
    throw new InboxError('โหลดภาพรวมไม่ได้ กรุณาตรวจสอบการติดตั้งฐานข้อมูลหรือลองใหม่', 503, 'OVERVIEW_UNAVAILABLE')
  }
  type Stats = {
    access: Summary['access']; totals: { totalSlips: number; approved: number; pending: number; verifiedSlipAmount: number };
    previous: Summary['previous']; results: Summary['results']; series: Summary['series'];
    slips: Summary['slips']; slipMatches: number; chats: Summary['chats']; chatMatches: number;
    messages: number; uniqueCustomers: number; customerGenders: Summary['customerGenders']; ai: Summary['ai'];
    activity: { key: string; messages: number; customers: number }[]; hours: { bin: number; messages: number }[];
  }
  const stats = response.data as Stats
  const access = stats.access, bucket = filters.from ? 'day' : 'month'
  const activity = stats.activity.map(point => ({ ...point, label: new Intl.DateTimeFormat('th-TH', bucket === 'day'
    ? { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' }
    : { timeZone: 'Asia/Bangkok', month: 'short', year: '2-digit' }).format(new Date(point.key + 'T12:00:00+07:00')) }))
  return { notices: [], summary: {
    shop: { id: shop.data.id, name: shop.data.name }, updatedAt: filters.to, access,
    metrics: { reconciledRevenue: null, messages: access.customers ? stats.messages : null,
      incomingMessages: access.customers ? stats.messages : null, uniqueCustomers: access.customers ? stats.uniqueCustomers : null,
      totalSlips: access.slips ? stats.totals.totalSlips : null, approved: access.slips ? stats.totals.approved : null,
      pending: access.slips ? stats.totals.pending : null, verifiedSlipAmount: access.slips ? stats.totals.verifiedSlipAmount : null,
      slipCredits: access.slips ? Math.max(0, Number(shop.data.slip_quota) + Number(shop.data.slip_quota_credits ?? 0) - Number(shop.data.slip_used)) : null },
    previous: access.slips ? stats.previous : null, results: access.slips ? stats.results : null,
    series: access.slips ? stats.series : [], bucket, slips: stats.slips, slipMatches: stats.slipMatches,
    chats: stats.chats, chatMatches: stats.chatMatches,
    customerGenders: access.customers ? stats.customerGenders : null,
    activity: access.customers ? activity : null,
    hourActivity: access.customers ? stats.hours.map(({ bin, messages }) => ({ label: String(bin * 3).padStart(2, '0') + ':00–' + String((bin + 1) * 3).padStart(2, '0') + ':00', messages })) : null,
    ai: access.ai ? stats.ai : null,
  } }
}
