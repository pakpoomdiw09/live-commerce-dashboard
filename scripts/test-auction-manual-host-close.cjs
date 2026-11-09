const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { fixture } = require('./helpers/auction-hardening-db.cjs')

async function workspace(f, durationSeconds) {
  const actor = (await f.one('insert into auth.users default values returning id')).id
  f.settings.closeKeywords = ['ปิด']
  const input = {
    pageId: '100', livePostId: '456', sessionId: null, roundId: null,
    revision: 0, financialRevision: 0, itemName: 'Manual round', startPrice: 100,
    minStep: 10, shippingFee: 20, durationSeconds,
    settings: { ...f.settings, countEnabled: false, bidText: '', privateText: '', closeText: '', heartCloses: false },
    hostIds: ['100', '999'], finance: { cost: 0, ads: 0, shipping: 0, fees: 0 },
  }
  const save = async (value, request = randomUUID()) =>
    (await f.one('select save_auction_workspace($1,$2,$3,$4) result', [f.tenant, actor, request, value])).result
  return { input, save }
}

test('manual workspace has no deadline, ignores expiry, and only the host closes before the locked winner confirms', async () => {
  const f = await fixture()
  try {
    const { input, save } = await workspace(f, null)
    const result = await save(input)
    const a = await f.one('select * from auctions where id=$1', [result.auctionId])
    assert.equal(a.duration_seconds, null)
    assert.equal(a.timer_started_at, null)
    assert.equal(a.ends_at, null)
    await f.receive(a, '900', '100')
    await f.receive(a, '901', '200')
    assert.equal((await f.one('select close_due_live_auction($1,$2) r', [a.id, f.tenant])).r.status, 'not_due')
    assert.deepEqual((await f.one('select expire_live_auctions_report($1) r', [f.tenant])).r, { closed: 0, failed: 0 })
    assert.equal((await f.one('select status from auctions where id=$1', [a.id])).status, 'active')
    assert.equal((await f.receive(a, '900', 'ปิด')).result.status, 'ignored')
    assert.equal((await f.receive(a, '999', 'ปิด')).result.status, 'awaiting_confirmation')
    assert.equal((await f.one('select order_id from auctions where id=$1', [a.id])).order_id, null)
    assert.equal((await f.receive(a, '900', 'confirm')).result.status, 'not_winner')
    const confirmed = await f.receive(a, '901', 'confirm')
    assert.equal(confirmed.result.status, 'confirmed')
    await f.processEvent(a, confirmed.event, confirmed.parsed)
    assert.equal((await f.one('select count(*)::int n from orders where source_id=$1', [a.id])).n, 1)
    assert.equal((await f.one('select leading_bidder_id from auctions where id=$1', [a.id])).leading_bidder_id, '901')
  } finally { await f.db.close() }
})

test('saving a timed round as manual clears all timer fields and replaying an old timed save cannot restart it', async () => {
  const f = await fixture()
  try {
    const { input, save } = await workspace(f, 600), request = randomUUID()
    const original = await save(input, request)
    assert.ok((await f.one('select ends_at from auctions where id=$1', [original.auctionId])).ends_at)
    const s = await f.one('select * from live_sessions where id=$1', [original.sessionId])
    const edit = { ...input, sessionId: s.id, roundId: original.auctionId,
      revision: s.automation_revision, financialRevision: s.financial_revision, durationSeconds: null }
    const manual = await save(edit)
    assert.equal(manual.auctionId, original.auctionId)
    assert.deepEqual(await f.one('select ends_at,timer_started_at,duration_seconds from auctions where id=$1', [original.auctionId]),
      { ends_at: null, timer_started_at: null, duration_seconds: null })
    await save(input, request)
    assert.equal((await f.one('select ends_at from auctions where id=$1', [original.auctionId])).ends_at, null)
  } finally { await f.db.close() }
})
