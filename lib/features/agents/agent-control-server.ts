import 'server-only'
import type { NextRequest } from 'next/server'
import { getActor, canAccessTenant } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import { hasFeature } from '@/lib/feature-access'
import { InboxError } from '@/lib/features/inbox/inbox-server'
import {
  agentControlConfig,
  agentControlAvailable,
} from '@/lib/features/agents/agent-control-flags'
import { UUID } from '@/lib/utils'
import { conversationOwner, redactAgentText } from '@/lib/features/agents/agent-control-core'
import type { HandoverCustomer } from '@/lib/features/agents/agent-handover'
export async function agentHandoverCustomers(
  db: ReturnType<typeof supabaseAdmin>,
  tenantId: string,
  allowed?: boolean,
): Promise<HandoverCustomer[]> {
  if (!(allowed ?? (await hasFeature(db, tenantId, 'customer_management')))) return []
  const result = await db
    .from('customers')
    .select(
      'id,display_name,avatar_url,platform_user_id,platform,bot_enabled,assigned_user_id,conversation_status,conversation_version,handover_at,agent_opted_out',
    )
    .eq('tenant_id', tenantId)
    .order('last_message_at', { ascending: false })
    .limit(50)
  if (result.error) throw result.error
  return (result.data ?? []).map((customer) => ({
    ...customer,
    display_name: customer.display_name?.trim() || null,
    platform_user_id: customer.platform_user_id || customer.id,
    ownership: conversationOwner(customer),
  }))
}
export async function agentControlTenant(
  req: NextRequest,
  tenantId: string,
  owner = false,
  allowUnentitled = false,
) {
  const actor = await getActor(req)
  if (!actor || actor.kind !== 'user') throw new InboxError('กรุณาเข้าสู่ระบบ', 401)
  if (!UUID.test(tenantId) || !(await canAccessTenant(actor, tenantId)))
    throw new InboxError('ไม่พบร้านค้า', 404)
  if (owner && !(await canAccessTenant(actor, tenantId, 'owner')))
    throw new InboxError('เฉพาะเจ้าของร้านเท่านั้น', 403)
  const db = supabaseAdmin()
  if (!allowUnentitled && !(await hasFeature(db, tenantId, 'ai_agent')))
    throw new InboxError('แพ็กเกจไม่รองรับ AI Agent', 403, 'FEATURE_LOCKED')
  if (!agentControlAvailable())
    throw new InboxError('ระบบ AI ถูกหยุดฉุกเฉิน กรุณาติดต่อผู้ดูแลระบบ', 403, 'FEATURE_DISABLED')
  const config = await agentControlConfig(db, tenantId)
  if (!config?.flags.agent_control_center_enabled)
    throw new InboxError('Control Center ยังไม่เปิดสำหรับร้านนี้', 403, 'FEATURE_DISABLED')
  return { db, tenantId, actor, config }
}
export async function agentControlDashboard(
  db: ReturnType<typeof supabaseAdmin>,
  tenantId: string,
  analytics: boolean,
) {
  const month = new Date().toISOString().slice(0, 7) + '-01'
  const customersAllowed = await hasFeature(db, tenantId, 'customer_management')
  const [versions, usage, jobs, audit, customers, stats, tokens, shop] = await Promise.all([
    db
      .from('agent_prompt_versions')
      .select('id,version,instructions,created_at')
      .eq('tenant_id', tenantId)
      .order('version', { ascending: false })
      .limit(30),
    db
      .from('agent_ai_monthly_usage')
      .select('used')
      .eq('tenant_id', tenantId)
      .eq('month', month)
      .maybeSingle(),
    db
      .from('agent_message_jobs')
      .select('id,route,status,reason,created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(50),
    db
      .from('agent_control_audit')
      .select('id,event,detail,created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(100),
    agentHandoverCustomers(db, tenantId, customersAllowed),
    analytics
      ? db.rpc('agent_control_overview', { p_tenant: tenantId })
      : Promise.resolve({ data: null, error: null }),
    db
      .from('agent_ai_usage')
      .select('id,status,input_tokens,output_tokens,cost_baht,reason,created_at')
      .eq('tenant_id', tenantId)
      .gte('created_at', month)
      .order('created_at', { ascending: false })
      .limit(100),
    db.from('bot_settings').select('ai_instructions').eq('tenant_id', tenantId).maybeSingle(),
  ])
  for (const result of [versions, usage, jobs, audit, tokens, shop])
    if (result.error) throw result.error
  return {
    shopInstructions: shop.data?.ai_instructions ?? '',
    versions: (versions.data ?? []).map((v) => ({
      ...v,
      instructions: redactAgentText(v.instructions ?? ''),
    })),
    used: usage.data?.used ?? 0,
    jobs: jobs.data ?? [],
    audit: audit.data ?? [],
    customers,
    stats: stats.data,
    usage: tokens.data ?? [],
    month,
    costAvailable: false,
  }
}
