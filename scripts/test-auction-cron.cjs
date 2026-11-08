const assert = require('node:assert/strict')
const { test } = require('node:test')
const { NextResponse } = require('next/server')
const load = require('./helpers/load-typescript.cjs')

test('external cron GET requests require authentication and drain webhook and auction outbox work', async () => {
  const cronPath = '/api/cron/facebook-webhooks'
  const calls = []
  const route = load(
    `app${cronPath}/route.ts`,
    {
      'node:crypto': require('node:crypto'),
      'next/server': { NextResponse },
      '@/lib/supabase/server': { supabaseAdmin: () => ({ rpc: async (name) => {
        assert.equal(name, 'expire_live_auctions_report')
        calls.push('expiry')
        return { data: { closed: 1, failed: 2 }, error: null }
      } }) },
      '@/lib/integrations/facebook/webhook-worker': {
        runFacebookWebhookWorker: async () => {
          calls.push('webhooks')
          return { completed: 1 }
        },
      },
      '@/lib/integrations/facebook/webhook-handler': { handleFacebookWebhookEvent() {} },
      '@/lib/features/commerce/auction-server': {
        deliverAuctionNotifications: async () => {
          calls.push('outbox')
        },
      },
      '@/lib/features/commerce/customer-tab-reminders': {
        runCustomerTabReminders: async () => {
          calls.push('reminders')
        },
      },
      '@/lib/features/shipping/shipping-notifications': {
        deliverShippingTrackingNotifications: async () => {
          calls.push('tracking')
        },
      },
    },
    { Buffer, process: { env: { CRON_SECRET: 'test-cron-secret' } } },
  )
  const request = (secret) =>
    new Request(`https://shop.example${cronPath}`, {
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
    })
  assert.equal((await route.GET(request())).status, 401)
  assert.equal((await route.GET(request('wrong'))).status, 401)
  assert.deepEqual(calls, [])
  const result = await route.GET(request('test-cron-secret'))
  assert.equal(result.status, 200)
  assert.deepEqual(await result.json(), { completed: 1, auctionExpiry: { closed: 1, failed: 2 } })
  assert.deepEqual(calls, ['webhooks', 'expiry', 'outbox', 'tracking', 'reminders'])
})
