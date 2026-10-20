import {NextRequest,NextResponse} from 'next/server'
import {followUpTenant} from '@/lib/features/follow-ups/smart-followup-server'
import {inboxError,InboxError} from '@/lib/features/inbox/inbox-server'
import {canAccessTenant} from '@/lib/auth'
import {UUID} from '@/lib/utils'
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{
 const input=await req.json().catch(()=>null);const {id}=await params
 const {db,tenantId,actor}=await followUpTenant(req,input?.tenantId??'')
 if(!(await canAccessTenant(actor,tenantId,'owner')))throw new InboxError('เฉพาะเจ้าของร้านยืนยันหลักฐานส่งถึงได้',403)
 const evidence=typeof input.evidence==='string'?input.evidence.trim():''
 const paidAt=Date.parse(input.deliveredAt??'')
 if(!UUID.test(id)||evidence.length<5||evidence.length>1000||!Number.isFinite(paidAt)||paidAt>Date.now()+120000)throw new InboxError('กรุณาระบุหลักฐานส่งถึงจริงและวันที่ให้ถูกต้อง')
 const order=await db.from('orders').select('customer_id,status,created_at').eq('id',id).eq('tenant_id',tenantId).maybeSingle()
 if(order.error)throw order.error
 if(!order.data||order.data.status!=='shipped'||paidAt<Date.parse(order.data.created_at))throw new InboxError('ต้องเป็นออเดอร์ที่จัดส่งแล้ว และวันที่ส่งถึงอยู่หลังสร้างออเดอร์')
 const saved=await db.from('order_delivery_events').insert({tenant_id:tenantId,order_id:id,customer_id:order.data.customer_id,confirmed_by:actor.id,evidence,delivered_at:new Date(paidAt).toISOString()})
 if(saved.error?.code==='23505')throw new InboxError('มีหลักฐานส่งถึงของออเดอร์นี้แล้ว',409)
 if(saved.error)throw saved.error
 return NextResponse.json({ok:true})
 }catch(error){return inboxError(error)}}
