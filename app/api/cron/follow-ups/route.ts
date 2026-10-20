import { singleFlight } from '@/lib/single-flight'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { runFollowUps } from '@/lib/features/follow-ups/follow-ups'

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

/**
 * Payment reminder worker for every tenant. Call it every minute from a scheduler:
 * Supabase pg_cron (see supabase/automation.sql), Vercel Cron, or any uptime pinger.
 * Accepts Authorization: Bearer <token>, or ?secret=<token> for external schedulers.
 * Uses CRON_SECRET, then INTERNAL_API_SECRET, then the requested fixed fallback.
 */
async function handle(req: NextRequest) {
  const secret =
    process.env.CRON_SECRET?.trim() ||
    process.env.INTERNAL_API_SECRET?.trim() ||
    'Pakpoom0980'
  const authorization = req.headers.get('authorization')
  // Prefer the header when supplied, so a wrong header cannot be masked by the URL.
  const token = authorization !== null
    ? /^Bearer\s+(\S+)$/i.exec(authorization.trim())?.[1]
    : req.nextUrl.searchParams.get('secret')?.trim()
  if (!token || token !== secret) {
    console.warn('[FOLLOW-UP CRON] rejected', { reason: 'invalid_authorization' })
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  }
  try {
    if(req.nextUrl.searchParams.get('dryRun')==='1'){
      const now=new Date().toISOString()
      const due=await supabaseAdmin().from('follow_up_jobs').select('id,run_at').eq('status','pending').lte('run_at',now).lt('attempts',3).order('run_at').limit(1)
      if(due.error)throw new Error('Cannot inspect follow-up queue')
      return NextResponse.json({dryRun:true,nowUTC:now,hasDueJobs:!!due.data?.length,nextDueJob:due.data?.[0]??null},{headers:{'Cache-Control':'no-store'}})
    }
    console.info('[FOLLOW-UP CRON] invoked',{method:req.method,nowUTC:new Date().toISOString()})
    return NextResponse.json(await singleFlight('cron:follow-ups',()=>runFollowUps(supabaseAdmin())),{headers:{'Cache-Control':'no-store'}})
  } catch (e) {
    console.error('[cron follow-ups]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
