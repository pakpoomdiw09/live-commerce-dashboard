import { BANK_CODES, isSupportedBank, UNSUPPORTED_BANK_MESSAGE } from '@/lib/features/banking/banks'
import { ORDER_STATUSES } from '@/lib/status'
import type { OrderStatus, TenantRow } from '@/lib/types'

type Result<T> = { ok: true; value: T } | { ok: false; error: string }
const fail = (error: string): Result<never> => ({ ok: false, error })

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())
const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k)

export type TenantInput = Partial<
  Pick<
    TenantRow,
    | 'name'
    | 'account_name'
    | 'account_number'
    | 'bank_code'
    | 'page_id'
    | 'expected_amount'
    | 'auto_reply_enabled'
    | 'auto_verify_enabled'
    | 'slip_quota'
  > & { page_access_token: string | null }
>

/** Tenant settings by who may change them. Anything not listed here needs the tenant's owner. */
export const STAFF_TENANT_FIELDS: (keyof TenantInput)[] = [
  'auto_reply_enabled',
  'auto_verify_enabled',
]
export const ADMIN_TENANT_FIELDS: (keyof TenantInput)[] = ['slip_quota']

/**
 * Validate tenant fields from a request body. With `partial` only the keys present are checked
 * (PATCH); without it name, bank_code and account_number are required (POST).
 */
export function parseTenantInput(body: unknown, partial: boolean): Result<TenantInput> {
  if (!body || typeof body !== 'object') return fail('body must be a JSON object')
  const b = body as Record<string, unknown>
  const out: TenantInput = {}
  const need = (k: string) => !partial || has(b, k)

  if (need('name')) {
    const name = str(b.name)
    if (!name || name.length > 120) return fail('ชื่อร้านต้องมี 1-120 ตัวอักษร')
    out.name = name
  }
  if (need('bank_code')) {
    const code = str(b.bank_code).toUpperCase()
    if (!BANK_CODES.includes(code)) return fail('เลือกธนาคารจากรายการ')
    if (!isSupportedBank(code)) return fail(UNSUPPORTED_BANK_MESSAGE)
    out.bank_code = code
  }
  if (need('account_number')) {
    const num = str(b.account_number).replace(/[\s-]/g, '')
    if (!/^\d{10,15}$/.test(num)) return fail('เลขบัญชี / พร้อมเพย์ต้องเป็นตัวเลข 10-15 หลัก')
    out.account_number = num
  }
  if (has(b, 'account_name')) {
    const v = str(b.account_name)
    if (v.length > 120) return fail('ชื่อบัญชียาวเกินไป')
    out.account_name = v || null
  }
  if (has(b, 'page_id')) {
    const v = str(b.page_id)
    if (v && !/^\d{5,25}$/.test(v)) return fail('Facebook Page ID ต้องเป็นตัวเลข')
    out.page_id = v || null
  }
  if (has(b, 'page_access_token')) {
    // "" clears the saved token
    const v = str(b.page_access_token)
    if (v && !/^[A-Za-z0-9_\-.|]{20,1000}$/.test(v)) return fail('Page Access Token ไม่ถูกต้อง')
    out.page_access_token = v || null
  }
  if (has(b, 'expected_amount')) {
    const v = str(b.expected_amount)
    const n = Number(v)
    if (v && !(Number.isFinite(n) && n > 0 && n < 10_000_000))
      return fail('ยอดที่คาดหวังต้องเป็นตัวเลขมากกว่า 0')
    out.expected_amount = v ? Math.round(n * 100) / 100 : null
  }
  for (const k of ['auto_reply_enabled', 'auto_verify_enabled'] as const) {
    if (!has(b, k)) continue
    if (typeof b[k] !== 'boolean') return fail(`${k} must be true or false`)
    out[k] = b[k] as boolean
  }
  if (has(b, 'slip_quota')) {
    const n = Number(b.slip_quota)
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000)
      return fail('โควตาเครดิตต้องเป็นจำนวนเต็ม 0-1,000,000')
    out.slip_quota = n
  }
  return { ok: true, value: out }
}

export type CustomerInput = {
  display_name?: string | null
  phone?: string | null
  address?: string | null
  tags?: string[]
  notes?: string | null
  order_status?: OrderStatus
}

/** CRM fields an admin may edit. Only the keys present are validated and written. */
export function parseCustomerInput(body: unknown): Result<CustomerInput> {
  if (!body || typeof body !== 'object') return fail('body must be a JSON object')
  const b = body as Record<string, unknown>
  const out: CustomerInput = {}
  if (has(b, 'display_name')) {
    const v = str(b.display_name)
    if (v.length > 120) return fail('ชื่อลูกค้ายาวเกิน 120 ตัวอักษร')
    out.display_name = v || null
  }
  if (has(b, 'phone')) {
    const v = str(b.phone).replace(/[\s-]/g, '')
    if (v && !/^\+?\d{9,15}$/.test(v)) return fail('เบอร์โทรไม่ถูกต้อง')
    out.phone = v || null
  }
  if (has(b, 'address')) {
    const v = str(b.address)
    if (v.length > 500) return fail('ที่อยู่ยาวเกิน 500 ตัวอักษร')
    out.address = v || null
  }
  if (has(b, 'notes')) {
    const v = str(b.notes)
    if (v.length > 1000) return fail('บันทึกยาวเกิน 1000 ตัวอักษร')
    out.notes = v || null
  }
  if (has(b, 'tags')) {
    if (!Array.isArray(b.tags)) return fail('tags must be an array')
    const tags = [...new Set(b.tags.map(str).filter(Boolean))]
    if (tags.length > 10 || tags.some((t) => t.length > 30))
      return fail('แท็กได้สูงสุด 10 รายการ ไม่เกิน 30 ตัวอักษร')
    out.tags = tags
  }
  if (has(b, 'order_status')) {
    if (!ORDER_STATUSES.includes(b.order_status as OrderStatus))
      return fail('สถานะออเดอร์ไม่ถูกต้อง')
    out.order_status = b.order_status as OrderStatus
  }
  if (Object.keys(out).length === 0) return fail('nothing to update')
  return { ok: true, value: out }
}
