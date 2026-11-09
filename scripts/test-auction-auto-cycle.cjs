const { test } = require('node:test'), assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { fixture } = require('./helpers/auction-hardening-db.cjs')
const { parseAuctionComment } = require('./helpers/load-typescript.cjs')('lib/integrations/facebook/auction-comment-parser.ts')

async function setup() {
  const f = await fixture()
  Object.assign(f.settings, { autoCycleRounds: true, countEnabled: true,
    counting_tags: { '5': '5', '4': '4', '3': '3', '2': '2', '1': '1', 'นับ 1': '1', 'นับ 2': '2', 'นับ 3': '3' },
    keywords: ['รับ', 'cf', 'ยืนยัน'], closeKeywords: ['ปิด', 'x', 'กากบาท'] })
  const actor = (await f.one('insert into auth.users default values returning id')).id
  const input = { pageId: '100', livePostId: '456', sessionId: null, roundId: null, revision: 0, financialRevision: 0,
    itemName: 'พระ', startPrice: 200, minStep: 10, shippingFee: 35, durationSeconds: null,
    hostIds: ['100', '999'], settings: { ...f.settings, bidText: '', privateText: '', closeText: '', heartCloses: false },
    finance: { cost: 0, ads: 0, shipping: 0, fees: 0 } }
  const save = async (v, id = randomUUID()) => (await f.one('select save_auction_workspace($1,$2,$3,$4) r', [f.tenant, actor, id, v])).r
  const saved = await save(input)
  const a = await f.one('select * from auctions where id=$1', [saved.auctionId])
  return { ...f, a, input, save, saved }
}

test('dashboard counting supports five steps and multiline custom counts without closing or accepting host bids', async () => {
  const f = await setup()
  try {
    for (const count of ['5', '4', '3', '2', '1']) {
      assert.equal((await f.receive(f.a, '999', count)).result.status, 'count')
      assert.equal((await f.one('select host_count from auctions where id=$1', [f.a.id])).host_count, count)
    }
    assert.equal((await f.receive(f.a, '999', 'นับ 1\nนับ 2\nนับ 3')).result.status, 'count')
    assert.equal((await f.one('select host_count from auctions where id=$1', [f.a.id])).host_count, '3')
    assert.equal((await f.receive(f.a, '900', 'ปิด')).result.status, 'ignored')
    assert.equal((await f.one('select status from auctions where id=$1', [f.a.id])).status, 'active')
    assert.equal((await f.one('select count(*)::int n from auctions')).n, 1)
  } finally { await f.db.close() }
})

test('host close atomically cycles from the saved template and previous winner confirms while new bids continue', async () => {
  const f = await setup()
  try {
    await f.receive(f.a, '900', '200'); await f.receive(f.a, '901', '250')
    const event = await f.event(f.a, '999', '3\n2\n1\nปิด')
    const queuedBid = await f.event(f.a, '902', '200')
    const parsed = parseAuctionComment('3\n2\n1\nปิด', true, f.settings)
    const close = { event, parsed, result: await f.processEvent(f.a, event, parsed) }
    assert.equal(close.result.status, 'awaiting_confirmation')
    assert.ok(close.result.nextAuctionId)
    const next = await f.one('select * from auctions where id=$1', [close.result.nextAuctionId])
    assert.equal(next.item_name, 'พระ'); assert.equal(Number(next.start_price), 200)
    assert.equal(Number(next.min_step), 10); assert.equal(Number(next.shipping_fee), 35)
    assert.equal(next.current_price, '0.00'); assert.equal(next.leading_bidder_id, null)
    assert.equal(next.ends_at, null); assert.equal(next.previous_auction_id, f.a.id)
    assert.equal((await f.one('select order_id from auctions where id=$1', [f.a.id])).order_id, null)
    // Retry routed to the new active round must not close it or create a third round.
    assert.deepEqual(await f.processEvent(next, close.event, close.parsed), close.result)
    assert.equal((await f.one('select count(*)::int n from auctions')).n, 2)
    assert.equal((await f.processEvent(next, queuedBid, parseAuctionComment('200', false, f.settings))).status, 'accepted')
    assert.equal((await f.receive(f.a, '900', 'cf')).result.status, 'not_winner')
    const confirmed = await f.receive(f.a, '901', 'รับ')
    assert.equal(confirmed.result.status, 'confirmed')
    assert.equal(confirmed.result.auctionId, f.a.id)
    assert.equal((await f.receive(next, '903', '210')).result.status, 'accepted')
    await f.processEvent(next, confirmed.event, confirmed.parsed)
    assert.equal((await f.one('select count(*)::int n from orders where source_id=$1', [f.a.id])).n, 1)
    assert.equal((await f.one('select order_id from auctions where id=$1', [next.id])).order_id, null)
    const early = await f.receive(next, '903', 'cf')
    assert.equal(early.result.status, 'awaiting_host_close')
    const closedNext = await f.receive(next, '999', 'x')
    assert.ok(closedNext.result.nextAuctionId)
    assert.equal((await f.processEvent(next, early.event, early.parsed)).status, 'awaiting_host_close')
    assert.equal((await f.one('select order_id from auctions where id=$1', [next.id])).order_id, null)
    assert.equal((await f.receive(next, '903', 'ยืนยัน')).result.status, 'confirmed')
    assert.equal((await f.one("select count(*)::int n from auctions where status='active'")).n, 1)
  } finally { await f.db.close() }
})

