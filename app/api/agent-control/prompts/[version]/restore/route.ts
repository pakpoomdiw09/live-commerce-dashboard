import {NextRequest,NextResponse} from 'next/server'
import {agentControlTenant} from '@/lib/agent-control-server'
import {inboxError,InboxError,checkRpc} from '@/lib/inbox-server'
export async function POST(req:NextRequest,{params}:{params:Promise<{version:string}>}){try{
 const {db,tenantId,actor}=await agentControlTenant(req,req.nextUrl.searchParams.get('tenantId')??'',true)
 const version=Number((await params).version)
 if(!Number.isSafeInteger(version)||version<1)throw new InboxError('เวอร์ชันไม่ถูกต้อง')
 const restored=await db.rpc('restore_agent_prompt',{p_tenant:tenantId,p_actor:actor.id,p_version:version})
 checkRpc(restored.error)
 if(restored.data!==true)throw new InboxError('ไม่พบเวอร์ชัน',404)
 return NextResponse.json({ok:true})
}catch(error){return inboxError(error)}}
