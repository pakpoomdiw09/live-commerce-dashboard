import 'server-only'
import type { NextRequest } from 'next/server'
import { getActor, canAccessTenant } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import { hasFeature } from '@/lib/feature-access'
import { InboxError } from '@/lib/features/inbox/inbox-server'
import { paymentProConfig, paymentProAvailable } from '@/lib/features/payments/payment-pro-flags'
import { UUID } from '@/lib/utils'
import { paymentReportFilters } from '@/lib/features/payments/payment-pro-core'

export async function paymentProTenant(req: NextRequest, tenantId: string, owner = false) {
  const actor = await getActor(req)
  if (!actor || actor.kind !== 'user') throw new InboxError('กรุณาเข้าสู่ระบบ', 401)
  if (!UUID.test(tenantId) || !(await canAccessTenant(actor, tenantId)))
    throw new InboxError('ไม่พบร้านค้าหรือไม่มีสิทธิ์', 404)
  if (owner && !(await canAccessTenant(actor, tenantId, 'owner')))
    throw new InboxError('เฉพาะเจ้าของร้านเท่านั้น', 403)
  const db = supabaseAdmin()
  if (!(await hasFeature(db, tenantId, 'slip_auto_pilot')))
    throw new InboxError('แพ็กเกจไม่รองรับตรวจสลิป', 403, 'FEATURE_LOCKED')
  if (!paymentProAvailable())
    throw new InboxError('Payment Pro ยังไม่เปิดใช้งานหรือถูกพักฉุกเฉิน', 403, 'FEATURE_DISABLED')
  const flags = await paymentProConfig(db, tenantId)
  if (!flags?.advancedDashboard)
    throw new InboxError('ยังไม่เปิด Dashboard Payment Pro', 403, 'FEATURE_DISABLED')
  return { db, tenantId, actor, flags }
}
export const PRO_LIST_COLUMNS =
  'id,slip_id,customer_id,status,reason,expected_satang,eligible,credit_charged,credit_refunded,provider_started_at,created_at,updated_at'
export async function paymentProOverview(
  db: ReturnType<typeof supabaseAdmin>,
  tenantId: string,
  analytics: boolean,
  filters = paymentReportFilters(),
) {
  const since = filters.from
  let list = db
    .from('payment_pro_attempts')
    .select(PRO_LIST_COLUMNS)
    .eq('tenant_id', tenantId)
    .gte('created_at', since)
    .lt('created_at', filters.to)
    .order('created_at', { ascending: false })
    .limit(500)
  if (filters.q) list = list.ilike('reason', '%' + filters.q.replace(/[\\%_]/g, '\\$&') + '%')
  const [attempts, audit, tenant, stats] = await Promise.all([
    analytics ? Promise.resolve({ data: [], error: null }) : list,
    db
      .from('payment_pro_audit')
      .select('id,attempt_id,actor_id,event,reason,created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(100),
    db
      .from('tenants')
      .select('slip_quota,slip_used,slip_quota_credits')
      .eq('id', tenantId)
      .single(),
    analytics
      ? db.rpc('payment_pro_dashboard_report', {
          p_tenant: tenantId,
          p_from: filters.from,
          p_to: filters.to,
          p_query: filters.q,
        })
      : Promise.resolve({ data: null, error: null }),
  ])
  for (const result of [attempts, audit, tenant, stats]) if (result.error) throw result.error
  const quota = Number(tenant.data!.slip_quota) + Number(tenant.data!.slip_quota_credits),
    used = Number(tenant.data!.slip_used)
  const report = stats.data as {
    attempts: unknown[]
    stats: Record<string, number>
    series: unknown[]
  } | null
  return {
    attempts: report?.attempts ?? attempts.data ?? [],
    audit: audit.data ?? [],
    credits: { quota, used, remaining: Math.max(0, quota - used) },
    stats: report?.stats ?? null,
    series: report?.series ?? [],
    provider: {
      configured: !!process.env.SLIPOK_API_KEY?.trim() && !!process.env.SLIPOK_BRANCH_ID?.trim(),
      liveCheckPerformed: false,
    },
    since,
    filters,
  }
}
