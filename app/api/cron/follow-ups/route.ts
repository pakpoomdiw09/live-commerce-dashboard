import { singleFlight } from '@/lib/single-flight'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { runFollowUps } from '@/lib/features/follow-ups/follow-ups'

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

async function handle(req: NextRequest) {
  // 🔓 ปิดการเช็ครหัสชั่วคราว เพื่อให้ทุกคำขอผ่านได้ทันที
  console.info('[FOLLOW-UP CRON] Bypass auth active', {
    nowUTC: new Date().toISOString(),
  })

  try {
    // ตรวจคิวอย่างเดียว ไม่ส่งข้อความจริง
    if (req.nextUrl.searchParams.get('dryRun') === '1') {
      const now = new Date().toISOString()

      const due = await supabaseAdmin()
        .from('follow_up_jobs')
        .select('id,run_at')
        .eq('status', 'pending')
        .lte('run_at', now)
        .lt('attempts', 3)
        .order('run_at')
        .limit(1)

      if (due.error) {
        throw new Error('Cannot inspect follow-up queue')
      }

      return NextResponse.json(
        {
          success: true,
          dryRun: true,
          nowUTC: now,
          hasDueJobs: !!due.data?.length,
          nextDueJob: due.data?.[0] ?? null,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const result = await singleFlight(
      'cron:follow-ups',
      () => runFollowUps(supabaseAdmin()),
    )

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    console.error('[cron follow-ups]', error)

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'failed',
      },
      { status: 500 },
    )
  }
}

export const GET = handle
export const POST = handle
