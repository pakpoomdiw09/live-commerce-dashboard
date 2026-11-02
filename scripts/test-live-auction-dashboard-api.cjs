const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { NextRequest, NextResponse } = require('next/server')
const load = require('./helpers/load-typescript.cjs')
const templates = load('lib/features/commerce/auction-templates.ts')
const automation = load('lib/features/commerce/session-automation.ts', {
  './auction-templates': templates,
})

test('all-in-one API authorizes before reads, validates settings and normalizes templates without accepting client balances', async () => {
  const tenantId = randomUUID(),
    actor = randomUUID(),
    sessionId = randomUUID(),
    bankId = randomUUID()
  let denied = false,
    ready = true,
    rpcError = null
  const calls = []
  const api = load(
    'app/api/live-auction/session/route.ts',
    {
      'next/server': {},
      '@/lib/auth': { getActor: async () => ({ kind: 'user', id: actor }) },
      '@/lib/supabase/server': {
        supabaseAdmin: () => ({
          rpc: async (name, input) => {
            calls.push({ name, input })
            return { data: { id: sessionId, revision: 1 }, error: rpcError }
          },
        }),
      },
      '@/lib/features/commerce/auction-api': {
        authorizeAuction: async () =>
          denied ? NextResponse.json({ error: 'Forbidden' }, { status: 403 }) : null,
        auctionReply: (data, status = 200) => NextResponse.json(data, { status }),
      },
      '@/lib/utils': { UUID: /^[a-f0-9]{8}-[a-f0-9-]{27}$/i },
      '@/lib/features/commerce/live-cf-setup': load(
        'lib/features/commerce/live-cf-setup.ts',
        { './commerce-core': {} },
        { URL },
      ),
      '@/lib/features/commerce/live-cf-payment-link': { liveCfPaymentLinksReady: () => ready },
      '@/lib/features/commerce/session-automation': automation,
    },
    { console: { error() {} }, SyntaxError },
  )
  const post = (input) =>
    api.POST(
      new NextRequest('https://shop.example/api/live-auction/session', {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'content-type': 'application/json' },
      }),
    )
  const base = {
    tenantId,
    requestId: randomUUID(),
    action: 'start',
    pageId: '100',
    livePostId: 'https://www.facebook.com/watch/?v=456',
    settings: automation.defaultSessionAutomation(bankId),
  }
  denied = true
  assert.equal((await post(base)).status, 403)
  assert.equal(
    (
      await api.GET(
        new NextRequest(
          `https://shop.example/api/live-auction/session?tenantId=${tenantId}&sessionId=${sessionId}`,
        ),
      )
    ).status,
    403,
  )
  assert.equal(calls.length, 0)
  denied = false
  for (const settings of [
    { ...base.settings, keywords: ['1', '１'] },
    { ...base.settings, bankAccountId: 'invalid' },
    { ...base.settings, privateReply: 'true' },
    { ...base.settings, bidText: '{total}' },
  ])
    assert.equal((await post({ ...base, settings })).status, 400)
  assert.equal(calls.length, 0)
  ready = false
  assert.equal((await post({ ...base, action: 'settings', sessionId, revision: 0 })).status, 503)
  assert.equal(calls.length, 0)
  ready = true
  assert.equal(
    (
      await post({
        ...base,
        paid_amount: 999999,
        settings: {
          ...base.settings,
          keywords: [' RAISE '],
          privateText: '{name} {item} {price} {total}',
        },
      })
    ).status,
    201,
  )
  assert.equal(calls[0].name, 'configure_auction_session')
  assert.equal(calls[0].input.p_actor, actor)
  assert.equal(calls[0].input.p_input.livePostId, '456')
  assert.equal(calls[0].input.p_input.settings.keywords[0], 'raise')
  assert.equal(
    calls[0].input.p_input.settings.privateText,
    '{bidder_name} {product_name} {price} {total}',
  )
  assert.equal('paid_amount' in calls[0].input.p_input, false)
  assert.equal((await post({ ...base, action: 'settings', sessionId, revision: -1 })).status, 400)
  assert.equal((await post({ ...base, action: 'settings', sessionId, revision: 0 })).status, 200)
  rpcError = { code: '40001' }
  assert.equal((await post({ ...base, action: 'settings', sessionId, revision: 0 })).status, 409)
  rpcError = { code: '42501' }
  assert.equal((await post(base)).status, 404)
  rpcError = null
  assert.equal(
    (
      await api.GET(
        new NextRequest(
          `https://shop.example/api/live-auction/session?tenantId=${tenantId}&sessionId=${sessionId}`,
        ),
      )
    ).status,
    200,
  )
  assert.equal(calls.at(-1).name, 'live_auction_customer_dashboard')
  assert.equal(calls.at(-1).input.p_tenant, tenantId)
  assert.equal(
    (
      await post({
        tenantId,
        sessionId,
        requestId: randomUUID(),
        action: 'load_customers',
        fbIds: ['900', '900'],
      })
    ).status,
    200,
  )
  assert.equal(calls.at(-1).name, 'collect_auction_session_customers')
  assert.equal(calls.at(-1).input.p_fb_ids.length, 1)
  const before = calls.length
  for (const invalid of [[], ['invalid'], Array(501).fill('900')])
    assert.equal(
      (
        await post({
          tenantId,
          sessionId,
          requestId: randomUUID(),
          action: 'load_customers',
          fbIds: invalid,
        })
      ).status,
      400,
    )
  assert.equal(calls.length, before)
  assert.equal(
    (
      await post({
        tenantId,
        sessionId,
        requestId: randomUUID(),
        action: 'note',
        fbId: '900',
        note: ' เก็บรวมกล่อง ',
        revision: 0,
      })
    ).status,
    200,
  )
  assert.equal(calls.at(-1).name, 'save_auction_customer_note')
  assert.equal(calls.at(-1).input.p_note, 'เก็บรวมกล่อง')
  assert.equal(
    (
      await post({
        tenantId,
        sessionId,
        requestId: randomUUID(),
        action: 'note',
        fbId: '900',
        note: 'x'.repeat(501),
        revision: 0,
      })
    ).status,
    400,
  )
})
