const { test } = require('node:test')
const assert = require('node:assert/strict')
const { NextResponse } = require('next/server')
const load = require('./helpers/load-typescript.cjs')

const shipping = load(
  'lib/features/shipping/shipping-server.ts',
  {
    'server-only': {},
    'next/server': { NextResponse },
    '@/lib/auth': { canAccessTenant: async () => true, getActor: async () => null },
    '@/lib/supabase/server': { supabaseAdmin: () => ({}) },
    '@/lib/utils': { UUID: /^[a-f0-9-]{36}$/i },
  },
  { console, Error },
)

test('missing or malformed shipping encryption key returns an actionable configuration error', async () => {
  for (const message of [
    'SHIPPING_CREDENTIALS_ENCRYPTION_KEY_REQUIRED',
    'SHIPPING_CREDENTIALS_ENCRYPTION_KEY_INVALID',
  ]) {
    const response = shipping.shippingFailure(new Error(message))
    assert.equal(response.status, 503)
    const body = await response.json()
    assert.match(body.error, /SHIPPING_CREDENTIALS_ENCRYPTION_KEY/)
    assert.doesNotMatch(body.error, /SHIPPING_CREDENTIALS_ENCRYPTION_KEY_REQUIRED/)
  }
})
