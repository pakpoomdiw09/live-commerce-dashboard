import 'server-only'
import { redirect } from 'next/navigation'
import { getActor } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/server'

/** Only a verified Supabase user can enter the owner dashboard. */
export async function requirePlatformOwner() {
  const actor = await getActor()
  if (!actor || actor.kind !== 'user' || !actor.isPlatformAdmin) redirect('/dashboard')
  return actor
}

export type AdminOverview = {
  tenantCount: number
  activeTenantCount: number
  monthRevenue: number
  pendingCount: number
  pendingAmount: number
}

export async function loadAdminOverview(): Promise<AdminOverview> {
  const { data, error } = await supabaseAdmin().rpc('platform_dashboard_overview')
  if (error) throw new Error('อ่านภาพรวมไม่ได้ กรุณาตรวจสอบการติดตั้ง platform-dashboard.sql')
  return data as AdminOverview
}
