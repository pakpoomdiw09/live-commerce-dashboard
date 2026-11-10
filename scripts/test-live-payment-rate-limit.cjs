const { test } = require('node:test')
const assert = require('node:assert/strict')
const load = require('./helpers/load-typescript.cjs')

const rateLimit = load('lib/features/commerce/live-payment-rate-limit.ts', {
  'server-only': {},
  'node:crypto': require('node:crypto'),
})

test('unverified forwarding headers do not create an IP bucket while per-order limits stay active', async () => {
  const calls = []
  const db = {
    rpc: async (name, args) => {
      calls.push({ name, args })
      return { data: true, error: null }
    },
  }

  const ipResult = await rateLimit.limitLivePaymentIp(
    db,
    new Headers({
      'x-real-ip': '198.51.100.20',
      'x-vercel-forwarded-for': '203.0.113.8',
      'x-forwarded-for': '192.0.2.9',
    }),
    'post',
  )
  assert.equal(ipResult, 'allowed')
  assert.deepEqual(calls, [])

  const orderResult = await rateLimit.limitLivePaymentOrder(db, 'order-fixture', 'post')
  assert.equal(orderResult, 'allowed')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'commerce_rate_limit')
  assert.equal(calls[0].args.p_max, 5)
  assert.match(calls[0].args.p_bucket, /^live-pay:v1:post:order:/)
})