test('template edits after accepted bids change only the following round and are replay fenced', async () => {
  const f = await setup()
  try {
    await f.receive(f.a, '900', '200')
    const s = await f.one('select * from live_sessions where id=$1', [f.saved.sessionId])
    const updated = { ...f.input, itemName: 'พระรุ่นใหม่', startPrice: 300, minStep: 20,
      sessionId: s.id, roundId: f.a.id, revision: s.automation_revision, financialRevision: s.financial_revision }
    const request = randomUUID(); await f.save(updated, request); await f.save(updated, request)
    assert.equal((await f.one('select start_price from auctions where id=$1', [f.a.id])).start_price, '200.00')
    const close = await f.receive(f.a, '999', 'x')
    const next = await f.one('select * from auctions where id=$1', [close.result.nextAuctionId])
    assert.equal(next.item_name, 'พระรุ่นใหม่'); assert.equal(next.start_price, '300.00')
    assert.equal(next.min_step, '20.00')
    assert.equal(next.public_reply_enabled, false); assert.equal(next.private_reply_enabled, false)
  } finally { await f.db.close() }
})

test('each cycled round inherits saved public/private switches and reply templates', async () => {
  const f = await setup()
  try {
    for (const [publicReply, privateReply] of [[true, false], [false, true], [true, true], [false, false]]) {
      const a = await f.one("select * from auctions where status='active' and tenant_id=$1", [f.tenant])
      const s = await f.one('select * from live_sessions where id=$1', [f.saved.sessionId])
      const settings = { ...f.input.settings, publicReply, privateReply,
        bidText: 'Sold {product_name} {price}', closeText: 'Sold {product_name} {price}',
        privateText: 'Invoice {product_name} {total} {bank_account} {payment_link}' }
      await f.save({ ...f.input, settings, sessionId: s.id, roundId: a.id,
        revision: s.automation_revision, financialRevision: s.financial_revision })
      await f.receive(a, '900', '200')
      const close = await f.receive(a, '999', 'กากบาท')
      const next = await f.one('select * from auctions where id=$1', [close.result.nextAuctionId])
      assert.equal(next.public_reply_enabled, publicReply); assert.equal(next.private_reply_enabled, privateReply)
      assert.equal(next.bid_reply_template, settings.bidText); assert.equal(next.private_reply_template, settings.privateText)
      assert.equal((await f.receive(a, '900', 'ยืนยัน')).result.status, 'confirmed')
      const channels = (await f.db.query('select channel from auction_deliveries where auction_id=$1', [a.id])).rows.map(r => r.channel)
      if (publicReply) assert.ok(channels.includes('public'))
      if (privateReply) assert.ok(channels.includes('private'))
    }
  } finally { await f.db.close() }
})

test('successor creation failure rolls back host closure and the same event can safely retry', async () => {
  const f = await setup()
  try {
    await f.receive(f.a, '900', '200')
    await f.db.exec("create function reject_cycle_fixture() returns trigger language plpgsql as $$begin if new.previous_auction_id is not null then raise exception 'ROLLOVER_FIXTURE';end if;return new;end $$;create trigger reject_cycle_fixture before insert on auctions for each row execute function reject_cycle_fixture();")
    const event = await f.event(f.a, '999', 'ปิด')
    const parsed = parseAuctionComment('ปิด', true, f.settings)
    await assert.rejects(f.processEvent(f.a, event, parsed), /ROLLOVER_FIXTURE/)
    assert.deepEqual(await f.one('select status,winner_locked_at,order_id from auctions where id=$1', [f.a.id]),
      { status: 'active', winner_locked_at: null, order_id: null })
    assert.equal((await f.one('select count(*)::int n from auction_bids where event_id=$1', [event.id])).n, 0)
    await f.db.exec('drop trigger reject_cycle_fixture on auctions')
    assert.ok((await f.processEvent(f.a, event, parsed)).nextAuctionId)
    assert.equal((await f.one('select count(*)::int n from auctions')).n, 2)
  } finally { await f.db.close() }
})
