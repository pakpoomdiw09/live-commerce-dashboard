import { NextRequest, NextResponse } from 'next/server'
import { agentControlTenant } from '@/lib/features/agents/agent-control-server'
import { inboxError, InboxError } from '@/lib/features/inbox/inbox-server'
import { loadBotSettings } from '@/lib/features/agents/chatbot-server'
import {
  CHAT_RULE_COLUMNS,
  matchChatRule,
  ruleOrder,
  type ChatRule,
  wantsHuman,
} from '@/lib/features/agents/chatbot'
import { inputRisk } from '@/lib/features/agents/agent-control-core'
import {
  aiReply,
  HANDOVER_TOKEN,
  AiAgentError,
  type AiProductResult,
} from '@/lib/features/agents/ai-agent'

// Isolated trial: no customer, sender, delivery or conversation mutation is used here.
export async function POST(req: NextRequest) {
  try {
    if (req.headers.get('origin') !== req.nextUrl.origin)
      throw new InboxError('แหล่งที่มาของคำขอไม่ถูกต้อง', 403)
    const { db, tenantId, config } = await agentControlTenant(
      req,
      req.nextUrl.searchParams.get('tenantId') ?? '',
    )
    if (!config.flags.agent_playground_enabled)
      throw new InboxError('ยังไม่เปิดพื้นที่ทดลองสำหรับร้านนี้', 403)
    const input = await req.json().catch(() => null)
    if (
      !Array.isArray(input?.messages) ||
      !input.messages.length ||
      input.messages.length > 12 ||
      input.messages.some(
        (m: { role?: unknown; text?: unknown } | null) =>
          !m ||
          !['user', 'model'].includes(String(m.role)) ||
          typeof m.text !== 'string' ||
          !m.text.trim() ||
          m.text.length > 2000,
      )
    )
      throw new InboxError('ข้อความทดลองไม่ถูกต้อง')
    const messages = input.messages as { role: 'user' | 'model'; text: string }[],
      latest = messages.at(-1)!
    if (latest.role !== 'user') throw new InboxError('กรุณาพิมพ์ข้อความทดลอง')
    const [settings, tenant] = await Promise.all([
      loadBotSettings(db, tenantId),
      db.from('tenants').select('name').eq('id', tenantId).maybeSingle(),
    ])
    if (tenant.error || !tenant.data) throw new InboxError('โหลดข้อมูลร้านสำหรับทดสอบไม่ได้', 503)
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
    const rule = matchChatRule(((rules.data ?? []) as ChatRule[]).sort(ruleOrder), latest.text)
    if (rule) return NextResponse.json({ text: rule.reply_text, charged: false, route: 'keyword' })
    if (
      inputRisk(latest.text) ||
      (config.capabilities?.handoff !== false &&
        wantsHuman(settings?.handover_keywords ?? [], latest.text))
    )
      return NextResponse.json({
        text: 'ข้อความนี้จะถูกส่งต่อให้แอดมินดูแลเมื่อใช้งานจริง',
        charged: false,
        route: 'handoff',
      })
    if (settings?.reply_mode === 'keyword')
      return NextResponse.json({ text: null, charged: false, route: 'none' })
    const product = { current: null as AiProductResult | null }
    const text = await aiReply(
      db,
      {
        tenantId,
        shopName: tenant.data.name,
        instructions: settings?.ai_instructions ?? null,
        customerId: '',
        onProductResult: (value) => {
          product.current = value
        },
        customerName: 'ลูกค้าทดลอง',
      },
      messages,
      true,
      true,
    )
    return NextResponse.json({
      text:
        text === HANDOVER_TOKEN
          ? 'ผู้ช่วยแนะนำให้แอดมินตรวจสอบและดูแลข้อความนี้'
          : text || 'ยังไม่มีคำตอบสำหรับข้อความนี้',
      image_url: product.current?.image_url ?? null,
      imageUrl: product.current?.image_url ?? null,
      has_product: product.current?.has_product ?? false,
      product_id: product.current?.product_id ?? null,
      charged: true,
      route: text === HANDOVER_TOKEN ? 'handoff' : 'ai',
    })
  } catch (error) {
    if (error instanceof AiAgentError)
      return NextResponse.json(
        {
          error:
            error.code === 'STORE_RULES_INVALID'
              ? error.message
              : 'ยังทดสอบ AI ไม่สำเร็จ กรุณาตรวจสอบสถานะการทำงานและโควตาของร้าน',
          code: error.code,
        },
        { status: error.status },
      )
    return inboxError(error)
  }
}
