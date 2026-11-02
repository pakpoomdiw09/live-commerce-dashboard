import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { runCustomerTabReminders } from '@/lib/features/commerce/customer-tab-reminders'
export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'
async function run(req: NextRequest) {
  const secret = (process.env.CRON_SECRET || process.env.INTERNAL_API_SECRET || '').trim()
  const expected = Buffer.from(`Bearer ${secret}`),
    supplied = Buffer.from(req.headers.get('authorization') ?? '')
  if (!secret || expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await runCustomerTabReminders(supabaseAdmin({ timeoutMs: 10000 })), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch {
    return NextResponse.json({ error: 'Customer tab worker unavailable' }, { status: 503 })
  }
}
export const GET = run
export const POST = run
