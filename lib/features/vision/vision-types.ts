import { selectImageRule, type ImageResponseRule } from '@/lib/features/vision/image-rules'

export const VISION_CATEGORIES = ['PRODUCT', 'PAYMENT_SLIP', 'GENERAL', 'UNKNOWN'] as const
export const VISION_CONFIDENCE_THRESHOLD = 0.8
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
  rules: ImageResponseRule[],
): VisionDecision {
  if (result.confidence < VISION_CONFIDENCE_THRESHOLD)
    return { action: 'HUMAN_HANDOFF', reason: 'LOW_CONFIDENCE' }
  if (result.category === 'UNKNOWN') return { action: 'HUMAN_HANDOFF', reason: 'UNKNOWN_IMAGE' }
  const trigger =
    result.category === 'PRODUCT'
      ? 'product'
      : result.category === 'PAYMENT_SLIP'
        ? 'slip'
        : 'general'
  const rule = selectImageRule(rules, trigger)
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
