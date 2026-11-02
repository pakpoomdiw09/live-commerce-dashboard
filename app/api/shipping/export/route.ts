import { NextRequest, NextResponse } from 'next/server'
import {
  shippingScope,
  shippingFailure,
  ShippingError,
} from '@/lib/features/shipping/shipping-server'
import { shippingCsv } from '@/lib/features/shipping/shipping-csv'
import type { ShippingShipment } from '@/lib/features/shipping/shipping-types'
import { UUID } from '@/lib/utils'

export async function POST(req: NextRequest) {
  try {
    const input = await req.json()
    const { db, actor, tenantId } = await shippingScope(req, input?.tenantId, true)
    if (
      !UUID.test(input?.requestId ?? '') ||
      !Array.isArray(input?.ids) ||
      !input.ids.length ||
      input.ids.length > 100 ||
      input.ids.some((id: unknown) => typeof id !== 'string' || !UUID.test(id)) ||
      new Set(input.ids).size !== input.ids.length
    )
      throw new ShippingError('กรุณาเลือก 1–100 รายการที่พร้อมส่ง')
    const rate = await db.rpc('commerce_rate_limit', {
      p_bucket: `shipping-export:${actor.id}:${tenantId}`,
      p_max: 20,
    })
    if (rate.error) throw rate.error
    if (!rate.data) throw new ShippingError('ดาวน์โหลดบ่อยเกินไป กรุณารอหนึ่งนาที', 429)
    const prepared = await db.rpc('manage_shipping', {
      p_tenant: tenantId,
      p_actor: actor.id,
      p_request: input.requestId,
      p_input: { action: 'export', ids: [...input.ids].sort() },
    })
    if (prepared.error) throw prepared.error
    const batch = await db
      .from('shipping_print_batches')
      .select('shipments')
      .eq('tenant_id', tenantId)
      .eq('id', prepared.data.batchId)
      .single()
    if (batch.error) throw batch.error
    return new NextResponse(shippingCsv(batch.data.shipments as ShippingShipment[]), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="snapbot-shipping.csv"',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    return shippingFailure(error)
  }
}
