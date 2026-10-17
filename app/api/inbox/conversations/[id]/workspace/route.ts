import {inboxInboundEvidence} from '@/lib/inbox-policy-server'
import {NextRequest, NextResponse} from 'next/server'
import {inboxCustomer, inboxError, InboxError, checkRpc} from '@/lib/inbox-server'
import {inboxWindow} from '@/lib/inbox-v2'
import {UUID} from '@/lib/utils'
type Context = {params: Promise<{id:string}>}
export async function GET(req:NextRequest,{params}:Context) {try {
  const {db,actor,customer,tenantId}=await inboxCustomer(req,(await params).id)
  const [notes,star,last]=await Promise.all([
    db.from('inbox_internal_notes').select('id,body,actor_id,created_at').eq('tenant_id',tenantId).eq('customer_id',customer.id).order('created_at',{ascending:false}).limit(50),
    db.from('inbox_stars').select('customer_id').eq('customer_id',customer.id).eq('user_id',actor.id).maybeSingle(),
    (async()=>{const page=await db.from('tenants').select('page_id').eq('id',tenantId).single();if(page.error)throw page.error;return {data:{created_at:await inboxInboundEvidence(db,tenantId,customer.id,page.data.page_id)},error:null}})(),
  ])
  if(notes.error||star.error||last.error) throw notes.error||star.error||last.error
  return NextResponse.json({notes:notes.data,starred:!!star.data,window:inboxWindow(last.data?.created_at),lastInboundAt:last.data?.created_at??null},{headers:{'Cache-Control':'no-store'}})
}catch(error){return inboxError(error)}}
export async function POST(req:NextRequest,{params}:Context) {try {
  if(req.headers.get('sec-fetch-site')==='cross-site'||req.headers.get('origin')&&req.headers.get('origin')!==req.nextUrl.origin) throw new InboxError('ไม่อนุญาตคำขอจากเว็บไซต์อื่น',403)
  const {db,actor,customer}=await inboxCustomer(req,(await params).id)
  const input=await req.json().catch(()=>null)
  if(!UUID.test(input?.requestId??'')||!['note','star','unstar','read'].includes(input?.action)||input.action==='note'&&(typeof input.body!=='string'||!input.body.trim()||input.body.length>2000)) throw new InboxError('ข้อมูลไม่ถูกต้อง (โน้ตไม่เกิน 2,000 ตัวอักษร)')
  if(input.action==='read'){
    const last=await db.from('messages').select('id').eq('customer_id',customer.id).eq('sender','customer').order('inbound_seq',{ascending:false}).limit(1).maybeSingle()
    if(last.error)throw last.error
    if(last.data){const read=await db.rpc('mark_inbox_read',{p_customer:customer.id,p_actor:actor.id,p_message:last.data.id});checkRpc(read.error)}
    return NextResponse.json({ok:true})
  }
  const result=await db.rpc('manage_inbox_workspace',{p_customer:customer.id,p_actor:actor.id,p_action:input.action,p_key:input.requestId,p_body:input.action==='note'?input.body.trim():null})
  checkRpc(result.error)
  return NextResponse.json({ok:true})
}catch(error){return inboxError(error)}}
