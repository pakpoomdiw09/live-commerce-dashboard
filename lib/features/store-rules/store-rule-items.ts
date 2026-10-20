export const STORE_RULE_CATEGORIES = { general: 'ทั่วไป', shipping: 'การจัดส่ง / บริการ', payment: 'การชำระเงิน', promotion: 'โปรโมชัน', returns: 'การเปลี่ยน / คืน', persona: 'บุคลิกและน้ำเสียง', handoff: 'ส่งต่อแอดมิน' } as const
export type StoreRuleCategory = keyof typeof STORE_RULE_CATEGORIES
export type StoreRuleItem = { id: string; body: string; category?: StoreRuleCategory; enabled?: boolean }
export const STORE_RULES_LIMIT = 50000
export const STORE_RULE_ITEMS_LIMIT = 200
export const validRuleCategory = (value: unknown): value is StoreRuleCategory => typeof value === 'string' && Object.hasOwn(STORE_RULE_CATEGORIES, value)
export type StoreRulesIssue = { path: string; code: string; message: string }
export type StoreRulesState =
  | { ok: true; kind: 'empty' | 'legacy' | 'items'; raw: string; items: StoreRuleItem[]; issues: [] }
  | { ok: false; kind: 'invalid'; raw: string; items: []; issues: StoreRulesIssue[] }

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const reserved = (raw: string) => /^[\s\uFEFF]*[\[{]/.test(raw) && /"snapbot_store_rules"\s*:/.test(raw)
const badText = (text: string) => {
  if (text.includes('\0')) return true
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(++index)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return true
  }
  return false
}

/** Keep invalid documents intact so the editor can offer manual recovery. */
export function parseStoreRules(input: unknown): StoreRulesState {
  const raw = typeof input === 'string' ? input : ''
  const invalid = (path: string, code: string, message: string): StoreRulesState => ({ ok: false, kind: 'invalid', raw, items: [], issues: [{ path, code, message }] })
  if (input !== null && input !== undefined && typeof input !== 'string') return invalid('$', 'INVALID_TYPE', 'ข้อมูลกฎของร้านต้องเป็นข้อความ')
  if (raw.length > STORE_RULES_LIMIT) return invalid('$', 'TOO_LONG', 'กฎของร้านรวมข้อมูลจัดเก็บต้องไม่เกิน 50,000 ตัวอักษร')
  if (badText(raw)) return invalid('$', 'INVALID_TEXT', 'ข้อความกฎมีอักขระที่ระบบไม่รองรับ กรุณาตรวจสอบก่อนบันทึก')
  if (!raw.trim()) return { ok: true, kind: 'empty', raw, items: [], issues: [] }
  let value: unknown
  try { value = JSON.parse(raw) } catch {
    if (reserved(raw)) return invalid('$', 'INVALID_JSON', 'รูปแบบข้อมูลกฎไม่สมบูรณ์ กรุณาแก้ไขข้อมูลหรือโหลดใหม่')
    return { ok: true, kind: 'legacy', raw, items: [{ id: 'legacy', body: raw }], issues: [] }
  }
  if (!object(value) || !Object.hasOwn(value, 'snapbot_store_rules')) {
    if (Array.isArray(value) && reserved(raw)) return invalid('$', 'INVALID_DOCUMENT', 'รายการกฎต้องอยู่ในเอกสารกฎของร้านที่ถูกต้อง')
    return { ok: true, kind: 'legacy', raw, items: [{ id: 'legacy', body: raw }], issues: [] }
  }
  if (value.snapbot_store_rules !== 1) return invalid('snapbot_store_rules', 'UNSUPPORTED_VERSION', 'ข้อมูลกฎเป็นรุ่นที่ระบบยังไม่รองรับ กรุณาตรวจสอบก่อนแก้ไข')
  if (Object.keys(value).some(key => !['snapbot_store_rules', 'rules'].includes(key))) return invalid('$', 'UNKNOWN_FIELD', 'ข้อมูลกฎมีช่องข้อมูลที่ระบบไม่รองรับ')
  if (!Array.isArray(value.rules)) return invalid('rules', 'INVALID_ITEMS', 'รายการกฎต้องเป็นรายการข้อความ')
  if (value.rules.length > STORE_RULE_ITEMS_LIMIT) return invalid('rules', 'TOO_MANY_ITEMS', 'เพิ่มกฎได้สูงสุด 200 ข้อ')
  const ids = new Set<string>(), items: StoreRuleItem[] = []
  for (const [index, item] of value.rules.entries()) {
    const path = 'rules[' + index + ']'
    if (!object(item)) return invalid(path, 'INVALID_ITEM', 'กฎข้อที่ ' + (index + 1) + ' มีรูปแบบไม่ถูกต้อง')
    if (Object.keys(item).some(key => !['id', 'body', 'category', 'enabled'].includes(key))) return invalid(path, 'UNKNOWN_FIELD', 'กฎข้อที่ ' + (index + 1) + ' มีช่องข้อมูลที่ระบบไม่รองรับ')
    if (typeof item.id !== 'string' || !item.id.trim() || item.id.length > 128 || badText(item.id) || /[\u0000-\u001f\u007f]/.test(item.id)) return invalid(path + '.id', 'INVALID_ID', 'รหัสกฎข้อที่ ' + (index + 1) + ' ไม่ถูกต้อง')
    if (ids.has(item.id)) return invalid(path + '.id', 'DUPLICATE_ID', 'พบรหัสกฎซ้ำ กรุณาตรวจสอบรายการกฎ')
    if (typeof item.body !== 'string' || !item.body.trim() || badText(item.body)) return invalid(path + '.body', 'INVALID_BODY', 'กรุณาใส่รายละเอียดกฎข้อที่ ' + (index + 1) + ' ให้ถูกต้อง')
    if (Object.hasOwn(item, 'category') && !validRuleCategory(item.category)) return invalid(path + '.category', 'INVALID_CATEGORY', 'หมวดหมู่กฎข้อที่ ' + (index + 1) + ' ไม่ถูกต้อง')
    if (Object.hasOwn(item, 'enabled') && typeof item.enabled !== 'boolean') return invalid(path + '.enabled', 'INVALID_STATUS', 'สถานะกฎข้อที่ ' + (index + 1) + ' ต้องเป็นเปิดหรือปิดใช้งาน')
    ids.add(item.id)
    items.push({ id: item.id, body: item.body, ...(validRuleCategory(item.category) ? { category: item.category } : {}), ...(typeof item.enabled === 'boolean' ? { enabled: item.enabled } : {}) })
  }
  return { ok: true, kind: 'items', raw, items, issues: [] }
}

export class StoreRulesValidationError extends Error {
  readonly code = 'STORE_RULES_INVALID'
  readonly status = 400
  constructor(readonly issues: StoreRulesIssue[]) {
    super(issues[0]?.message ?? 'ข้อมูลกฎของร้านไม่ถูกต้อง')
  }
}
export function validateStoreRules(input: unknown): Extract<StoreRulesState, { ok: true }> {
  const result = parseStoreRules(input)
  if (!result.ok) throw new StoreRulesValidationError(result.issues)
  return result
}
export function storedRuleItems(raw: string): StoreRuleItem[] | null {
  const result = parseStoreRules(raw)
  return result.ok && result.kind === 'items' ? result.items : null
}
export function readStoreRuleItems(raw: string, legacyText = raw): StoreRuleItem[] {
  const result = parseStoreRules(raw)
  if (!result.ok) return []
  return result.kind === 'legacy' && legacyText.trim() ? [{ id: 'legacy', body: legacyText }] : result.items
}
/** Drafts may be incomplete; validate the serialized document at every persistence boundary. */
export const serializeStoreRuleItems = (rules: StoreRuleItem[]) => JSON.stringify({ snapbot_store_rules: 1, rules })
