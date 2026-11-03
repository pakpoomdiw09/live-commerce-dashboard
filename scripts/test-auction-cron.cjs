const assert = require('node:assert/strict')
const { test } = require('node:test')
const { NextResponse } = require('next/server')
const load = require('./helpers/load-typescript.cjs')

test('the configured minute cron authenticates Vercel GET requests and drains webhook and auction outbox work', async () => {
  const cron = require('../vercel.json').crons.find(
    (job) => job.path === '/api/cron/facebook-webhooks',
  )
  assert.ok(cron)
  assert.equal(cron.schedule, '* * * * *')
  const calls = []
  const route = load(
    `app${cron.path}/route.ts`,
    {
      'node:crypto': require('node:crypto'),
      'next/server': { NextResponse },
      '@/lib/supabase/server': { supabaseAdmin: () => ({}) },
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
    },
    { Buffer, process: { env: { CRON_SECRET: 'test-cron-secret' } } },
  )
  const request = (secret) =>
    new Request(`https://shop.example${cron.path}`, {
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
    })
  assert.equal((await route.GET(request())).status, 401)
  assert.equal((await route.GET(request('wrong'))).status, 401)
  assert.deepEqual(calls, [])
  const result = await route.GET(request('test-cron-secret'))
  assert.equal(result.status, 200)
  assert.deepEqual(await result.json(), { completed: 1 })
  assert.deepEqual(calls, ['webhooks', 'outbox', 'reminders'])
})
