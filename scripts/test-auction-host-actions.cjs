const { test } = require('node:test')
const assert = require('node:assert/strict')
const { NextRequest, NextResponse } = require('next/server')
const load = require('./helpers/load-typescript.cjs')
const envelope = load(
  'lib/integrations/facebook/webhook-envelope.ts',
  { 'node:crypto': require('node:crypto') },
  { TextDecoder },
)
const tenantId = '11111111-1111-4111-8111-111111111111'
const auctionId = '22222222-2222-4222-8222-222222222222'
const silent = { info() {}, warn() {}, error() {} }

function fixture(options = {}) {
  const calls = { scopes: [], sends: [], queued: [], deferred: [], workers: 0 }
  const db = {
    from(table) {
      const filters = []
      const q = {
        select: () => q,
        eq(key, value) {
          filters.push([key, value])
          calls.scopes.push([table, key, value])
          return q
        },
        order: () => q,
        limit: () => q,
        async maybeSingle() {
          const row =
            table === 'auctions'
              ? {
                  id: auctionId,
                  tenant_id: tenantId,
                  page_id: '100',
                  live_post_id: '456',
                  status: options.closed ? 'closed' : 'active',
                  session_automation: options.automation ?? { closeKeywords: ['ปิด'], closeEnabled: true, countEnabled: true, counting_tags: { '3': '3', '2': '2', '1': '1' } },
                }
              : table === 'live_sessions'
                ? { tenant_id: tenantId, page_id: '100', live_post_id: '456', ...(options.sessionSettings ?? {}) }
              : {
                  id: tenantId,
                  page_id: '100',
                  page_access_token: options.missingToken ? null : 'TEST_PAGE_SECRET',
                  is_active: true,
                }
          return {
            data:
              options.foreign || !filters.every(([key, value]) => row[key] === value) ? null : row,
            error: null,
          }
        },
      }
      return q
    },
    async rpc(name, input) {
      calls.queued.push({ name, input })
      return {
        data: { id: 'receipt', accepted: 1 },
        error: options.enqueueError ? { code: 'DB_UNAVAILABLE' } : null,
      }
    },
  }
  const route = load(
    'app/api/live-cf/auction/host-action/route.ts',
    {
      'next/server': { NextResponse, after: (callback) => calls.deferred.push(callback) },
      '@/lib/supabase/server': { supabaseAdmin: () => db },
      '@/lib/features/commerce/auction-api': {
        authorizeAuction: async () =>
          options.denied ? NextResponse.json({ error: 'forbidden' }, { status: 403 }) : null,
        auctionReply: (value, status = 200) => NextResponse.json(value, { status }),
        auctionFailure: () => NextResponse.json({ error: 'unavailable' }, { status: 503 }),
      },
      '@/lib/integrations/facebook/client': {
        pageTokenFor: (row) => row.page_access_token,
        replyToComment: async (...args) => {
          calls.sends.push(args)
          if (options.providerError) throw new Error('provider timeout')
          return { id: '456_789' }
        },
      },
      '@/lib/integrations/facebook/webhook-envelope': envelope,
      '@/lib/integrations/facebook/webhook-worker': {
        runFacebookWebhookWorker: async () => {
          calls.workers++
        },
      },
      '@/lib/integrations/facebook/webhook-handler': { handleFacebookWebhookEvent: async () => {} },
      '@/lib/utils': { UUID: /^[a-f0-9-]{36}$/ },
      '@/lib/integrations/facebook/auction-comment-parser': {
        parseAuctionComment: (text, isHost, automation) => {
          if (options.invalidHostControl) return { type: 'IGNORE' }
          if (isHost && automation.closeKeywords.includes(text)) return { type: 'HOST_CONTROL', action: 'close', count: null }
          const count = automation.counting_tags[text]
          return count && automation.countEnabled !== false
            ? { type: 'HOST_CONTROL', action: 'count', count }
            : { type: 'IGNORE' }
        },
      },
      '@/lib/features/commerce/comment-config': load('lib/features/commerce/comment-config.ts'),
    },
    { console: silent, TextEncoder, Date },
  )
  return {
    calls,
    async send(action = '3', extra = {}) {
      return route.POST(
        new NextRequest('https://shop.example/api/live-cf/auction/host-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', origin: 'https://shop.example' },
          body: JSON.stringify({ tenantId, auctionId, action, ...extra }),
        }),
      )
    },
  }
}

