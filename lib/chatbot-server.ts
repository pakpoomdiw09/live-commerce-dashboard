import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { botReply } from '@/lib/bot'
import { aiReply, HANDOVER_TOKEN } from '@/lib/ai-agent'
import { randomFallback, randomHandover } from '@/lib/fallback-messages'
import { quickReplies } from '@/lib/facebook'
import { deliverOnce, deliverRichOnce, type Recipient } from '@/lib/slip/notify'
import { BOT_SETTINGS_COLUMNS, CHAT_RULE_COLUMNS, matchChatRule, ruleOrder, wantsHuman, type BotSettings, type ChatRule } from '@/lib/chatbot'

/** The tenant's saved settings, or null before it has saved any (the old built-in replies then apply). */
export async function loadBotSettings(db: SupabaseClient, tenantId: string): Promise<BotSettings | null> {
  const { data, error } = await db.from('bot_settings').select(BOT_SETTINGS_COLUMNS).eq('tenant_id', tenantId).maybeSingle()
  // before supabase/automation.sql has run there is no table: keep the built-in replies working
  if (error) console.error('[chatbot] settings lookup failed (did you run supabase/automation.sql?)', error.message)
  return (data as BotSettings | null) ?? null
}

export type Incoming = {
  tenant: { id: string; name: string }
  customer: { id: string; display_name: string | null }
  recipient: Recipient
  messageId: string
  text: string
}

/**
 * Answer one customer text message (auto-reply is already known to be on for this chat):
 * handover keywords first, then keyword rules or the AI Agent, then the fallback text.
 */
export async function answerChat(db: SupabaseClient, m: Incoming) {
  if (process.env.AGENT_CONTROL_ENABLED === 'true') {
    const { orchestrateAgentMessage } = await import('@/lib/agent-orchestrator')
    if (await orchestrateAgentMessage(db, m)) return
  }
  const settings = await loadBotSettings(db, m.tenant.id)
  const once = `reply:${m.messageId}`

  if (!settings) {
    const reply = await botReply(m.text, m.customer)
    if (reply) await deliverOnce(db, m.recipient, once, reply)
    return
  }

  if (wantsHuman(settings.handover_keywords, m.text)) return handover(db, m, settings, once)

  if (settings.reply_mode === 'ai') {
    const reply = await aiReply(db, {
      shopName: m.tenant.name,
      instructions: settings.ai_instructions,
      customerName: m.customer.display_name,
      customerId: m.customer.id,
      tenantId: m.tenant.id,
    })
    if (reply === HANDOVER_TOKEN) return handover(db, m, settings, once)
    const text = reply ?? randomFallback(settings)
    if (text) await deliverOnce(db, m.recipient, once, text)
    return
  }

  const { data, error } = await db.from('chat_rules').select(CHAT_RULE_COLUMNS).eq('tenant_id', m.tenant.id).eq('is_active', true)
  if (error) console.error('[chatbot] rules lookup failed', error.message)
  const rule = matchChatRule(((data ?? []) as ChatRule[]).sort(ruleOrder), m.text)
  console.log(`[chatbot] message ${m.messageId} → ${rule ? `rule "${rule.name}"` : 'no matching rule'}`)
  if (rule) {
    await sendRule(db, m.recipient, once, rule)
    const { error: bumpError } = await db.rpc('bump_chat_rule', { p_rule: rule.id })
    if (bumpError) console.error('[chatbot] hit count failed', bumpError.message)
    return
  }
  const fallback = randomFallback(settings)
  if (fallback) await deliverOnce(db, m.recipient, once, fallback)
}

/** Text and/or image, with the quick reply buttons on the last part. */
export async function sendRule(db: SupabaseClient, to: Recipient, once: string, rule: ChatRule) {
  const buttons = quickReplies(rule.quick_replies)
  const text = rule.reply_text?.trim()
  const parts: object[] = []
  if (rule.reply_type === 'image' && rule.image_url) {
    if (text) parts.push({ text })
    parts.push({ attachment: { type: 'image', payload: { url: rule.image_url, is_reusable: true } }, ...buttons })
  } else if (text) {
    parts.push({ text, ...buttons })
  }
  if (!parts.length) return
  const attachments = rule.reply_type === 'image' && rule.image_url ? [{ type: 'image', payload: { url: rule.image_url } }] : []
  return await deliverRichOnce(db, to, once, text || '[รูปภาพ]', parts, 'RESPONSE', attachments)
}

/** Stop the bot for this chat until an admin turns it back on, and tell the customer. */
export async function handover(db: SupabaseClient, m: Incoming, settings: BotSettings, once: string) {
  const text = randomHandover(settings)
  if (text) await deliverOnce(db, m.recipient, `handover:${once}`, text)
  else {
    const started = await db.rpc('start_inbox_handover', { p_customer: m.customer.id })
    if (started.error) throw started.error
    const released = await db.rpc('end_inbox_delivery', { p_customer: m.customer.id, p_lease: started.data })
    if (released.error) throw released.error
  }
}
