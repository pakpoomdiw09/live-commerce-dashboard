import {NextRequest,NextResponse} from 'next/server'
import {receivingCodeTenant,createReceivingQr,decodeReceivingQr} from '@/lib/features/payments/payment-codes-server'
import {codeMatchesAccount,receivingAmount,type ReceivingAccount} from '@/lib/features/payments/payment-codes-core'
import {InboxError,inboxError,checkRpc} from '@/lib/features/inbox/inbox-server'
import {UUID} from '@/lib/utils'
export const runtime='nodejs'
const tenantOf=(req:NextRequest)=>req.nextUrl.searchParams.get('tenantId')??''
function sameOrigin(req:NextRequest){const origin=req.headers.get('origin');if(origin&&origin!==req.nextUrl.origin||req.headers.get('sec-fetch-site')==='cross-site')throw new InboxError('ไม่อนุญาตคำขอจากเว็บไซต์อื่น',403)}
function checkCodeRpc(error:{code?:string}|null){
 if(error?.code==='40001')throw new InboxError('บัญชีรับเงินหรือออเดอร์เปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่',409,'RECEIVING_CONFLICT')
 if(error?.code==='22023')throw new InboxError('ข้อมูล QR หรือคีย์คำขอไม่ตรงกับรายการเดิม กรุณาตรวจข้อมูลอีกครั้ง')
 if(error?.code==='P0002')throw new InboxError('ไม่พบ QR ในร้านนี้',404)
 checkRpc(error)
}
export async function GET(req:NextRequest){try{
 const {db,tenantId}=await receivingCodeTenant(req,tenantOf(req))
 const [accounts,codes,audit,orders]=await Promise.all([
  db.from('bank_accounts').select('id,bank_code,account_name,account_number,is_active,is_primary').eq('tenant_id',tenantId).order('created_at'),
  db.from('payment_receiving_codes').select('id,account_id,label,payload,recipient_snapshot,amount_satang,order_id,source,is_active,created_at').eq('tenant_id',tenantId).order('created_at',{ascending:false}).limit(100),
  db.from('payment_receiving_audit').select('id,code_id,action,created_at').eq('tenant_id',tenantId).order('created_at',{ascending:false}).limit(30),
  db.from('orders').select('id,product_name,amount,status').eq('tenant_id',tenantId).eq('status','pending_payment').order('created_at',{ascending:false}).limit(100),
 ])
 for(const result of [accounts,codes,audit,orders])if(result.error)throw result.error
 const orderIds=[...new Set((codes.data??[]).flatMap(code=>code.order_id?[code.order_id]:[]))]
 const linked=orderIds.length?await db.from('orders').select('id,amount,status').eq('tenant_id',tenantId).in('id',orderIds):{data:[],error:null}
 if(linked.error)throw linked.error
 return NextResponse.json({accounts:accounts.data,codes:(codes.data??[]).map(({recipient_snapshot,...code})=>{
  const account=accounts.data?.find(account=>account.id===code.account_id),order=linked.data?.find(order=>order.id===code.order_id)
  let payloadMatches=false
  if(account)try{payloadMatches=codeMatchesAccount(code.payload,account).amountSatang===(code.amount_satang===null?null:Number(code.amount_satang))}catch{}
  const available=payloadMatches&&code.is_active&&!!account?.is_active&&account.bank_code==='PROMPTPAY'&&account.account_number===recipient_snapshot&&(!code.order_id||!!order&&order.status==='pending_payment'&&receivingAmount(String(order.amount))===Number(code.amount_satang))
  return {...code,payload:available?code.payload:null,available}
 }),orders:orders.data,audit:audit.data,capabilities:{promptpay:true,bankQr:false,barcode:false}},{headers:{'Cache-Control':'private, no-store'}})
}catch(error){return inboxError(error)}}
export async function POST(req:NextRequest){try{
 const {db,tenantId,actor}=await receivingCodeTenant(req,tenantOf(req));sameOrigin(req)
 if(Number(req.headers.get('content-length')??0)>6*1024*1024)throw new InboxError('ไฟล์ต้องไม่เกิน 5 MB',413)
 const multipart=req.headers.get('content-type')?.startsWith('multipart/form-data')
 const form=multipart?await req.formData():null
 const input=form?Object.fromEntries(form.entries()):await req.json().catch(()=>null)
 if(!input||!UUID.test(input.accountId??'')||!UUID.test(input.requestId??'')||typeof input.label!=='string'||!input.label.trim()||input.label.length>100||!['generate','import'].includes(input.mode)||input.confirmed!==true&&input.confirmed!=='true')throw new InboxError('กรุณาเลือกบัญชี ใส่ชื่อ QR และยืนยันข้อมูลผู้รับ')
 const account=await db.from('bank_accounts').select('id,bank_code,account_name,account_number,is_active').eq('id',input.accountId).eq('tenant_id',tenantId).maybeSingle()
 if(account.error)throw account.error
 if(!account.data)throw new InboxError('ไม่พบบัญชีรับเงินในร้านนี้',404)
 let amount:number|null
 try{amount=receivingAmount(input.amount)}catch(error){throw new InboxError(error instanceof Error?error.message:'ยอดเงินไม่ถูกต้อง')}
 const orderId=typeof input.orderId==='string'&&input.orderId?input.orderId:null
 if(orderId){
  if(!UUID.test(orderId))throw new InboxError('รหัสออเดอร์ไม่ถูกต้อง')
  const order=await db.from('orders').select('id,amount,status').eq('id',orderId).eq('tenant_id',tenantId).maybeSingle()
  if(order.error)throw order.error
  if(!order.data||order.data.status!=='pending_payment')throw new InboxError('ออเดอร์นี้ไม่ได้รอชำระเงินหรือไม่อยู่ในร้านนี้',409)
  amount=receivingAmount(String(order.data.amount)) // DB total wins over any browser amount.
  if(amount===null)throw new InboxError('ยอดออเดอร์ไม่ถูกต้อง',409)
 }
 let payload:string
 try{
  if(input.mode==='import'){
   const file=form?.get('file')
   if(!(file instanceof File))throw new InboxError('กรุณาอัปโหลดรูป QR')
   payload=await decodeReceivingQr(file)
   const decoded=codeMatchesAccount(payload,account.data as ReceivingAccount)
   if(orderId&&decoded.amountSatang!==amount)throw new InboxError('ยอดใน QR ที่อัปโหลดไม่ตรงกับยอดออเดอร์')
   if(!orderId&&amount!==null&&decoded.amountSatang!==amount)throw new InboxError('ยอดในรูป QR ไม่ตรงกับยอดที่กรอก')
   amount=decoded.amountSatang
  }else payload=createReceivingQr(account.data as ReceivingAccount,amount)
 }catch(error){throw new InboxError(error instanceof Error?error.message:'สร้างหรืออ่าน QR ไม่สำเร็จ')}
 const result=await db.rpc('save_payment_receiving_code',{p_tenant:tenantId,p_actor:actor.id,p_key:input.requestId,p_account:account.data.id,p_label:input.label.trim(),p_payload:payload,p_recipient:account.data.account_number,p_amount:amount,p_order:orderId,p_source:input.mode==='import'?'imported':'generated'})
 checkCodeRpc(result.error)
 return NextResponse.json({ok:true,id:result.data,paymentVerified:false})
}catch(error){return inboxError(error)}}
export async function PATCH(req:NextRequest){try{
 const {db,tenantId,actor}=await receivingCodeTenant(req,tenantOf(req));sameOrigin(req)
 const input=await req.json().catch(()=>null)
 if(!input||!UUID.test(input.id??'')||typeof input.isActive!=='boolean')throw new InboxError('ข้อมูลสถานะ QR ไม่ถูกต้อง')
 const result=await db.rpc('set_payment_receiving_code_active',{p_tenant:tenantId,p_actor:actor.id,p_id:input.id,p_active:input.isActive})
 checkCodeRpc(result.error)
 return NextResponse.json({ok:true})
}catch(error){return inboxError(error)}}
