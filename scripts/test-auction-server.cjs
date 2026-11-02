const { test } = require('node:test')
const assert = require('node:assert/strict')
const { NextRequest, NextResponse } = require('next/server')
const load = require('./helpers/load-typescript.cjs')
const parser = load('lib/integrations/facebook/auction-comment-parser.ts')
const routing = load('lib/features/comments/live-comment-routing.ts', { './comment-rules': {} })
const tenantId = '11111111-1111-4111-8111-111111111111'
const auctionId = '22222222-2222-4222-8222-222222222222'
const orderId = '33333333-3333-4333-8333-333333333333'
const silent = { info() {}, warn() {}, error() {} }

function fixture({
  result = { status: 'accepted', amount: 200, name: 'Buyer', isOpening: true },
  privateFails = false,
  missingSchema = false,
  missingLink = false,
} = {}) {
  const tables = {
    auctions: [
      {
        id: auctionId,
        tenant_id: tenantId,
        page_id: '100',
        live_post_id: '456',
        live_post_aliases: [],
        host_ids: ['999'],
        item_name: 'เหรียญ',
        start_price: 200,
        min_step: 20,
        current_price: 220,
        shipping_fee: 50,
        order_id: orderId,
        leading_bidder_id: '900',
        leading_bidder_name: 'Buyer',
        created_at: '2026-01-01',
      },
    ],
    tenants: [{ id: tenantId, page_id: '100', page_access_token: 'TEST_SECRET', is_active: true }],
    auction_deliveries: [],
  }
  const calls = { rpc: [], public: [], private: [], resolve: [] }
  const db = {
    from(table) {
      const predicates = []
      let patch = null
      const finish = () => {
        if (missingSchema && table === 'auctions') return { data: null, error: { code: '42P01' } }
        const rows = tables[table].filter((row) => predicates.every((test) => test(row)))
        if (patch) rows.forEach((row) => Object.assign(row, patch))
        return { data: rows.map((row) => ({ ...row })), error: null }
      }
      const q = {
        select: () => q,
        order: () => q,
        limit: () => q,
        update(value) {
          patch = value
          return q
        },
        eq(key, value) {
          predicates.push((row) => row[key] === value)
          return q
        },
        lte(key, value) {
          predicates.push((row) => row[key] <= value)
          return q
        },
        lt(key, value) {
          predicates.push((row) => row[key] < value)
          return q
        },
        then(resolve, reject) {
          return Promise.resolve(finish()).then(resolve, reject)
        },
        async maybeSingle() {
          const answer = finish()
          return { ...answer, data: answer.data?.[0] ?? null }
        },
        async single() {
          return q.maybeSingle()
        },
      }
      return q
    },
    async rpc(name, input) {
      calls.rpc.push({ name, input })
      return { data: result, error: null }
    },
  }
  const api = load(
    'lib/features/commerce/auction-server.ts',
    {
      'server-only': {},
      '@/lib/supabase/server': { supabaseAdmin: () => db },
      '@/lib/integrations/facebook/client': {
        pageTokenFor: (row) => row.page_access_token,
        replyToComment: async (...args) => {
          calls.public.push(args)
        },
        sendPrivateReply: async (...args) => {
          calls.private.push(args)
          if (privateFails) throw { code: 'PROVIDER_TIMEOUT' }
        },
        resolveLiveCommentVideo: async (...args) => {
          calls.resolve.push(args)
          return { ids: ['456'], live: true }
        },
      },
      './live-cf-payment-link': {
        createLiveCfPaymentLink: () =>
          missingLink ? null : 'https://shop.example/pay/live/signed',
      },
      './customer-tabs-server': { tabForOrder: async () => null },
      '@/lib/integrations/facebook/auction-comment-parser': parser,
      '@/lib/features/comments/live-comment-routing': routing,
    },
    { console: silent },
  )
  const steps = new Map()
  const receive = (text, sender = '900', post = '456') =>
    api.handleAuctionComment({
      value: { message: text, comment_id: '456_789', post_id: post, from: { id: sender } },
      tenantId,
      pageId: '100',
      token: 'TEST_SECRET',
      execution: {
        event: { id: 'event', created_at: '2026-02-01' },
        assertLease: async () => {},
        once: async (key, send) => {
          if (!steps.has(key)) steps.set(key, await send())
          return steps.get(key)
        },
      },
    })
  return { api, receive, tables, calls }
}

