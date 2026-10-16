import {NextRequest,NextResponse} from 'next/server'
import {inboxTenant,inboxError,InboxError} from '@/lib/inbox-server'
import {CUSTOMER_COLUMNS} from '@/lib/types'
import {UUID} from '@/lib/utils'
export async function GET(req:NextRequest){try{
 const {db,tenantId}=await inboxTenant(req,req.nextUrl.searchParams.get('tenantId')??'')
 const before=req.nextUrl.searchParams.get('before'),id=req.nextUrl.searchParams.get('beforeId')
 let query=db.from('customers').select(`${CUSTOMER_COLUMNS},messages(sender,body,attachments,created_at),slips(status,created_at)`).eq('tenant_id',tenantId).eq('slips.tenant_id',tenantId)
 if(before){
  if(!UUID.test(id??'')||(before!=='null'&&!Number.isFinite(Date.parse(before))))throw new InboxError('ตัวแบ่งหน้าไม่ถูกต้อง')
  if(before==='null')query=query.is('last_message_at',null).lt('id',id!)
  else{const time=new Date(before).toISOString();query=query.or(`last_message_at.lt.${time},and(last_message_at.eq.${time},id.lt.${id}),last_message_at.is.null`)}
 }
 const result=await query.order('last_message_at',{ascending:false,nullsFirst:false}).order('id',{ascending:false}).order('created_at',{ascending:false,referencedTable:'messages'}).limit(1,{referencedTable:'messages'}).order('created_at',{ascending:false,referencedTable:'slips'}).limit(1,{referencedTable:'slips'}).limit(101)
 if(result.error)throw result.error
 return NextResponse.json({chats:(result.data??[]).slice(0,100).map(({messages,slips,...customer})=>({customer,preview:messages[0]??null,latestSlip:slips[0]?.status??null})),hasMore:(result.data?.length??0)>100},{headers:{'Cache-Control':'no-store'}})
 }catch(error){return inboxError(error)}}
