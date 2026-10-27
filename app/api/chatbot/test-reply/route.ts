import { NextRequest, NextResponse } from 'next/server'
import { canAccessTenant, getActor } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import {
  AiAgentError,
  aiConfigured,
  aiModel,
  aiReply,
  HANDOVER_TOKEN,
  type AiProductResult,
} from '@/lib/features/agents/ai-agent'
import {
  CHAT_RULE_COLUMNS,
  matchChatRule,
  ruleOrder,
  type ChatRule,
  wantsHuman,
} from '@/lib/features/agents/chatbot'
import { UUID } from '@/lib/utils'
import { randomHandover, MAX_FALLBACK_MESSAGES } from '@/lib/features/agents/fallback-messages'
import { parseStoreRules } from '@/lib/features/store-rules/store-rule-items'

export const runtime = 'nodejs'
export const maxDuration = 60
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })
const boundedText = (value: unknown, max: number) =>
  value === null || value === undefined || (typeof value === 'string' && value.length <= max)
/** Simulator history/settings never touch customer chats; AI generations consume tenant quota. */
export async function POST(req: NextRequest) {
  const actor = await getActor(req)
  if (!actor) return bad('กรุณาเข้าสู่ระบบ', 401)
  const raw = await req.text()
  if (raw.length > 64_000) return bad('ข้อความทดสอบยาวเกินไป', 413)
  let body
  try {
    body = JSON.parse(raw)
  } catch {
    return bad('ข้อมูลทดสอบไม่ถูกต้อง')
  }
  const { tenantId, settings, messages, mode = 'chat' } = body ?? {}
  if (typeof tenantId !== 'string' || !UUID.test(tenantId)) return bad('เพจไม่ถูกต้อง')
  if (!(await canAccessTenant(actor, tenantId))) return bad('ไม่พบเพจหรือไม่มีสิทธิ์เข้าถึง', 404)
  if (
    !settings ||
    !['keyword', 'ai'].includes(settings.reply_mode) ||
    !boundedText(settings.ai_instructions, 50000) ||
    !boundedText(settings.fallback_text, 2000) ||
    (settings.fallback_messages !== undefined &&
      (!Array.isArray(settings.fallback_messages) ||
        settings.fallback_messages.length > MAX_FALLBACK_MESSAGES ||
        !settings.fallback_messages.every(
          (text: unknown) => typeof text === 'string' && text.length <= 2000,
        ))) ||
    !boundedText(settings.handover_text, 2000) ||
    !Array.isArray(settings.handover_keywords) ||
    (settings.handover_messages !== undefined &&
      (!Array.isArray(settings.handover_messages) ||
        settings.handover_messages.length > MAX_FALLBACK_MESSAGES ||
        !settings.handover_messages.every(
          (text: unknown) => typeof text === 'string' && text.length <= 2000,
        ))) ||
    settings.handover_keywords.length > 50 ||
    !settings.handover_keywords.every((k: unknown) => typeof k === 'string' && k.length <= 100) ||
    !['chat', 'rules'].includes(mode) ||
    !Array.isArray(messages) ||
    messages.length < 1 ||
    messages.length > 12 ||
    !messages.every(
      (m: { role?: unknown; text?: unknown } | null) =>
        m &&
        ['user', 'model'].includes(String(m.role)) &&
        typeof m.text === 'string' &&
        m.text.trim() &&
        m.text.length <= 2000,
    ) ||
    messages.at(-1).role !== 'user'
  )
    return bad('การตั้งค่าหรือประวัติแชทไม่ถูกต้อง')
  const storeRules = parseStoreRules(settings.ai_instructions)
  if (!storeRules.ok)
    return NextResponse.json(
      {
        error: storeRules.issues[0].message,
        code: 'STORE_RULES_INVALID',
        issues: storeRules.issues,
      },
      { status: 400 },
    )
  const startedAt = Date.now()
  const product = { current: null as AiProductResult | null }
  const respond = (
    text: string | null,
    handover = false,
    imageUrl: string | null = null,
    quickReplies: string[] = [],
    details: {
      route: 'keyword' | 'ai' | 'handover' | 'none'
      matchedRule?: string | null
      model?: string | null
      providerCalled?: boolean
    } = { route: 'none' },
  ) =>
    NextResponse.json(
      {
        text,
        handover,
        imageUrl,
        image_url: imageUrl,
        has_product: details.route === 'ai' && product.current?.has_product === true,
        product_id: details.route === 'ai' ? (product.current?.product_id ?? null) : null,
        quickReplies,
        ...details,
        elapsedMs: Date.now() - startedAt,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  const text = messages.at(-1).text
  const db = supabaseAdmin()
  try {
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
    if (rules.error) return bad('Keyword rules unavailable', 503)
    const rule = matchChatRule(((rules.data ?? []) as ChatRule[]).sort(ruleOrder), text)
    if (rule)
      return respond(
        rule.reply_text,
        false,
        rule.reply_type === 'image' ? rule.image_url : null,
        rule.quick_replies,
        { route: 'keyword', matchedRule: rule.name, providerCalled: false },
      )
    if (wantsHuman(settings.handover_keywords, text))
      return respond(randomHandover(settings), true, null, [], {
        route: 'handover',
        providerCalled: false,
      })
    if (!aiConfigured()) return bad('ระบบ AI ยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบ', 503)
    const { data: tenant, error: tenantError } = await db
      .from('tenants')
      .select('name')
      .eq('id', tenantId)
      .single()
    if (tenantError || !tenant) return bad('อ่านข้อมูลร้านไม่ได้ กรุณาลองใหม่ภายหลัง', 503)

    const reply = await aiReply(
      db,
      {
        tenantId,
        shopName: tenant.name,
        instructions: settings.ai_instructions ?? null,
        simulation: true,
        customerName: 'ลูกค้าทดสอบ',
        customerId: '',
        onProductResult: (value) => {
          product.current = value
        },
      },
      messages,
      true,
      false,
      true,
    )
    if (reply === HANDOVER_TOKEN)
      return respond(randomHandover(settings), true, null, [], {
        route: 'handover',
        providerCalled: true,
        model: aiModel(),
      })
    if (!reply) return bad('AI ไม่สามารถตอบข้อความนี้ได้ กรุณาตรวจสอบการตั้งค่าแล้วลองใหม่', 503)
    return respond(reply, false, product.current?.image_url ?? null, [], {
      route: 'ai',
      providerCalled: true,
      model: aiModel(),
    })
  } catch (error) {
    if (error instanceof AiAgentError) {
      console.error('[chatbot/test-reply]', {
        code: error.code,
        status: error.status,
        message: error.message,
      })
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    console.error('[chatbot/test-reply] failed', {
      name: error instanceof Error ? error.name : 'UnknownError',
    })
    return bad('ทดสอบบอทไม่สำเร็จ กรุณาลองอีกครั้ง', 503)
  }
}
