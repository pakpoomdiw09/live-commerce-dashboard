/** Unicode/case/space normalization shared by the webhook and setup preview. */
export function normalizeCfText(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim()
}

export function normalizeCfCode(value: string | null | undefined): string | null {
  const code = normalizeCfText(value)
  if (!code) return null
  return code.slice(0, 60)
}

/** Extract an optional trailing Live CF quantity. A plain code always means one item. */
export function cfQuantity(value: string | null | undefined): number {
  const text = normalizeCfText(value)
  const suffix = /(?:\*|x)\s*(\d+)\s*$/iu.exec(text) ?? /\s+(\d+)\s*$/u.exec(text)
  if (!suffix) return 1
  const quantity = Number(suffix[1])
  return Number.isSafeInteger(quantity) && quantity > 0 ? Math.min(quantity, 99) : 1
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Match comment against targetCode according to mode ('flexible' | 'strict'):
 * - strict: Exact match 100% (ignoring leading/trailing spaces and case)
 * - flexible: Matches bare code or code preceded by prefixes like CF, FC, จอง, เอา, สนใจ or as a complete token
 */
export function matchOrderCode(
  comment: string | null | undefined,
  targetCode: string | null | undefined,
  mode: 'flexible' | 'strict' = 'flexible',
): boolean {
  if (!comment || !targetCode) return false
  const normComment = normalizeCfText(comment)
  const normTarget = normalizeCfText(targetCode)
  if (!normComment || !normTarget) return false

  if (mode === 'strict') {
    return normComment === normTarget
  }

  // mode === 'flexible'
  if (normComment === normTarget) return true

  // Prefixes are optional. Preserve old aliases while supporting Thai booking words.
  const prefixRegex = /^(?:cf|fc|ขอรับ|เอา|จอง|สั่ง|ปิด|สนใจ|รับ|ขอ)\s*[:.\-]?\s*/iu
  const withoutPrefix = normComment.replace(prefixRegex, '').trim()
  if (withoutPrefix === normTarget) return true

  // Thai often has no separating spaces: รับA1ค่ะ / ปิด159ครับ.
  // Only explicit polite endings are accepted; longer SKUs must remain distinct.
  for (const candidate of [normComment, withoutPrefix]) {
    if (
      candidate.startsWith(normTarget) &&
      /^(?:\s*(?:ครับ|ค่ะ|คะ|จ้า|จ้ะ|นะ|น้า))$/u.test(candidate.slice(normTarget.length))
    )
      return true
  }

  // Also check if targetCode appears as a distinct word/token in the comment
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}\\p{M}_-])${escapeRegex(normTarget)}(?=$|[^\\p{L}\\p{N}\\p{M}_-])`,
    'u',
  )
  return pattern.test(normComment)
}

/** Match a configured CF code as a complete token (`159` never matches `1590`). Backward compatible. */
export function matchesCfCode(text: string | null | undefined, expected: string): boolean {
  return matchOrderCode(text, expected, 'flexible')
}

/**
 * สกัดรหัสสินค้า CF จากข้อความคอมเมนต์อย่างยืดหยุ่น:
 * - รองรับ Case-insensitive ทั้ง CF, cf, Cf, cF
 * - รองรับคำนำหน้าภาษาไทย: รับ, เอา, จอง, ขอรับ, สั่ง, ปิด, สนใจ, ขอ
 * - รองรับทั้งแบบเว้นวรรคและไม่เว้นวรรค เช่น "CF fc159", "CFfc159", "รับ fc159", "fc159"
 * - ตัดคำลงท้ายสุภาพ/คำสร้อย เช่น ครับ, ค่ะ, คะ, จ้า, จ้ะ, น้า, แอดมิน ออกอัตโนมัติ
 * - คืนค่าเป็นตัวพิมพ์เล็ก (lowercase canonical) เพื่อให้เทียบกับ SKU/Rule ได้แม่นยำ
 */
export function cfCode(text: string | null | undefined): string | null {
  if (!text) return null

  // 1. Clean & Normalize Unicode และช่องว่าง
  let clean = text
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // ลบ zero-width spaces
    .replace(/\s+/gu, ' ')
    .trim()

  if (!clean) return null

  // 2. ตัดคำนำหน้า (Prefix) ทั้งไทยและอังกฤษ (Case-insensitive)
  const prefixRegex = /^(?:cf|fc|ขอรับ|รับ|เอา|จอง|สั่ง|ปิด|สนใจ|ขอ)\s*[:.\-_]?\s*/iu
  clean = clean.replace(prefixRegex, '').trim()

  // 3. ตัดคำลงท้ายสุภาพ (Suffix)
  const suffixRegex = /\s*(?:ครับ|ค่ะ|คะ|จ้า|จ้ะ|นะ|น้า|หน่อย|แอดมิน|คับ|ฮะ)[\s.!~]*$/iu
  clean = clean.replace(suffixRegex, '').trim()

  // 4. สกัดรหัสสินค้า (อักษร + ตัวเลข ความยาว 1-40 ตัวอักษร)
  const codeMatch = /^([\p{L}\p{N}][\p{L}\p{N}\p{M}_\-]{0,39})/u.exec(clean)
  if (!codeMatch) return null

  return codeMatch[1].toLocaleLowerCase('en-US').trim()
}
