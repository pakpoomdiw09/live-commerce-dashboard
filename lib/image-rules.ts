export const IMAGE_TRIGGERS = {
  slip: { label: 'ลูกค้าส่งรูปสลิป', description: 'กฎสำหรับตอบกลับรูปสลิปโอนเงิน' },
  general: { label: 'ลูกค้าส่งรูปทั่วไป', description: 'กฎสำหรับตอบกลับรูปภาพทั่วไป' },
  product: { label: 'ลูกค้าส่งรูปสินค้า', description: 'กฎสำหรับตอบกลับรูปสินค้าที่ลูกค้าสอบถาม' },
} as const
export type ImageTrigger = keyof typeof IMAGE_TRIGGERS
export type ImageResponseRule = {
  id: string; tenant_id: string; name: string; trigger_type: ImageTrigger
  response_text: string | null; media_url: string | null; is_active: boolean
  created_at: string; updated_at: string; priority?: number
}
export type ImageRuleDraft = Pick<ImageResponseRule, 'name' | 'trigger_type' | 'response_text' | 'media_url' | 'is_active' | 'priority'>
export const IMAGE_RULE_COLUMNS = 'id,tenant_id,name,trigger_type,response_text,media_url,is_active,created_at,updated_at,priority'

export function selectImageRule(rules: ImageResponseRule[], trigger: ImageTrigger) {
  return rules.filter(r => r.is_active && r.trigger_type === trigger && (r.response_text?.trim() || r.media_url))
    .sort((a,b) => (b.priority ?? 0)-(a.priority ?? 0) || a.id.localeCompare(b.id))[0] ?? null
}

export function imageRuleError(draft: ImageRuleDraft): string | null {
  if (draft.priority !== undefined && (!Number.isInteger(draft.priority) || draft.priority < 0 || draft.priority > 1000)) return 'ลำดับความสำคัญต้องเป็นจำนวนเต็ม 0–1,000'
  if (!draft.name.trim() || draft.name.trim().length > 100) return 'ตั้งชื่อกฎ 1–100 ตัวอักษร'
  if (!Object.hasOwn(IMAGE_TRIGGERS, draft.trigger_type)) return 'เลือกประเภทภาพที่ใช้เป็นเงื่อนไข'
  if (!draft.response_text?.trim() && !draft.media_url) return 'เพิ่มข้อความตอบกลับหรือรูปภาพอย่างน้อยหนึ่งอย่าง'
  if ((draft.response_text?.length ?? 0) > 2000) return 'ข้อความตอบกลับต้องไม่เกิน 2,000 ตัวอักษร'
  if (draft.media_url) {
    try { if (!['http:', 'https:'].includes(new URL(draft.media_url).protocol) || draft.media_url.length > 2048) return 'ลิงก์รูปภาพไม่ถูกต้อง' }
    catch { return 'ลิงก์รูปภาพไม่ถูกต้อง' }
  }
  return null
}
