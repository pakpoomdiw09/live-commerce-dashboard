import {NextRequest,NextResponse} from 'next/server'
import {inboxCustomer,inboxError,InboxError} from '@/lib/inbox-server'
import {UUID} from '@/lib/utils'
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{
 const {db,customer}=await inboxCustomer(req,(await params).id)
 const before=req.nextUrl.searchParams.get('before'),beforeId=req.nextUrl.searchParams.get('beforeId')
 let query=db.from('messages').select('id,customer_id,sender,body,attachments,created_at,inbound_seq,provider_message_id,delivery_status').eq('customer_id',customer.id)
 if(before){
  if(!Number.isFinite(Date.parse(before))||!UUID.test(beforeId??''))throw new InboxError('ตัวแบ่งหน้าข้อความไม่ถูกต้อง')
  const time=new Date(before).toISOString()
  query=query.or(`created_at.lt.${time},and(created_at.eq.${time},id.lt.${beforeId})`)
 }
 const result=await query.order('created_at',{ascending:false}).order('id',{ascending:false}).limit(101)
 if(result.error)throw result.error
 return NextResponse.json({messages:(result.data??[]).slice(0,100).reverse(),hasMore:(result.data?.length??0)>100},{headers:{'Cache-Control':'no-store'}})
 }catch(error){return inboxError(error)}}
