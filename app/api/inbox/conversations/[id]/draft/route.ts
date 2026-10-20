import {NextRequest,NextResponse} from 'next/server'
import {inboxCustomer,inboxError,InboxError} from '@/lib/features/inbox/inbox-server'
import {hasFeature} from '@/lib/feature-access'
import {aiReply,HANDOVER_TOKEN,DRAFT_FALLBACK,AiAgentError} from '@/lib/features/agents/ai-agent'
import {customerName} from '@/lib/utils'
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{
 const {db,customer,tenantId}=await inboxCustomer(req,(await params).id)
 const page=await db.from('tenants').select('page_id').eq('id',tenantId).single()
 if(page.error)throw page.error
 const {inboxInboundEvidence}=await import('@/lib/features/inbox/inbox-policy-server')
 const {inboxWindow}=await import('@/lib/features/inbox/inbox-v2')
 if(!inboxWindow(await inboxInboundEvidence(db,tenantId,customer.id,page.data.page_id)).allowed)throw new InboxError('หมดเวลา 24 ชั่วโมง แอดมินต้องเขียนคำตอบด้วยตนเอง',409,'MESSAGING_WINDOW_CLOSED')
 if(!(await hasFeature(db,tenantId,'ai_agent')))throw new InboxError("เปลี่ยนแพ็กเกจเพื่อใช้ผู้ช่วยร่างข้อความ",403,'FEATURE_LOCKED')
 const [settings,tenant]=await Promise.all([db.from('bot_settings').select('ai_instructions').eq('tenant_id',tenantId).maybeSingle(),db.from('tenants').select('name').eq('id',tenantId).single()])
 if(settings.error||tenant.error)throw settings.error||tenant.error
 const draft=await aiReply(db,{tenantId,customerId:customer.id,customerName:customerName(customer),shopName:tenant.data.name,instructions:settings.data?.ai_instructions??null},undefined,true,true,false,true)
 return NextResponse.json({draft:draft&&draft!==HANDOVER_TOKEN?draft:DRAFT_FALLBACK},{headers:{'Cache-Control':'no-store'}})
 }catch(error){if(error instanceof AiAgentError)return NextResponse.json({error:error.code==='RATE_LIMIT'?'มีการใช้งานผู้ช่วยร่างข้อความจำนวนมาก กรุณารอสักครู่แล้วลองใหม่':'ผู้ช่วยร่างข้อความยังไม่พร้อมใช้งาน กรุณาให้เจ้าของร้านตรวจสอบการตั้งค่า',code:error.code},{status:error.status});return inboxError(error)}}
