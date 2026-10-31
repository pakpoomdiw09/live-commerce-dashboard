import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { LiveProductOption } from './comment-rules'

/**
 * Load the active tenant's real product catalog. Tenants created before commerce-v2
 * may not have store metadata, commerce_archived or variants yet, so the legacy
 * products table is a supported fallback instead of an empty/error state.
 */
export async function liveProducts(db: SupabaseClient, tenantId: string) {
  const [commerceProducts, variants, store] = await Promise.all([
    db
      .from('products')
      .select('id,name,code,price,stock,image_url,description')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .eq('commerce_archived', false)
      .order('name')
      .limit(1000),
    db
      .from('commerce_variants')
      .select('id,product_id,label,variant_code,price,stock')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('label')
      .limit(5000),
    db
      .from('commerce_stores')
      .select('slug')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ])

  const fallbackProducts = commerceProducts.error
    ? await db
        .from('products')
        .select('id,name,code,price,stock,image_url,description')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('name')
        .limit(1000)
    : null
  const productRows = commerceProducts.data ?? fallbackProducts?.data ?? []
  if (commerceProducts.error && fallbackProducts?.error)
    return {
      products: [] as LiveProductOption[],
      error: 'โหลดรายการสินค้าไม่สำเร็จ กรุณาตรวจสอบสิทธิ์ของร้านค้าแล้วลองใหม่',
      fallback: true,
    }

  const storeSlug = store?.data?.slug ?? null

  return {
    products: productRows.map((product) => ({
      ...product,
      description: (product as { description?: string | null }).description ?? null,
      sales_page_url: storeSlug ? `/s/${storeSlug}` : null,
      variants: variants.error
        ? []
        : (variants.data ?? []).filter((variant) => variant.product_id === product.id),
    })) as LiveProductOption[],
    error: null,
    fallback: !!commerceProducts.error || !!variants.error,
  }
}
