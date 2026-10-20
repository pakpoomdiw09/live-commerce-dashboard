import { hasFeature } from '@/lib/feature-access'
import { supabaseAdmin } from '@/lib/supabase/server'
import { getActiveTenant, getViewer } from '@/lib/tenant'
import { requireDashboardUser } from '@/lib/auth'
import { aiConfigured } from '@/lib/features/agents/ai-agent'
import { BOT_SETTINGS_COLUMNS, CHAT_RULE_COLUMNS, defaultBotSettings, ruleOrder, type BotSettings, type ChatRule } from '@/lib/features/agents/chatbot'
import { ConversationsClient, type HandedOver } from '@/components/chatbot/ConversationsClient'

import { SetupNotice } from '@/components/shared/SetupNotice'
import { agentControlConfig } from '@/lib/features/agents/agent-control-flags'
import { AgentControlCenter } from '@/components/chatbot/AgentControlCenter'
import { InlineError } from '@/components/shared/ErrorState'
import { isMissingDatabaseColumn } from '@/lib/types'

export const metadata = { title: 'ผู้ช่วยตอบบทสนทนา' }

export default async function ConversationsPage() {
  await requireDashboardUser()
  const [tenant, viewer] = await Promise.all([getActiveTenant(), getViewer()])
  if (!tenant) return <SetupNotice kind="no-tenant" />
  if (!viewer.role) return <SetupNotice kind="migration" message="ไม่มีสิทธิ์เข้าถึงร้านค้านี้"/>
  const db = supabaseAdmin()

  const warnings: string[] = []
  let aiAllowed = false
  try {
    aiAllowed = await hasFeature(db, tenant.id, 'ai_agent')
  } catch (error) {
    console.error('[chatbot/conversations] package access lookup failed', error)
    warnings.push('ตรวจสอบสิทธิ์แพ็กเกจ AI ไม่สำเร็จ จึงปิดการตั้งค่า AI ชั่วคราว')
  }

  const settingsColumns = BOT_SETTINGS_COLUMNS.split(', ').filter(column => !['fallback_messages', 'handover_messages'].includes(column)).join(', ')
  let settings
  try {
    settings = await db.from('bot_settings').select(BOT_SETTINGS_COLUMNS).eq('tenant_id', tenant.id).maybeSingle()
    if (isMissingDatabaseColumn(settings.error, 'fallback_messages') || isMissingDatabaseColumn(settings.error, 'handover_messages')) {
      settings = await db.from('bot_settings').select(settingsColumns).eq('tenant_id', tenant.id).maybeSingle()
      if (!settings.error) warnings.push('ข้อมูลข้อความแจ้งส่งต่อแอดมินยังเป็นรุ่นเก่า ระบบจะแสดงค่าเริ่มต้นให้ก่อน')
    }
  } catch (error) {
    console.error('[chatbot/conversations] bot settings query failed', error)
    warnings.push('โหลดการตั้งค่าบอตไม่ได้ ระบบจะแสดงค่าเริ่มต้นชั่วคราว')
    settings = { data: null, error: null }
  }
  if (settings.error) {
    console.error('[chatbot/conversations] bot settings query failed', settings.error)
    warnings.push('โหลดการตั้งค่าบอตไม่ได้ ระบบจะแสดงค่าเริ่มต้นชั่วคราว')
  }

  const rules=await db.from('chat_rules').select(CHAT_RULE_COLUMNS).eq('tenant_id',tenant.id)
  if(rules.error)warnings.push('Keyword rules unavailable')
  let handedOver
  try {
    handedOver = await db
      .from('customers')
      .select('id, display_name, platform_user_id, handover_at, conversation_version')
      .eq('tenant_id', tenant.id)
      .eq('bot_enabled', false)
      .not('handover_at', 'is', null)
      .order('handover_at', { ascending: false })
      .limit(50)
    if (isMissingDatabaseColumn(handedOver.error, 'conversation_version')) {
      handedOver = await db
        .from('customers')
        .select('id, display_name, platform_user_id, handover_at')
        .eq('tenant_id', tenant.id)
        .eq('bot_enabled', false)
        .not('handover_at', 'is', null)
        .order('handover_at', { ascending: false })
        .limit(50)
      if (!handedOver.error) warnings.push('ยังไม่ได้ติดตั้งข้อมูลจัดการบทสนทนารุ่นล่าสุด ปุ่มจัดการบางรายการอาจใช้ไม่ได้')
    }
  } catch (error) {
    console.error('[chatbot/conversations] handover queue query failed', error)
    warnings.push('โหลดรายการที่ส่งต่อให้แอดมินไม่ได้ รายการจะแสดงเป็นค่าว่างชั่วคราว')
    handedOver = { data: [], error: null }
  }
  if (handedOver.error) {
    console.error('[chatbot/conversations] handover queue query failed', handedOver.error)
    warnings.push('โหลดรายการที่ส่งต่อให้แอดมินไม่ได้ รายการจะแสดงเป็นค่าว่างชั่วคราว')
  }

  let controlConfig: Awaited<ReturnType<typeof agentControlConfig>> = null
  let controlled = false
  // Keep existing Control Center settings visible when a subscription expires.
  try {
    controlConfig = await agentControlConfig(db, tenant.id)
    controlled = controlConfig?.flags.agent_control_center_enabled === true
  } catch (error) {
    console.error('[chatbot/conversations] agent control config unavailable', error)
    if (aiAllowed) warnings.push('ส่วนควบคุมผู้ช่วย AI ยังไม่พร้อม ระบบจะแสดงหน้าจอตั้งค่าพื้นฐานแทน')
  }

  const editor = (
    <>
    {warnings.map((warning, index) => <InlineError key={`${index}:${warning}`} title={warning} />)}
    <ConversationsClient
      hidePlayground={controlled}
      aiAllowed={aiAllowed}
      tenantId={tenant.id}
      tenantBotOn={tenant.auto_reply_enabled}
      aiReady={aiConfigured()}
      initialSettings={{...defaultBotSettings(tenant.id), ...(settings.data as Partial<BotSettings> | null)}}
      initialRules={((rules.data??[]) as ChatRule[]).sort(ruleOrder)}
      handedOver={(handedOver.data ?? []) as HandedOver[]}
    />
    </>
  )
  return controlled
    ? <AgentControlCenter key={tenant.id} tenantId={tenant.id}>{editor}</AgentControlCenter>
    : editor
}
