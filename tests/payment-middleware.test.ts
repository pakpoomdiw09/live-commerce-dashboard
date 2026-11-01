import assert from 'node:assert/strict'
import * as crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { NextRequest, NextResponse } from 'next/server'

const require = createRequire(import.meta.url)
const load = require('../scripts/helpers/load-typescript.cjs')
const quietConsole = { error() {}, warn() {} }

function paymentTokens() {
  return load(
    'lib/features/commerce/live-cf-payment-link.ts',
    { 'server-only': {}, 'node:crypto': crypto },
    {
      Buffer,
      URL,
      process: {
        env: {
          LIVE_CF_PAYMENT_LINK_SECRET: 'test-only-payment-link-secret-0123456789',
          LIVE_CF_APP_URL: 'https://shop.example',
          NODE_ENV: 'production',
        },
      },
    },
  )
}

function middleware(mode: 'anonymous' | 'auth-error' | 'missing-env' | 'client-error') {
  const session = load(
    'lib/supabase/middleware.ts',
    {
      '@supabase/ssr': {
        createServerClient: () => {
          if (mode === 'client-error') throw new Error('Simulated session client failure')
          return {
            auth: {
              getUser: async () => {
                if (mode === 'auth-error') throw new Error('Simulated invalid session')
                return { data: { user: null } }
              },
            },
          }
        },
      },
      'next/server': { NextResponse },
      '@/lib/supabase/env': {
        getSupabaseEnv: () =>
          mode === 'missing-env' ? null : { url: 'https://db.example', anonKey: 'test-only' },
      },
      '@/lib/oauth': { safeAuthNext: () => '/' },
    },
    { URL, console: quietConsole },
  )
  return load(
    'middleware.ts',
    { 'next/server': { NextResponse }, '@/lib/supabase/middleware': session },
    { console: quietConsole },
  ).middleware as (request: NextRequest) => Promise<NextResponse>
}

test('anonymous buyers can open a signed Live CF payment link without a login redirect', async () => {
  const tokens = paymentTokens()
  const now = Date.now()
  const orderId = '11111111-1111-4111-8111-111111111111'
  const url = tokens.createLiveCfPaymentLink(orderId, now) as string
  const token = new URL(url).pathname.split('/').at(-1)!
  assert.equal(tokens.verifyLiveCfPaymentToken(token, now)?.orderId, orderId)
  const response = await middleware('anonymous')(new NextRequest(url))
  assert.equal(response.headers.get('x-middleware-next'), '1')
  assert.equal(response.headers.get('location'), null)
})

test('payment paths stay public through missing config, invalid sessions, and middleware fallback', async () => {
  for (const mode of ['missing-env', 'auth-error', 'client-error'] as const) {
    const response = await middleware(mode)(
      new NextRequest('https://shop.example/pay/live/token?campaign=messenger'),
    )
    assert.equal(response.headers.get('x-middleware-next'), '1', mode)
    assert.equal(response.headers.get('location'), null, mode)
  }
})

test('dashboard and other payment paths still require login in every middleware path', async () => {
  for (const mode of ['anonymous', 'auth-error', 'missing-env', 'client-error'] as const) {
    for (const path of [
      '/settings',
      '/pay/admin',
      '/pay/live-admin/token',
      '/pay/liveevil/token',
    ]) {
      const response = await middleware(mode)(new NextRequest(`https://shop.example${path}`))
      assert.equal(response.status, 307, `${mode}: ${path}`)
      assert.equal(new URL(response.headers.get('location')!).pathname, '/login')
    }
  }
})

test('public payment routing retains HMAC tamper protection and 24-hour expiry', () => {
  const tokens = paymentTokens()
  const now = Date.now()
  const orderId = '11111111-1111-4111-8111-111111111111'
  const url = tokens.createLiveCfPaymentLink(orderId, now) as string
  const token = new URL(url).pathname.split('/').at(-1)!
  assert.ok(tokens.verifyLiveCfPaymentToken(token, now))
  assert.equal(
    tokens.verifyLiveCfPaymentToken(
      token.replace(orderId, '22222222-2222-4222-8222-222222222222'),
      now,
    ),
    null,
  )
  assert.equal(tokens.verifyLiveCfPaymentToken(token, now + 24 * 60 * 60_000 + 1000), null)
})
