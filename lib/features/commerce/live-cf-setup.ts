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
  category_id?: string
  description?: string
  images?: string[]
  is_active?: boolean
  featured?: boolean
  cost?: number | null
  compare_price?: number | null
  variants?: {
    id: string
    label: string
    variant_code: string
    price: string
    stock: string
  }[]
}

export function quickLiveProduct(draft: QuickLiveProductDraft) {
  const variants = draft.variants ?? []
  if (!variants.length && !draft.stock.trim()) throw new CommerceError('กรุณากรอกจำนวนสต็อก')
  return parseProduct({
    name: draft.name,
    code: draft.cf_code,
    price: Number(draft.price),
    stock: Number(draft.stock),
    category_id: draft.category_id ?? '',
    description: draft.description ?? '',
    images: draft.images ?? [],
    variants: variants.map((variant, index) => {
      if (!variant.stock.trim())
        throw new CommerceError(`กรุณากรอกสต็อกของตัวเลือกที่ ${index + 1}`)
      return { ...variant, price: Number(variant.price), stock: Number(variant.stock) }
    }),
    is_active: draft.is_active ?? true,
    featured: draft.featured ?? false,
    cost: draft.cost,
    compare_price: draft.compare_price,
  })
}
