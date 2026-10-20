import { NextRequest, NextResponse } from 'next/server'
import { agentControlTenant } from '@/lib/features/agents/agent-control-server'
import { canAccessTenant } from '@/lib/auth'
import { loadAgentOverview } from '@/lib/features/agents/agent-overview-server'
import { CAPABILITY_KEYS, type AgentOverviewRange } from '@/lib/features/agents/agent-overview-core'
import { inboxError, InboxError, checkRpc } from '@/lib/features/inbox/inbox-server'
import { isSupportedBank, UNSUPPORTED_BANK_MESSAGE } from '@/lib/features/banking/banks'

function upgradeResponse(code: 'FEATURE_LOCKED' | 'AI_QUOTA_EXHAUSTED' | 'SLIP_QUOTA_EXHAUSTED') {
  const messages = {
    FEATURE_LOCKED: 'กรุณาชำระแพ็กเกจ Starter หรือ Pro ที่รองรับความสามารถนี้ก่อนใช้งาน หากแพ็กเกจหมดอายุ กรุณาต่ออายุแพ็กเกจ',
    AI_QUOTA_EXHAUSTED: 'โควตาผู้ช่วย AI หมดหรือยังไม่ได้กำหนด กรุณาตรวจสอบแพ็กเกจและเพิ่มโควตาก่อนเปิดใช้งาน',
    SLIP_QUOTA_EXHAUSTED: 'เครดิตตรวจสลิปหมด กรุณาเติมเครดิตก่อนเปิดใช้งาน',
  }
  return NextResponse.json({ error: messages[code], code, upgradeUrl: '/billing' }, { status: code === 'FEATURE_LOCKED' ? 403 : 409 })
}

export async function GET(req: NextRequest) {
  try {
    const { db, tenantId, actor } = await agentControlTenant(req, req.nextUrl.searchParams.get('tenantId') ?? '', false, true)
    const days = Number(req.nextUrl.searchParams.get('days') ?? '7')
    if (![7, 30, 90].includes(days)) throw new InboxError('ช่วงเวลาไม่ถูกต้อง')
    const data = await loadAgentOverview(db, tenantId, days as AgentOverviewRange, await canAccessTenant(actor, tenantId, 'owner'))
    return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return inboxError(error) }
}

export async function PATCH(req: NextRequest) {
  try {
    if (req.headers.get('origin') !== req.nextUrl.origin) throw new InboxError('แหล่งที่มาของคำขอไม่ถูกต้อง', 403)
    const { db, tenantId, actor } = await agentControlTenant(req, req.nextUrl.searchParams.get('tenantId') ?? '', true, true)
    const input = await req.json().catch(() => null)
    if (!input || typeof input.enabled !== 'boolean' || !['master', ...CAPABILITY_KEYS].includes(input.capability)) throw new InboxError('ข้อมูลการตั้งค่าไม่ถูกต้อง')
    if (input.capability === 'slips' && input.enabled) {
      // Give entitlement/quota errors priority over bank setup errors. RPC rechecks atomically.
      const [ai, slip, settings, usage, credits] = await Promise.all([
        db.rpc('has_tenant_feature', { p_tenant: tenantId, p_feature: 'ai_agent' }),
        db.rpc('has_tenant_feature', { p_tenant: tenantId, p_feature: 'slip_auto_pilot' }),
        db.from('agent_control_settings').select('ai_monthly_limit').eq('tenant_id', tenantId).maybeSingle(),
        db.from('agent_ai_monthly_usage').select('used').eq('tenant_id', tenantId).eq('month', new Date().toISOString().slice(0, 7) + '-01').maybeSingle(),
        db.from('tenants').select('slip_quota,slip_quota_credits,slip_used').eq('id', tenantId).maybeSingle(),
      ])
      if ([ai, slip, settings, usage, credits].some(result => result.error) || !credits.data) throw new InboxError('ตรวจสอบแพ็กเกจและโควตาไม่ได้ กรุณาลองใหม่', 503)
      if (ai.data !== true || slip.data !== true) return upgradeResponse('FEATURE_LOCKED')
      if ((settings.data?.ai_monthly_limit ?? 0) <= (usage.data?.used ?? 0)) return upgradeResponse('AI_QUOTA_EXHAUSTED')
      if (Number(credits.data.slip_quota) + Number(credits.data.slip_quota_credits) <= Number(credits.data.slip_used)) return upgradeResponse('SLIP_QUOTA_EXHAUSTED')
      const accounts = await db.from('bank_accounts').select('bank_code').eq('tenant_id', tenantId).eq('is_active', true)
      if (accounts.error) throw new InboxError('อ่านบัญชีรับเงินไม่ได้ กรุณาลองใหม่', 503)
      if (!accounts.data?.length || accounts.data.some(account => !isSupportedBank(account.bank_code))) throw new InboxError(UNSUPPORTED_BANK_MESSAGE)
    }
    const result = await db.rpc('set_agent_overview_capability', { p_tenant: tenantId, p_actor: actor.id, p_capability: input.capability, p_enabled: input.enabled })
    if (result.error?.code === 'PGRST202' || result.error?.code === '42883') throw new InboxError('กรุณาติดตั้งส่วนอัปเดตศูนย์ควบคุมผู้ช่วย AI ก่อนเปลี่ยนการตั้งค่า', 503)
    if (result.error?.code === 'P0403') return upgradeResponse('FEATURE_LOCKED')
    if (result.error?.code === 'P0402') return upgradeResponse('AI_QUOTA_EXHAUSTED')
    if (result.error?.code === 'P0404') return upgradeResponse('SLIP_QUOTA_EXHAUSTED')
    if (result.error?.code === '22023') throw new InboxError(input.capability === 'followup' ? 'กรุณาตั้งค่ากติกาติดตามลูกค้าก่อนเปิดใช้งาน' : input.capability === 'slips' ? 'กรุณาตั้งค่าบัญชีรับเงินและตรวจสอบสิทธิ์ตรวจสลิปก่อนเปิดใช้งาน' : 'กรุณาตรวจสอบการตั้งค่าระบบประมวลผลผู้ช่วย AI ก่อนเปิดใช้งาน')
    checkRpc(result.error)
    return NextResponse.json({ ok: true })
  } catch (error) { return inboxError(error) }
}
