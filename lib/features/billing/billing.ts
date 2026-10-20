import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Billing, PlanId } from '@/lib/features/billing/plans'
import { tenantHasFeatureBypass } from '@/lib/auth'

/**
 * A tenant's plan and broadcast credits, after lapsing an expired plan and refilling a new month.
 * Service-role client only (the credit functions aren't granted to dashboard users).
 */
export async function getBilling(db: SupabaseClient, tenantId: string, adminBypass = false): Promise<Billing> {
  const featureBypass = adminBypass || await tenantHasFeatureBypass(db, tenantId)
  const refreshed = await db.rpc('refresh_broadcast_credits', { p_tenant: tenantId })
  if (refreshed.error) throw new Error(`${refreshed.error.message} (did you run supabase/billing.sql?)`)
  const { data, error } = await db
    .from('tenants')
    .select('plan, plan_expires_at, broadcast_allowance, broadcast_credits, broadcast_topup_credits, slip_quota, slip_used, slip_quota_credits')
    .eq('id', tenantId)
    .single()
  if (error) throw new Error(error.message)
  return {
    featureBypass,
    plan: data.plan as PlanId,
    planExpiresAt: data.plan_expires_at,
    monthly: data.broadcast_credits,
    allowance: data.broadcast_allowance,
    topup: data.broadcast_topup_credits,
    slipRemaining: Math.max(data.slip_quota + data.slip_quota_credits - data.slip_used, 0),
    slipQuotaCredits: data.slip_quota_credits,
  }
}

/** Credits taken for one batch, by bucket. */
export type Reservation = { monthly: number; topup: number }

export async function reserveCredits(db: SupabaseClient, tenantId: string, count: number): Promise<Reservation> {
  const { data, error } = await db.rpc('reserve_broadcast_credits', { p_tenant: tenantId, p_count: count })
  if (error) throw new Error(`reserve credits failed: ${error.message}`)
  const row = (Array.isArray(data) ? data[0] : data) as Reservation | undefined
  return { monthly: row?.monthly ?? 0, topup: row?.topup ?? 0 }
}

/**
 * Keep the credits of `used` messages, give the rest back. Used credits count against the
 * plan credits first (they were taken first), so the unused remainder goes back to top-ups first.
 */
export async function settleCredits(db: SupabaseClient, tenantId: string, r: Reservation, used: number) {
  const usedMonthly = Math.min(used, r.monthly)
  const back = { monthly: r.monthly - usedMonthly, topup: r.topup - (used - usedMonthly) }
  if (back.monthly <= 0 && back.topup <= 0) return
  const { error } = await db.rpc('refund_broadcast_credits', { p_tenant: tenantId, p_monthly: back.monthly, p_topup: back.topup })
  if (error) console.error('[billing] refund failed', tenantId, back, error.message)
}
