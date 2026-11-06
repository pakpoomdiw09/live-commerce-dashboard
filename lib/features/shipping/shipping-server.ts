import 'server-only'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { canAccessTenant, getActor } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import { UUID } from '@/lib/utils'
import type { ShippingPrintBatch } from './shipping-types'

export class ShippingError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}
export const shippingReply = (value: unknown, status = 200) =>
  NextResponse.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } })
export async function shippingScope(
  req: NextRequest | undefined,
  tenantId: unknown,
  write = false,
  owner = false,
) {
  if (write && (!req || req.headers.get('origin') !== req.nextUrl.origin))
    throw new ShippingError('คำขอไม่ถูกต้อง', 403)
  const actor = await getActor(req)
  if (
    !actor ||
    actor.kind !== 'user' ||
    typeof tenantId !== 'string' ||
    !UUID.test(tenantId) ||
    !(await canAccessTenant(actor, tenantId, owner ? 'owner' : 'staff'))
  )
    throw new ShippingError('ไม่มีสิทธิ์จัดการรายการจัดส่งของร้านนี้', 403)
  return { actor, db: supabaseAdmin({ timeoutMs: 15000 }), tenantId }
}
export function shippingFailure(error: unknown) {
  if (error instanceof ShippingError) return shippingReply({ error: error.message }, error.status)
  if (error instanceof Error && error.message === 'BEEMOVE_CONNECTION_TEST_UNAVAILABLE')
    return shippingReply(
      {
        error:
          'ยังไม่มี API ตรวจสอบการเชื่อมต่อ Bee Move ที่ยืนยันแล้ว กรุณาตรวจ API contract กับผู้ให้บริการก่อนใช้งานจริง',
      },
      503,
    )
  if (error instanceof SyntaxError) return shippingReply({ error: 'ข้อมูลคำขอไม่ถูกต้อง' }, 400)
  const issue = error as {
    code?: string
    message?: string
    details?: string
    hint?: string
  }
  console.error('[shipping/api]', {
    code: issue?.code || 'SHIPPING_FAILED',
    message: issue?.message || null,
    details: issue?.details || null,
    hint: issue?.hint || null,
  })
  if (issue?.code === '40001')
    return shippingReply(
      {
        error: 'ยอด ที่อยู่ หรือสถานะเปลี่ยนแล้ว กรุณาโหลดรายการล่าสุดและเตรียมฉลากใหม่',
        reload: true,
      },
      409,
    )
  if (issue?.code === '42501' || issue?.code === 'P0002')
    return shippingReply({ error: 'ไม่พบรายการจัดส่งของร้านนี้' }, 404)
  if (issue?.message?.includes('SENDER_REQUIRED'))
    return shippingReply({ error: 'กรุณาตั้งค่าชื่อ เบอร์โทร และที่อยู่ผู้ส่งก่อนพิมพ์' }, 400)
  if (issue?.code === 'P0001' || ['23514', '22P02'].includes(issue?.code || ''))
    return shippingReply(
      {
        error:
          'กรุณาตรวจที่อยู่ที่ยืนยันแล้ว ยอดชำระ และเลขพัสดุก่อนดำเนินการ รายการที่ส่งแล้วแก้ไขหรือลบไม่ได้',
      },
      400,
    )
  return shippingReply(
    { error: 'โหลดหรือบันทึกไม่สำเร็จ กรุณาตรวจการติดตั้ง shipping-fulfillment.sql' },
    503,
  )
}
export async function loadShippingBatch(
  batchId: string,
  req?: NextRequest,
): Promise<ShippingPrintBatch> {
  if (!UUID.test(batchId)) throw new ShippingError('ไม่พบชุดใบปะหน้า', 404)
  const actor = await getActor(req)
  if (!actor || actor.kind !== 'user') throw new ShippingError('กรุณาเข้าสู่ระบบ', 401)
  const db = supabaseAdmin({ timeoutMs: 15000 })
  const scope = await db
    .from('shipping_print_batches')
    .select('tenant_id')
    .eq('id', batchId)
    .maybeSingle()
  if (scope.error) throw scope.error
  if (!scope.data || !(await canAccessTenant(actor, scope.data.tenant_id)))
    throw new ShippingError('ไม่พบชุดใบปะหน้า', 404)
  const batch = await db
    .from('shipping_print_batches')
    .select('*')
    .eq('id', batchId)
    .eq('tenant_id', scope.data.tenant_id)
    .single()
  if (batch.error) throw batch.error
  return batch.data as ShippingPrintBatch
}
