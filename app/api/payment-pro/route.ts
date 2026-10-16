import { NextRequest,NextResponse } from 'next/server'
import { paymentProTenant,paymentProOverview,PRO_LIST_COLUMNS } from '@/lib/payment-pro-server'
import { inboxError,InboxError } from '@/lib/inbox-server'
import { csvCell,paymentReportFilters } from '@/lib/payment-pro-core'
export async function GET(req:NextRequest){
  try{
    const {db,tenantId,flags}=await paymentProTenant(req,req.nextUrl.searchParams.get('tenantId')??'')
    let filters
    try{filters=paymentReportFilters(req.nextUrl.searchParams.get('range'),req.nextUrl.searchParams.get('q'))}catch{throw new InboxError('ช่วงเวลาหรือคำค้นไม่ถูกต้อง')}
    if(req.nextUrl.searchParams.get('format')==='csv'){
      let query=db.from('payment_pro_attempts').select(PRO_LIST_COLUMNS).eq('tenant_id',tenantId).gte('created_at',filters.from).lt('created_at',filters.to).order('created_at',{ascending:false}).limit(10000)
      if(filters.q)query=query.ilike('reason','%'+filters.q.replace(/[\\%_]/g,'\\$&')+'%')
      const result=await query
      if(result.error)throw result.error
      const keys=['id','slip_id','status','reason','expected_satang','credit_charged','credit_refunded','created_at'] as const
      const csv='\uFEFF'+[keys.map(csvCell).join(','),...(result.data??[]).map(row=>keys.map(key=>csvCell(row[key])).join(','))].join('\r\n')
      return new NextResponse(csv,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="snapbot-payment-pro-${filters.days}days.csv"`,'Cache-Control':'private, no-store'}})
    }
    return NextResponse.json({...await paymentProOverview(db,tenantId,flags.analytics,filters),flags},{headers:{'Cache-Control':'private, no-store'}})
  }catch(error){return inboxError(error)}
}
