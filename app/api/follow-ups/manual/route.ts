import {NextRequest,NextResponse} from 'next/server'
import {followUpTenant} from '@/lib/features/follow-ups/smart-followup-server'
import {checkRpc,inboxError,InboxError} from '@/lib/features/inbox/inbox-server'
import {UUID} from '@/lib/utils'

export async function GET(req:NextRequest){try{
 const {db,tenantId}=await followUpTenant(req,req.nextUrl.searchParams.get('tenantId')??'')
 const customerId=req.nextUrl.searchParams.get('customerId')
 if(customerId){
  if(!UUID.test(customerId))throw new InboxError('รหัสลูกค้าไม่ถูกต้อง')
  const customer=await db.from('customers').select('id').eq('tenant_id',tenantId).eq('id',customerId).maybeSingle()
  if(customer.error)throw customer.error
  if(!customer.data)throw new InboxError('ไม่พบลูกค้า',404)
  const [orders,products]=await Promise.all([
   db.from('orders').select('id,product_name,status,amount,created_at').eq('tenant_id',tenantId).eq('customer_id',customerId).order('created_at',{ascending:false}).limit(50),
   db.from('products').select('id,name').eq('tenant_id',tenantId).eq('is_active',true).eq('commerce_archived',false).order('name').limit(200),
  ])
  if(orders.error)throw orders.error;if(products.error)throw products.error
  return NextResponse.json({orders:orders.data??[],products:products.data??[]},{headers:{'Cache-Control':'no-store'}})
 }
 const q=(req.nextUrl.searchParams.get('q')??'').trim().slice(0,100)
 let query=db.from('customers').select('id,display_name,platform_user_id').eq('tenant_id',tenantId).order('last_message_at',{ascending:false,nullsFirst:false}).limit(30)
 if(UUID.test(q))query=query.eq('id',q)
 else if(/^\d+$/.test(q))query=query.eq('platform_user_id',q)
 else if(q){const term=q.replace(/[^\p{L}\p{N}\s._-]/gu,'').replace(/_/g,'\\_');if(!term)throw new InboxError('ค้นหาด้วยชื่อหรือ Customer ID');query=query.ilike('display_name',`%${term}%`)}
 const {data,error}=await query;if(error)throw error
 return NextResponse.json({customers:data??[]},{headers:{'Cache-Control':'no-store'}})
 }catch(error){return inboxError(error)}}

export async function POST(req:NextRequest){try{
 const input=await req.json().catch(()=>null)
 const {db,tenantId,actor}=await followUpTenant(req,input?.tenantId??'')
 const referenceId=input?.referenceId||null
 if(!UUID.test(input?.customerId??'')||!['payment','interested','after_sales'].includes(input?.kind)||(referenceId!==null&&!UUID.test(referenceId)))throw new InboxError('กรุณาเลือกลูกค้าและประเภทให้ครบ')
 const {data,error}=await db.rpc('add_manual_follow_up',{p_tenant:tenantId,p_actor:actor.id,p_customer:input.customerId,p_kind:input.kind,p_reference:referenceId})
 checkRpc(error)
 if(!data?.length)throw new InboxError('ไม่พบงานที่เพิ่มเข้าคิว กรุณาตรวจสอบการติดตั้ง follow-up-simplified.sql แล้วลองใหม่',409)
 return NextResponse.json({jobs:data},{status:201})
 }catch(error){return inboxError(error)}}
