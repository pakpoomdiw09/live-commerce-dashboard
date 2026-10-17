import {inboxWindow} from '@/lib/inbox-v2'
import {NextRequest,NextResponse} from 'next/server'
import {inboxCustomer,inboxError,InboxError,checkRpc} from '@/lib/inbox-server'
import {pageTokenFor,sendMessageWithReceipt,SendApiError,isWindowOrTagError} from '@/lib/facebook'
import {UUID} from '@/lib/utils'
export const runtime='nodejs'

/** Claim a durable client ID before sending. Ambiguous network results must never be retried automatically. */
export async function POST(req:NextRequest){
 let lease:string|null=null
 let scope:Awaited<ReturnType<typeof inboxCustomer>>|null=null
 try{
  const input=await req.json().catch(()=>null)
  if(!UUID.test(input?.clientId??'')||!UUID.test(input?.customerId??''))throw new InboxError('รหัสข้อความไม่ถูกต้อง')
  scope=await inboxCustomer(req,input.customerId)
  const {db,actor,customer,tenantId}=scope
  const text=typeof input.text==='string'?input.text.trim():''
  if((!text&&!input.mediaId)||text.length>2000||(text&&input.mediaId))throw new InboxError('ส่งข้อความหรือไฟล์แนบครั้งละหนึ่งรายการ (ข้อความไม่เกิน 2,000 ตัวอักษร)')
  const externalId=`agent:${input.clientId}`
  const previous=await db.from('messages').select('id,delivery_status').eq('customer_id',customer.id).eq('external_id',externalId).maybeSingle()
  if(previous.error)throw previous.error
  if(previous.data){
   if(['sent','delivered','read'].includes(previous.data.delivery_status))return NextResponse.json({ok:true,...previous.data,duplicate:true})
   throw new InboxError('คำขอนี้ถูกประมวลผลแล้ว กรุณาตรวจสถานะข้อความในแชทก่อนส่งใหม่',409,'SEND_ALREADY_CLAIMED')
  }
  const [page,last]=await Promise.all([
   db.from('tenants').select('page_id,page_access_token').eq('id',tenantId).single(),
   db.from('messages').select('created_at').eq('customer_id',customer.id).eq('sender','customer').order('created_at',{ascending:false}).limit(1).maybeSingle(),
  ])
  if(page.error||last.error)throw page.error||last.error
  const token=pageTokenFor(page.data)
  if(!token)throw new InboxError("เพจนี้ยังไม่มี สิทธิ์เชื่อมต่อเพจ",409)
  if(!inboxWindow(last.data?.created_at).allowed)throw new InboxError('ส่งไม่ได้: เกิน 24 ชั่วโมงนับจากข้อความล่าสุดของลูกค้า',409,'MESSAGING_WINDOW_CLOSED')
  await (await import('@/lib/inbox-policy-server')).assertInboxPolicy(db,tenantId,customer.id,page.data.page_id,token)
  let message:object={text},attachments:object[]=[]
  if(input.mediaId){
   if(!UUID.test(input.mediaId))throw new InboxError('ไฟล์แนบไม่ถูกต้อง')
   const media=await db.from('inbox_media').select('id,path,kind').eq('id',input.mediaId).eq('tenant_id',tenantId).eq('uploaded_by',actor.id).maybeSingle()
   if(media.error)throw media.error
   if(!media.data)throw new InboxError('ไม่พบไฟล์แนบ',404)
   const signed=await db.storage.from('inbox-media').createSignedUrl(media.data.path,3600)
   if(signed.error)throw signed.error
   message={attachment:{type:media.data.kind,payload:{url:signed.data.signedUrl,is_reusable:false}}}
   attachments=[{type:media.data.kind,payload:{url:`/api/inbox/media/${media.data.id}`}}]
  }
  const started=process.env.SNAPBOT_SAFETY_ENABLED==='true'
   ? await db.rpc('claim_and_start_inbox_reply',{p_customer:customer.id,p_actor:actor.id,p_version:customer.conversation_version??0})
   : await db.rpc('start_inbox_delivery',{p_customer:customer.id,p_actor:actor.id})
  checkRpc(started.error);lease=started.data
  const inserted=await db.from('messages').insert({customer_id:customer.id,external_id:externalId,sender:'agent',body:text||null,attachments,delivery_status:'pending'}).select('id').single()
  if(inserted.error?.code==='23505')throw new InboxError('ข้อความนี้กำลังถูกส่งแล้ว',409,'SEND_ALREADY_CLAIMED')
  if(inserted.error)throw inserted.error
  const id=inserted.data.id
  try{
   const providerId=await sendMessageWithReceipt(token,customer.platform_user_id,message)
   const saved=await db.from('messages').update({provider_message_id:providerId,delivery_status:'sent'}).eq('id',id)
   if(saved.error){console.error('[inbox/send] receipt persistence failed',{id,code:saved.error.code});throw new Error('Receipt persistence failed')}
   return NextResponse.json({ok:true,id,delivery_status:'sent'})
  }catch(error){
   const rejected=error instanceof SendApiError && error.status<500
   await db.from('messages').update({delivery_status:rejected?'failed':'unknown'}).eq('id',id)
   console.error('[inbox/send] provider failure',{id,code:error instanceof SendApiError?error.code:'unknown'})
   throw new InboxError(isWindowOrTagError(error)?"เฟซบุ๊ก ปฏิเสธ: อยู่นอกช่วงเวลาที่อนุญาต":rejected?"เฟซบุ๊ก ปฏิเสธการส่งข้อความ กรุณาตรวจสิทธิ์เพจ":"ยังยืนยันผลการส่งไม่ได้ กรุณาตรวจข้อความใน ช่องทางแชทของเพจ ก่อนส่งใหม่",502,rejected?'SEND_REJECTED':'SEND_UNKNOWN')
  }
 }catch(error){return inboxError(error)}finally{
  if(scope&&lease){const result=await scope.db.rpc('end_inbox_delivery',{p_customer:scope.customer.id,p_lease:lease});if(result.error)console.error('[inbox/send] lease release failed',{code:result.error.code})}
 }
}
