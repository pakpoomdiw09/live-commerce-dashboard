import {NextRequest,NextResponse} from 'next/server'
import {agentControlTenant,agentControlDashboard} from '@/lib/agent-control-server'
import {inboxError,InboxError,checkRpc} from '@/lib/inbox-server'
import {containsSecret} from '@/lib/agent-control-core'
export async function GET(req:NextRequest){try{
 const {db,tenantId,config,actor}=await agentControlTenant(req,req.nextUrl.searchParams.get('tenantId')??'')
 const {canAccessTenant}=await import('@/lib/auth')
 return NextResponse.json({...await agentControlDashboard(db,tenantId,config.flags.agent_analytics_enabled),config,canManage:await canAccessTenant(actor,tenantId,'owner')},{headers:{'Cache-Control':'private, no-store'}})
}catch(error){return inboxError(error)}}
export async function PATCH(req:NextRequest){try{
 const {db,tenantId,actor}=await agentControlTenant(req,req.nextUrl.searchParams.get('tenantId')??'',true)
 const input=await req.json().catch(()=>null)
 if(typeof input?.instructions!=='string'||input.instructions.length>8000||containsSecret(input.instructions))throw new InboxError('คำสั่ง AI ต้องไม่เกิน 8,000 ตัวอักษร และไม่มี Key/Token')
 const result=await db.rpc('save_agent_prompt',{p_tenant:tenantId,p_actor:actor.id,p_instructions:input.instructions.trim()||null})
 checkRpc(result.error)
 return NextResponse.json({ok:true})
}catch(error){return inboxError(error)}}
