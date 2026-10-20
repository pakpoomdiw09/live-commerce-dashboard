import {NextRequest,NextResponse} from 'next/server'
import {slipBankTenant,bankQr} from '@/lib/features/slips/slip-bank-server'
import {bankAccountError} from '@/lib/features/banking/bank-accounts'
import {InboxError,inboxError,checkRpc} from '@/lib/features/inbox/inbox-server'
import {UUID} from '@/lib/utils'
import {isSupportedBank,UNSUPPORTED_BANK_MESSAGE} from '@/lib/features/banking/banks'
export async function GET(req:NextRequest){try{
 const {db,tenantId,owner}=await slipBankTenant(req,req.nextUrl.searchParams.get('tenantId')??'')
 const result=await db.from('bank_accounts').select('id,tenant_id,bank_code,account_name,account_number,is_active,is_primary,created_at').eq('tenant_id',tenantId).order('created_at').order('id')
 if(result.error)throw new InboxError('โหลดบัญชีไม่ได้ กรุณาตรวจสอบ supabase/slip-bank-controls.sql',503)
 const audit=owner?await db.from('bank_account_audit').select('id,action,last_four,created_at').eq('tenant_id',tenantId).order('created_at',{ascending:false}).limit(30):{data:[],error:null}
 if(audit.error)throw new InboxError('โหลดประวัติบัญชีไม่ได้ กรุณาตรวจสอบ supabase/slip-bank-controls.sql',503)
 return NextResponse.json({accounts:(result.data??[]).map(a=>({...a,account_number:owner?a.account_number:'••••'+a.account_number.slice(-4),qrPayload:owner?bankQr(a):null})),audit:audit.data,canManage:owner},{headers:{'Cache-Control':'private, no-store'}})
}catch(error){return inboxError(error)}}
export async function POST(req:NextRequest){try{
 const {db,tenantId,actor}=await slipBankTenant(req,req.nextUrl.searchParams.get('tenantId')??'',true)
 const input=await req.json().catch(()=>null)
 if(!input||!['save','primary','toggle','delete'].includes(input.action)||(input.id&&!UUID.test(input.id)))throw new InboxError('ข้อมูลบัญชีไม่ถูกต้อง')
 if(input.action!=='save'&&!UUID.test(input.id??''))throw new InboxError('กรุณาระบุบัญชีที่ต้องการเปลี่ยน')
 if(input.confirmed!==true)throw new InboxError('กรุณายืนยันการเปลี่ยนบัญชีรับเงิน',409,'CONFIRMATION_REQUIRED')
 let values={}
 if(input.action==='save'){
  if(typeof input.bank_code!=='string'||typeof input.account_name!=='string'||typeof input.account_number!=='string'||typeof input.is_active!=='boolean')throw new InboxError('ข้อมูลบัญชีไม่ถูกต้อง')
  const problem=bankAccountError(input.bank_code,input.account_name,input.account_number);if(problem)throw new InboxError(problem)
  values={bank_code:input.bank_code,account_name:input.account_name.trim(),account_number:input.account_number.replace(/[\s-]/g,''),is_active:input.is_active}
 }
 if(input.action==='primary'||input.action==='toggle'){
  const {data:account,error}=await db.from('bank_accounts').select('bank_code,is_active').eq('tenant_id',tenantId).eq('id',input.id).maybeSingle()
  if(error)throw new InboxError('อ่านบัญชีรับเงินไม่ได้',503)
  if(!account)throw new InboxError('ไม่พบบัญชีในร้านนี้',404)
  if((input.action==='primary'||!account.is_active)&&!isSupportedBank(account.bank_code))throw new InboxError(UNSUPPORTED_BANK_MESSAGE,400,'UNSUPPORTED_BANK')
 }
 const result=await db.rpc('manage_slip_bank_account',{p_tenant:tenantId,p_actor:actor.id,p_action:input.action,p_id:input.id??null,p_data:values,p_confirmed:true})
 if(result.error?.code==='23505')throw new InboxError('บัญชีนี้มีอยู่ในร้านแล้ว',409)
 if(result.error?.code==='23503')throw new InboxError('บัญชีนี้มี QR หรือข้อมูลรับเงินผูกอยู่ กรุณาปิดใช้งานบัญชีแทนการลบ',409)
 if(result.error?.code==='23514')throw new InboxError('ข้อมูลบัญชีไม่ผ่านข้อกำหนด กรุณาตรวจสอบข้อมูลและติดตั้ง supabase/bank-registry.sql สำหรับธนาคารที่เพิ่มใหม่',409)
 if(result.error?.code==='P0002')throw new InboxError('ไม่พบบัญชีในร้านนี้',404)
 if(result.error?.code==='22023')throw new InboxError('กรุณายืนยันและเลือกบัญชีที่เปิดใช้งาน')
 checkRpc(result.error)
 return NextResponse.json({ok:true})
}catch(error){return inboxError(error)}}
