// Shared by the webhook (answering chats) and the dashboard (editors and previews). Keep in sync with supabase/automation.sql.
import { ruleMatches, type MatchType } from '@/lib/comment-rules'

export type ReplyMode = 'keyword' | 'ai'

export const DEFAULT_AI_INSTRUCTIONS = `(ตัวอย่าง)
- ค่าส่งสินค้า 50 บาท (ซื้อครบ 999 บาท ส่งฟรี Flash Express)
- ตัดรอบส่งของทุกวัน เวลา 13:00 น.
- เปลี่ยนไซส์สินค้าได้ภายใน 7 วัน (ลูกค้าชำระค่าส่งเปลี่ยนเอง)
- ตอบด้วยน้ำเสียงสุภาพ สดใส เป็นกันเอง ใช้คำลงท้าย "ค่ะ" เสมอ
- หากลูกค้าถามหาสินค้า ให้เช็กข้อมูลจากรายการสินค้าในระบบและแจ้งราคาตามจริง`

export type FollowUpStep = { delay_minutes: number; text: string }

export type BotSettings = {
  tenant_id: string
  reply_mode: ReplyMode
  ai_instructions: string | null
  fallback_text: string | null
  fallback_messages?: string[]
  handover_keywords: string[]
  handover_text: string | null
  handover_messages?: string[]
  followup_enabled: boolean
  followup_steps: FollowUpStep[]
  updated_at: string
}

export const BOT_SETTINGS_COLUMNS =
  'tenant_id, reply_mode, ai_instructions, fallback_text, fallback_messages, handover_keywords, handover_text, handover_messages, followup_enabled, followup_steps, updated_at'

/** What a tenant gets before it has saved any settings (mirrors the column defaults). */
export const defaultBotSettings = (tenantId: string): BotSettings => ({
  tenant_id: tenantId,
  reply_mode: 'keyword',
  ai_instructions: DEFAULT_AI_INSTRUCTIONS,
  fallback_text: null,
  fallback_messages: [],
  handover_keywords: ['แอดมิน', 'คุยกับแอดมิน', 'ติดต่อแอดมิน', 'ขอคุยกับคน'],
  handover_text: 'รับทราบค่ะ แอดมินจะเข้ามาตอบโดยเร็วที่สุดนะคะ 🙏',
  handover_messages: ['รับทราบค่ะ แอดมินจะเข้ามาตอบโดยเร็วที่สุดนะคะ 🙏'],
  followup_enabled: false,
  followup_steps: [
    { delay_minutes: 15, text: 'คุณ {ชื่อลูกค้า} ยังไม่ได้ส่งสลิปสำหรับยอด {ยอดเงิน} บาทนะคะ โอนแล้วส่งสลิปในแชทนี้ได้เลยค่ะ' },
    { delay_minutes: 60, text: 'แจ้งเตือนอีกครั้งค่ะ ออเดอร์ยอด {ยอดเงิน} บาท ยังรอการชำระเงิน หากต้องการยกเลิกแจ้งแอดมินได้เลยนะคะ' },
  ],
  updated_at: new Date(0).toISOString(),
})

export type ChatRule = {
  id: string
  tenant_id: string
  name: string
  match_type: MatchType
  keywords: string[]
  reply_type: 'text' | 'image'
  reply_text: string | null
  image_url: string | null
  quick_replies: string[]
  priority: number
  is_active: boolean
  hit_count: number
  created_at: string
}

export const CHAT_RULE_COLUMNS =
  'id, tenant_id, name, match_type, keywords, reply_type, reply_text, image_url, quick_replies, priority, is_active, hit_count, created_at'

/** Meta's limits for quick reply buttons. */
export const QUICK_REPLY_MAX = 13
export const QUICK_REPLY_TITLE_MAX = 20

/** Highest priority first, then oldest: the order the webhook tries rules in. */
export const ruleOrder = (a: ChatRule, b: ChatRule) => b.priority - a.priority || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)

/** The first active rule that answers this message, or null. `rules` must already be in ruleOrder. */
export const matchChatRule = (rules: ChatRule[], text: string) => rules.find((r) => r.is_active && ruleMatches(r, text)) ?? null

/** The customer asked for a person: any handover keyword appears in the message. */
export const wantsHuman = (keywords: string[], text: string) => ruleMatches({ match_type: 'keyword', keywords }, text)

/** Follow-up delays offered in the dashboard. Meta's standard window closes 24 h after the customer's last message. */
export const FOLLOW_UP_DELAYS = [
  { minutes: 15, label: '15 นาที' },
  { minutes: 30, label: '30 นาที' },
  { minutes: 60, label: '1 ชั่วโมง' },
  { minutes: 180, label: '3 ชั่วโมง' },
  { minutes: 360, label: '6 ชั่วโมง' },
  { minutes: 720, label: '12 ชั่วโมง' },
  { minutes: 1380, label: '23 ชั่วโมง' },
]

/** Fill {name} and {total} in a follow-up message. */
export function renderFollowUp(text: string, v: { name: string; total: number }) {
  const total = v.total.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return text.replace(/\{(name|ชื่อลูกค้า|total|ยอดเงิน)\}/g, (_, key: string) =>
    key === 'name' || key === 'ชื่อลูกค้า' ? v.name : total)
}

