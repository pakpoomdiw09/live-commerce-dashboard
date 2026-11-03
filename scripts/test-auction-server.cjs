const { test } = require('node:test')
const assert = require('node:assert/strict')
const { NextRequest, NextResponse } = require('next/server')
const load = require('./helpers/load-typescript.cjs')
const parser = load('lib/integrations/facebook/auction-comment-parser.ts')
const routing = load('lib/features/comments/live-comment-routing.ts', { './comment-rules': {} })
const templates = load('lib/features/commerce/auction-templates.ts')
const tenantId = '11111111-1111-4111-8111-111111111111'
const auctionId = '22222222-2222-4222-8222-222222222222'
const orderId = '33333333-3333-4333-8333-333333333333'
const silent = { info() {}, warn() {}, error() {} }

function fixture({
  result = { status: 'accepted', amount: 200, name: 'Buyer', isOpening: true },
  privateFails = false,
  missingSchema = false,
  missingLink = false,
  tab = null,
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
        status: 'active',
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
    live_sessions: [],
    tenants: [{ id: tenantId, page_id: '100', page_access_token: 'TEST_SECRET', is_active: true }],
    auction_deliveries: [],
    messages: [],
  }
  const calls = { rpc: [], public: [], private: [], resolve: [], timeline: [] }
  let currentSender = null
  const db = {
    from(table) {
      const predicates = []
      let ordering = null
      let rowLimit = Infinity
      let patch = null
      const finish = () => {
        if (missingSchema && table === 'auctions') return { data: null, error: { code: '42P01' } }
        let rows = tables[table].filter((row) => predicates.every((test) => test(row)))
        if (ordering) {
          const { key, ascending } = ordering
          rows.sort(
            (a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (ascending ? 1 : -1),
          )
        }
        rows = rows.slice(0, rowLimit)
        if (patch) rows.forEach((row) => Object.assign(row, patch))
        return { data: rows.map((row) => ({ ...row })), error: null }
      }
      const q = {
        select: () => q,
        order(key, { ascending = true } = {}) {
          ordering = { key, ascending }
          return q
        },
        limit(value) {
          rowLimit = value
          return q
        },
        update(value) {
          patch = value
          return q
        },
        eq(key, value) {
          predicates.push((row) => row[key] === value)
          return q
        },
        in(key, values) {
          if (key === 'live_post_id') assert.ok(values.every((id) => /^\d+(?:_\d+)?$/.test(id)))
          predicates.push((row) => values.includes(row[key]))
          return q
        },
        is(key, value) {
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
      calls.timeline.push('rpc:' + name)
      calls.rpc.push({ name, input })
      if (name === 'confirm_live_auction_winner') {
        const auction = tables.auctions.find((row) => row.id === input.p_auction)
        if (auction.leading_bidder_id !== currentSender)
          return { data: { status: 'not_winner' }, error: null }
        if (auction.winner_confirmation_comment_id)
          return { data: { status: 'already_confirmed' }, error: null }
        auction.winner_confirmation_comment_id = '456_789'
        for (const delivery of tables.auction_deliveries) {
          if (delivery.auction_id === auction.id && delivery.status === 'awaiting_confirmation') {
            delivery.status = 'pending'
            delivery.comment_id = '456_789'
          }
        }
        return { data: { status: 'confirmed' }, error: null }
      }
      return { data: result, error: null }
    },
  }
  const api = load(
    'lib/features/commerce/auction-server.ts',
    {
      'server-only': {},
      './customer-tab-types': load('lib/features/commerce/customer-tab-types.ts'),
      '@/lib/supabase/server': { supabaseAdmin: () => db },
      '@/lib/integrations/facebook/client': {
        pageTokenFor: (row) => row.page_access_token,
        replyToComment: async (...args) => {
          calls.timeline.push('public')
          calls.public.push(args)
        },
        sendAuctionPrivateReply: async (...args) => {
          calls.timeline.push('private')
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
      './customer-tabs-server': {
        tabForOrder: async () => tab,
        customerTabAccount: async () => 'KTB 9260337828',
        customerTabSummary: async () => ({
          link: 'https://shop.example/pay/live/signed',
          account: 'KTB 9260337828',
          privateText: 'ยอดรวม 1,000 บาท โอนแล้ว 200 บาท ยอดค้างสุทธิ 800 บาท',
        }),
      },
      './auction-templates': templates,
      '@/lib/integrations/facebook/auction-comment-parser': parser,
      '@/lib/features/comments/live-comment-routing': routing,
    },
    { console: silent },
  )
  const steps = new Map()
  const receive = (text, sender = '900', post = '456') => {
    currentSender = sender
    return api.handleAuctionComment({
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
  }
  return { api, receive, tables, calls }
}

test('auction routing uses scoped rows, separates host/customer commands and checkpoints confirmations', async () => {
  const f = fixture()
  f.tables.auctions[0].session_automation = {
    keywords: ['1'],
    countEnabled: true,
    closeEnabled: true,
    heartCloses: false,
  }
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

test('auction keywords and close words do not fall back to hardcoded defaults', () => {
  assert.equal(parser.parseAuctionComment('+1').type, 'IGNORE')
  assert.equal(parser.parseAuctionComment('กด 1').type, 'IGNORE')
  assert.equal(parser.parseAuctionComment('ปิด', true).type, 'IGNORE')
  assert.equal(parser.parseAuctionComment('1').type, 'NUMERIC_BID')
  assert.equal(parser.parseAuctionComment('1').amount, 1)
})

test('auction keywords never run against an unrelated post or a closed round without an active live session', async () => {
  const f = fixture()
  assert.equal(await f.receive('1', '900', '999'), false)
  assert.equal(f.calls.rpc.length, 0)
  assert.equal(f.calls.private.length, 0)

  f.tables.auctions[0].status = 'closed'
  assert.equal(await f.receive('1', '900'), false)
  assert.equal(f.calls.rpc.length, 0)
  assert.equal(f.calls.private.length, 0)
})

test('seller-defined bid words record silently and only a trusted host can use the configured close word', async () => {
  const f = fixture()
  f.tables.auctions[0].session_automation = {
    keywords: ['เคาะ'],
    closeKeywords: ['จบรายการ'],
    countEnabled: false,
    closeEnabled: true,
    heartCloses: false,
  }
  await f.receive('เคาะ')
  assert.equal(f.calls.rpc.at(-1).input.p_kind, 'STEP_BID')
  assert.equal(f.calls.public.length, 0)
  assert.equal(await f.receive('CF A1'), true, 'auction posts stay isolated from the CF pipeline')
  const count = f.calls.rpc.length
  await f.receive('จบรายการ', '900')
  await f.receive('❤️', '100')
  await f.receive('3', '100')
  assert.equal(f.calls.rpc.length, count)
  await f.receive('จบรายการ', '100')
  assert.equal(f.calls.rpc.at(-1).input.p_control, 'close')
  f.tables.auctions[0].session_automation.closeKeywords = ['❌', '🛑']
  for (const sender of ['100', '999']) {
    for (const text of ['❌', '🛑']) {
      await f.receive(text, sender)
      assert.equal(f.calls.rpc.at(-1).input.p_control, 'close')
    }
  }
  const closed = f.calls.rpc.length
  await f.receive('❌', '900')
  await f.receive('🛑', '900')
  assert.equal(f.calls.rpc.length, closed)
})

test('an active live is found beyond 100 newer rounds and cannot match a foreign tenant or Page', async () => {
  const f = fixture()
  const active = f.tables.auctions[0]
  f.tables.auctions.push(
    ...Array.from({ length: 150 }, (_, index) => ({
      ...active,
      id: `history-${index}`,
      live_post_id: String(1000 + index),
      status: 'closed',
      created_at: '2026-01-20',
    })),
  )
  f.tables.auctions.push(
    { ...active, id: 'foreign-tenant', tenant_id: 'foreign', created_at: '2026-01-25' },
    { ...active, id: 'foreign-page', page_id: '200', created_at: '2026-01-25' },
  )
  assert.equal(await f.receive('250'), true)
  assert.equal(f.calls.rpc.at(-1).input.p_auction, auctionId)
  assert.equal(f.calls.resolve.length, 0)
})

test('closed rounds cannot receive late bids, even while their live session remains open', async () => {
  const f = fixture()
  f.tables.auctions[0].status = 'closed'
  f.tables.live_sessions.push({
    id: 'live',
    tenant_id: tenantId,
    page_id: '100',
    live_post_id: '456',
    ended_at: null,
  })
  f.tables.auctions.push({
    ...f.tables.auctions[0],
    id: 'other-live',
    live_post_id: '777',
    status: 'active',
    created_at: '2026-01-25',
  })
  assert.equal(await f.receive('250'), true)
  assert.equal(f.calls.rpc.length, 0)
  // A round created after this event must not capture an older queued bid.
  f.tables.auctions.push({
    ...f.tables.auctions[0],
    id: 'future-round',
    status: 'active',
    created_at: '2026-03-01',
  })
  assert.equal(await f.receive('300'), true)
  assert.equal(f.calls.rpc.length, 0)
})

test('auction keywords require an explicit post or video ID match', async () => {
  const f = fixture()
  f.tables.auctions[0].session_automation = {
    keywords: ['raise'],
    closeKeywords: ['stop'],
    closeEnabled: true,
  }
  assert.equal(await f.receive('raise', '900', '100_777'), false)
  assert.equal(f.calls.rpc.length, 0)
  assert.equal(f.calls.resolve.length, 0)
  assert.deepEqual(f.tables.auctions[0].live_post_aliases, [])
})

test('unmatched Page posts are ignored; missing optional auction schema falls through to ordinary CF', async () => {
  const f = fixture()
  assert.equal(await f.receive('250', '900', '100_777'), false)
  assert.equal(f.calls.resolve.length, 0)
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

test('only the latest winner keyword releases both replies to the confirmation comment with frozen price and real totals', async () => {
  const f = fixture({
    tab: {
      total_amount: 350,
      paid_amount: 0,
      remaining_amount: 350,
      shipping_fee: 50,
      customer_tab_items: [
        { item_name: 'เหรียญ', amount: 300, order_type: 'auction', cancelled: false },
      ],
    },
  })
  const auction = f.tables.auctions[0]
  Object.assign(auction, {
    status: 'closed',
    closed_at: '2026-01-02',
    current_price: 300,
    session_automation: { keywords: ['1'], closeKeywords: ['x', '❌', '321'] },
    bid_reply_template: '{ชื่อลูกค้า} {รายการ} {ราคา} {ยอดรวมสะสม} {เลขบัญชี}',
    private_reply_template: '{ชื่อลูกค้า} {รายการ} {ราคา} {ยอดรวมสะสม} {เลขบัญชี}',
  })
  f.tables.live_sessions.push({
    id: 'live',
    tenant_id: tenantId,
    page_id: '100',
    live_post_id: '456',
    ended_at: null,
  })
  for (const channel of ['public', 'private'])
    f.tables.auction_deliveries.push({
      id: channel,
      auction_id: auctionId,
      channel,
      comment_id: 'winning-bid',
      status: 'awaiting_confirmation',
    })
  await f.api.deliverAuctionNotifications(auctionId)
  assert.equal(f.calls.private.length + f.calls.public.length, 0)
  await f.receive('1', '901')
  assert.equal(
    f.calls.rpc.some((call) => call.name === 'confirm_live_auction_winner'),
    false,
    'non-winners are rejected before the confirmation RPC',
  )
  assert.equal(
    f.calls.private.length + f.calls.public.length,
    0,
    'a non-winner cannot receive or release the bill',
  )
  await f.receive('1', '900')
  assert.equal(f.calls.private.length, 1)
  assert.equal(f.calls.public.length, 1)
  assert.equal(f.calls.private[0][1], '456_789')
  assert.equal(f.calls.public[0][1], '456_789')
  assert.match(f.calls.public[0][2], /Buyer เหรียญ 300 350 KTB 9260337828/)
  assert.match(f.calls.private[0][2], /Buyer เหรียญ 300 350 KTB 9260337828/)
  assert.match(f.calls.private[0][3], /ค่าจัดส่งครั้งเดียว: 50 บาท/)
  assert.ok(!/[{}]/.test(f.calls.private[0][2]), 'all Thai template placeholders resolve')
  assert.equal(auction.current_price, 300)
  await f.receive('1', '900')
  assert.equal(f.calls.private.length, 1, 'repeated confirmations never resend')
  assert.equal(f.calls.public.length, 1)
})

test('an unconfirmed winner can confirm during the next round; other customers still bid without receiving bills', async () => {
  const f = fixture()
  Object.assign(f.tables.auctions[0], {
    status: 'closed',
    closed_at: '2026-01-02',
    session_automation: { keywords: ['1'], closeKeywords: ['x'] },
  })
  f.tables.live_sessions.push({
    id: 'live',
    tenant_id: tenantId,
    page_id: '100',
    live_post_id: '456',
    ended_at: null,
  })
  const nextId = 'next-active'
  f.tables.auctions.push({
    ...f.tables.auctions[0],
    id: nextId,
    status: 'active',
    created_at: '2026-01-20',
  })
  await f.receive('1', '901')
  assert.equal(f.calls.rpc.at(-1).input.p_auction, nextId)
  assert.equal(f.calls.rpc.at(-1).name, 'process_live_auction_comment')
  assert.equal(f.calls.private.length, 0)
  await f.receive('1', '900')
  assert.equal(f.calls.rpc.at(-1).name, 'confirm_live_auction_winner')
  assert.equal(f.calls.rpc.at(-1).input.p_auction, auctionId)
  await f.receive('1', '900')
  assert.equal(
    f.calls.rpc.at(-1).name,
    'process_live_auction_comment',
    'after confirmation, the winner can bid in the next round',
  )
  assert.equal(f.calls.rpc.at(-1).input.p_auction, nextId)
})

test('auction templates and switches control replies and use the cumulative net balance', async () => {
  const silentBid = fixture()
  silentBid.tables.auctions[0].public_reply_enabled = false
  await silentBid.receive('เปิด')
  assert.equal(silentBid.calls.public.length, 0)
  assert.equal(silentBid.calls.rpc.length, 1, 'bids still count while replies are disabled')
  const custom = fixture({
    tab: {
      total_amount: 1000,
      paid_amount: 200,
      remaining_amount: 800,
      shipping_fee: 50,
      customer_tab_items: [
        { item_name: 'พระสมเด็จ', amount: 500, order_type: 'auction', cancelled: false },
        {
          item_name: 'เหรียญหลวงพ่อทวด',
          amount: 450,
          order_type: 'cf',
          source_code: 'a1',
          cancelled: false,
        },
      ],
    },
  })
  custom.tables.auctions[0].bid_reply_template = '{bidder_name} leads {product_name}: {price}'
  await custom.receive('เปิด')
  assert.match(custom.calls.public[0][2], /Buyer leads .*200/)
  custom.tables.auctions[0].private_reply_template = 'Pay {total} for {product_name}'
  custom.tables.auction_deliveries.push({
    id: 'a',
    auction_id: auctionId,
    channel: 'private',
    comment_id: 'winner',
    status: 'pending',
  })
  custom.tables.messages.push({
    external_id: `auction-bill:${auctionId}`,
    delivery_status: 'pending',
  })
  await custom.api.deliverAuctionNotifications(auctionId)
  assert.match(custom.calls.private[0][2], /Pay 800/)
  assert.match(custom.calls.private[0][3], /KTB 9260337828/)
  assert.match(custom.calls.private[0][3], /1,000/)
  assert.match(custom.calls.private[0][3], /\[ประมูล\] พระสมเด็จ/)
  assert.match(custom.calls.private[0][3], /\[CF-A1\] เหรียญหลวงพ่อทวด/)
  assert.match(custom.calls.private[0][3], /ค่าจัดส่งครั้งเดียว: 50 บาท/)
  assert.ok(custom.calls.private[0][3].length <= 640)
  assert.equal(custom.calls.private[0][4], 'https://shop.example/pay/live/signed')
  assert.equal(custom.tables.messages[0].delivery_status, 'sent')
})

test('auctions without configured close keywords ignore built-in close markers', async () => {
  const f = fixture()
  f.tables.auctions[0].session_automation = { privateReply: true }
  f.tables.auction_deliveries.push(
    {
      id: 'public-first',
      auction_id: auctionId,
      channel: 'public',
      comment_id: 'close-comment',
      status: 'pending',
    },
    {
      id: 'win-one',
      auction_id: auctionId,
      channel: 'private',
      comment_id: 'winner-one',
      status: 'pending',
    },
  )
  await f.receive('❌', '100')
  assert.deepEqual(f.calls.timeline, [])
  assert.equal(f.calls.private.length, 0)
  assert.equal(f.calls.public.length, 0)
  assert.deepEqual(
    f.tables.auction_deliveries.map((delivery) => delivery.status),
    ['pending', 'pending'],
  )
})

test('Thai auction variables are single-pass, validated per channel, and preserve financial footers', () => {
  assert.equal(
    templates.storeAuctionTemplate('{ชื่อสินค้า} {ยอดชำระ} {ลิงก์ชำระเงิน/แนบสลิป}'),
    '{product_name} {total} {payment_link}',
  )
  assert.equal(templates.validAuctionTemplate('{payment_link}', 'public'), false)
  assert.equal(templates.validAuctionTemplate('{total}', 'public'), false)
  assert.equal(templates.validAuctionTemplate('{unknown}', 'private'), false)
  assert.equal(templates.validAuctionTemplate(' ', 'private'), false)
  assert.equal(
    templates.renderAuctionTemplate('{product_name} {total}', {
      product_name: '{total}',
      total: '800',
    }),
    '{total} 800',
  )
  const footer = 'Total 1000 Paid 200 Remaining 800 KTB https://shop.example/pay'
  const rendered = templates.auctionPrivateMessage('x'.repeat(1500), {}, 'y'.repeat(1900), footer)
  assert.ok(rendered.endsWith(footer))
  assert.ok(rendered.length <= 2000)
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

test('auction setup persists typed replies, rejects unsafe public variables and mismatched Pages', async () => {
  const inserted = []
  let linksReady = true
  let selectedBank = { id: orderId }
  let hostError = null
  const db = {
    from(table) {
      const q = {
        select: () => q,
        eq: () => q,
        insert(value) {
          inserted.push(value)
          return q
        },
        async single() {
          return { data: table === 'tenants' ? { page_id: '100' } : { id: auctionId }, error: null }
        },
        async maybeSingle() {
          return { data: selectedBank, error: null }
        },
      }
      return q
    },
  }
  const api = load(
    'app/api/live-cf/auction/route.ts',
    {
      'next/server': {},
      '@/lib/auth': { getActor: async () => ({ kind: 'user', id: 'signed-in-owner' }) },
      '@/lib/features/commerce/auction-hosts': {
        auctionHostIds: async (_db, actorId, pageId) => {
          if (hostError) throw hostError
          assert.equal(actorId, 'signed-in-owner')
          assert.equal(pageId, '100')
          return ['100', '999']
        },
      },
      '@/lib/supabase/server': { supabaseAdmin: () => db },
      '@/lib/features/commerce/auction-api': {
        authorizeAuction: async () => null,
        auctionReply: (body, status = 200) => NextResponse.json(body, { status }),
        auctionFailure: () => NextResponse.json({ error: 'Unexpected error' }, { status: 500 }),
      },
      '@/lib/features/commerce/live-cf-setup': {
        extractFacebookLiveId: (value) => (/^\d+$/.test(value) ? value : null),
      },
      '@/lib/features/commerce/live-cf-payment-link': { liveCfPaymentLinksReady: () => linksReady },
      '@/lib/features/commerce/auction-templates': templates,
      '@/lib/utils': { UUID: /^[a-f0-9-]{36}$/ },
    },
    { console: silent, Error },
  )
  const input = {
    tenantId,
    pageId: '100',
    livePostId: '456',
    itemName: 'Item',
    startPrice: 200,
    minStep: 20,
    shippingFee: 50,
    bankAccountId: orderId,
    privateText: '{product_name}: {total}',
    bidText: '{bidder_name} {price}',
  }
  const post = (value) =>
    api.POST(
      new NextRequest('https://shop.example/api/live-cf/auction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      }),
    )
  assert.equal((await post(input)).status, 201)
  assert.equal(inserted[0].private_reply_enabled, true)
  assert.deepEqual(Array.from(inserted[0].host_ids), ['100', '999'])
  assert.equal(inserted[0].bid_reply_template, '{bidder_name} {price}')
  hostError = new Error('AUCTION_HOST_FACEBOOK_REQUIRED')
  const reconnect = await post(input)
  assert.equal(reconnect.status, 400)
  assert.match((await reconnect.json()).error, /เชื่อมต่อ Facebook/)
  assert.equal(inserted.length, 1)
  hostError = null
  for (const patch of [
    { pageId: '200' },
    { privateReply: 'false' },
    { bidText: '{payment_link}' },
    { closeText: '{total}' },
    { privateText: '{unknown}' },
    { privateText: 'x'.repeat(1501) },
  ])
    assert.equal((await post({ ...input, ...patch })).status, 400)
  assert.equal(inserted.length, 1)
  linksReady = false
  assert.equal((await post(input)).status, 503)
  assert.equal((await post({ ...input, privateReply: false, publicReply: false })).status, 201)
  assert.equal(inserted.at(-1).private_reply_enabled, false)
  selectedBank = null
  assert.equal((await post({ ...input, privateReply: false })).status, 400)
})
