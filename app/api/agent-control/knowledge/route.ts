import {NextRequest,NextResponse} from 'next/server'
import {agentControlTenant} from '@/lib/agent-control-server'
import {inboxError,InboxError,checkRpc} from '@/lib/inbox-server'
import {knowledgeError} from '@/lib/agent-control-core'
import {UUID} from '@/lib/utils'
export async function POST(req:NextRequest){try{
 const {db,tenantId,actor,config}=await agentControlTenant(req,req.nextUrl.searchParams.get('tenantId')??'',true)
 if(!config.flags.agent_knowledge_base_enabled)throw new InboxError('ยังไม่เปิดฐานความรู้',403,'FEATURE_DISABLED')
 const input=await req.json().catch(()=>null),problem=knowledgeError(input)
 if(problem)throw new InboxError(problem)
 const values={kind:input.kind,title:input.title.trim(),content:input.content.trim(),is_active:input.is_active}
 if(input.id&&!UUID.test(input.id))throw new InboxError('รหัสฐานความรู้ไม่ถูกต้อง')
 const result=await db.rpc('manage_agent_knowledge',{p_tenant:tenantId,p_actor:actor.id,p_action:'save',p_id:input.id??null,p_data:values})
 checkRpc(result.error)
 return NextResponse.json({ok:true})
}catch(error){return inboxError(error)}}
export async function DELETE(req:NextRequest){try{
 const {db,tenantId,actor}=await agentControlTenant(req,req.nextUrl.searchParams.get('tenantId')??'',true)
 const id=req.nextUrl.searchParams.get('id')??''
 if(!UUID.test(id))throw new InboxError('รหัสฐานความรู้ไม่ถูกต้อง')
 const result=await db.rpc('manage_agent_knowledge',{p_tenant:tenantId,p_actor:actor.id,p_action:'delete',p_id:id,p_data:{}})
 checkRpc(result.error)
 if(!result.data)throw new InboxError('ไม่พบฐานความรู้',404)
 return NextResponse.json({ok:true})
}catch(error){return inboxError(error)}}
