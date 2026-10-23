export const AGENT_FLAG_KEYS = [
  'agent_control_center_enabled',
  'agent_orchestrator_enabled',
  'agent_knowledge_base_enabled',
  'agent_playground_enabled',
  'agent_analytics_enabled',
  'agent_advanced_guardrails_enabled',
] as const
export type AgentFlag = (typeof AGENT_FLAG_KEYS)[number]
export type AgentFlags = Record<AgentFlag, boolean>
export const AGENT_FLAGS = Object.fromEntries(AGENT_FLAG_KEYS.map((k) => [k, false])) as AgentFlags
export type ConversationOwner = 'AI_ACTIVE' | 'ADMIN_ACTIVE' | 'WAITING_ADMIN' | 'PAUSED'
// Compatibility adapter: existing routes/DB retain their old identifiers.
import { conversationState } from '@/lib/domain-state'
export function conversationOwner(
  customer: Parameters<typeof conversationState>[0],
): ConversationOwner {
  const legacy = {
    AI_ACTIVE: 'AI_ACTIVE',
    HUMAN_TAKEN_OVER: 'ADMIN_ACTIVE',
    PAUSED: 'PAUSED',
    WAITING_APPROVAL: 'WAITING_ADMIN',
  } as const
  return legacy[conversationState(customer)]
}
const ownerTransitions: Record<ConversationOwner, ConversationOwner[]> = {
  AI_ACTIVE: ['ADMIN_ACTIVE', 'WAITING_ADMIN', 'PAUSED'],
  ADMIN_ACTIVE: ['AI_ACTIVE', 'PAUSED'],
  WAITING_ADMIN: ['ADMIN_ACTIVE', 'AI_ACTIVE', 'PAUSED'],
  PAUSED: ['AI_ACTIVE', 'ADMIN_ACTIVE'],
}
export const canChangeOwner = (current: ConversationOwner, next: ConversationOwner) =>
  ownerTransitions[current]?.includes(next) ?? false
