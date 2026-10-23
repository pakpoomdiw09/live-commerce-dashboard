import { singleFlight } from '@/lib/single-flight'
import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function run(req: NextRequest) {
  const secret = (process.env.CRON_SECRET || process.env.INTERNAL_API_SECRET || '').trim()
  const expected = Buffer.from(`Bearer ${secret}`),
    received = Buffer.from(req.headers.get('authorization') ?? '')
  if (!secret || expected.length !== received.length || !timingSafeEqual(expected, received))
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const result = await singleFlight(
      'cron:inbox-windows',
      async () => await supabaseAdmin().rpc('expire_inbox_automation_windows', { p_limit: 500 }),
    )
    if (result.error) throw result.error
    return NextResponse.json({ paused: result.data }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json(
      { error: 'ยังปรับสถานะแชทหมดเวลาไม่ได้' },
      { status: 503, headers: { 'Retry-After': '30' } },
    )
  }
}
export const GET = run
export const POST = run