test('auction routing uses scoped rows, separates host/customer commands and checkpoints confirmations', async () => {
  const f = fixture()
  assert.equal(await f.receive('เปิดให้ 10 ลุ้น'), true)
  await f.receive('เปิดให้ 10 ลุ้น')
  assert.equal(f.calls.rpc[0].input.p_kind, 'OPENING_BID')
  assert.equal(f.calls.rpc[0].input.p_tenant, tenantId)
  assert.equal(f.calls.public.length, 1)
  assert.match(f.calls.public[0][2], /200/)
  await f.receive('1', '100')
  assert.equal(f.calls.rpc.at(-1).input.p_kind, 'HOST_CONTROL')
  assert.equal(f.calls.rpc.at(-1).input.p_control, '1')
  await f.receive('1', '901')
  assert.equal(f.calls.rpc.at(-1).input.p_kind, 'STEP_BID')
  const before = f.calls.rpc.length
  await f.receive('ปิด', '901')
  assert.equal(f.calls.rpc.length, before, 'an ordinary customer cannot close')
  await f.receive('เคาะ 3', '999')
  assert.equal(f.calls.rpc.at(-1).input.p_control, '3')
})

test('Page-post resolution pins a verified alias; missing optional schema falls through to ordinary CF', async () => {
  const f = fixture()
  assert.equal(await f.receive('250', '900', '100_777'), true)
  assert.equal(f.calls.resolve.length, 1)
  assert.ok(f.tables.auctions[0].live_post_aliases.includes('100_777'))
  await f.receive('300', '901', '100_777')
  assert.equal(f.calls.resolve.length, 1, 'saved alias avoids repeated Graph lookups')
  assert.equal(await fixture({ missingSchema: true }).receive('250'), false)
})

test('closing bills include shipping and target the winning comment; ambiguous sends never repeat', async () => {
  const f = fixture({ privateFails: true })
  f.tables.auction_deliveries.push(
    {
      id: 'a',
      auction_id: auctionId,
      channel: 'private',
      comment_id: 'winning-comment',
      status: 'pending',
    },
    {
      id: 'b',
      auction_id: auctionId,
      channel: 'public',
      comment_id: 'host-close-comment',
      status: 'pending',
    },
  )
  await f.api.deliverAuctionNotifications(auctionId)
  assert.equal(f.calls.private.length, 1)
  assert.equal(f.calls.private[0][1], 'winning-comment')
  assert.match(f.calls.private[0][2], /270 บาท/)
  assert.match(f.calls.private[0][2], /https:\/\/shop.example\/pay\/live\/signed/)
  assert.equal(f.calls.public[0][1], 'host-close-comment')
  assert.equal(f.tables.auction_deliveries[0].status, 'requires_review')
  assert.equal(f.tables.auction_deliveries[1].status, 'sent')
  await f.api.deliverAuctionNotifications(auctionId)
  assert.equal(f.calls.private.length, 1)
  assert.equal(f.calls.public.length, 1)
})

test('two outbox runners cannot dispatch the same pending bill twice', async () => {
  const f = fixture()
  f.tables.auction_deliveries.push({
    id: 'a',
    auction_id: auctionId,
    channel: 'private',
    comment_id: 'winner',
    status: 'pending',
  })
  await Promise.all([
    f.api.deliverAuctionNotifications(auctionId),
    f.api.deliverAuctionNotifications(auctionId),
  ])
  assert.equal(f.calls.private.length, 1)
  assert.equal(f.tables.auction_deliveries[0].status, 'sent')
})

test('auction API rejects anonymous, foreign-shop, cross-origin and disabled requests before data access', async () => {
  let actor = null,
    member = false,
    enabled = true,
    checks = 0
  const api = load(
    'lib/features/commerce/auction-api.ts',
    {
      'server-only': {},
      'next/server': { NextResponse },
      '@/lib/auth': {
        getActor: async () => actor,
        canAccessTenant: async (_actor, id, role) => {
          checks++
          assert.equal(id, tenantId)
          assert.equal(role, 'owner')
          return member
        },
      },
      '@/lib/feature-flags': { isFeatureEnabled: () => enabled },
      '@/lib/utils': { UUID: /^[a-f0-9-]{36}$/ },
    },
    { console: silent, SyntaxError },
  )
  const req = new NextRequest('https://shop.example/api/live-cf/auction', {
    headers: { origin: 'https://shop.example' },
  })
  assert.equal((await api.authorizeAuction(req, tenantId, true)).status, 403)
  actor = { kind: 'user', id: 'owner' }
  assert.equal((await api.authorizeAuction(req, tenantId, true)).status, 403)
  member = true
  assert.equal(await api.authorizeAuction(req, tenantId, true), null)
  const before = checks
  assert.equal(
    (
      await api.authorizeAuction(
        new NextRequest(req.url, { headers: { origin: 'https://evil.example' } }),
        tenantId,
        true,
      )
    ).status,
    403,
  )
  assert.equal(checks, before)
  enabled = false
  assert.equal((await api.authorizeAuction(req, tenantId)).status, 404)
})
