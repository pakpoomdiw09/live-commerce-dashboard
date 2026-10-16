import {NextRequest,NextResponse} from 'next/server'
import {supabaseAdmin} from '@/lib/supabase/server'
import {agentControlAvailable} from '@/lib/agent-control-flags'
export async function POST(req:NextRequest){
 const secret=(process.env.CRON_SECRET||process.env.INTERNAL_API_SECRET||'').trim()
 if(!secret||req.headers.get('authorization')!==`Bearer ${secret}`)return NextResponse.json({error:'unauthorized'},{status:401})
 if(!agentControlAvailable())return NextResponse.json({enabled:false,recovered:0})
 const result=await supabaseAdmin().rpc('recover_agent_jobs')
 return result.error?NextResponse.json({error:'Recovery unavailable'},{status:503}):NextResponse.json({enabled:true,recovered:result.data})
}
