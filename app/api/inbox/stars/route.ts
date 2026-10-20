import {NextRequest,NextResponse} from 'next/server'
import {inboxTenant,inboxError} from '@/lib/features/inbox/inbox-server'

export async function GET(req:NextRequest){try{
  const {db,actor,tenantId}=await inboxTenant(req,req.nextUrl.searchParams.get('tenantId')??'')
  const [pending,stars,followUps,paid]=await Promise.all([
    db.from('orders').select('customer_id,customers!inner(tenant_id)').eq('tenant_id',tenantId).eq('customers.tenant_id',tenantId).eq('status','pending_payment').limit(1000),
    db.from('inbox_stars').select('customer_id,customers!inner(tenant_id)').eq('user_id',actor.id).eq('customers.tenant_id',tenantId).limit(1000),
    db.from('inbox_follow_up_flags').select('customer_id,customers!inner(tenant_id)').eq('user_id',actor.id).eq('tenant_id',tenantId).eq('customers.tenant_id',tenantId).limit(1000),
    db.from('customers').select('id,slips!inner(id)').eq('tenant_id',tenantId).eq('slips.tenant_id',tenantId)
      .or('status.eq.valid,and(approved_at.not.is.null,status.in.(amount_mismatch,wrong_receiver,fake,error))',{referencedTable:'slips'})
      .limit(1,{referencedTable:'slips'}).order('id').limit(1000),
  ])
  if(pending.error||stars.error||paid.error)throw pending.error||stars.error||paid.error
  if(followUps.error&&!['42P01','PGRST205'].includes(followUps.error.code))throw followUps.error
  return NextResponse.json({
    customerIds:(stars.data??[]).map(row=>row.customer_id),
    followUpCustomerIds:(followUps.data??[]).map(row=>row.customer_id),
    paidCustomerIds:(paid.data??[]).map(row=>row.id),
    pendingPaymentIds:[...new Set((pending.data??[]).map(row=>row.customer_id))],
    followUpAvailable:!followUps.error,
    limited:[pending,stars,followUps,paid].some(result=>result.data?.length===1000),
  },{headers:{'Cache-Control':'no-store'}})
}catch(error){return inboxError(error)}}
