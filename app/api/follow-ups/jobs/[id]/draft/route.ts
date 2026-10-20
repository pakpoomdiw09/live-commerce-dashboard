import {NextRequest,NextResponse} from 'next/server'
import {followUpTenant} from '@/lib/features/follow-ups/smart-followup-server'
import {inboxError,InboxError} from '@/lib/features/inbox/inbox-server'
import {hasFeature} from '@/lib/feature-access'
import {AiAgentError} from '@/lib/features/agents/ai-agent'
import {draftManualFollowUp} from '@/lib/features/follow-ups/manual-followup-ai'
import {UUID} from '@/lib/utils'
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{
 const input=await req.json().catch(()=>null);const {id}=await params
 const {db,tenantId}=await followUpTenant(req,input?.tenantId??'')
 if(!(await hasFeature(db,tenantId,'ai_agent')))throw new InboxError('AI ช่วยร่างสำหรับแพ็กเกจ Pro',403,'FEATURE_LOCKED')
 if(!UUID.test(id))throw new InboxError('รหัสงานไม่ถูกต้อง')
 const job=await db.from('follow_up_jobs').select('customer_id,text,kind,orders(product_name,amount)').eq('id',id).eq('tenant_id',tenantId).eq('status','requires_review').eq('reason','ai_draft').maybeSingle()
 if(job.error)throw job.error
 if(!job.data)throw new InboxError('ไม่พบงานที่รอตรวจทานข้อความ AI',404)
 const result=await draftManualFollowUp(db,tenantId,job.data.customer_id,job.data.kind)
 return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}})
 }catch(error){if(error instanceof AiAgentError)return NextResponse.json({error:error.message,code:error.code},{status:error.status});return inboxError(error)}}
