import { singleFlight } from '@/lib/single-flight'
import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { runFacebookWebhookWorker } from '@/lib/integrations/facebook/webhook-worker'
import { handleFacebookWebhookEvent } from '@/lib/integrations/facebook/webhook-handler'

export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'

async function run(req: NextRequest) {
  const secret = (process.env.CRON_SECRET || process.env.INTERNAL_API_SECRET || '').trim()
  const authorization = req.headers.get('authorization') ?? ''
  const expected = Buffer.from(`Bearer ${secret}`),
    received = Buffer.from(authorization)
  if (!secret || expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    return NextResponse.json(
      await singleFlight('cron:facebook-webhooks', () =>
        runFacebookWebhookWorker(supabaseAdmin(), handleFacebookWebhookEvent),
      ),
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch {
    console.error('[facebook-webhook/worker] database unavailable')
    return NextResponse.json(
      { error: 'Webhook worker unavailable' },
      { status: 503, headers: { 'Retry-After': '30' } },
    )
  }
}
export const GET = run
export const POST = run
