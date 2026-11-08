const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const load = require('./helpers/load-typescript.cjs')

const tenantId = '11111111-1111-4111-8111-111111111111'
const auctionId = '22222222-2222-4222-8222-222222222222'
const sessionId = '33333333-3333-4333-8333-333333333333'
const videoId = '456'
const accessToken = 'TEST_ACCESS_TOKEN_DO_NOT_LOG'
const fromId = '918273645546372819'
const bodyText = 'COMMENT_BODY_DO_NOT_LOG'

function comment(
  index,
  createdAt = '2026-02-01T00:00:00.000Z',
  from = { id: fromId, name: 'Buyer' },
) {
  return {
    id: `comment-${index}`,
    message: bodyText,
    created_time: createdAt,
    ...(from === null ? {} : { from }),
  }
}

function fixture({ pages, cursor = null, graphError = null } = {}) {
  const tables = {
    tenants: [{ id: tenantId, page_id: '100', page_access_token: accessToken, is_active: true }],
    live_sessions: [{ id: sessionId, tenant_id: tenantId, page_id: '100', live_post_id: videoId }],
    auctions: [
      {
        id: auctionId,
        tenant_id: tenantId,
        page_id: '100',
        live_post_id: videoId,
        created_at: '2026-01-01T00:00:00.000Z',
        status: 'active',
      },
    ],
    auction_poll_cursors: cursor
      ? [
          {
            cursor_id: cursor.cursor_id ?? auctionId,
            auction_id: auctionId,
            tenant_id: tenantId,
            session_id: null,
            live_video_id: videoId,
            ...cursor,
          },
        ]
      : [],
  }
  const graphCalls = []
  const rpcCalls = []
  const logs = []
  const responsePage = (url) => {
    if (graphError) return { status: 400, body: { error: graphError } }
    const parsed = new URL(url)
    const page = Number(parsed.searchParams.get('page') ?? 1)
    const result = pages(page, parsed)
    return { status: 200, body: result }
  }
  const db = {
    from(table) {
      const predicates = []
      let ordering = null
      let limit = Infinity
      let patch = null
      const query = {
        select() {
          return query
        },
        eq(key, value) {
          predicates.push((row) => row[key] === value)
          return query
        },
        is(key, value) {
          predicates.push((row) => (value === null ? row[key] == null : row[key] === value))
          return query
        },
        not(key, operator, value) {
          assert.equal(operator, 'is')
          assert.equal(value, null)
          predicates.push((row) => row[key] != null)
          return query
        },
        or(filter) {
          const match = filter.match(/^([a-z_]+)\.eq\.(.+)$/)
          if (match) predicates.push((row) => row[match[1]] === match[2])
          else if (filter === 'id.not.is.null') predicates.push((row) => row.id != null)
          else throw new Error(`Unsupported .or() expression in poller test: ${filter}`)
          return query
        },
        order(key, options = {}) {
          ordering = { key, ascending: options.ascending !== false }
          return query
        },
        limit(value) {
          limit = value
          return query
        },
        update(value) {
          patch = value
          return query
        },
        upsert(value, options) {
          const index = tables[table].findIndex(
            (row) => row[options?.onConflict ?? 'id'] === value[options?.onConflict ?? 'id'],
          )
          if (index < 0) tables[table].push({ ...value })
          else tables[table][index] = { ...tables[table][index], ...value }
          return Promise.resolve({ data: null, error: null })
        },
        finish() {
          let rows = (tables[table] ?? []).filter((row) =>
            predicates.every((predicate) => predicate(row)),
          )
          if (ordering) {
            const { key, ascending } = ordering
            rows = [...rows].sort(
              (a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (ascending ? 1 : -1),
            )
          }
          rows = rows.slice(0, limit)
          if (patch) rows.forEach((row) => Object.assign(row, patch))
          return { data: rows.map((row) => ({ ...row })), error: null }
        },
        async maybeSingle() {
          const result = query.finish()
          return { ...result, data: result.data[0] ?? null }
        },
        then(resolve, reject) {
          return Promise.resolve(query.finish()).then(resolve, reject)
        },
      }
      return query
    },
    async rpc(name, input) {
      rpcCalls.push({ name, input })
      if (name === 'commerce_rate_limit') return { data: true, error: null }
      if (name === 'enqueue_facebook_webhook') {
        const events = input.p_events ?? []
        return { data: { id: 'receipt', accepted: events.length }, error: null }
      }
      throw new Error(`Unexpected poller RPC: ${name}`)
    },
  }
  class NextResponse extends Response {
    static json(value, init) {
      return new NextResponse(JSON.stringify(value), init)
    }
  }
  const route = load(
    'app/api/live-cf/auction/poll-comments/route.ts',
    {
      'node:crypto': require('node:crypto'),
      'server-only': {},
      'next/server': { NextRequest: Request, NextResponse },
      '@/lib/auth': {
        getActor: async () => ({ kind: 'user', id: 'actor' }),
        canAccessTenant: async () => true,
      },
      '@/lib/supabase/server': { supabaseAdmin: () => db },
      '@/lib/feature-flags': { isFeatureEnabled: () => true },
      '@/lib/integrations/facebook/client': {
        graph: (path) => `https://graph.facebook.com/v25.0/${path}`,
        pageTokenFor: (row) => row.page_access_token,
      },
      '@/lib/integrations/facebook/webhook-envelope': {
        parseWebhook(bytes) {
          const payload = JSON.parse(new TextDecoder().decode(bytes))
          const events = payload.entry.flatMap((entry) =>
            entry.changes.map((change) => ({ payload: change.value })),
          )
          return { raw: payload, hash: 'safe-hash', events }
        },
      },
      '@/lib/integrations/facebook/webhook-worker': {
        runFacebookWebhookWorker: async () => ({ claimed: 0 }),
      },
      '@/lib/integrations/facebook/webhook-handler': { handleFacebookWebhookEvent: async () => {} },
      '@/lib/utils': { UUID: /^[0-9a-f-]{36}$/i },
      '@/lib/features/commerce/auction-server': { deliverAuctionNotifications: async () => {} },
    },
    {
      AbortSignal,
      TextDecoder,
      TextEncoder,
      URL,
      console: Object.fromEntries(
        ['info', 'warn', 'error'].map((method) => [
          method,
          (...args) => logs.push(JSON.stringify(args)),
        ]),
      ),
      fetch: async (input, init = {}) => {
        const url = String(input)
        graphCalls.push({ url, authorization: init.headers?.Authorization })
        const response = responsePage(url)
        return new Response(JSON.stringify(response.body), {
          status: response.status,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  )
  return {
    route: route.POST,
    tables,
    graphCalls,
    rpcCalls,
    logs,
    async poll(withSession = false) {
      const req = new Request('https://app.example/api/live-cf/auction/poll-comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_id: '100', ...(withSession ? { session_id: sessionId } : {}) }),
      })
      const response = await route.POST(req)
      return { status: response.status, body: await response.json() }
    },
  }
}

const pageUrl = (page) => `https://graph.facebook.com/v25.0/${videoId}/comments?page=${page}`
module.exports = { fixture, comment, pageUrl }

test('queues all 250 comments across Graph pages and advances the cursor', async () => {
  const createdAt = (index) =>
    new Date(Date.parse('2026-02-01T00:10:00.000Z') - index * 1000).toISOString()
  const batches = [
    Array.from({ length: 100 }, (_, i) => comment(i, createdAt(i))),
    Array.from({ length: 100 }, (_, i) => comment(i + 100, createdAt(i + 100))),
    Array.from({ length: 50 }, (_, i) => comment(i + 200, createdAt(i + 200))),
  ]
  const f = fixture({
    pages: (page) => ({
      data: batches[page - 1],
      ...(page < 3 ? { paging: { next: pageUrl(page + 1) } } : {}),
    }),
  })
  const result = await f.poll()
  assert.equal(result.status, 200)
  assert.equal(result.body.fetched, 250)
  assert.equal(result.body.queued, 250)
  assert.equal(f.graphCalls.length, 3)
  assert.equal(f.tables.auction_poll_cursors[0].high_water_at, '2026-02-01T00:10:00.000Z')
  assert.equal(f.tables.auction_poll_cursors[0].continuation_url, null)
  assert.ok(f.rpcCalls.some((call) => call.name === 'enqueue_facebook_webhook'))
})

test('a page-one comment reaching the overlap boundary prevents fetching page two', async () => {
  const highWater = '2026-02-01T00:00:30.000Z'
  const f = fixture({
    cursor: { high_water_at: highWater },
    pages: () => ({
      data: [
        comment('new', '2026-02-01T00:00:29.000Z'),
        comment('boundary', '2026-02-01T00:00:09.000Z'),
      ],
      paging: { next: pageUrl(2) },
    }),
  })
  const result = await f.poll()
  assert.equal(result.body.queued, 1)
  assert.equal(f.graphCalls.length, 1)
  assert.equal(f.tables.auction_poll_cursors[0].continuation_url, null)
})

test('Graph Error 100 returns VIDEO_NOT_ACCESSIBLE and never tries a secondary video ID', async () => {
  const f = fixture({
    pages: () => ({ data: [] }),
    graphError: { code: 100, message: 'video unavailable' },
  })
  const result = await f.poll()
  assert.equal(result.status, 502)
  assert.equal(result.body.reason, 'VIDEO_NOT_ACCESSIBLE')
  assert.equal(f.graphCalls.length, 1)
  assert.match(f.graphCalls[0].url, /\/456\/comments/)
})

test('comments missing from or from.id are skipped, valid author comments queue, and all-skipped cycles advance high water', async () => {
  const f = fixture({
    pages: () => ({
      data: [
        comment('missing-from', '2026-02-01T00:00:03.000Z', null),
        comment('empty-from', '2026-02-01T00:00:02.000Z', {}),
        comment('valid', '2026-02-01T00:00:01.000Z'),
      ],
    }),
  })
  const result = await f.poll()
  assert.equal(result.body.skipped.MISSING_FROM_ID, 2)
  assert.equal(result.body.queued, 1)
  const events = f.rpcCalls.find((call) => call.name === 'enqueue_facebook_webhook').input.p_events
  assert.equal(events.length, 1)
  assert.equal(events[0].payload.from.id, fromId)
  assert.equal(JSON.stringify(events).includes('anon_'), false)

  const allSkipped = fixture({
    pages: () => ({ data: [comment('only-missing', '2026-02-01T00:00:04.000Z', null)] }),
  })
  const skippedResult = await allSkipped.poll()
  assert.equal(skippedResult.body.queued, 0)
  assert.equal(skippedResult.body.skipped.MISSING_FROM_ID, 1)
  assert.equal(allSkipped.tables.auction_poll_cursors[0].high_water_at, '2026-02-01T00:00:04.000Z')
  assert.equal(
    allSkipped.rpcCalls.some((call) => call.name === 'enqueue_facebook_webhook'),
    false,
  )
})

test('pagination rejects non Graph hosts and non HTTPS URLs before making a second request', async () => {
  const f = fixture({
    pages: () => ({
      data: [comment(1)],
      paging: { next: `http://evil.test/${videoId}/comments?page=2` },
    }),
  })
  const result = await f.poll()
  assert.equal(result.status, 503)
  assert.equal(f.graphCalls.length, 1)
  assert.equal(f.tables.auction_poll_cursors.length, 0)
})

test('continuation URLs are sanitized before persistence and logs omit tokens, author IDs, and comment bodies', async () => {
  const f = fixture({
    pages: (page) => ({
      data: Array.from({ length: 100 }, (_, i) =>
        comment(`${page}-${i}`, '2026-02-01T00:00:04.000Z', null),
      ),
      paging: { next: `${pageUrl(page + 1)}&access_token=${accessToken}` },
    }),
  })
  const result = await f.poll()
  assert.equal(result.body.queued, 0)
  assert.equal(f.graphCalls.length, 10)
  assert.equal(f.tables.auction_poll_cursors[0].continuation_url.includes('access_token'), false)
  assert.equal(f.tables.auction_poll_cursors[0].continuation_url.includes(accessToken), false)
  const logText = f.logs.join('\n')
  assert.equal(logText.includes(accessToken), false)
  assert.equal(logText.includes(fromId), false)
  assert.equal(logText.includes(bodyText), false)
})

test('polling always sends the Page token in the Authorization header, never in a Graph URL', async () => {
  const f = fixture({ pages: () => ({ data: [comment(1)] }) })
  await f.poll()
  assert.equal(f.graphCalls[0].authorization, `Bearer ${accessToken}`)
  assert.equal(f.graphCalls[0].url.includes(accessToken), false)
})

test('session filters exclude other lives and poll a closed, unconfirmed winner', async () => {
  const f = fixture({ pages: () => ({ data: [comment('selected-session')] }) })
  f.tables.auctions.unshift({ ...f.tables.auctions[0], id: 'other-round', live_post_id: '999' })
  Object.assign(f.tables.auctions[1], {
    status: 'closed',
    winner_locked_at: '2026-02-01',
    winner_confirmed_at: null,
  })
  assert.equal((await f.poll(true)).status, 200)
  assert.match(f.graphCalls[0].url, /\/456\/comments/)
})

test('Graph error text containing tokens, author IDs or messages is never logged', async () => {
  const f = fixture({
    graphError: { code: 100, message: `${accessToken} ${fromId} ${bodyText}`, type: fromId },
  })
  const result = await f.poll()
  assert.equal(result.body.reason, 'VIDEO_NOT_ACCESSIBLE')
  for (const secret of [accessToken, fromId, bodyText]) {
    assert.equal(f.logs.join('\n').includes(secret), false)
    assert.equal(JSON.stringify(result.body).includes(secret), false)
  }
})

test('blank and synthetic identities are skipped without enqueueing bids', async () => {
  const f = fixture({
    pages: () => ({ data: ['', ' ', 'anon_123'].map((id, i) => comment(i, undefined, { id })) }),
  })
  const result = await f.poll()
  assert.equal(result.body.queued, 0)
  assert.equal(result.body.skipped.MISSING_FROM_ID, 3)
})

test('only exact HTTPS Graph hosts receive a second request', async () => {
  for (const link of [
    'https://graph.facebook.com.evil.test/x',
    'https://evil.test/x',
    'http://graph.facebook.com/x',
    'https://user:pass@graph.facebook.com/x',
  ]) {
    const f = fixture({ pages: () => ({ data: [comment(link)], paging: { next: link } }) })
    assert.equal((await f.poll()).status, 503)
    assert.equal(f.graphCalls.length, 1)
  }
})

test('linked continuation resumes backlog without applying the advanced high-water boundary', async () => {
  const f = fixture({
    cursor: {
      high_water_at: '2026-02-01T00:10:00Z',
      continuation_url: pageUrl(11),
      continuation_anchor_url: pageUrl(2),
      continuation_boundary_at: '2026-02-01T00:00:00Z',
      updated_at: new Date().toISOString(),
    },
    pages: (page) =>
      page === 1
        ? { data: [comment('fresh', '2026-02-01T00:10:01Z')], paging: { next: pageUrl(2) } }
        : page === 2
          ? { data: [comment('bridge', '2026-02-01T00:09:59Z')], paging: { next: pageUrl(3) } }
          : { data: [comment('backlog', '2026-02-01T00:01:00Z')] },
  })
  const result = await f.poll()
  assert.equal(result.body.queued, 3)
  assert.equal(new URL(f.graphCalls[1].url).searchParams.get('page'), '2')
  assert.equal(new URL(f.graphCalls[2].url).searchParams.get('page'), '3')
  assert.equal(f.tables.auction_poll_cursors[0].continuation_url, null)
  assert.equal(f.tables.auction_poll_cursors[0].high_water_at, '2026-02-01T00:10:01.000Z')
})

test('expired or unlinked stored cursors are discarded for the fresh page chain', async () => {
  for (const patch of [
    { updated_at: '2020-01-01T00:00:00Z' },
    { continuation_anchor_url: pageUrl(99) },
    { continuation_url: 'https://evil.test/x' },
  ]) {
    const f = fixture({
      cursor: {
        high_water_at: '2026-02-01T00:00:30Z',
        continuation_url: pageUrl(11),
        continuation_anchor_url: pageUrl(2),
        continuation_boundary_at: '2026-01-01T00:00:00Z',
        updated_at: new Date().toISOString(),
        ...patch,
      },
      pages: (page) => ({
        data: [comment(`discard-${page}`, '2026-02-01T00:00:31Z')],
        ...(page === 1 ? { paging: { next: pageUrl(2) } } : {}),
      }),
    })
    assert.equal((await f.poll()).status, 200)
    assert.equal(new URL(f.graphCalls[1].url).searchParams.get('page'), '2')
    assert.equal(f.tables.auction_poll_cursors[0].continuation_url, null)
  }
})
