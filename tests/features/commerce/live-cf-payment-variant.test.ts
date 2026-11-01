import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import * as crypto from 'node:crypto'
import { test } from 'node:test'
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '../../../lib/features/commerce/commerce-core'
const require = createRequire(import.meta.url),
  load = require('../../../scripts/helpers/load-typescript.cjs')
const orderId = '11111111-1111-4111-8111-111111111111',
  variantId = '22222222-2222-4222-8222-222222222222'
function fixture() {
  const tokens = load(
    'lib/features/commerce/live-cf-payment-link.ts',
    { 'server-only': {}, 'node:crypto': crypto },
    {
      Buffer,
      URL,
      process: {
        env: {
          LIVE_CF_PAYMENT_LINK_SECRET: 'test-only-payment-secret-at-least-32-characters',
          LIVE_CF_APP_URL: 'https://shop.example',
          NODE_ENV: 'production',
        },
      },
    },
  )
  const state = {
    calls: [] as { name: string; args: Record<string, unknown> }[],
    rate: true,
    error: null as null | { message: string; code: string },
  }
  const route = load(
    'app/api/live-cf/payment-variant/route.ts',
    {
      'next/server': { NextResponse },
      '@/lib/features/commerce/live-cf-payment-link': tokens,
      '@/lib/features/commerce/commerce-core': { isUuid },
      '@/lib/feature-flags': { isFeatureEnabled: () => true },
      '@/lib/supabase/server': {
        supabaseAdmin: () => ({
          rpc: async (name: string, args: Record<string, unknown>) => {
            state.calls.push({ name, args })
            return name === 'commerce_rate_limit'
              ? { data: state.rate, error: null }
              : {
                  data: {
                    variant_id: variantId,
                    variant_label: 'สี: ดำ',
                    amount: 259,
                    confirmed_at: new Date().toISOString(),
                  },
                  error: state.error,
                }
          },
        }),
      },
    },
    { console: { error() {} } },
  )
  const token = new URL(tokens.createLiveCfPaymentLink(orderId)).pathname.split('/').at(-1)!
  const send = (body: Record<string, unknown>, origin = 'https://shop.example') =>
    route.POST(
      new NextRequest('https://shop.example/api/live-cf/payment-variant', {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ token, variantId, ...body }),
      }),
    ) as Promise<NextResponse>
  return { state, tokens, token, send }
}
test('signed customer variant selection needs no login and sends only verified order and variant IDs to the atomic RPC', async () => {
  const f = fixture(),
    response = await f.send({ amount: 1, tenantId: 'foreign', orderId: 'foreign' })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).amount, 259)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(Object.keys(f.state.calls[1].args).sort(), ['p_order', 'p_variant'])
  assert.equal(f.state.calls[1].args.p_order, orderId)
  assert.equal(f.state.calls[1].args.p_variant, variantId)
})
test('tampered/expired tokens, cross-origin calls and malformed variants cannot reach selection writes', async () => {
  const f = fixture()
  const bad = f.token.replace(orderId, '33333333-3333-4333-8333-333333333333')
  assert.equal((await f.send({ token: bad })).status, 401)
  const expired = new URL(
    f.tokens.createLiveCfPaymentLink(orderId, Date.now() - 25 * 3600000),
  ).pathname
    .split('/')
    .at(-1)
  assert.equal((await f.send({ token: expired })).status, 401)
  assert.equal((await f.send({}, 'https://evil.example')).status, 403)
  assert.equal((await f.send({ variantId: 'invalid' })).status, 400)
  assert.equal(f.state.calls.length, 0)
  f.state.rate = false
  assert.equal((await f.send({})).status, 429)
  assert.equal(f.state.calls.length, 1)
})
test('sold-out, foreign or locked variants produce actionable errors without accepting a client quote', async () => {
  const f = fixture()
  for (const message of [
    'LIVE_CF_VARIANT_SOLD_OUT',
    'LIVE_CF_VARIANT_INVALID',
    'LIVE_CF_SELECTION_LOCKED',
    'LIVE_CF_PAYMENT_IN_PROGRESS',
  ]) {
    f.state.error = { message, code: 'P0001' }
    assert.equal((await f.send({})).status, 409)
  }
})
