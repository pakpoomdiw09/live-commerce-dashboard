import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import { getActor, canAccessTenant } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import { hasFeature } from '@/lib/feature-access'
import {
  CUSTOMER_COLUMNS,
  CUSTOMER_COLUMNS_WITHOUT_AVATAR,
  isMissingCustomerAvatarColumn,
  type CustomerRow,
} from '@/lib/types'
import { UUID } from '@/lib/utils'
import { logInboxError } from '@/lib/features/inbox/inbox-diagnostics'

export class InboxError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = 'INBOX_ERROR',
  ) {
    super(message)
  }
}
export function inboxError(error: unknown) {
  if (!(error instanceof InboxError)) {
    logInboxError('request', error)
    try {
      checkRpc(error as { code?: string })
    } catch (mapped) {
      if (mapped instanceof InboxError) error = mapped
    }
  }
  if (error instanceof InboxError)
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
  return NextResponse.json(
    { error: 'ไม่สามารถดำเนินการได้ กรุณาลองอีกครั้ง', code: 'INBOX_ERROR' },
    { status: 503 },
  )
}
export async function inboxTenant(req: NextRequest, tenantId: string) {
  const actor = await getActor(req)
  if (!actor || actor.kind !== 'user') throw new InboxError('กรุณาเข้าสู่ระบบ', 401)
  if (!UUID.test(tenantId) || !(await canAccessTenant(actor, tenantId)))
    throw new InboxError('ไม่พบร้านค้า', 404)
  const db = supabaseAdmin({ timeoutMs: 10000 })
  if (!(await hasFeature(db, tenantId, 'customer_management')))
    throw new InboxError('ฟีเจอร์นี้สำหรับสมาชิกที่อัปเกรดแพ็กเกจ', 403, 'FEATURE_LOCKED')
  return { db, actor, tenantId }
}
export async function inboxCustomer(
  req: NextRequest,
  id: string,
  options: { actionOnly?: boolean } = {},
) {
  const actor = await getActor(req)
  if (!actor || actor.kind !== 'user') throw new InboxError('กรุณาเข้าสู่ระบบ', 401)
  if (!UUID.test(id)) throw new InboxError('รหัสลูกค้าไม่ถูกต้อง')
  const db = supabaseAdmin({ timeoutMs: 10000 })
  const scopeQuery = db.from('customers')
  const scope = options.actionOnly
    ? await scopeQuery
        .select(
          'id,tenant_id,assigned_user_id,bot_enabled,conversation_status,conversation_version,inbound_seq',
        )
        .eq('id', id)
        .maybeSingle()
    : await scopeQuery.select('tenant_id').eq('id', id).maybeSingle()
  if (scope.error) throw scope.error
  if (!scope.data?.tenant_id || !(await canAccessTenant(actor, scope.data.tenant_id)))
    throw new InboxError('ไม่พบลูกค้า', 404)
  if (!(await hasFeature(db, scope.data.tenant_id, 'customer_management')))
    throw new InboxError('ฟีเจอร์นี้สำหรับสมาชิกที่อัปเกรดแพ็กเกจ', 403, 'FEATURE_LOCKED')
  if (options.actionOnly)
    return { db, actor, customer: scope.data as CustomerRow, tenantId: scope.data.tenant_id }
  let result = await db
    .from('customers')
    .select(CUSTOMER_COLUMNS)
    .eq('id', id)
    .eq('tenant_id', scope.data.tenant_id)
    .maybeSingle()
  if (isMissingCustomerAvatarColumn(result.error))
    result = await db
      .from('customers')
      .select(CUSTOMER_COLUMNS_WITHOUT_AVATAR)
      .eq('id', id)
      .maybeSingle()
  const customer = result.data as CustomerRow | null
  if (result.error) throw result.error
  if (!customer?.tenant_id || !(await canAccessTenant(actor, customer.tenant_id)))
    throw new InboxError('ไม่พบลูกค้า', 404)
  if (!(await hasFeature(db, customer.tenant_id, 'customer_management')))
    throw new InboxError('ฟีเจอร์นี้สำหรับสมาชิกที่อัปเกรดแพ็กเกจ', 403, 'FEATURE_LOCKED')
  return { db, actor, customer, tenantId: customer.tenant_id }
}
export function checkRpc(error: { code?: string } | null) {
  if (!error) return
  if (error.code === '57014')
    throw new InboxError('ฐานข้อมูลตอบช้า กรุณาตรวจสถานะแชทก่อนลองใหม่', 503, 'DATABASE_TIMEOUT')
  if (['PGRST202', 'PGRST204', '42883', '42703', '42P01'].includes(error.code ?? ''))
    throw new InboxError(
      'ระบบจัดการแชทยังไม่พร้อม กรุณาติดต่อผู้ดูแล',
      503,
      'INBOX_SCHEMA_UNAVAILABLE',
    )
  if (error.code === 'P0424')
    throw new InboxError('หมดเวลาตอบกลับ รอลูกค้าส่งข้อความมาใหม่', 409, 'MESSAGING_WINDOW_CLOSED')
  if (error.code === 'P0429')
    throw new InboxError('ทำรายการถี่เกินไป กรุณารอสักครู่', 429, 'RATE_LIMITED')
  if (['40001', '55P03'].includes(error.code ?? ''))
    throw new InboxError(
      'แชทมีการเปลี่ยนแปลงหรือกำลังส่งข้อความ กรุณาลองอีกครั้ง',
      409,
      'CONVERSATION_CONFLICT',
    )
  if (error.code === '42501')
    throw new InboxError('ไม่มีสิทธิ์ดำเนินการกับแชทนี้', 403, 'FEATURE_LOCKED')
  if (error.code === '22023')
    throw new InboxError('ผู้รับโอนหรือการตั้งค่าระบบอัตโนมัติไม่พร้อมใช้งาน')
  throw error
}
