import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildProductReply } from '@/lib/features/commerce/messenger-product'
import {
  VISION_CONFIDENCE_THRESHOLD,
  type VisionDecision,
  type VisionProduct,
  type VisionResult,
} from './vision-types'

export const CATALOG_INQUIRY =
  'สนใจสินค้าตัวไหนสอบถามได้เลยค่ะ รบกวนส่งชื่อสินค้า รหัสสินค้า หรือรูปที่ชัดเจนเพิ่มเติม เพื่อให้ช่วยตรวจสอบได้ตรงรุ่นค่ะ'

/** Paginate the complete active catalog, never a global or silently truncated list. */
export async function loadVisionCatalog(db: SupabaseClient, tenantId: string) {
  const products: VisionProduct[] = []
  for (let offset = 0; ; offset += 100) {
    const page = await db
      .from('products')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .eq('commerce_archived', false)
      .order('id')
      .range(offset, offset + 99)
    if (page.error) throw page.error
    products.push(...(page.data ?? []))
    if (!page.data || page.data.length < 100) return products
  }
}

/** Re-read authoritative facts and storefront availability after model generation. */
export async function catalogVisionDecision(
  db: SupabaseClient,
  tenantId: string,
  result: VisionResult,
  candidates: readonly VisionProduct[],
): Promise<VisionDecision> {
  const fallback: VisionDecision = {
    action: 'RULE_REPLY',
    reason: 'CATALOG_NO_MATCH',
    responseText: CATALOG_INQUIRY,
  }
  if (
    result.category !== 'PRODUCT' ||
    result.confidence < VISION_CONFIDENCE_THRESHOLD ||
    !candidates.some((p) => p.id === result.productId)
  )
    return fallback
  const [product, store] = await Promise.all([
    db
      .from('products')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', result.productId!)
      .eq('is_active', true)
      .eq('commerce_archived', false)
      .maybeSingle(),
    db
      .from('commerce_stores')
      .select('slug')
      .eq('tenant_id', tenantId)
      .eq('is_open', true)
      .maybeSingle(),
  ])
  if (product.error) throw product.error
  if (store.error) throw store.error
  if (!product.data || !store.data) return fallback
  const p = product.data as VisionProduct
  const rawOrigin =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  const origin = rawOrigin && (/^https?:\/\//i.test(rawOrigin) ? rawOrigin : `https://${rawOrigin}`)
  const reply = buildProductReply(
    {
      ...p,
      images: [],
      store_slug: store.data.slug,
      sales_page_url: p.sales_page_url ?? null,
      variant_id: null,
      variant_label: null,
      description: Number(p.stock) > 0 ? 'สถานะ: มีสินค้า' : 'สถานะ: สินค้าหมด',
    },
    origin,
  )
  if (!reply) return fallback
  return {
    action: 'PRODUCT_SEARCH',
    reason: 'CATALOG_MATCH',
    productId: p.id,
    responseText: reply.body,
  }
}