export const FOLLOW_UP_REASON: Record<string, string> = {
  plan_required: 'แพ็กเกจไม่รองรับหรือหมดอายุ',
  paid: 'ชำระเงินแล้ว',
  order_cancelled: 'ยกเลิกออเดอร์',
  superseded: 'มีออเดอร์ใหม่แทน',
  slip_received: 'ลูกค้าส่งสลิปแล้ว',
  handover: 'แอดมินรับแชทแล้ว',
  bot_off: 'ปิดบอทของร้าน',
  disabled: 'ปิดระบบติดตาม',
  window_closed: 'เกิน 24 ชม. ของ Meta',
  manual: 'ยกเลิกโดยแอดมิน',
  no_token: 'ยังไม่ได้ตั้ง Page Token',
}

export type BroadcastSegment = 'all' | 'pending_payment' | 'paid_before'

export const BROADCAST_SEGMENTS: Record<BroadcastSegment, { label: string; hint: string }> = {
  all: { label: 'ลูกค้าทั้งหมด', hint: 'ทุกแชทของเพจนี้' },
  pending_payment: { label: 'ค้างชำระ', hint: 'มีออเดอร์ที่ยังไม่โอน' },
  paid_before: { label: 'ลูกค้าเก่า', hint: 'เคยชำระเงินแล้วอย่างน้อย 1 ออเดอร์' },
}

/** within_24h: plain UPDATE messages. outside_24h: sent with a Meta message tag, never promotional. */
export type BroadcastWindow = 'within_24h' | 'outside_24h'

export const BROADCAST_WINDOWS: Record<BroadcastWindow, { label: string; hint: string }> = {
  within_24h: { label: 'ภายใน 24 ชม.', hint: 'ลูกค้าที่ทักมาภายใน 24 ชม. ส่งข้อความได้ทุกประเภท รวมถึงโปรโมชัน' },
  outside_24h: { label: 'เกิน 24 ชม.', hint: 'ต้องเลือกหมวดหมู่ข้อความ และห้ามเป็นข้อความโฆษณา/โปรโมชัน' },
}

/** Meta's message tags: the only way to message a person after the 24-hour window. */
export type MessageTag = 'POST_PURCHASE_UPDATE' | 'CONFIRMED_EVENT_UPDATE' | 'ACCOUNT_UPDATE' | 'HUMAN_AGENT'

export const MESSAGE_TAGS: Record<MessageTag, { label: string; hint: string }> = {
  POST_PURCHASE_UPDATE: { label: 'แจ้งสถานะคำสั่งซื้อ / เลขพัสดุ / ใบเสร็จ', hint: 'แจ้งความคืบหน้าของคำสั่งซื้อที่ลูกค้าซื้อแล้ว เช่น เลขพัสดุหรือใบเสร็จ' },
  CONFIRMED_EVENT_UPDATE: { label: 'แจ้งเตือนนัดหมาย / ไลฟ์สดที่ลงทะเบียนไว้', hint: 'แจ้งเตือนเฉพาะนัดหมายหรือไลฟ์สดที่ลูกค้าลงทะเบียนไว้แล้ว' },
  ACCOUNT_UPDATE: { label: 'แจ้งเปลี่ยนแปลงข้อมูลบัญชี / เครดิตสมาชิก', hint: 'แจ้งข้อมูลบัญชีหรือเครดิตสมาชิกของลูกค้าที่เปลี่ยนแปลง' },
  HUMAN_AGENT: { label: 'แอดมินตอบกลับลูกค้า (ส่งได้ภายใน 7 วันหลังทักล่าสุด)', hint: 'แอดมินตอบกลับลูกค้าได้ภายใน 7 วันหลังลูกค้าทักครั้งล่าสุด' },
}

export const MESSAGE_TAG_VALUES = Object.keys(MESSAGE_TAGS) as MessageTag[]

export type BroadcastRow = {
  id: string
  tenant_id: string
  name: string
  message: string
  audience_segment: BroadcastSegment
  audience_tags: string[]
  audience_window: BroadcastWindow
  /** set exactly when audience_window is outside_24h */
  message_tag: MessageTag | null
  status: 'draft' | 'sending' | 'sent' | 'failed'
  total: number
  sent: number
  failed: number
  skipped: number
  /** why sends failed, e.g. outside the window or a tag Meta refused */
  last_error: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export const BROADCAST_COLUMNS =
  'id, tenant_id, name, message, audience_segment, audience_tags, audience_window, message_tag, status, total, sent, failed, skipped, last_error, created_at, started_at, finished_at'

/** Meta's standard messaging window: the Page may message a person up to 24 h after their last message. */
export const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000

/** HUMAN_AGENT may answer a person up to 7 days after their last message. */
export const HUMAN_AGENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export const inWindow = (lastMessageAt: string | null, now = Date.now()) =>
  !!lastMessageAt && now - new Date(lastMessageAt).getTime() < MESSAGING_WINDOW_MS
