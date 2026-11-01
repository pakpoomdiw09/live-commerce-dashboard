import { CommerceError, parseProduct } from './commerce-core'

const replyFields = [
  ['{product_name}', '{ชื่อสินค้า}'],
  ['{variant_name}', '{ตัวเลือกสินค้า}'],
  ['{price}', '{ราคา}'],
  ['{total}', '{ยอดชำระ}'],
  ['{payment_link}', '{ลิงก์ชำระเงิน}'],
] as const

/** Keep the stored transport format compatible while presenting readable Thai fields. */
export function displayLiveReplyTemplate(value: string) {
  return replyFields.reduce((text, [stored, display]) => text.replaceAll(stored, display), value)
}
export function storedLiveReplyTemplate(value: string) {
  return replyFields.reduce((text, [stored, display]) => text.replaceAll(display, stored), value)
}

/** Facebook share links can hide the numeric ID; never mistake their opaque token for an ID. */
export function extractFacebookLiveId(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 2048) return null
  const value = input.trim()
  if (!value || /^\d+(?:_\d+)?$/.test(value)) return value
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      !(url.hostname === 'facebook.com' || url.hostname.endsWith('.facebook.com'))
    )
      return null
    const pathId =
      url.pathname.match(/\/videos\/(?:[^/]+\/)?(\d+)\/?$/i)?.[1] ??
      url.pathname.match(/^\/live\/(\d+)\/?$/i)?.[1]
    if (pathId) return pathId
    if (/^\/(?:watch(?:\/live)?\/?|video\.php|live\/?)$/i.test(url.pathname)) {
      const id = url.searchParams.get('v')
      if (id && /^\d+$/.test(id)) return id
    }
  } catch {
    // Invalid URLs fall through to an explicit input error in the UI and API.
  }
  return null
}

export type QuickLiveProductDraft = {
  name: string
  price: string
  stock: string
  cf_code: string
}

export function quickLiveProduct(draft: QuickLiveProductDraft) {
  if (!draft.stock.trim()) throw new CommerceError('กรุณากรอกจำนวนสต็อก')
  return parseProduct({
    name: draft.name,
    code: draft.cf_code,
    price: Number(draft.price),
    stock: Number(draft.stock),
    description: '',
    images: [],
    variants: [],
    is_active: true,
  })
}
