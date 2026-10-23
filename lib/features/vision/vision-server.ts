import 'server-only'
import type { NextRequest } from 'next/server'
import { canAccessTenant, getActor } from '@/lib/auth'
import { hasFeature } from '@/lib/feature-access'
import { InboxError } from '@/lib/features/inbox/inbox-server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { UUID } from '@/lib/utils'
import type { VisionSettings } from '@/lib/features/vision/vision-types'

export async function visionTenant(req: NextRequest, tenantId: string, owner = false) {
  const actor = await getActor(req)
  if (!actor || actor.kind !== 'user') throw new InboxError('กรุณาเข้าสู่ระบบ', 401)
  if (!UUID.test(tenantId) || !(await canAccessTenant(actor, tenantId, owner ? 'owner' : 'staff')))
    throw new InboxError('ไม่พบร้านค้าหรือไม่มีสิทธิ์', 404)
  const db = supabaseAdmin()
  if (!(await hasFeature(db, tenantId, 'image_assistant')))
    throw new InboxError('กรุณาอัปเกรดแพ็กเกจ', 403, 'FEATURE_LOCKED')
  return { db, actor, tenantId }
}
export const defaultVisionSettings = (tenantId: string): VisionSettings => ({
  tenant_id: tenantId,
  enabled: false,
  mode: 'rules',
  confidence_threshold: 0.8,
  handoff_enabled: true,
})
export async function visionOverview(db: ReturnType<typeof supabaseAdmin>, tenantId: string) {
  const month = new Date().toISOString().slice(0, 7) + '-01'
  const [settings, usage, jobs, tenant] = await Promise.all([
    db.from('vision_settings').select('*').eq('tenant_id', tenantId).maybeSingle(),
    db
      .from('vision_usage')
      .select('used')
      .eq('tenant_id', tenantId)
      .eq('month', month)
      .maybeSingle(),
    db
      .from('vision_jobs')
      .select('id,source,status,result,decision,reason,created_at,ai_request_started_at,attempts')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(30),
    db.from('tenants').select('plan').eq('id', tenantId).single(),
  ])
  for (const result of [settings, usage, jobs, tenant]) if (result.error) throw result.error
  const limits = await db
    .from('vision_plan_limits')
    .select('monthly_images,product_search')
    .eq('plan', tenant.data!.plan)
    .single()
  if (limits.error) throw limits.error
  const used = usage.data?.used ?? 0,
    limit = limits.data.monthly_images as number
  return {
    settings: (settings.data ?? defaultVisionSettings(tenantId)) as VisionSettings,
    usage: { used, limit, remaining: Math.max(0, limit - used), month },
    productSearch:
      limits.data.product_search === true && (await hasFeature(db, tenantId, 'ai_agent')),
    jobs: jobs.data ?? [],
    automationEnabled: process.env.AI_VISION_AUTOMATION_ENABLED === 'true',
  }
}
