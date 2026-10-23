import { parseStoreRules, STORE_RULES_LIMIT } from '@/lib/features/store-rules/store-rule-items'
export const STORE_RULES_MAX_LENGTH = STORE_RULES_LIMIT
export const SHOP_RULE_FIELDS = {
  tone: 'บุคลิกและน้ำเสียงที่ต้องการ',
  opening: 'คำขึ้นต้น',
  closing: 'คำลงท้าย',
  dispatch: 'รอบส่งสินค้าหรือระยะเวลาให้บริการ',
  shipping: 'ค่าจัดส่งหรือค่าบริการ',
  promotion: 'โปรโมชันและเงื่อนไข',
  answers: 'เรื่องที่ตอบเองได้',
  handoff: 'เรื่องที่ต้องส่งต่อแอดมิน',
  extra: 'ข้อมูลเพิ่มเติมและกติกาเดิม',
} as const
export type ShopRulesForm = Record<keyof typeof SHOP_RULE_FIELDS, string>
export const emptyShopRules = (): ShopRulesForm =>
  Object.fromEntries(Object.keys(SHOP_RULE_FIELDS).map((key) => [key, ''])) as ShopRulesForm
const heading = 'ข้อมูลกติการ้านที่จัดหมวดหมู่'
const isField = (line: string) =>
  Object.values(SHOP_RULE_FIELDS).some((label) => line.startsWith(label + ':'))
const escapeValue = (value: string) =>
  value
    .split('\n')
    .map((line) => (line.startsWith('\\') || isField(line) ? '\\' + line : line))
    .join('\n')
const unescapeValue = (line: string) =>
  line.startsWith('\\') && (line[1] === '\\' || isField(line.slice(1))) ? line.slice(1) : line

/** Plain text remains compatible with saved prompt versions and existing AI readers. */
export function compileShopRules(value: ShopRulesForm): string {
  const content = Object.entries(SHOP_RULE_FIELDS)
    .filter(([key]) => value[key as keyof ShopRulesForm].trim())
    .map(([key, label]) => `${label}: ${escapeValue(value[key as keyof ShopRulesForm].trim())}`)
    .join('\n\n')
  return content ? `${heading}\n\n${content}` : ''
}
export function validateShopRules(input: unknown): ShopRulesForm {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('ข้อมูลกติการ้านไม่ถูกต้อง')
  const data = input as Record<string, unknown>,
    result = emptyShopRules()
  if (Object.keys(data).some((key) => !Object.hasOwn(SHOP_RULE_FIELDS, key)))
    throw new Error('ข้อมูลกติการ้านไม่ถูกต้อง')
  for (const key of Object.keys(result) as (keyof ShopRulesForm)[]) {
    if (typeof data[key] !== 'string' || data[key].length > STORE_RULES_MAX_LENGTH)
      throw new Error('กรุณาตรวจสอบข้อความกฎของร้าน')
    result[key] = data[key]
  }
  if (compileShopRules(result).length > STORE_RULES_MAX_LENGTH)
    throw new Error('กฎของร้านรวมกันต้องไม่เกิน 50,000 ตัวอักษร')
  return result
}
/** Unmapped old instructions stay editable and are never discarded on the first structured save. */
export function parseShopRules(text: string): ShopRulesForm {
  const result = emptyShopRules(),
    keys = Object.keys(SHOP_RULE_FIELDS) as (keyof ShopRulesForm)[]
  if (!text.startsWith(heading + '\n')) return { ...result, extra: text }
  let current: keyof ShopRulesForm | null = null
  const unknown: string[] = []
  for (const line of text.slice(heading.length + 1).split('\n')) {
    if (current === 'extra') {
      result.extra += '\n' + unescapeValue(line)
      continue
    }
    const key = keys.find((key) => line.startsWith(SHOP_RULE_FIELDS[key] + ':'))
    if (key) {
      current = key
      result[key] +=
        (result[key] ? '\n' : '') +
        unescapeValue(line.slice(SHOP_RULE_FIELDS[key].length + 1).trimStart())
    } else if (current) result[current] += '\n' + unescapeValue(line)
    else unknown.push(line)
  }
  for (const key of keys) result[key] = result[key].trim()
  result.extra = [unknown.join('\n').trim(), result.extra].filter(Boolean).join('\n\n')
  return result
}
/** Keep serialization markers and editor escaping out of the model's shop context. */
export function shopRulesPrompt(text: string): string {
  const result = parseStoreRules(text)
  if (!result.ok) return ''
  if (result.kind === 'items')
    return result.items
      .filter((item) => item.enabled !== false)
      .map((item) => item.body)
      .join('\n\n')
  if (!text.startsWith(heading + '\n')) return text
  const settings = parseShopRules(text)
  return Object.entries(SHOP_RULE_FIELDS)
    .filter(([key]) => settings[key as keyof ShopRulesForm].trim())
    .map(([key, label]) =>
      key === 'extra' ? settings.extra : `${label}: ${settings[key as keyof ShopRulesForm]}`,
    )
    .join('\n\n')
}
