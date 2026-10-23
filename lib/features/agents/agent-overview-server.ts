import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  agentCapabilityEntitlements,
  type summarizeAgentJobs,
  type AgentOverviewRange,
  type AgentOverviewJob,
  type AgentOverviewData,
} from '@/lib/features/agents/agent-overview-core'
import { hasFeature } from '@/lib/feature-access'
import { automationStopped } from '@/lib/automation-safety'
import { aiConfigured } from '@/lib/features/agents/ai-agent'
import { PLANS, type PlanId } from '@/lib/features/billing/plans'
import { InboxError } from '@/lib/features/inbox/inbox-server'
import { agentControlAvailable } from '@/lib/features/agents/agent-control-flags'

export async function loadAgentOverview(
  db: SupabaseClient,
  tenantId: string,
  days: AgentOverviewRange,
  canManage: boolean,
): Promise<AgentOverviewData> {
  const now = new Date(),
    month = now.toISOString().slice(0, 7) + '-01'
  const feature = async (name: string) => {
    const result = await db.rpc('has_tenant_feature', { p_tenant: tenantId, p_feature: name })
    if (result.error || typeof result.data !== 'boolean')
      throw new InboxError('ตรวจสอบสิทธิ์แพ็กเกจไม่ได้ กรุณาลองใหม่', 503)
    return result.data
  }
  const [
    tenant,
    settings,
    usage,
    follow,
    aiAllowed,
    slipAllowed,
    followAllowed,
    customersAllowed,
    stopped,
    stats,
  ] = await Promise.all([
    db
      .from('tenants')
      .select(
        'name,auto_reply_enabled,auto_verify_enabled,page_id,page_token_set,plan,plan_expires_at,slip_quota,slip_quota_credits,slip_used',
      )
      .eq('id', tenantId)
      .maybeSingle(),
    db
      .from('agent_control_settings')
      .select('flags,ai_monthly_limit')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    db
      .from('agent_ai_monthly_usage')
      .select('used')
      .eq('tenant_id', tenantId)
      .eq('month', month)
      .maybeSingle(),
    db.from('follow_up_policies').select('enabled').eq('tenant_id', tenantId).maybeSingle(),
    feature('ai_agent'),
    feature('slip_auto_pilot'),
    feature('customer_follow_up'),
    hasFeature(db, tenantId, 'customer_management'),
    automationStopped(db, tenantId),
    db.rpc('agent_overview_stats', { p_tenant: tenantId, p_days: days, p_now: now.toISOString() }),
  ])
  if (tenant.error || !tenant.data || settings.error || usage.error)
    throw new InboxError('โหลดสถานะผู้ช่วย AI ไม่สำเร็จ กรุณาลองใหม่', 503)
  if (
    stats.error ||
    !stats.data ||
    !Array.isArray(stats.data.recent) ||
    stats.data.recent.length > 10 ||
    !Array.isArray(stats.data.points) ||
    stats.data.points.length !== days
  ) {
    console.error('[overview/agent] aggregate unavailable', {
      code: stats.error?.code ?? 'INVALID_RESULT',
    })
    throw new InboxError('โหลดสถิติผู้ช่วย AI ไม่สำเร็จ กรุณาลองใหม่หรือติดต่อผู้ดูแล', 503)
  }
  const { recent, ...metrics } = stats.data as ReturnType<typeof summarizeAgentJobs> & {
    recent: AgentOverviewJob[]
  }
  const flags = settings.data?.flags ?? {},
    managed = agentControlAvailable() && flags.agent_orchestrator_enabled === true
  const limit = settings.data?.ai_monthly_limit ?? 0,
    used = usage.data?.used ?? 0
  const entitlements = agentCapabilityEntitlements(
    { ai: aiAllowed, slips: slipAllowed, followup: followAllowed },
    limit - used,
    Number(tenant.data.slip_quota ?? 0) +
      Number(tenant.data.slip_quota_credits ?? 0) -
      Number(tenant.data.slip_used ?? 0),
  )
  const configured = !!tenant.data.page_id && tenant.data.page_token_set === true
  const live = agentControlAvailable()
  const readiness = [
    ...(!tenant.data.auto_reply_enabled ? ['ระบบตอบอัตโนมัติถูกปิดอยู่'] : []),
    ...(!managed ? ['ยังไม่เปิดระบบประมวลผลผู้ช่วย AI'] : []),
    ...(!configured ? ['ยังไม่ได้เชื่อมต่อเพจพร้อมสิทธิ์ส่งข้อความ'] : []),
    ...(!aiConfigured() ? ['ยังไม่ได้ตั้งค่าผู้ให้บริการ AI'] : []),
    ...(!live ? ['ขณะนี้ยังไม่เปิดส่งข้อความจริงจากผู้ช่วย AI'] : []),
    ...(stopped ? ['ระบบถูกพักฉุกเฉินอยู่'] : []),
    ...(limit <= used ? ['โควตา AI ไม่เพียงพอหรือยังไม่ได้ตั้งค่า'] : []),
    ...(!aiAllowed ? ['แพ็กเกจปัจจุบันไม่รองรับผู้ช่วย AI'] : []),
    ...(flags.capability_answers === false ? ['ความสามารถตอบคำถามถูกปิดอยู่'] : []),
    ...(flags.capability_intent === false ? ['การวิเคราะห์ข้อความถูกปิดอยู่'] : []),
  ]
  const names = new Map<string, string | null>(),
    notices: string[] = []
  if (recent.length && customersAllowed) {
    const result = await db
      .from('customers')
      .select('id,display_name')
      .eq('tenant_id', tenantId)
      .in('id', [...new Set(recent.map((job) => job.customer_id))])
    if (result.error) notices.push('ยังโหลดชื่อลูกค้าไม่ได้')
    else for (const row of result.data ?? []) names.set(row.id, row.display_name)
  }
  if (follow.error) notices.push('ระบบติดตามลูกค้ายังไม่พร้อม กรุณาตรวจสอบการตั้งค่า')
  const plan =
    tenant.data.plan_expires_at && Date.parse(tenant.data.plan_expires_at) <= now.getTime()
      ? 'free'
      : tenant.data.plan
  return {
    ...metrics,
    updatedAt: now.toISOString(),
    canManage,
    masterEnabled: tenant.data.auto_reply_enabled,
    ready: readiness.length === 0,
    readiness,
    page: { name: configured ? tenant.data.name : null, configured },
    capabilities: {
      answers: flags.capability_answers !== false,
      products: flags.capability_products !== false,
      handoff: flags.capability_handoff !== false,
      intent: flags.capability_intent !== false,
      slips: tenant.data.auto_verify_enabled,
      followup: !follow.error && follow.data?.enabled === true,
    },
    available: {
      answers: managed,
      products: managed,
      handoff: managed,
      intent: managed,
      slips: slipAllowed,
      followup: followAllowed && !follow.error && !!follow.data,
    },
    entitlements,
    quota: {
      plan: PLANS[plan as PlanId]?.name ?? 'ยังไม่มีข้อมูลแพ็กเกจ',
      used,
      limit,
      remaining: Math.max(0, limit - used),
      month,
    },
    recent: recent.map((job) => ({ ...job, customer: names.get(job.customer_id) ?? null })),
    notices,
  }
}
