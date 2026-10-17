import {NextRequest,NextResponse} from 'next/server'
import {inboxTenant,inboxError,InboxError,checkRpc} from '@/lib/inbox-server'
import {UUID} from '@/lib/utils'
export async function GET(req:NextRequest){try{
 const {db,tenantId}=await inboxTenant(req,req.nextUrl.searchParams.get('tenantId')??'')
 const result=await db.from('inbox_quick_replies').select('id,body,shortcut').eq('tenant_id',tenantId).order('created_at',{ascending:true}).limit(100)
 if(result.error)throw result.error
 return NextResponse.json({replies:result.data},{headers:{'Cache-Control':'no-store'}})
}catch(error){return inboxError(error)}}
export async function POST(req:NextRequest){try{
 if(req.headers.get('sec-fetch-site')==='cross-site'||req.headers.get('origin')&&req.headers.get('origin')!==req.nextUrl.origin)throw new InboxError('ไม่อนุญาตคำขอจากเว็บไซต์อื่น',403)
 const {db,actor,tenantId}=await inboxTenant(req,req.nextUrl.searchParams.get('tenantId')??'')
 const input=await req.json().catch(()=>null)
 if(!UUID.test(input?.requestId??'')||typeof input.body!=='string'||!input.body.trim()||input.body.length>2000)throw new InboxError('กรุณาระบุคำตอบด่วนไม่เกิน 2,000 ตัวอักษร')
 const shortcut=input.shortcut??''
 if(typeof shortcut!=='string'||shortcut.length>60)throw new InboxError('ทางลัดต้องไม่เกิน 60 ตัวอักษร')
 const result=await db.rpc('save_inbox_quick_reply',{p_tenant:tenantId,p_actor:actor.id,p_key:input.requestId,p_body:input.body.trim(),p_shortcut:shortcut.trim()})
 if(result.error?.code==='22023')throw new InboxError('บันทึกไม่ได้ กรุณาตรวจข้อความและจำนวนคำตอบด่วน (สูงสุด 100 รายการต่อร้าน)')
 checkRpc(result.error)
 return NextResponse.json({reply:result.data},{headers:{'Cache-Control':'no-store'}})
}catch(error){return inboxError(error)}}
