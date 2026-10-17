import {NextRequest,NextResponse} from 'next/server'
import {inboxTenant,inboxError} from '@/lib/inbox-server'
export async function GET(req:NextRequest){try{
 const {db,actor,tenantId}=await inboxTenant(req,req.nextUrl.searchParams.get('tenantId')??'')
 const pending=await db.from('orders').select('customer_id,customers!inner(tenant_id)').eq('tenant_id',tenantId).eq('customers.tenant_id',tenantId).eq('status','pending_payment').limit(1000)
 if(pending.error)throw pending.error
 const result=await db.from('inbox_stars').select('customer_id,customers!inner(tenant_id)').eq('user_id',actor.id).eq('customers.tenant_id',tenantId).limit(1000)
 if(result.error)throw result.error
 return NextResponse.json({customerIds:result.data.map(r=>r.customer_id),pendingPaymentIds:[...new Set(pending.data.map(r=>r.customer_id))],limited:result.data.length===1000||pending.data.length===1000},{headers:{'Cache-Control':'no-store'}})
}catch(error){return inboxError(error)}}
