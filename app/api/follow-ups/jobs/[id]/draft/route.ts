import {NextRequest,NextResponse} from 'next/server'
import {followUpTenant} from '@/lib/smart-followup-server'
import {inboxError,InboxError} from '@/lib/inbox-server'
import {hasFeature} from '@/lib/feature-access'
import {aiReply,HANDOVER_TOKEN,AiAgentError} from '@/lib/ai-agent'
import {UUID} from '@/lib/utils'
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{
 const input=await req.json().catch(()=>null);const {id}=await params
 const {db,tenantId}=await followUpTenant(req,input?.tenantId??'')
 if(!(await hasFeature(db,tenantId,'ai_agent')))throw new InboxError('AI ช่วยร่างสำหรับแพ็กเกจ Pro',403,'FEATURE_LOCKED')
 if(!UUID.test(id))throw new InboxError('รหัสงานไม่ถูกต้อง')
 const job=await db.from('follow_up_jobs').select('customer_id,text,kind,orders(product_name,amount)').eq('id',id).eq('tenant_id',tenantId).eq('status','requires_review').eq('reason','ai_draft').maybeSingle()
 if(job.error)throw job.error
 if(!job.data)throw new InboxError('ไม่พบงานที่รอตรวจทานข้อความ AI',404)
 const tenant=await db.from('tenants').select('name').eq('id',tenantId).single();if(tenant.error)throw tenant.error
 const draft=await aiReply(db,{tenantId,customerId:job.data.customer_id,customerName:null,shopName:tenant.data.name,instructions:'ร่างข้อความติดตามสั้น สุภาพ ไม่กดดัน จากข้อมูลจริงต่อไปนี้เท่านั้น ห้ามแต่งราคา โปรโมชัน ข้อเสนอ หรือสถานะชำระ/จัดส่งขึ้นเอง ห้ามแสดงตัวเลขราคา ให้เก็บ placeholder เดิมตามจำเป็น เป็นร่างให้แอดมินตรวจทาน: '+JSON.stringify(job.data)},[{role:'user',text:'ช่วยปรับข้อความติดตามนี้ให้อ่านง่าย ไม่ต้องส่งถึงลูกค้า: '+job.data.text}],true)
 if(!draft||draft===HANDOVER_TOKEN)throw new InboxError('AI ยังร่างไม่ได้ กรุณาแก้ข้อความเอง',422)
 return NextResponse.json({draft},{headers:{'Cache-Control':'no-store'}})
 }catch(error){if(error instanceof AiAgentError)return NextResponse.json({error:error.message,code:error.code},{status:error.status});return inboxError(error)}}
