import { singleFlight } from '@/lib/single-flight'
import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { runFacebookWebhookWorker } from '@/lib/integrations/facebook/webhook-worker'
import { handleFacebookWebhookEvent } from '@/lib/integrations/facebook/webhook-handler'
import { deliverAuctionNotifications } from '@/lib/features/commerce/auction-server'
import { deliverShippingTrackingNotifications } from '@/lib/features/shipping/shipping-notifications'

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
      await singleFlight('cron:facebook-webhooks', async () => {
        const summary = await runFacebookWebhookWorker(supabaseAdmin(), handleFacebookWebhookEvent)
        const expired = await supabaseAdmin().rpc('expire_live_auctions_report')
        if (expired.error) console.error('[auction/expiry] recovery failed', { code: expired.error.code })
        try {
          await deliverAuctionNotifications()
        } catch {
          console.warn('[auction/delivery] outbox unavailable or not installed')
        }
        try {
          await deliverShippingTrackingNotifications(supabaseAdmin({ timeoutMs: 10000 }))
        } catch {
          console.warn('[shipping/tracking] recovery outbox unavailable')
        }
        try {
          const { runCustomerTabReminders } =
            await import('@/lib/features/commerce/customer-tab-reminders')
          await runCustomerTabReminders(supabaseAdmin({ timeoutMs: 10000 }))
        } catch {
          console.warn('[customer-tabs/reminder] worker unavailable or not installed')
        }
        return { ...summary, auctionExpiry: expired.error ? { closed: 0, failed: 1, unavailable: true } : expired.data }
      }),
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
