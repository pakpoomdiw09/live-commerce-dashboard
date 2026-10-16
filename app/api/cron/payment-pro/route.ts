import {NextRequest,NextResponse} from 'next/server'
import {supabaseAdmin} from '@/lib/supabase/server'
import {paymentProAvailable} from '@/lib/payment-pro-flags'
export async function POST(req:NextRequest){
 const secret=(process.env.CRON_SECRET||process.env.INTERNAL_API_SECRET||'').trim()
 if(!secret||req.headers.get('authorization')!==`Bearer ${secret}`)return NextResponse.json({error:'unauthorized'},{status:401})
 if(!paymentProAvailable())return NextResponse.json({enabled:false,recovered:0})
 const result=await supabaseAdmin().rpc('recover_payment_pro')
 if(result.error)return NextResponse.json({error:'Payment Pro recovery unavailable'},{status:503})
 return NextResponse.json({enabled:true,recovered:result.data})
}