export function routeMessage(c: {
  eventDuplicate: boolean
  customerOptedOut: boolean
  adminActive: boolean
  keywordMatched: boolean
  aiEnabled: boolean
  subscriptionAllowsAI: boolean
  aiCreditsAvailable: boolean
}) {
  if (c.eventDuplicate || c.customerOptedOut) return 'SKIP'
  if (c.adminActive) return 'ADMIN'
  if (c.keywordMatched) return 'KEYWORD'
  return c.aiEnabled && c.subscriptionAllowsAI && c.aiCreditsAvailable ? 'AI' : 'FALLBACK'
}
export type AgentKnowledge = {
  id: string
  kind: 'shop' | 'shipping' | 'warranty' | 'returns' | 'faq' | 'forbidden' | 'handoff'
  title: string
  content: string
  is_active: boolean
}
export type AgentProduct = {
  id?: string
  code: string
  name: string
  price: number
  stock: number
  description?: string | null
  image_url?: string | null
  commerce_images?: string[] | null
}
export const IMAGE_PRODUCT_NOT_FOUND = 'สนใจสินค้าตัวไหน สอบถามเพิ่มเติมได้เลยนะคะ'
export type ShopPersona = { opening: string; closing: string }
/** Only owner-authored conversational wording; business claims still require grounded records. */
export function shopPersona(instructions: string): ShopPersona {
  const read = (labels: string) => {
    const match = instructions.match(
      new RegExp(`^\\s*(?:[-*•]\\s+)?(?:${labels})\\s*[:：]\\s*(.+)$`, 'imu'),
    )
    const value = (match?.[1] ?? '')
      .trim()
      .replace(/^["'“”‘’]|["'“”‘’]$/gu, '')
      .trim()
    if (
      !value ||
      value === '...' ||
      value.length > 120 ||
      containsSecret(value) ||
      inputRisk(value) ||
      /\d|[\u202a-\u202e\u2066-\u2069]|ค่าส่ง|ฟรี|คืนเงิน|โอน|ชำระ|จัดส่ง|รับประกัน|ส่วนลด|payment|shipped|refund|discount|bank/iu.test(
        value,
      )
    )
      return ''
    return value
  }
  return { opening: read('คำขึ้นต้น|คำทักทาย'), closing: read('คำลงท้าย|คำปิดท้าย') }
}
function personaReply(text: string, persona?: ShopPersona) {
  return [
    persona?.opening && !text.startsWith(persona.opening) ? persona.opening : '',
    text,
    persona?.closing && !text.endsWith(persona.closing) ? persona.closing : '',
  ]
    .filter(Boolean)
    .join('\n')
}
/** Owner-saved rules become selectable facts, without permitting model-written claims. */
export function shopRulesKnowledge(instructions: string): AgentKnowledge[] {
  const lines = instructions
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+)/u, '').trim())
    .filter(
      (line) =>
        !!line &&
        !/^(?:บุคลิก|น้ำเสียง|โทนเสียง|คำขึ้นต้น|คำทักทาย|คำลงท้าย|คำปิดท้าย|รูปแบบการตอบ|ตอบด้วยน้ำเสียง)/u.test(
          line,
        ),
    )
  return lines
    .flatMap((line) => line.match(/[\s\S]{1,1800}/gu) ?? [])
    .map((content, index) => ({
      id: `shop-rule:${index + 1}`,
      kind: 'shop',
      title: `กติกาและนิสัยของร้าน ข้อ ${index + 1}`,
      content,
      is_active: true,
    }))
}
export function inputRisk(text: string) {
  if (
    /ignore.{0,30}(previous|system|instruction)|reveal.{0,30}(prompt|key|token)|system\s*prompt|api[_ -]?key|access[_ -]?token|แสดง.{0,20}(คีย์|โทเค็น|พรอมป์ต์ระบบ)|ลืมคำสั่ง|ข้าม.{0,15}(กฎ|คำสั่ง)/iu.test(
      text,
    )
  )
    return 'PROMPT_INJECTION'
  if (
    /ยืนยัน.{0,15}(สลิป|ชำระเงิน)|เปลี่ยนสถานะ.{0,15}(ออเดอร์|ชำระ)|mark.{0,10}(paid|payment)|create.{0,10}order/iu.test(
      text,
    )
  )
    return 'PROTECTED_ACTION'
  return null
}
export function containsSecret(text: string) {
  return /AIza[\w-]{20,}|\bEAA[\w]{30,}|\beyJ[\w-]+\.[\w-]+\.[\w-]+|(?:api[_ -]?key|access[_ -]?token|service[_ -]?role)\s*[:=]\s*\S{8,}/iu.test(
    text,
  )
}
export function knowledgeRequiresHuman(text: string, sources: AgentKnowledge[]) {
  const normalized = text.toLocaleLowerCase('th-TH')
  return sources.some(
    (k) =>
      k.is_active &&
      ['forbidden', 'handoff'].includes(k.kind) &&
      [k.title, ...k.content.split(/[,\n;|]/)].some(
        (word) =>
          word.trim().length >= 2 &&
          word.trim().length <= 100 &&
          normalized.includes(word.trim().toLocaleLowerCase('th-TH')),
      ),
  )
}
export function redactAgentText(text: string) {
  return text
    .replace(/AIza[\w-]+|\bEAA[\w]{30,}|\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[อีเมล]')
    .replace(/(?<!\d)(?:\+66|0)\d[\d -]{7,14}\d(?!\d)/g, '[ข้อมูลติดต่อ]')
}
export function knowledgeError(value: unknown): string | null {
  const k = value as Partial<AgentKnowledge> | null
  if (
    !k ||
    !['shop', 'shipping', 'warranty', 'returns', 'faq', 'forbidden', 'handoff'].includes(
      k.kind ?? '',
    ) ||
    typeof k.title !== 'string' ||
    !k.title.trim() ||
    k.title.length > 100 ||
    typeof k.content !== 'string' ||
    !k.content.trim() ||
    k.content.length > 2000 ||
    typeof k.is_active !== 'boolean'
  )
    return 'ข้อมูลฐานความรู้ไม่ถูกต้อง (เนื้อหาไม่เกิน 2,000 ตัวอักษร)'
  return containsSecret(k.content) ? 'ห้ามบันทึก API Key หรือ Token ในฐานความรู้' : null
}
/** The model selects facts; the server renders only DB text/prices/stock. No model-generated financial claims. */
export function groundedAgentReply(
  raw: string,
  knowledge: AgentKnowledge[],
  products: AgentProduct[],
  persona?: ShopPersona,
  imageMatch = false,
): { text: string; handoff: boolean; sourceIds: string[]; reason: string } {
  const value = JSON.parse(raw) as {
    decision?: string
    knowledgeIds?: unknown
    productCodes?: unknown
  }
  const review = (reason: string) => ({ text: '[HANDOVER]', handoff: true, sourceIds: [], reason })
  if (!value || value.decision === 'HANDOFF') return review('MODEL_HANDOFF')
  if (imageMatch && value.decision === 'CLARIFY')
    return {
      text: IMAGE_PRODUCT_NOT_FOUND,
      handoff: false,
      sourceIds: [],
      reason: 'IMAGE_NO_MATCH',
    }
  if (value.decision === 'CLARIFY')
    return {
      text: personaReply(
        persona?.opening || persona?.closing
          ? 'รบกวนระบุสินค้าหรือรายละเอียดที่ต้องการเพิ่มเติม'
          : 'รบกวนระบุสินค้าหรือรายละเอียดที่ต้องการเพิ่มเติมได้ไหมคะ',
        persona,
      ),
      handoff: false,
      sourceIds: [],
      reason: 'REQUEST_INFORMATION',
    }
  if (
    value.decision !== 'ANSWER' ||
    !Array.isArray(value.knowledgeIds) ||
    !Array.isArray(value.productCodes) ||
    value.knowledgeIds.length > 3 ||
    value.productCodes.length > 3
  )
    return review('INVALID_MODEL_OUTPUT')
  const knowledgeIds = value.knowledgeIds,
    productCodes = value.productCodes
  const sources = knowledge.filter((k) => k.is_active && knowledgeIds.includes(k.id))
  const catalog = products.filter((p) => productCodes.includes(p.code))
  if (
    sources.length !== new Set(value.knowledgeIds).size ||
    catalog.length !== new Set(value.productCodes).size ||
    sources.some((k) => ['forbidden', 'handoff'].includes(k.kind))
  )
    return review('UNVERIFIED_SOURCE')
  const parts = [
    ...sources.map((k) => k.content),
    ...catalog.map(
      (p) =>
        `${p.name} (${p.code}) ราคา ${Number(p.price).toFixed(2)} บาท · ${p.stock > 0 ? `คงเหลือ ${p.stock} ชิ้น` : 'สินค้าหมด'}`,
    ),
  ]
  if (!parts.length) return review('INSUFFICIENT_KNOWLEDGE')
  if (imageMatch)
    for (const product of catalog) {
      if (product.description?.trim()) parts.push(product.description.trim())
    }
  const text = personaReply(parts.join('\n\n'), persona)
  if (
    text.length > 2000 ||
    containsSecret(text) ||
    inputRisk(text) ||
    /ได้รับ.{0,10}(ยอดโอน|เงิน)|ชำระเงิน.{0,10}(สำเร็จ|เรียบร้อย)|ออเดอร์.{0,10}(สร้าง|ยืนยัน|จัดส่ง).{0,8}แล้ว/iu.test(
      text,
    )
  )
    return review('OUTPUT_REQUIRES_REVIEW')
  return {
    text,
    handoff: false,
    sourceIds: [...sources.map((k) => k.id), ...catalog.map((p) => p.code)],
    reason: 'VERIFIED_BUSINESS_DATA',
  }
}
