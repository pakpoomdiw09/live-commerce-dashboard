const { test } = require('node:test')
const assert = require('node:assert/strict')
const { fixture, comment, pageUrl } = require('./test-auction-poller-hardening.cjs')

function cycled(f, confirmed = false) {
  const active = f.tables.auctions[0]
  active.created_at = '2026-02-01T00:00:15.000Z'
  f.tables.auctions.push({ ...active, id: 'waiting-round', status: 'closed',
    created_at: '2026-02-01T00:00:00.000Z', closed_at: '2026-02-01T00:00:05.000Z',
    winner_locked_at: '2026-02-01T00:00:05.000Z', winner_confirmed_at: confirmed ? '2026-02-01T00:00:09.000Z' : null })
}

test('an active successor does not hide a delayed previous-winner confirmation inside the overlap window', async () => {
  const bid = comment('new-bid', '2026-02-01T00:00:20.000Z')
  const confirmation = { ...comment('old-confirm', '2026-02-01T00:00:10.000Z'), message: 'cf' }
  const f = fixture({ cursor: { high_water_at: '2026-02-01T00:00:20.000Z' }, pages: () => ({ data: [bid, confirmation] }) })
  cycled(f)
  const result = await f.poll(true)
  assert.equal(result.status, 200)
  assert.equal(result.body.queued, 2)
  assert.equal(result.body.skipped.BEFORE_ROUND_START, undefined)
})

test('pagination reaches older waiting winners instead of stopping at the latest active round boundary', async () => {
  const f = fixture({ cursor: { high_water_at: '2026-02-01T00:00:20.000Z' }, pages: page => page === 1
    ? { data: [comment('new-bid', '2026-02-01T00:00:20.000Z'), { ...comment('confirm-one', '2026-02-01T00:00:14.000Z'), message: 'cf' }], paging: { next: pageUrl(2) } }
    : { data: [{ ...comment('confirm-two', '2026-02-01T00:00:08.000Z'), message: 'cf' }] } })
  cycled(f)
  const result = await f.poll(true)
  assert.equal(result.status, 200)
  assert.equal(result.body.queued, 3)
  assert.equal(f.graphCalls.length, 2)
})

test('confirmed, foreign-tenant and other-live rounds do not widen the active session polling floor', async () => {
  const f = fixture({ pages: () => ({ data: [comment('new', '2026-02-01T00:00:20.000Z'), comment('old', '2026-02-01T00:00:10.000Z')] }) })
  cycled(f, true)
  const old = f.tables.auctions[1]
  f.tables.auctions.push({ ...old, id: 'foreign', tenant_id: 'foreign', winner_confirmed_at: null },
    { ...old, id: 'other-live', live_post_id: '777', winner_confirmed_at: null })
  const result = await f.poll(true)
  assert.equal(result.status, 200)
  assert.equal(result.body.queued, 1)
  assert.equal(result.body.skipped.BEFORE_ROUND_START, 1)
})
