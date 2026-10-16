import { hasFeature } from '@/lib/feature-access'
import { supabaseAdmin } from '@/lib/supabase/server'
import { getActiveTenant, getViewer } from '@/lib/tenant'
import { requireDashboardUser } from '@/lib/auth'
import { aiConfigured } from '@/lib/ai-agent'
import { BOT_SETTINGS_COLUMNS, CHAT_RULE_COLUMNS, defaultBotSettings, ruleOrder, type BotSettings, type ChatRule } from '@/lib/chatbot'
import { ConversationsClient, type HandedOver } from '@/components/chatbot/ConversationsClient'
import { SetupNotice } from '@/components/SetupNotice'
import {agentControlConfig} from '@/lib/agent-control-flags'
import {AgentControlCenter} from '@/components/chatbot/AgentControlCenter'

export const metadata = { title: 'ผู้ช่วยตอบบทสนทนา' }

export default async function ConversationsPage() {
  await requireDashboardUser()
  const [tenant, viewer] = await Promise.all([getActiveTenant(), getViewer()])
  if (!tenant) return <SetupNotice kind="no-tenant" />
  if (!viewer.role) return <SetupNotice kind="migration" message="ไม่มีสิทธิ์เข้าถึงร้านค้านี้"/>
  const db = supabaseAdmin()

  const aiAllowed = await hasFeature(db, tenant.id, 'ai_agent')
  const [settings, rules, handedOver] = await Promise.all([
    db.from('bot_settings').select(BOT_SETTINGS_COLUMNS).eq('tenant_id', tenant.id).maybeSingle(),
    db.from('chat_rules').select(CHAT_RULE_COLUMNS).eq('tenant_id', tenant.id),
    db
      .from('customers')
      .select('id, display_name, platform_user_id, handover_at, conversation_version')
      .eq('tenant_id', tenant.id)
      .eq('bot_enabled', false)
      .not('handover_at', 'is', null)
      .order('handover_at', { ascending: false })
      .limit(50),
  ])
  const error = settings.error ?? rules.error ?? handedOver.error
  if (error) return <SetupNotice kind="migration" message={error.message} />

  let controlled=false
  if(aiAllowed){
    try{controlled=(await agentControlConfig(supabaseAdmin(),tenant.id))?.flags.agent_control_center_enabled===true}
    catch{return <SetupNotice kind="migration" message="กรุณาติดตั้ง agent-control.sql หรือปิด AGENT_CONTROL_ENABLED เพื่อใช้หน้าเดิม"/>}
  }
  const editor = (
    <ConversationsClient
      hidePlayground={controlled}
      aiAllowed={aiAllowed}
      tenantId={tenant.id}
      tenantBotOn={tenant.auto_reply_enabled}
      aiReady={aiConfigured()}
      initialSettings={(settings.data as BotSettings | null) ?? defaultBotSettings(tenant.id)}
      initialRules={((rules.data ?? []) as ChatRule[]).sort(ruleOrder)}
      handedOver={(handedOver.data ?? []) as HandedOver[]}
    />
  )
  return controlled?<AgentControlCenter key={tenant.id} tenantId={tenant.id}>{editor}</AgentControlCenter>:editor
}