test('host shortcuts post Page-owned comments to the stored live video and enqueue canonical events', async () => {
  for (const action of ['3', '2', '1', 'close']) {
    const f = fixture()
    const response = await f.send(action, {
      pageId: 'attacker-page',
      livePostId: 'attacker-post',
      token: 'attacker-token',
    })
    assert.equal(response.status, 202)
    const body = await response.json()
    assert.equal(body.posted, true)
    assert.equal(body.queued, true)
    assert.equal(body.commentId, '456_789')
    assert.ok(!JSON.stringify(body).includes('TEST_PAGE_SECRET'))
    assert.deepEqual(f.calls.sends, [
      ['TEST_PAGE_SECRET', '456', action === 'close' ? 'ปิด' : action],
    ])
    assert.ok(
      f.calls.scopes.some(
        (scope) => scope[0] === 'auctions' && scope[1] === 'tenant_id' && scope[2] === tenantId,
      ),
    )
    const queued = f.calls.queued[0]
    assert.equal(queued.name, 'enqueue_facebook_webhook')
    const event = queued.input.p_events[0]
    assert.equal(event.orderingKey, 'comments:100')
    assert.equal(event.payload.value.from.id, '100')
    assert.equal(event.payload.value.post_id, '456')
    assert.equal(event.payload.value.comment_id, '456_789')
    // The later signed Meta webhook has the same event key and cannot close twice.
    const later = envelope.parseWebhook(
      Buffer.from(queued.input.p_raw.replace('"feed"', '"live_comments"')),
    )
    assert.equal(later.events[0].eventKey, event.eventKey)
    await f.calls.deferred[0]()
    assert.equal(f.calls.workers, 1)
  }
})

test('invalid, unauthorized, foreign, closed and disconnected host actions never contact Meta', async () => {
  for (const [options, action, status] of [
    [{ denied: true }, '3', 403],
    [{ foreign: true }, 'close', 404],
    [{ closed: true }, '1', 409],
    [{ missingToken: true }, '3', 409],
    [{}, 'arbitrary text', 400],
  ]) {
    const f = fixture(options)
    assert.equal((await f.send(action)).status, status)
    assert.equal(f.calls.sends.length, 0)
    assert.equal(f.calls.queued.length, 0)
  }
})

test('close action uses active session settings and refuses a tag that does not parse as HOST_CONTROL', async () => {
  const configured = fixture({ sessionSettings: { comment_settings: { closing_tags: ['終了'] } } })
  assert.equal((await configured.send('close')).status, 202)
  assert.equal(configured.calls.sends[0][2], '終了')
  const invalid = fixture({ invalidHostControl: true })
  assert.equal((await invalid.send('close')).status, 409)
  assert.equal(invalid.calls.sends.length, 0)
})

test('provider uncertainty cannot close locally and enqueue uncertainty never resends the published comment', async () => {
  const failed = fixture({ providerError: true })
  assert.equal((await failed.send('close')).status, 502)
  assert.equal(failed.calls.sends.length, 1)
  assert.equal(failed.calls.queued.length, 0)
  const queued = fixture({ enqueueError: true })
  const response = await queued.send('close')
  assert.equal(response.status, 202)
  const body = await response.json()
  assert.equal(body.posted, true)
  assert.equal(body.queued, false)
  assert.equal(queued.calls.sends.length, 1)
  assert.equal(queued.calls.deferred.length, 0)
})
