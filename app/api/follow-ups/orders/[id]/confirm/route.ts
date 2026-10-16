import {NextRequest,NextResponse} from 'next/server'
import {followUpTenant} from '@/lib/smart-followup-server'
import {inboxError,InboxError,checkRpc} from '@/lib/inbox-server'
import {UUID} from '@/lib/utils'
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{
 const input=await req.json().catch(()=>null);const {id}=await params
 const {db,actor,tenantId}=await followUpTenant(req,input?.tenantId??'')
 if(!UUID.test(id))throw new InboxError('รหัสออเดอร์ไม่ถูกต้อง')
 const result=await db.rpc('confirm_follow_up_order',{p_order:id,p_tenant:tenantId,p_actor:actor.id});checkRpc(result.error)
 return NextResponse.json({ok:true})
 }catch(error){return inboxError(error)}}
