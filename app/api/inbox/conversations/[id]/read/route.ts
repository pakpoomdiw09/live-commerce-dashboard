import {NextRequest,NextResponse} from 'next/server'
import {inboxCustomer,inboxError,InboxError,checkRpc} from '@/lib/inbox-server'
import {UUID} from '@/lib/utils'
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{
 const {db,actor,customer}=await inboxCustomer(req,(await params).id)
 const input=await req.json().catch(()=>null)
 if(!UUID.test(input?.messageId??''))throw new InboxError('รหัสข้อความไม่ถูกต้อง')
 const {error}=await db.rpc('mark_inbox_read',{p_customer:customer.id,p_actor:actor.id,p_message:input.messageId});checkRpc(error)
 return NextResponse.json({ok:true})
 }catch(error){return inboxError(error)}}
