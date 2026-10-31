/** Shared by the settings UI and Messenger sender. Keep the fallback identical everywhere. */
export const DEFAULT_SLIP_CONFIRMATION_TEMPLATE =
  '✅ ชำระเงินสำเร็จ · {pageName}\nทางร้านได้รับยอดชำระเงินเรียบร้อยแล้วครับ จำนวน {amount} บาท 💸✨\nขอขอบพระคุณที่ไว้วางใจครับผม 🙏📦 ทางร้านจะรีบดำเนินการจัดส่งสินค้าให้โดยเร็วที่สุดครับ 🚚💨'

export const MAX_SLIP_CONFIRMATION_LENGTH = 2000

/** Empty input resets the shop to the default; preserve all other whitespace verbatim. */
export function normalizeSlipConfirmationTemplate(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw new Error('ข้อความยืนยันยอดเงินต้องเป็นข้อความ')
  const template = value.replace(/\r\n?/g, '\n')
  if (!template.trim()) return null
  if (template.length > MAX_SLIP_CONFIRMATION_LENGTH)
    throw new Error(`ข้อความยืนยันยอดเงินต้องไม่เกิน ${MAX_SLIP_CONFIRMATION_LENGTH} ตัวอักษร`)
  const unsupported = template
    .match(/\{([^{}]+)\}/g)
    ?.find((key) => !['{amount}', '{pageName}'].includes(key))
  if (unsupported) throw new Error('ใช้ตัวแปรได้เฉพาะ {amount} และ {pageName}')
  return template
}

export function renderSlipConfirmationTemplate(
  amount: number | null,
  pageName?: string | null,
  template?: string | null,
): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0)
    throw new Error('SLIP_CONFIRMATION_AMOUNT_INVALID')
  const source =
    normalizeSlipConfirmationTemplate(template ?? null) ?? DEFAULT_SLIP_CONFIRMATION_TEMPLATE
  const values = {
    amount: amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    pageName: pageName?.trim() || 'ร้านค้า',
  }
  // One pass: placeholder-like text or replacement syntax inside a Page name stays literal.
  const text = source.replace(
    /\{(amount|pageName)\}/g,
    (_, key: keyof typeof values) => values[key],
  )
  if (text.length > MAX_SLIP_CONFIRMATION_LENGTH)
    throw new Error('SLIP_CONFIRMATION_MESSAGE_TOO_LONG')
  return text
}
