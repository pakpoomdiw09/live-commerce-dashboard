import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import { getActor, canAccessTenant } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import { hasFeature } from '@/lib/feature-access'
import { CUSTOMER_COLUMNS, type CustomerRow } from '@/lib/types'
import { UUID } from '@/lib/utils'

export class InboxError extends Error {
  constructor(message: string, readonly status=400, readonly code='INBOX_ERROR') { super(message) }
}
export function inboxError(error: unknown) {
  if (error instanceof InboxError) return NextResponse.json({error:error.message,code:error.code},{status:error.status})
  console.error('[inbox] request failed', {code:(error as {code?:string})?.code ?? 'unknown'})
  return NextResponse.json({error:'ไม่สามารถดำเนินการได้ กรุณาลองอีกครั้ง',code:'INBOX_ERROR'},{status:503})
}
export async function inboxTenant(req: NextRequest,tenantId: string) {
  const actor=await getActor(req)
  if (!actor || actor.kind!=='user') throw new InboxError('กรุณาเข้าสู่ระบบ',401)
  if (!UUID.test(tenantId) || !(await canAccessTenant(actor,tenantId))) throw new InboxError('ไม่พบร้านค้า',404)
  const db=supabaseAdmin()
  if (!(await hasFeature(db,tenantId,'customer_management'))) throw new InboxError('ฟีเจอร์นี้สำหรับสมาชิกที่อัปเกรดแพ็กเกจ',403,'FEATURE_LOCKED')
  return {db,actor,tenantId}
}
export async function inboxCustomer(req: NextRequest,id: string) {
  const actor=await getActor(req)
  if (!actor || actor.kind!=='user') throw new InboxError('กรุณาเข้าสู่ระบบ',401)
  if (!UUID.test(id)) throw new InboxError('รหัสลูกค้าไม่ถูกต้อง')
  const db=supabaseAdmin()
  const scope=await db.from('customers').select('tenant_id').eq('id',id).maybeSingle()
  if(scope.error)throw scope.error
  if(!scope.data?.tenant_id||!(await canAccessTenant(actor,scope.data.tenant_id)))throw new InboxError('ไม่พบลูกค้า',404)
  if(!(await hasFeature(db,scope.data.tenant_id,'customer_management')))throw new InboxError('ฟีเจอร์นี้สำหรับสมาชิกที่อัปเกรดแพ็กเกจ',403,'FEATURE_LOCKED')
  const {data,error}=await db.from('customers').select(CUSTOMER_COLUMNS).eq('id',id).maybeSingle()
  const customer=data as CustomerRow|null
  if(error) throw error
  if(!customer?.tenant_id || !(await canAccessTenant(actor,customer.tenant_id))) throw new InboxError('ไม่พบลูกค้า',404)
  if(!(await hasFeature(db,customer.tenant_id,'customer_management'))) throw new InboxError('ฟีเจอร์นี้สำหรับสมาชิกที่อัปเกรดแพ็กเกจ',403,'FEATURE_LOCKED')
  return {db,actor,customer,tenantId:customer.tenant_id}
}
export function checkRpc(error: {code?:string}|null) {
  if(!error)return
  if(error.code==='P0429')throw new InboxError('ทำรายการถี่เกินไป กรุณารอสักครู่',429,'RATE_LIMITED')
  if(['40001','55P03'].includes(error.code??''))throw new InboxError('แชทมีการเปลี่ยนแปลงหรือกำลังส่งข้อความ กรุณาลองอีกครั้ง',409,'CONVERSATION_CONFLICT')
  if(error.code==='42501')throw new InboxError('ไม่มีสิทธิ์ดำเนินการกับแชทนี้',403,'FEATURE_LOCKED')
  if(error.code==='22023')throw new InboxError('ผู้รับโอนหรือการตั้งค่าบอทไม่พร้อมใช้งาน')
  throw error
}
