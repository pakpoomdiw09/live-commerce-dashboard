import { singleFlight } from '@/lib/single-flight'
import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { runFollowUps } from '@/lib/features/follow-ups/follow-ups'

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

function isAuthorized(req: NextRequest) {
  const secret = (process.env.CRON_SECRET || process.env.INTERNAL_API_SECRET || '').trim()
  const expected = Buffer.from(`Bearer ${secret}`)
  const received = Buffer.from(req.headers.get('authorization') ?? '')
  return (
    Boolean(secret) && expected.length === received.length && timingSafeEqual(expected, received)
  )
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    console.warn('[FOLLOW-UP CRON] unauthorized invocation', { method: req.method })
    return NextResponse.json(
      { error: 'unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  console.info('[FOLLOW-UP CRON] invoked', {
    method: req.method,
    nowUTC: new Date().toISOString(),
  })

  try {
    const deadline = Date.now() + 45000
    const db = supabaseAdmin({ timeoutMs: 8000 })
    const now = new Date().toISOString()
    const due = await db
      .from('follow_up_jobs')
      .select('id,tenant_id,run_at', { count: 'exact' })
      .eq('status', 'pending')
      .lte('run_at', now)
      .order('run_at')
      .limit(20)

    if (due.error) {
      console.error('[FOLLOW-UP CRON] due queue lookup failed', { code: due.error.code })
      throw new Error('Cannot inspect follow-up queue')
    }
    const dueJobs = due.data ?? []
    console.info('[FOLLOW-UP CRON] due queue', {
      dueCount: due.count ?? dueJobs.length,
      listedCount: dueJobs.length,
      nowUTC: now,
      jobs: dueJobs.map((job) => ({
        jobId: job.id,
        tenantId: job.tenant_id,
        scheduledAtUTC: job.run_at,
        dueByUTC: now,
      })),
    })

    // Queue inspection is deliberately read-only; it never claims or sends a job.
    if (req.nextUrl.searchParams.get('dryRun') === '1') {
      return NextResponse.json(
        {
          success: true,
          dryRun: true,
          nowUTC: now,
          dueCount: due.count ?? dueJobs.length,
          dueJobs,
          hasDueJobs: dueJobs.length > 0,
          nextDueJob: dueJobs[0] ?? null,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const result = await singleFlight('cron:follow-ups', () =>
      runFollowUps(db, undefined, deadline),
    )
    console.info('[FOLLOW-UP CRON] worker result', {
      dueCount: due.count ?? dueJobs.length,
      ...result,
    })

    return NextResponse.json(
      { ...result, dueCount: due.count ?? dueJobs.length },
      {
        status: result.failed > 0 || result.errors > 0 ? 503 : 200,
        headers: { 'Cache-Control': 'no-store' },
      },
    )
  } catch (error) {
    console.error('[cron follow-ups]', error)

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'failed',
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}

export const GET = handle
export const POST = handle
