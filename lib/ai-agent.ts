import { hasFeature } from '@/lib/feature-access'
import 'server-only'
import { ApiError, GoogleGenAI, type Content } from '@google/genai'
import type { SupabaseClient } from '@supabase/supabase-js'

/** The model writes this alone when the customer should be passed to a person. */
export const HANDOVER_TOKEN = '[HANDOVER]'

const DEFAULT_MODEL = 'gemini-2.5-flash'
export const aiModel = () => (process.env.GEMINI_MODEL ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').replace(/^models\//, '').trim() || DEFAULT_MODEL

export class AiAgentError extends Error {
  constructor(public code: string, message: string, public status = 503) {
    super(message)
    this.name = 'AiAgentError'
  }
}
const HISTORY = 12 // recent messages of this chat sent as context

export const aiConfigured = () => !!process.env.GEMINI_API_KEY?.trim()

let client: GoogleGenAI | null = null
let clientApiKey: string | null = null
// a chat reply that takes longer than this is worse than the fallback text
function gemini(apiKey: string) {
  if (!client || clientApiKey !== apiKey) {
    client = new GoogleGenAI({
      apiKey,
      vertexai: false,
      httpOptions: { timeout: 25_000, retryOptions: { attempts: 1 } },
    })
    clientApiKey = apiKey
  }
  return client
}

export type AiContext = {
  agentJob?: { id: string; claim: string }
  shopName: string
  instructions: string | null
  customerName: string | null
  customerId: string
  tenantId: string
}

/**
 * The AI Agent's reply to the latest customer message, HANDOVER_TOKEN, or null when it can't answer
 * (no API key, refusal, error). Never throws: the caller falls back to its own text.
 */
export async function aiReply(db: SupabaseClient, ctx: AiContext, testMessages?: { role: 'user' | 'model'; text: string }[], reportErrors = false): Promise<string | null> {
  if (!(await hasFeature(db, ctx.tenantId, 'ai_agent'))) return null
  if (process.env.AGENT_CONTROL_KILL_SWITCH === 'true') {
    if (reportErrors) throw new AiAgentError('AI_EMERGENCY_STOP', 'ระบบ AI ถูกพักฉุกเฉิน กรุณาติดต่อผู้ดูแล', 503)
    return null
  }
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  let model = aiModel()
  let control: import('./agent-control-ai').AgentGeneration | null = null
  if (!apiKey) {
    console.warn('[ai] GEMINI_API_KEY is not set: AI Agent mode cannot answer')
    if (reportErrors) throw new AiAgentError('MISSING_API_KEY', 'ยังไม่ได้ตั้งค่า GEMINI_API_KEY ในเซิร์ฟเวอร์ กรุณาตั้งค่าและรีสตาร์ตแอป')
    return null
  }
  try {
    if (process.env.SNAPBOT_SAFETY_ENABLED === 'true') await (await import('./automation-safety')).assertAutomationRunning(db, ctx.tenantId)
    const [messages, catalog] = await Promise.all([
      testMessages ? Promise.resolve(testMessages.slice(-HISTORY).map(m => ({ role: m.role, parts: [{ text: m.text }] }))) : history(db, ctx.customerId),
      productCatalog(db, ctx.tenantId),
    ])
    if (!messages.length) throw new AiAgentError('EMPTY_HISTORY', 'ไม่มีข้อความให้ AI ตอบ กรุณาพิมพ์ข้อความใหม่', 400)
    if (process.env.AGENT_CONTROL_ENABLED === 'true') {
      const managed = await import('./agent-control-ai')
      const latest = messages.at(-1)?.parts?.map(p => p.text ?? '').join(' ') ?? ''
      control = await managed.prepareAgentGeneration(db, ctx, latest)
      if (control) for (const turn of messages) turn.parts = (turn.parts ?? []).map(p => ({ text: managed.sanitizeAgentHistory(p.text ?? '') }))
    }

    const generate = async (selectedModel: string) => {
      if (process.env.SNAPBOT_SAFETY_ENABLED === 'true') await (await import('./automation-safety')).assertAutomationRunning(db, ctx.tenantId)
      return gemini(apiKey).models.generateContent({
      model: selectedModel,
      contents: messages,
      config: {
        systemInstruction: control?.systemInstruction ?? `${SYSTEM_PROMPT}\n\n${shopContext(ctx, catalog)}`,
        ...(control ? { responseMimeType: 'application/json' } : {}),
        maxOutputTokens: 2000,
        // Gemini 2.5 Flash supports disabling thinking for short, quick chat replies.
        ...(selectedModel.startsWith('gemini-2.5-flash') ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
      })
    }
    let response
    try {
      response = await generate(model)
    } catch (error) {
      if (control) throw error // managed invocations never silently retry/switch the configured model
      // 404: model retired/unknown -> switch to the default. 500/503: Gemini overloaded -> retry once
      // (on the default model when a custom one is configured).
      const status = error instanceof ApiError ? error.status : undefined
      const transient = status === 500 || status === 503
      if (!(status === 404 && model !== DEFAULT_MODEL) && !transient) throw error
      console.warn('[ai] Gemini request failed; retrying once', { model, fallbackModel: DEFAULT_MODEL, status })
      if (transient) await new Promise(r => setTimeout(r, 1000))
      model = DEFAULT_MODEL
      response = await generate(model)
    }
    const blockReason = response.promptFeedback?.blockReason
    if (blockReason && blockReason !== 'BLOCKED_REASON_UNSPECIFIED') {
      console.error('[ai] prompt blocked', { model, blockReason })
      throw new AiAgentError('SAFETY_BLOCK', 'Gemini ไม่สามารถตอบข้อความนี้ได้ตามข้อจำกัดความปลอดภัย กรุณาปรับข้อความแล้วลองใหม่', 422)
    }
    const finishReason = response.candidates?.[0]?.finishReason
    if (finishReason && finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS') {
      console.error('[ai] generation stopped', { model, finishReason })
      throw new AiAgentError('GENERATION_BLOCKED', 'Gemini หยุดสร้างคำตอบ กรุณาปรับข้อความแล้วลองใหม่', 422)
    }
    const text = response.text?.trim()
    if (process.env.SNAPBOT_SAFETY_ENABLED === 'true') await (await import('./automation-safety')).assertAutomationRunning(db, ctx.tenantId)
    if (!text) throw new AiAgentError('EMPTY_RESPONSE', 'Gemini ส่งคำตอบว่างกลับมา กรุณาลองใหม่หรือเปลี่ยนโมเดล')
    if (control) return await (await import('./agent-control-ai')).finishAgentGeneration(db, control, text, response.usageMetadata)
    return text.includes(HANDOVER_TOKEN) ? HANDOVER_TOKEN : text.slice(0, 2000)
  } catch (e) {
    if (control) await (await import('./agent-control-ai')).failAgentGeneration(db, control)
    // Log diagnostic details with credentials redacted; never print request bodies.
    const status = e instanceof ApiError ? e.status : undefined
    const detail = (e instanceof Error ? e.message : String(e)).split(apiKey).join('[REDACTED]')
      .replace(/AIza[A-Za-z0-9_-]+/g, '[REDACTED]').slice(0, 2000)
    console.error('[ai] Gemini reply failed', { model, status, name: e instanceof Error ? e.name : 'UnknownError', message: detail })
    let failure = e instanceof AiAgentError ? e : new AiAgentError('PROVIDER_ERROR', 'เชื่อมต่อ Gemini ไม่สำเร็จ กรุณาลองใหม่ภายหลัง')
    if (status === 429) failure = new AiAgentError('RATE_LIMIT', 'Gemini จำกัดจำนวนคำขอหรือโควตาหมด กรุณารอสักครู่และตรวจโควตาใน Google AI Studio', 429)
    else if (status === 401 || status === 403) failure = new AiAgentError('INVALID_API_KEY', 'GEMINI_API_KEY ไม่ถูกต้องหรือไม่มีสิทธิ์ใช้งาน กรุณาตรวจ key และโปรเจกต์ที่ออก key')
    else if (status === 404) failure = new AiAgentError('MODEL_NOT_FOUND', 'ไม่พบโมเดล Gemini ที่กำหนดหรือโมเดลปิดบริการแล้ว กรุณาตรวจ GEMINI_MODEL')
    else if (status === 500 || status === 503) failure = new AiAgentError('MODEL_OVERLOADED', `โมเดล Gemini (${model}) ไม่พร้อมให้บริการชั่วคราว (${status}) กรุณาลองใหม่อีกครั้งในอีกสักครู่`, 503)
    else if (status === 400) failure = new AiAgentError('INVALID_PROVIDER_REQUEST', 'Gemini ไม่รองรับรูปแบบคำขอหรือการตั้งค่าโมเดลนี้ กรุณาตรวจรายละเอียดใน Terminal')
    else if (/timeout|timed out|abort/i.test(detail)) failure = new AiAgentError('TIMEOUT', 'Gemini ใช้เวลาตอบนานเกินไป กรุณาลองใหม่', 504)
    if (reportErrors) throw failure
    return null
  }
}

const SYSTEM_PROMPT = `You are the chat assistant of a Thai online shop, answering customers in Facebook Messenger on the shop's behalf.

How to answer:
- Reply in the customer's language (usually Thai), politely, in the shop's voice (Thai shops typically end sentences with ค่ะ/นะคะ). Keep it to 1-4 short sentences: this is a chat, not an email. Plain text only, no Markdown.
- Use only the facts in the shop information and product list below. If a price, stock level, shipping detail or policy is not there, say an admin will confirm rather than guessing.
- To order, the customer types the product code in this chat (for example "CF A12"); the system then sends the total and the bank account. Payment is by bank transfer: the customer sends the slip image in this chat and it is checked automatically.
- Never invent discounts, promises, bank accounts or order statuses.

Reply with exactly ${HANDOVER_TOKEN} and nothing else when the customer asks for a human/admin, is upset or complaining, wants a refund or cancellation, or asks something you cannot answer from the information given.`

function shopContext(ctx: AiContext, catalog: string) {
  return [
    `Shop: ${ctx.shopName}`,
    ctx.customerName ? `Customer's name: ${ctx.customerName}` : null,
    ctx.instructions?.trim() ? `Shop information and instructions from the owner:\n${ctx.instructions.trim()}` : null,
    catalog ? `Products (code | name | price THB | in stock):\n${catalog}` : 'No product list is available.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

async function productCatalog(db: SupabaseClient, tenantId: string) {
  const { data, error } = await db.from('products').select('code, name, price, stock, description').eq('tenant_id', tenantId).eq('is_active', true).order('code').limit(100)
  if (error) throw new AiAgentError('CATALOG_UNAVAILABLE', 'อ่านรายการสินค้าของเพจไม่ได้ กรุณาตรวจฐานข้อมูลและลองใหม่')
  return (data ?? [])
    .map((p) => `${p.code} | ${p.name} | ${Number(p.price)} | ${p.stock}${p.description ? ` | ${String(p.description).slice(0, 200)}` : ''}`)
    .join('\n')
}

/** Gemini history uses user/model roles and text parts, ending with the customer. */
async function history(db: SupabaseClient, customerId: string): Promise<Content[]> {
  const { data } = await db
    .from('messages')
    .select('sender, body, attachments')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(HISTORY)
  const turns: Content[] = []
  for (const m of (data ?? []).reverse()) {
    const role = m.sender === 'customer' ? 'user' : 'model'
    const text = m.body?.trim() || (Array.isArray(m.attachments) && m.attachments.length ? '[ส่งรูปภาพ/ไฟล์]' : '')
    if (!text) continue
    const last = turns[turns.length - 1]
    if (last?.role === role) last.parts = [{ text: `${last.parts?.[0]?.text ?? ''}\n${text}` }]
    else turns.push({ role, parts: [{ text }] })
  }
  while (turns[0]?.role === 'model') turns.shift()
  // the reply must answer the customer, so the history has to end on their turn
  while (turns.length && turns[turns.length - 1].role === 'model') turns.pop()
  return turns
}
