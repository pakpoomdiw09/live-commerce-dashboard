import { NextRequest, NextResponse } from 'next/server'
import { commerceScope, commerceResponse } from '@/lib/features/commerce/commerce-server'
import { CommerceError, isUuid, safeImage } from '@/lib/features/commerce/commerce-core'

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const scope = await commerceScope(req.nextUrl.searchParams.get('tenantId') ?? '', true, req)
    const { id } = await context.params
    if (!isUuid(id)) throw new CommerceError('รหัสสินค้าไม่ถูกต้อง')
    const [product, variants] = await Promise.all([
      scope.db
        .from('products')
        .select(
          'id,name,code,price,stock,description,image_url,is_active,commerce_images,commerce_category_id,commerce_cost,commerce_compare_price,commerce_featured,commerce_version',
        )
        .eq('id', id)
        .eq('tenant_id', scope.tenantId)
        .eq('commerce_archived', false)
        .maybeSingle(),
      scope.db
        .from('commerce_variants')
        .select('id,label,variant_code,price,stock')
        .eq('product_id', id)
        .eq('tenant_id', scope.tenantId)
        .eq('is_active', true)
        .order('label')
        .limit(41),
    ])
    if (product.error) throw product.error
    if (variants.error) throw variants.error
    if (!product.data) throw new CommerceError('ไม่พบสินค้านี้ในร้านค้า', 404)
    const row = product.data
    if (!Number.isSafeInteger(row.commerce_version) || row.commerce_version < 0)
      throw new CommerceError('ข้อมูลรุ่นสินค้าไม่พร้อม กรุณาโหลดใหม่', 409)
    if ((variants.data?.length ?? 0) > 40)
      throw new CommerceError(
        'สินค้านี้มีตัวเลือกเกิน 40 รายการ กรุณาจัดการที่หน้าร้านค้าก่อนแก้ไข',
        409,
      )
    // Reads must allow legacy blank SKUs so the seller can assign a code in this editor.
    const value = {
      code: row.code ?? '',
      name: row.name,
      description: row.description ?? '',
      is_active: row.is_active,
      price: Number(row.price),
      images: (Array.isArray(row.commerce_images) && row.commerce_images.length
        ? row.commerce_images
        : row.image_url
          ? [row.image_url]
          : []
      )
        .map(safeImage)
        .filter(Boolean),
      category_id: row.commerce_category_id,
      featured: row.commerce_featured,
      cost: row.commerce_cost == null ? null : Number(row.commerce_cost),
      compare_price: row.commerce_compare_price == null ? null : Number(row.commerce_compare_price),
      variants: (variants.data ?? []).map((variant) => ({
        ...variant,
        price: Number(variant.price),
      })),
    }
    return NextResponse.json(
      { product: { ...value, stock: row.stock, id: row.id, version: row.commerce_version } },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    return commerceResponse(error)
  }
}
