const assert = require('node:assert/strict')
const { test } = require('node:test')
const { randomUUID } = require('node:crypto')
const { NextRequest, NextResponse } = require('next/server')
const load = require('./helpers/load-typescript.cjs')
const templates = load('lib/features/commerce/auction-templates.ts')
const automation = load('lib/features/commerce/session-automation.ts', {
  './auction-templates': templates,
})
const money = load('lib/features/commerce/live-session-types.ts')

test('workspace API restores scoped saved values and commits a single normalized request after owner authorization', async () => {
  const tenantId = randomUUID(),
    sessionId = randomUUID(),
    actorId = randomUUID(),
    bankId = randomUUID()
  const calls = []
  let denied = false
  let failedTable = null
  const settings = {
    ...automation.defaultSessionAutomation(bankId),
    keywords: ['raise'],
    privateText: '{bidder_name} {total} {bank_account}',
  }
  const rows = {
    live_sessions: [
      {
        id: sessionId,
        tenant_id: tenantId,
        page_id: '100',
        live_post_id: '456',
        auction_settings: settings,
      },
    ],
    auctions: [
      {
        id: randomUUID(),
        tenant_id: tenantId,
        page_id: '100',
        live_post_id: '456',
        start_price: 300,
        min_step: 25,
        shipping_fee: 47,
      },
    ],
  }
  const db = {
    from(table) {
      calls.push({ table })
      const filters = []
      const query = {
        select: () => query,
        order: () => query,
        limit: () => query,
        eq(key, value) {
          filters.push((row) => row[key] === value)
          return query
        },
        async maybeSingle() {
          if (table === failedTable) return { data: null, error: { code: '42501' } }
          return {
            data: rows[table].find((row) => filters.every((predicate) => predicate(row))) ?? null,
            error: null,
          }
        },
      }
      return query
    },
    async rpc(name, args) {
      calls.push({ name, args })
      return { data: { sessionId }, error: null }
    },
  }
  const api = load(
    'app/api/live-auction/workspace/route.ts',
    {
      'next/server': {},
      '@/lib/auth': { getActor: async () => ({ kind: 'user', id: actorId }) },
      '@/lib/supabase/server': { supabaseAdmin: () => db },
      '@/lib/features/commerce/auction-api': {
        authorizeAuction: async () =>
          denied ? NextResponse.json({ error: 'Forbidden' }, { status: 403 }) : null,
        auctionReply: (body, status = 200) => NextResponse.json(body, { status }),
      },
      '@/lib/features/commerce/auction-hosts': {
        auctionHostIds: async (_db, actor, page) => {
          assert.equal(actor, actorId)
          assert.equal(page, '100')
          return ['100', '999']
        },
      },
      '@/lib/features/commerce/live-cf-payment-link': { liveCfPaymentLinksReady: () => true },
      '@/lib/features/commerce/live-session-types': money,
      '@/lib/utils': { UUID: /^[a-f0-9-]{36}$/i },
      '@/lib/features/commerce/session-automation': automation,
    },
    { console: { error() {} }, Error, SyntaxError },
  )
  const post = (input) =>
    api.POST(
      new NextRequest('https://shop.example/api/live-auction/workspace', {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  const input = {
    tenantId,
    requestId: randomUUID(),
    pageId: '100',
    livePostId: '456',
    itemName: 'Saved item',
    startPrice: '300',
    minStep: '25',
    shippingFee: '47',
    settings,
    finance: { cost: '125.50', ads: '15', shipping: '7', fees: '3.25' },
  }
  denied = true
  assert.equal((await post(input)).status, 403)
  assert.equal(
    (
      await api.GET(
        new NextRequest(`https://shop.example/api/live-auction/workspace?tenantId=${tenantId}`),
      )
    ).status,
    403,
  )
  assert.equal(calls.length, 0)
  denied = false
  const restored = await (
    await api.GET(
      new NextRequest(
        `https://shop.example/api/live-auction/workspace?tenantId=${tenantId}&sessionId=${sessionId}`,
      ),
    )
  ).json()
  assert.equal(restored.round.shipping_fee, 47)
  assert.deepEqual(restored.settings.keywords, ['raise'])
  assert.equal(restored.settings.privateText, settings.privateText)
  assert.equal(
    (
      await api.GET(
        new NextRequest(
          `https://shop.example/api/live-auction/workspace?tenantId=${tenantId}&sessionId=${randomUUID()}`,
        ),
      )
    ).status,
    200,
  )
  for (const table of ['live_sessions', 'auctions']) {
    failedTable = table
    const response = await api.GET(
      new NextRequest(
        `https://shop.example/api/live-auction/workspace?tenantId=${tenantId}&pageId=100&livePostId=456`,
      ),
    )
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.ready, true)
    assert.deepEqual(body.bids, [])
    if (table === 'auctions') assert.equal(body.auction, null)
    else
      assert.equal(body.auction.shipping_fee, 47, 'session failures must not block auction reads')
  }
  failedTable = null
  const foreign = await (
    await api.GET(
      new NextRequest(
        `https://shop.example/api/live-auction/workspace?tenantId=${randomUUID()}&pageId=100&livePostId=456`,
      ),
    )
  ).json()
  assert.equal(foreign.auction, null, 'never restore another tenant’s auction')
  const anotherLive = await (
    await api.GET(
      new NextRequest(
        `https://shop.example/api/live-auction/workspace?tenantId=${tenantId}&pageId=100&livePostId=789`,
      ),
    )
  ).json()
  assert.equal(anotherLive.auction, null, 'never restore a different live’s auction')
  calls.length = 0
  for (const patch of [
    { shippingFee: '-1' },
    { minStep: '0' },
    { finance: { cost: '1.001', ads: '0', shipping: '0', fees: '0' } },
    { sessionId, revision: -1 },
  ])
    assert.equal((await post({ ...input, ...patch })).status, 400)
  assert.equal(calls.length, 0)
  assert.equal(
    (
      await post({
        ...input,
        paid_amount: 999,
        settings: {
          ...settings,
          keywords: [' RAISE '],
          bidText: '{ชื่อลูกค้า} {ราคา}',
          auto_accumulate_summary: false,
        },
      })
    ).status,
    200,
  )
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'save_auction_workspace')
  assert.equal(calls[0].args.p_input.shippingFee, 47)
  assert.deepEqual(Array.from(calls[0].args.p_input.settings.keywords), ['raise'])
  assert.equal(calls[0].args.p_input.settings.bidText, '{bidder_name} {price}')
  assert.equal(calls[0].args.p_input.settings.auto_accumulate_summary, false)
  assert.equal(calls[0].args.p_input.finance.cost, 125.5)
  assert.equal(calls[0].args.p_input.finance.fees, 3.25)
  assert.equal('paid_amount' in calls[0].args.p_input, false)
  assert.deepEqual(Array.from(calls[0].args.p_input.hostIds), ['100', '999'])

  const emptySettings = {
    ...settings,
    keywords: [],
    closeKeywords: [],
    publicReply: false,
    privateReply: false,
    bidText: '',
    closeText: '',
    privateText: '',
  }
  const blankDraft = await post({
    ...input,
    requestId: randomUUID(),
    settings: emptySettings,
  })
  assert.equal(
    blankDraft.status,
    200,
    'new workspaces can save with no implicit keywords or replies',
  )
  assert.deepEqual(Array.from(calls.at(-1).args.p_input.settings.keywords), [])
  assert.deepEqual(Array.from(calls.at(-1).args.p_input.settings.closeKeywords), [])
  assert.equal(calls.at(-1).args.p_input.settings.privateText, '')
  assert.equal(calls.at(-1).args.p_input.settings.auto_accumulate_summary, true)

  assert.equal(
    (
      await post({
        ...input,
        requestId: randomUUID(),
        settings: {
          ...settings,
          keywords: [' RAISE ', 'raise', 'raise', '❌', '❌'],
          closeKeywords: ['❌', '❌', '❌'],
        },
      })
    ).status,
    200,
  )
  assert.deepEqual(Array.from(calls.at(-1).args.p_input.settings.keywords), [
    'raise',
    'raise',
    'raise',
    '❌',
    '❌',
  ])
  assert.deepEqual(Array.from(calls.at(-1).args.p_input.settings.closeKeywords), ['❌', '❌', '❌'])
  for (const empty of ['', null]) {
    assert.equal(
      (
        await post({
          ...input,
          requestId: randomUUID(),
          finance: { cost: empty, ads: empty, shipping: empty, fees: empty },
        })
      ).status,
      200,
    )
    assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).args.p_input.finance)), {
      cost: 0,
      ads: 0,
      shipping: 0,
      fees: 0,
    })
  }
  for (const invalid of [undefined, -1, '1.005', true, {}, 'no']) {
    assert.equal(
      (await post({ ...input, finance: { ...input.finance, fees: invalid } })).status,
      400,
    )
  }
})
