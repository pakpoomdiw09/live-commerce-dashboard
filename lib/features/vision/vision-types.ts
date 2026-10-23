import { selectImageRule, type ImageResponseRule } from '@/lib/features/vision/image-rules'

export const VISION_CATEGORIES = ['PRODUCT', 'PAYMENT_SLIP', 'GENERAL', 'UNKNOWN'] as const
export type VisionCategory = (typeof VISION_CATEGORIES)[number]
export type VisionResult = {
  category: VisionCategory
  confidence: number
  description: string
  productId?: string
}
export type VisionSettings = {
  tenant_id: string
  enabled: boolean
  mode: 'rules' | 'catalog'
  confidence_threshold: number
  handoff_enabled: boolean
}
export type VisionProduct = {
  id: string
  code: string
  name: string
  price: number
  stock: number
  description: string | null
}
export type VisionDecision = {
  action: 'PRODUCT_SEARCH' | 'VERIFY_SLIP' | 'RULE_REPLY' | 'HUMAN_HANDOFF'
  reason: string
  responseText?: string
  mediaUrl?: string | null
  ruleId?: string
  productId?: string
}
export type VisionJob = {
  id: string
  tenant_id: string
  customer_id: string | null
  message_id: string | null
  image_path: string
  mime_type: string
  source: 'test' | 'messenger'
  status: string
  claim_token: string
  result: VisionResult | null
  decision: VisionDecision | null
  reason: string | null
  created_at: string
}

/** Treat model output as untrusted. Catalog IDs are resolved again against this tenant's DB rows. */
export function parseVisionResult(text: string): VisionResult {
  const value = JSON.parse(text) as Record<string, unknown>
  if (
    !VISION_CATEGORIES.includes(value.category as VisionCategory) ||
    typeof value.confidence !== 'number' ||
    !Number.isFinite(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 1 ||
    typeof value.description !== 'string'
  )
    throw new Error('INVALID_VISION_RESPONSE')
  return {
    category: value.category as VisionCategory,
    confidence: value.confidence,
    description: value.description.slice(0, 500),
    ...(typeof value.productId === 'string' ? { productId: value.productId } : {}),
  }
}
export function decideVisionAction(
  result: VisionResult,
  settings: VisionSettings,
  rules: ImageResponseRule[],
  products: VisionProduct[],
  productSearch: boolean,
): VisionDecision {
  if (result.confidence < settings.confidence_threshold)
    return { action: 'HUMAN_HANDOFF', reason: 'LOW_CONFIDENCE' }
  if (result.category === 'PAYMENT_SLIP') return { action: 'VERIFY_SLIP', reason: 'SLIP_DETECTED' }
  if (result.category === 'UNKNOWN') return { action: 'HUMAN_HANDOFF', reason: 'UNKNOWN_IMAGE' }
  if (result.category === 'PRODUCT' && settings.mode === 'catalog') {
    if (!productSearch) return { action: 'HUMAN_HANDOFF', reason: 'PRO_REQUIRED' }
    const product = products.find((p) => p.id === result.productId)
    if (!product) return { action: 'HUMAN_HANDOFF', reason: 'NO_CATALOG_MATCH' }
    return {
      action: 'PRODUCT_SEARCH',
      reason: 'CATALOG_MATCH',
      productId: product.id,
      responseText: `${product.name} (${product.code}) ราคา ${Number(product.price).toFixed(2)} บาท · ${product.stock > 0 ? `คงเหลือ ${product.stock} ชิ้น` : 'สินค้าหมด'}`,
    }
  }
  const rule = selectImageRule(rules, result.category === 'PRODUCT' ? 'product' : 'general')
  return rule
    ? {
        action: 'RULE_REPLY',
        reason: 'MATCHED_RULE',
        ruleId: rule.id,
        responseText: rule.response_text ?? undefined,
        mediaUrl: rule.media_url,
      }
    : { action: 'HUMAN_HANDOFF', reason: 'NO_RULE' }
}
