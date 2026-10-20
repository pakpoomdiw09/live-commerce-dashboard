import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { randomHandover } from '@/lib/features/agents/fallback-messages'
import { quickReplies } from '@/lib/integrations/facebook/client'
import { deliverOnce, deliverRichOnce, type Recipient } from '@/lib/features/slips/notify'
import { BOT_SETTINGS_COLUMNS, type BotSettings, type ChatRule } from '@/lib/features/agents/chatbot'

/** The tenant's saved settings, or null before it has saved any. */
export async function loadBotSettings(db: SupabaseClient, tenantId: string): Promise<BotSettings | null> {
  const { data, error } = await db.from('bot_settings').select(BOT_SETTINGS_COLUMNS).eq('tenant_id', tenantId).maybeSingle()
  // before supabase/automation.sql has run there is no table: keep the built-in replies working
  if (error) console.error('[chatbot] settings lookup failed (did you run supabase/automation.sql?)', error.message)
  return (data as BotSettings | null) ?? null
}

export type Incoming = {
  imageUrls?: readonly string[]
  tenant: { id: string; name: string }
  customer: { id: string; display_name: string | null }
  recipient: Recipient
  messageId: string
  text: string
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
