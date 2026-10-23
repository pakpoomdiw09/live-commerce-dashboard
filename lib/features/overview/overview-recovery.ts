import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadFeatureAccess } from '@/lib/feature-access'
import { emptyPremiumOverview, type OverviewFilters } from './premium-overview-core'
import { logOverviewError } from './overview-diagnostics'
import { InboxError } from '@/lib/features/inbox/inbox-server'
import { temporaryFullAccess } from '@/lib/full-access'

/** Emergency read path: SQL counts only, no unbounded client-side aggregation. */
export async function recoverOverview(
  db: SupabaseClient,
  shop: { id: string; name: string },
  filters: OverviewFilters,
) {
  // The caller has already authorized membership and loaded this active shop.
  const features = temporaryFullAccess
    ? { slip_auto_pilot: true, customer_management: true, ai_agent: true }
    : await loadFeatureAccess(db, shop.id)
  const base = emptyPremiumOverview(shop, filters, 'ข้อมูลบางส่วนยังไม่พร้อม')
  base.access = {
    slips: features.slip_auto_pilot,
    customers: features.customer_management,
    ai: features.ai_agent,
  }
  const scopedSlips = () => {
    let query = db
      .from('slips')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', shop.id)
      .lt('created_at', filters.to)
    if (filters.from) query = query.gte('created_at', filters.from)
    return query
  }
  let successful = 0
  const notices = ['สถิติบางส่วนยังไม่พร้อม ค่า 0 ในส่วนที่โหลดไม่ได้เป็นค่าชั่วคราว']
  async function count(
    stage: string,
    query: PromiseLike<{ count: number | null; error: unknown; status?: number }>,
  ) {
    try {
      const result = await query
      if (result.error) {
        logOverviewError(stage, result.error, { tenantId: shop.id, status: result.status })
        return 0
      }
      if (typeof result.count !== 'number') {
        logOverviewError(stage, new Error('COUNT_MISSING'), { tenantId: shop.id })
        return 0
      }
      successful++
      return result.count
    } catch (error) {
      logOverviewError(stage, error, { tenantId: shop.id })
      return 0
    }
  }
  const work: Promise<void>[] = []
  if (base.access.customers) {
    let messages = db
      .from('messages')
      .select('id,customers!inner(tenant_id)', { count: 'exact', head: true })
      .eq('customers.tenant_id', shop.id)
      .eq('sender', 'customer')
      .lt('created_at', filters.to)
    let customers = db
      .from('customers')
      .select('id,messages!inner(id)', { count: 'exact', head: true })
      .eq('tenant_id', shop.id)
      .eq('messages.sender', 'customer')
      .lt('messages.created_at', filters.to)
    if (filters.from) {
      messages = messages.gte('created_at', filters.from)
      customers = customers.gte('messages.created_at', filters.from)
    }
    work.push(
      count('recovery.messages.count', messages).then((n) => {
        base.metrics.messages = n
        base.metrics.incomingMessages = n
      }),
    )
    work.push(
      count('recovery.customers.distinct', customers).then((n) => {
        base.metrics.uniqueCustomers = n
      }),
    )
  }
  if (base.access.slips) {
    work.push(
      count('recovery.slips.total', scopedSlips()).then((n) => {
        base.metrics.totalSlips = n
      }),
    )
    work.push(
      count(
        'recovery.slips.passed',
        scopedSlips().or(
          'status.eq.valid,and(approved_at.not.is.null,status.in.(amount_mismatch,wrong_receiver,fake,error))',
        ),
      ).then((n) => {
        base.metrics.approved = n
        base.results!.passed = n
      }),
    )
    work.push(
      count(
        'recovery.slips.pending',
        scopedSlips().or(
          'status.eq.pending,and(status.in.(amount_mismatch,wrong_receiver),approved_at.is.null)',
        ),
      ).then((n) => {
        base.metrics.pending = n
        base.results!.pending = n
      }),
    )
    work.push(
      count(
        'recovery.slips.error',
        scopedSlips().eq('status', 'error').is('approved_at', null),
      ).then((n) => {
        base.results!.error = n
      }),
    )
    work.push(
      count(
        'recovery.slips.rejected',
        scopedSlips().or('status.eq.duplicate,and(status.eq.fake,approved_at.is.null)'),
      ).then((n) => {
        base.results!.rejected = n
      }),
    )
  }
  await Promise.all(work)
  if (work.length && !successful)
    throw new InboxError('โหลดฐานข้อมูลภาพรวมไม่ได้ กรุณาลองใหม่', 503, 'OVERVIEW_UNAVAILABLE')
  return { summary: base, notices }
}
