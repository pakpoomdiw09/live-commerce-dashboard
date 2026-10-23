import { temporaryFullAccess } from '@/lib/full-access'
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const FEATURES = [
  'ai_agent',
  'image_assistant',
  'customer_management',
  'slip_auto_pilot',
  'customer_follow_up',
] as const
export type Feature = (typeof FEATURES)[number]
export type FeatureAccess = Record<Feature, boolean>
export const LOCKED_ACCESS: FeatureAccess = {
  ai_agent: false,
  image_assistant: false,
  customer_management: false,
  slip_auto_pilot: false,
  customer_follow_up: false,
}

/** Database-owned entitlements, active tenant and expiry; no frontend or admin metadata bypass. */
export async function hasFeature(
  db: SupabaseClient,
  tenantId: string,
  feature: Feature,
): Promise<boolean> {
  if (temporaryFullAccess) {
    const { data, error } = await db
      .from('tenants')
      .select('id')
      .eq('id', tenantId)
      .eq('is_active', true)
      .maybeSingle()
    return !error && !!data
  }
  try {
    const { data, error } = await db.rpc('has_tenant_feature', {
      p_tenant: tenantId,
      p_feature: feature,
    })
    if (error)
      console.error('[feature-access] lookup failed', { tenantId, feature, code: error.code })
    return !error && data === true
  } catch {
    console.error('[feature-access] lookup unavailable', { tenantId, feature })
    return false
  }
}

export async function loadFeatureAccess(
  db: SupabaseClient,
  tenantId: string,
): Promise<FeatureAccess> {
  const entries = await Promise.all(
    FEATURES.map(async (feature) => [feature, await hasFeature(db, tenantId, feature)] as const),
  )
  return Object.fromEntries(entries) as FeatureAccess
}

export class FeatureLockedError extends Error {
  readonly code = 'FEATURE_LOCKED'
  constructor(readonly feature: Feature) {
    super('ฟีเจอร์นี้สำหรับสมาชิกที่อัปเกรดแพ็กเกจ')
  }
}
export async function requireFeature(db: SupabaseClient, tenantId: string, feature: Feature) {
  if (!(await hasFeature(db, tenantId, feature))) throw new FeatureLockedError(feature)
}
export async function hasSlipAccess(db: SupabaseClient, tenantId: string): Promise<boolean> {
  if (!(await hasFeature(db, tenantId, 'slip_auto_pilot'))) return false
  if (temporaryFullAccess) return true
  const { data, error } = await db
    .from('tenants')
    .select('slip_quota,slip_quota_credits,slip_used')
    .eq('id', tenantId)
    .maybeSingle()
  return (
    !error &&
    !!data &&
    Number(data.slip_used) < Number(data.slip_quota) + Number(data.slip_quota_credits)
  )
}
export function featureLockedResponse(feature: Feature) {
  return NextResponse.json(
    {
      error: 'ฟีเจอร์นี้สำหรับสมาชิกที่อัปเกรดแพ็กเกจ',
      code: 'FEATURE_LOCKED',
      feature,
      upgradeUrl: '/billing',
    },
    { status: 403 },
  )
}
