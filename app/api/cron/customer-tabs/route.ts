import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { runCustomerTabReminders } from '@/lib/features/commerce/customer-tab-reminders'
import { verifyCronAuth } from '@/lib/security/cron-auth'
export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'
async function run(req: NextRequest) {
  if (!verifyCronAuth(req))
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
