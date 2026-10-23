import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  agentControlConfig,
  agentControlAvailable,
} from '@/lib/features/agents/agent-control-flags'
import { inputRisk } from '@/lib/features/agents/agent-control-core'
import {
  loadBotSettings,
  handover,
  sendRule,
  type Incoming,
} from '@/lib/features/agents/chatbot-actions'
import {
  defaultBotSettings,
  wantsHuman,
  CHAT_RULE_COLUMNS,
  matchChatRule,
  ruleOrder,
  type ChatRule,
} from '@/lib/features/agents/chatbot'
import { aiReply, HANDOVER_TOKEN, type AiProductResult } from '@/lib/features/agents/ai-agent'
import { hasFeature } from '@/lib/feature-access'

import { deliverOnce } from '@/lib/features/slips/notify'

export async function orchestrateAgentMessage(db: SupabaseClient, m: Incoming): Promise<boolean> {
  const config = await agentControlConfig(db, m.tenant.id)
  if (!config?.flags.agent_orchestrator_enabled) return false
  const claim = await db.rpc('claim_agent_message', {
    p_tenant: m.tenant.id,
    p_customer: m.customer.id,
    p_message: m.messageId,
  })
  if (claim.error) throw claim.error
  const job = (claim.data as { id: string; claim_token: string }[] | null)?.[0]
  if (!job) return true // duplicate, opt-out, stale message or human ownership; never fall through to legacy
  const save = async (values: Record<string, unknown>) => {
    const result = await db
      .from('agent_message_jobs')
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq('id', job.id)
      .eq('tenant_id', m.tenant.id)
      .eq('claim_token', job.claim_token)
      .eq('status', 'processing')
      .select('id')
      .maybeSingle()
    if (result.error || !result.data) throw new Error('AGENT_CLAIM_CHANGED')
  }
  try {
    const settings = (await loadBotSettings(db, m.tenant.id)) ?? defaultBotSettings(m.tenant.id)
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
    if (
      settings.reply_mode === 'keyword' &&
      !rule &&
      !wantsHuman(settings.handover_keywords, m.text) &&
      !inputRisk(m.text)
    ) {
      await save({ route: 'SKIP', status: 'skipped', reason: 'NO_KEYWORD_MATCH' })
      return true
    }
    const aiEntitled =
      !rule &&
      config.capabilities?.answers !== false &&
      config.capabilities?.intent !== false &&
      (await hasFeature(db, m.tenant.id, 'ai_agent'))
    let route: string = rule ? 'KEYWORD' : aiEntitled && config.monthlyLimit > 0 ? 'AI' : 'ADMIN'
    const product = { current: null as AiProductResult | null }
    let text: string | null = null,
      reason: string | null = route === 'ADMIN' ? 'AI_NOT_AVAILABLE' : null
    if (
      route !== 'KEYWORD' &&
      ((config.capabilities?.handoff !== false && wantsHuman(settings.handover_keywords, m.text)) ||
        inputRisk(m.text))
    ) {
      route = 'ADMIN'
      reason = inputRisk(m.text) ?? 'CUSTOMER_REQUESTED_HUMAN'
    } else if (route === 'AI') {
      try {
        text = await aiReply(
          db,
          {
            tenantId: m.tenant.id,
            shopName: m.tenant.name,
            customerName: m.customer.display_name,
            customerId: m.customer.id,
            instructions: settings.ai_instructions,
            imageUrls: m.imageUrls,
            onProductResult: (value) => {
              product.current = value
            },
            agentJob: { id: job.id, claim: job.claim_token },
          },
          undefined,
          true,
        )
      } catch (error) {
        reason = (error as { code?: string })?.code ?? 'AI_PROVIDER_FAILED'
        text = [
          'AGENT_POLICY_HANDOFF',
          'AGENT_INPUT_REQUIRES_REVIEW',
          'AGENT_SENSITIVE_KNOWLEDGE',
        ].includes(reason)
          ? HANDOVER_TOKEN
          : null
      }
      if (text === HANDOVER_TOKEN) {
        route = 'ADMIN'
        text = null
        reason = 'AI_HUMAN_REVIEW'
      } else if (!text) {
        route = 'ADMIN'
        reason = reason ?? 'AI_UNAVAILABLE'
      }
    }
    await save({ route, reason })
    const current = await agentControlConfig(db, m.tenant.id)
    if (!agentControlAvailable() || !current?.flags.agent_orchestrator_enabled) {
      await save({ status: 'review', reason: 'ORCHESTRATOR_DISABLED' })
      return true
    }
    const live = agentControlAvailable()
    // Handoff is a real ownership transition, even when automatic message sending is disabled.
    if (route === 'ADMIN' && !live) {
      const started = await db.rpc('start_inbox_handover', { p_customer: m.customer.id })
      if (started.error) throw started.error
      const released = await db.rpc('end_inbox_delivery', {
        p_customer: m.customer.id,
        p_lease: started.data,
      })
      if (released.error) throw released.error
      await save({ status: 'review', reason: reason ?? 'WAITING_ADMIN' })
      return true
    }
    if (!live) {
      await save({ status: 'draft', reason: reason ?? 'LIVE_SEND_DISABLED' })
      return true
    }
    const allowed = await db.rpc('begin_agent_dispatch', {
      p_job: job.id,
      p_claim: job.claim_token,
    })
    if (allowed.error || allowed.data !== true) {
      await save({ status: 'skipped', reason: 'CONVERSATION_CHANGED' })
      return true
    }
    const once = `reply:${m.messageId}`
    if (route === 'ADMIN') {
      await handover(db, m, settings, once)
      await save({ status: 'review', reason: reason ?? 'WAITING_ADMIN' })
      return true
    }
    let sent: boolean | undefined = false
    if (route === 'KEYWORD' && rule) {
      sent = await sendRule(db, m.recipient, once, rule)
      if (sent) await db.rpc('bump_chat_rule', { p_rule: rule.id })
    } else if (text)
      sent = await (product.current?.image_url
        ? (await import('@/lib/features/agents/product-reply')).deliverProductReply(
            db,
            m.recipient,
            once,
            text,
            product.current.image_url,
          )
        : deliverOnce(db, m.recipient, once, text))
    await save({
      status: sent ? 'sent' : text || rule ? 'review' : 'skipped',
      reason: sent ? reason : 'NO_NEW_DELIVERY',
    })
  } catch (error) {
    console.error('[agent-control] message requires review', {
      jobId: job.id,
      code: (error as { code?: string })?.code ?? 'PROCESSING_OR_DELIVERY_FAILED',
    })
    await save({ status: 'review', reason: 'PROCESSING_OR_DELIVERY_FAILED' })
  }
  return true
}
