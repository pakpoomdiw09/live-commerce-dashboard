import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { LiveProductOption } from './comment-rules'

/** Both queries are bounded to the active shop and use the signed-in user's RLS. */
export async function liveProducts(db: SupabaseClient, tenantId: string) {
  const [products, variants] = await Promise.all([
    db
      .from('products')
      .select('id,name,code,price,stock')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .eq('commerce_archived', false)
      .order('name')
      .limit(1000),
    db
      .from('commerce_variants')
      .select('id,product_id,label,price,stock')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('label')
      .limit(5000),
  ])
  if (products.error || variants.error)
    return {
      products: [] as LiveProductOption[],
      error: 'โหลดสินค้าร้านค้าไม่ได้ กรุณาตรวจการติดตั้งระบบร้านค้าหรือลองใหม่',
    }
  return {
    products: (products.data ?? []).map((p) => ({
      ...p,
      variants: (variants.data ?? []).filter((v) => v.product_id === p.id),
    })) as LiveProductOption[],
    error: null,
  }
}
