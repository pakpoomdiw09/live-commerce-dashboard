import { NextRequest,NextResponse } from 'next/server'
import { paymentProTenant } from '@/lib/features/payments/payment-pro-server'
import { inboxError,InboxError } from '@/lib/features/inbox/inbox-server'
import { UUID } from '@/lib/utils'
export const runtime='nodejs'
export const maxDuration=60
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){
  try{
    const {db,actor,tenantId}=await paymentProTenant(req,req.nextUrl.searchParams.get('tenantId')??'',true)
    const {id}=await params
    if(!UUID.test(id))throw new InboxError('รหัสรายการไม่ถูกต้อง')
    let body
    try { body=await req.json() } catch { throw new InboxError('ข้อมูลต้องเป็น JSON ที่ถูกต้อง') }
    if(!body||typeof body!=='object'||Array.isArray(body))throw new InboxError('ข้อมูลรายการไม่ถูกต้อง')
    if(!['approve','reject','cancel','retry'].includes(body.action)||typeof body.reason!=='string'||body.reason.trim().length<5||body.reason.length>1000)throw new InboxError('เลือกการดำเนินการและระบุเหตุผล 5–1,000 ตัวอักษร')
    const result=await db.rpc('act_payment_pro',{p_attempt:id,p_tenant:tenantId,p_actor:actor.id,p_action:body.action,p_reason:body.reason.trim()})
    if(result.error?.code==='42501')throw new InboxError('เฉพาะเจ้าของร้านเท่านั้น',403)
    if(result.error?.code==='P0002')throw new InboxError('ไม่พบรายการ',404)
    if(result.error)throw result.error
    if(result.data!==true)throw new InboxError('ไม่สามารถยืนยันได้ หลักฐานจาก Provider หรือออเดอร์ยังไม่ผ่านเงื่อนไข',409,'PAYMENT_REVIEW_REQUIRED')
    if(body.action==='retry'){
      const {resumePaymentPro}=await import('@/lib/features/payments/payment-pro')
      await resumePaymentPro(db,id,tenantId)
    }
    return NextResponse.json({ok:true})
  }catch(error){return inboxError(error)}
}
