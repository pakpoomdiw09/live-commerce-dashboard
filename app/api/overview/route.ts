import {NextRequest,NextResponse} from 'next/server'
import {getActor} from '@/lib/auth'
import {loadPremiumOverview} from '@/lib/premium-overview-server'
import {inboxError} from '@/lib/inbox-server'
export async function GET(req:NextRequest){try{
 const p=req.nextUrl.searchParams
 const data=await loadPremiumOverview(await getActor(req),p.get('tenantId')??'',{range:p.get('range'),page:p.get('page'),q:p.get('q')})
 return NextResponse.json(data,{headers:{'Cache-Control':'private, no-store'}})
}catch(error){return inboxError(error)}}
