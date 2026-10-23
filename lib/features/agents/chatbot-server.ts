import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { aiReply, HANDOVER_TOKEN, type AiProductResult } from '@/lib/features/agents/ai-agent'
import { deliverOnce } from '@/lib/features/slips/notify'
import {
  defaultBotSettings,
  wantsHuman,
  CHAT_RULE_COLUMNS,
  matchChatRule,
  ruleOrder,
  type ChatRule,
} from '@/lib/features/agents/chatbot'
import { hasFeature } from '@/lib/feature-access'
import { inputRisk } from '@/lib/features/agents/agent-control-core'
import {
  loadBotSettings,
  handover,
  sendRule,
  type Incoming,
} from '@/lib/features/agents/chatbot-actions'
export {
  loadBotSettings,
  sendRule,
  handover,
  type Incoming,
} from '@/lib/features/agents/chatbot-actions'

export async function answerChat(db: SupabaseClient, m: Incoming) {
  await (
    await import('@/lib/features/inbox/inbox-automation-window')
  ).assertAutomationWindow(db, m.customer.id, m.tenant.id)
  const { orchestrateAgentMessage } = await import('@/lib/features/agents/agent-orchestrator')
  if (await orchestrateAgentMessage(db, m)) return
  const settings = (await loadBotSettings(db, m.tenant.id)) ?? defaultBotSettings(m.tenant.id)
  const once = 'reply:' + m.messageId
  if (wantsHuman(settings.handover_keywords, m.text) || inputRisk(m.text))
    return handover(db, m, settings, once)
  const rules =
    settings.reply_mode === 'keyword'
      ? await db
          .from('chat_rules')
          .select(CHAT_RULE_COLUMNS)
          .eq('tenant_id', m.tenant.id)
          .eq('is_active', true)
          .order('priority', { ascending: false })
          .order('created_at')
          .order('id')
          .limit(20)
      : { data: [], error: null }
  if (rules.error) throw rules.error
  const rule =
    settings.reply_mode === 'keyword'
      ? matchChatRule(((rules.data ?? []) as ChatRule[]).sort(ruleOrder), m.text)
      : null
  if (rule) {
    await sendRule(db, m.recipient, once, rule)
    await db.rpc('bump_chat_rule', { p_rule: rule.id })
    return
  }
  if (settings.reply_mode === 'keyword') return // Keyword mode never falls through to AI.
  if (
    wantsHuman(settings.handover_keywords, m.text) ||
    inputRisk(m.text) ||
    !(await hasFeature(db, m.tenant.id, 'ai_agent'))
  )
    return handover(db, m, settings, once)
  const product = { current: null as AiProductResult | null }
  let reply: string | null = null
  try {
    reply = await aiReply(db, {
      shopName: m.tenant.name,
      instructions: settings.ai_instructions,
      customerName: m.customer.display_name,
      customerId: m.customer.id,
      tenantId: m.tenant.id,
      imageUrls: m.imageUrls,
      onProductResult: (value) => {
        product.current = value
      },
    })
  } catch {
    /* Provider failure transfers to staff; never send a generic fallback. */
  }
  if (!reply || reply === HANDOVER_TOKEN) return handover(db, m, settings, once)
  await (product.current?.image_url
    ? (await import('@/lib/features/agents/product-reply')).deliverProductReply(
        db,
        m.recipient,
        once,
        reply,
        product.current.image_url,
      )
    : deliverOnce(db, m.recipient, once, reply))
}
