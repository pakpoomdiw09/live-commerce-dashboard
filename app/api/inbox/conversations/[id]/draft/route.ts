import {NextRequest,NextResponse} from 'next/server'
import {inboxCustomer,inboxError,InboxError} from '@/lib/inbox-server'
import {hasFeature} from '@/lib/feature-access'
import {aiReply,HANDOVER_TOKEN,AiAgentError} from '@/lib/ai-agent'
import {customerName} from '@/lib/utils'
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{
 const {db,customer,tenantId}=await inboxCustomer(req,(await params).id)
 if(!(await hasFeature(db,tenantId,'ai_agent')))throw new InboxError('อัปเกรดเป็น Pro เพื่อใช้ AI ช่วยร่าง',403,'FEATURE_LOCKED')
 const [settings,tenant]=await Promise.all([db.from('bot_settings').select('ai_instructions').eq('tenant_id',tenantId).maybeSingle(),db.from('tenants').select('name').eq('id',tenantId).single()])
 if(settings.error||tenant.error)throw settings.error||tenant.error
 const draft=await aiReply(db,{tenantId,customerId:customer.id,customerName:customerName(customer),shopName:tenant.data.name,instructions:settings.data?.ai_instructions??null},undefined,true)
 if(!draft||draft===HANDOVER_TOKEN)throw new InboxError('AI ยังร่างคำตอบไม่ได้ กรุณาตอบด้วยตนเอง',422)
 return NextResponse.json({draft},{headers:{'Cache-Control':'no-store'}})
 }catch(error){if(error instanceof AiAgentError)return NextResponse.json({error:error.message,code:error.code},{status:error.status});return inboxError(error)}}
