import { NextRequest, NextResponse } from 'next/server'
import { agentControlTenant } from '@/lib/features/agents/agent-control-server'
import { inboxError, InboxError } from '@/lib/features/inbox/inbox-server'
import {
  CHAT_RULE_COLUMNS,
  matchChatRule,
  ruleOrder,
  type ChatRule,
  wantsHuman,
} from '@/lib/features/agents/chatbot'
import {
  inputRisk,
  groundedAgentReply,
  knowledgeRequiresHuman,
  shopRulesKnowledge,
  containsSecret,
  type AgentProduct,
} from '@/lib/features/agents/agent-control-core'
import {
  shopRulesPrompt,
  STORE_RULES_MAX_LENGTH,
} from '@/lib/features/store-rules/shop-persona-settings'
import { parseStoreRules } from '@/lib/features/store-rules/store-rule-items'
import { loadBotSettings } from '@/lib/features/agents/chatbot-server'
/** Deterministic dry-run only. This module deliberately imports no AI provider or Sender. */
export async function POST(req: NextRequest) {
  try {
    const { db, tenantId, config } = await agentControlTenant(
      req,
      req.nextUrl.searchParams.get('tenantId') ?? '',
    )
    if (!config.flags.agent_playground_enabled)
      throw new InboxError('ยังไม่เปิด Playground', 403, 'FEATURE_DISABLED')
    const input = await req.json().catch(() => null)
    if (typeof input?.text !== 'string' || !input.text.trim() || input.text.length > 2000)
      throw new InboxError('ข้อความทดสอบต้องมี 1–2,000 ตัวอักษร')
    const settings = await loadBotSettings(db, tenantId)
    const rules =
      settings?.reply_mode === 'keyword'
        ? await db
            .from('chat_rules')
            .select(CHAT_RULE_COLUMNS)
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .order('priority', { ascending: false })
            .order('created_at')
            .order('id')
            .limit(20)
        : { data: [], error: null }
    if (rules.error) throw rules.error
    const rule = matchChatRule(((rules.data ?? []) as ChatRule[]).sort(ruleOrder), input.text)
    const risk = inputRisk(input.text)
    const human = risk || wantsHuman(settings?.handover_keywords ?? [], input.text)
    if (human)
      return NextResponse.json({
        mode: 'simulation',
        route: 'ADMIN',
        matchedKeyword: null,
        proposedText: 'แนะนำส่งต่อแอดมิน',
        reason: risk ?? 'CUSTOMER_REQUESTED_HUMAN',
        sourceIds: [],
        guardrails: 'REQUIRE_HUMAN_REVIEW',
        estimatedAiCredits: 0,
        chargedAiCredits: 0,
        providerCalled: false,
      })
    if (rule)
      return NextResponse.json({
        mode: 'simulation',
        route: 'KEYWORD',
        matchedKeyword: rule.name,
        proposedText: rule.reply_text,
        reason: 'HIGHEST_PRIORITY_MATCH',
        sourceIds: [rule.id],
        chargedAiCredits: 0,
        providerCalled: false,
      })
    if (settings?.reply_mode === 'keyword')
      return NextResponse.json({
        mode: 'simulation',
        route: 'SKIP',
        proposedText: null,
        reason: 'NO_KEYWORD_MATCH',
        chargedAiCredits: 0,
        providerCalled: false,
      })
    const catalog = await db
      .from('products')
      .select('code,name,price,stock,description')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('code')
      .limit(100)
    if (catalog.error) throw catalog.error
    const state = parseStoreRules(settings?.ai_instructions)
    if (!state.ok)
      return NextResponse.json(
        {
          error: 'ข้อมูลกฎของร้านมีปัญหา กรุณาตรวจสอบก่อนทดลองตอบ',
          code: 'STORE_RULES_INVALID',
          issues: state.issues,
        },
        { status: 422 },
      )
    const instructions = shopRulesPrompt(state.raw)
    if (instructions.length > STORE_RULES_MAX_LENGTH || containsSecret(instructions))
      throw new InboxError('กรุณาตรวจสอบกฎของร้านก่อนทดลอง')
    const sources = shopRulesKnowledge(instructions),
      products = (catalog.data ?? []) as AgentProduct[]
    if (knowledgeRequiresHuman(input.text, sources))
      return NextResponse.json({
        mode: 'simulation',
        route: 'ADMIN',
        matchedKeyword: null,
        proposedText: 'หัวข้อนี้ต้องส่งต่อแอดมิน',
        reason: 'KNOWLEDGE_POLICY_HANDOFF',
        sourceIds: [],
        guardrails: 'REQUIRE_HUMAN_REVIEW',
        estimatedAiCredits: 0,
        chargedAiCredits: 0,
        providerCalled: false,
      })
    const normalized = input.text.toLocaleLowerCase('th-TH')
    const product = products.find(
      (p) => normalized.includes(p.code.toLowerCase()) || normalized.includes(p.name.toLowerCase()),
    )
    const source = sources.find(
      (k) =>
        !['forbidden', 'handoff'].includes(k.kind) &&
        ['ค่าส่ง', 'ค่าจัดส่ง', 'ตัดรอบ', 'รอบส่ง', 'เวลาเปิด', 'นโยบาย'].some(
          (term) => normalized.includes(term) && k.content.includes(term),
        ),
    )
    const controlled = groundedAgentReply(
      JSON.stringify({
        decision: product || source ? 'ANSWER' : 'CLARIFY',
        knowledgeIds: source ? [source.id] : [],
        productCodes: product ? [product.code] : [],
      }),
      sources,
      products,
    )
    return NextResponse.json({
      mode: 'simulation',
      route: controlled.handoff ? 'ADMIN' : 'AI',
      matchedKeyword: null,
      proposedText: controlled.text,
      reason: controlled.reason,
      sourceIds: controlled.sourceIds,
      guardrails: controlled.handoff ? 'REQUIRE_HUMAN_REVIEW' : 'DATABASE_FACTS_ONLY',
      estimatedAiCredits: 1,
      chargedAiCredits: 0,
      providerCalled: false,
    })
  } catch (error) {
    return inboxError(error)
  }
}
