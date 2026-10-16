import { hasFeature, featureLockedResponse } from '@/lib/feature-access'
import { NextRequest, NextResponse } from 'next/server'
import { canAccessTenant, getActor } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import { AiAgentError, aiConfigured, aiReply, HANDOVER_TOKEN } from '@/lib/ai-agent'
import { CHAT_RULE_COLUMNS, matchChatRule, ruleOrder, wantsHuman, type ChatRule } from '@/lib/chatbot'
import { UUID } from '@/lib/utils'
import { randomFallback, randomHandover, MAX_FALLBACK_MESSAGES } from '@/lib/fallback-messages'

export const runtime = 'nodejs'
export const maxDuration = 60
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })
const boundedText = (value: unknown, max: number) => value === null || value === undefined || (typeof value === 'string' && value.length <= max)

/** Read-only simulator: draft settings and in-memory history never touch customer chats. */
export async function POST(req: NextRequest) {
  const actor = await getActor(req)
  if (!actor) return bad('กรุณาเข้าสู่ระบบ', 401)
  const raw = await req.text()
  if (raw.length > 64_000) return bad('ข้อความทดสอบยาวเกินไป', 413)
  let body
  try { body = JSON.parse(raw) } catch { return bad('ข้อมูลทดสอบไม่ถูกต้อง') }
  const { tenantId, settings, messages } = body ?? {}
  if (typeof tenantId !== 'string' || !UUID.test(tenantId)) return bad('เพจไม่ถูกต้อง')
  if (!(await canAccessTenant(actor, tenantId))) return bad('ไม่พบเพจหรือไม่มีสิทธิ์เข้าถึง', 404)
  if (!settings || !['keyword', 'ai'].includes(settings.reply_mode)
    || !boundedText(settings.ai_instructions, 8000) || !boundedText(settings.fallback_text, 2000)
    || (settings.fallback_messages !== undefined && (!Array.isArray(settings.fallback_messages)
      || settings.fallback_messages.length > MAX_FALLBACK_MESSAGES
      || !settings.fallback_messages.every((text: unknown) => typeof text === 'string' && text.length <= 2000)))
    || !boundedText(settings.handover_text, 2000) || !Array.isArray(settings.handover_keywords)
    || (settings.handover_messages !== undefined && (!Array.isArray(settings.handover_messages)
      || settings.handover_messages.length > MAX_FALLBACK_MESSAGES
      || !settings.handover_messages.every((text: unknown) => typeof text === 'string' && text.length <= 2000)))
    || settings.handover_keywords.length > 50 || !settings.handover_keywords.every((k: unknown) => typeof k === 'string' && k.length <= 100)
    || !Array.isArray(messages) || messages.length < 1 || messages.length > 12
    || !messages.every((m: { role?: unknown; text?: unknown } | null) => m && ['user', 'model'].includes(String(m.role)) && typeof m.text === 'string' && m.text.trim() && m.text.length <= 2000)
    || messages.at(-1).role !== 'user') return bad('การตั้งค่าหรือประวัติแชทไม่ถูกต้อง')
  const respond = (text: string | null, handover = false, imageUrl: string | null = null, quickReplies: string[] = []) =>
    NextResponse.json({ text, handover, imageUrl, quickReplies }, { headers: { 'Cache-Control': 'no-store' } })
  const text = messages.at(-1).text
  if (wantsHuman(settings.handover_keywords, text)) return respond(randomHandover(settings), true)
  const db = supabaseAdmin()
  try {
    if (settings.reply_mode === 'ai') {
      if (!(await hasFeature(db, tenantId, 'ai_agent'))) return featureLockedResponse('ai_agent')
      if (!aiConfigured()) return bad('ระบบ AI ยังไม่พร้อมใช้งาน กรุณาตั้งค่า GEMINI_API_KEY', 503)
      const { data: tenant, error } = await db.from('tenants').select('name').eq('id', tenantId).single()
      if (error || !tenant) return bad('อ่านข้อมูลเพจไม่ได้', 503)
      const reply = await aiReply(db, { tenantId, shopName: tenant.name, instructions: settings.ai_instructions ?? null,
        customerName: 'ลูกค้าทดสอบ', customerId: '', }, messages, true)
      if (reply === HANDOVER_TOKEN) return respond(randomHandover(settings), true)
      return respond(reply ?? randomFallback(settings))
    }
    const { data, error } = await db.from('chat_rules').select(CHAT_RULE_COLUMNS).eq('tenant_id', tenantId).eq('is_active', true)
    if (error) return bad('อ่านกฎคีย์เวิร์ดไม่ได้', 503)
    const rule = matchChatRule(((data ?? []) as ChatRule[]).sort(ruleOrder), text)
    return rule ? respond(rule.reply_text, false, rule.reply_type === 'image' ? rule.image_url : null, rule.quick_replies)
      : respond(randomFallback(settings))
  } catch (error) {
    if (error instanceof AiAgentError) {
      console.error('[chatbot/test-reply]', { code: error.code, status: error.status, message: error.message })
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: { 'Cache-Control': 'no-store' } })
    }
    console.error('[chatbot/test-reply] failed', { name: error instanceof Error ? error.name : 'UnknownError' })
    return bad('ทดสอบบอทไม่สำเร็จ กรุณาลองอีกครั้ง', 503)
  }
}
