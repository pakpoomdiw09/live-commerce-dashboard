import { NextRequest, NextResponse } from 'next/server'
import { canAccessTenant, getActor } from '@/lib/auth'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { liveProducts } from '@/lib/features/comments/live-products'
import { supabaseAdmin } from '@/lib/supabase/server'
import { UUID } from '@/lib/utils'

export async function GET(req: NextRequest) {
  if (!isFeatureEnabled('live_cf'))
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const tenantId = req.nextUrl.searchParams.get('tenantId')?.trim() ?? ''
  const actor = await getActor(req)
  if (
    !actor ||
    actor.kind !== 'user' ||
    !UUID.test(tenantId) ||
    !(await canAccessTenant(actor, tenantId, 'staff'))
  )
    return NextResponse.json({ error: 'ไม่มีสิทธิ์ดูสินค้าของร้านนี้' }, { status: 403 })

  const catalog = await liveProducts(supabaseAdmin(), tenantId)
  if (catalog.error)
    return NextResponse.json(
      { error: catalog.error, products: [] },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    )
  return NextResponse.json(
    { products: catalog.products, fallback: catalog.fallback },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
