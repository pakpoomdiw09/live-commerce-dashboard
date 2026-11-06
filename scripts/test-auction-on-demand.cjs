const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { PGlite } = require('@electric-sql/pglite')
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto')
const { build } = require('./build-full-database-setup.cjs')
const fs = require('node:fs')

test('on-demand bills use each sender highest actual price, without close-time or leader gates', async () => {
  const db = new PGlite({ extensions: { pgcrypto } })
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
  try {
    await db.exec(`
      create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create schema storage;create schema extensions;
      create table auth.users(id uuid primary key default gen_random_uuid(),email text);
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.user',true),'')::uuid$$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      alter table storage.objects enable row level security;
      create publication supabase_realtime;
      grant usage on schema public,auth,storage to anon,authenticated,service_role;
      alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
      alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
    `)
    await db.exec(build().completeSql)
    const tenant = (
      await one("insert into tenants(name,page_id) values('Shop','100') returning id")
    ).id
    const bank = (
      await one(
        "insert into bank_accounts(tenant_id,bank_code,account_name,account_number) values($1,'KBANK','Shop','1234567890') returning id",
        [tenant],
      )
    ).id
    const payload = (
      await one(
        "insert into facebook_webhook_payloads(payload_sha256,raw_payload) values($1,'{}') returning id",
        ['a'.repeat(64)],
      )
    ).id
    const settings = {
      winnerFlow: 'on_demand',
      keywords: ['1', '11', '+1', '1'],
      closeKeywords: ['❌', '❌'],
      closeEnabled: true,
    }
    async function round() {
      return (
        await one(
          `insert into auctions(tenant_id,page_id,live_post_id,item_name,start_price,min_step,shipping_fee,bank_account_id,
        host_ids,session_automation,public_reply_enabled,private_reply_enabled)
        values($1,'100','456','Product',200,20,50,$2,array['999'],$3,false,true) returning id`,
          [tenant, bank, JSON.stringify(settings)],
        )
      ).id
    }
    async function event(sender, text, extra = {}) {
      return one(
        `insert into facebook_webhook_events(payload_id,page_id,event_key,ordering_key,kind,payload,status)
        values($1,'100',$2,'auction:456','change',$3,'completed') returning *`,
        [
          payload,
          randomUUID(),
          JSON.stringify({
            field: 'feed',
            value: {
              item: 'comment',
              verb: 'add',
              post_id: '456',
              comment_id: '456_' + randomUUID(),
              from: { id: sender, name: 'Buyer ' + sender },
              message: text,
              ...extra,
            },
          }),
        ],
      )
    }
    async function process(id, ev, tenantId = tenant) {
      return (
        await one(
          "select process_live_auction_comment($1,$2,$3,'CONFIRM_BID',999999,null) result",
          [id, tenantId, ev.id],
        )
      ).result
    }
    const id = await round()
    const empty = await process(id, await event('902', '1'))
    assert.equal(empty.reason, 'NO_BID_HISTORY')
    assert.equal((await one('select count(*) n from orders')).n, 0)
    // A timestamp older than the round is not a reason to discard signed comments.
    await process(id, await event('900', '250', { created_time: '1600000000' }))
    await process(id, await event('900', '200'))
    await process(id, await event('901', '500'))
    const confirmation = await event('900', '+1')
    const first = await process(id, confirmation)
    assert.equal(first.status, 'claimed')
    assert.equal(first.amount, 250)
    assert.deepEqual(await process(id, confirmation), first)
    let order = await one('select * from orders where id=$1', [first.orderId])
    assert.equal(Number(order.amount), 300)
    assert.equal(Number(order.item_amount), 250)
    assert.equal(order.live_auction_id, id)
    assert.equal(
      (await one('select leading_bidder_id from auctions where id=$1', [id])).leading_bidder_id,
      '901',
    )
    assert.equal(
      (await one("select count(*) n from auction_deliveries where channel='public'")).n,
      0,
    )
    assert.equal((await one('select count(*) n from auction_deliveries')).n, 1)
    const delivery = await one('select * from auction_deliveries where claim_id=$1', [
      first.claimId,
    ])
    assert.equal(
      (await one('select claim_auction_bill_delivery($1,999) ok', [delivery.id])).ok,
      false,
    )
    assert.equal((await one('select claim_auction_bill_delivery($1,1) ok', [delivery.id])).ok, true)
    assert.equal(
      (await one('select claim_auction_bill_delivery($1,1) ok', [delivery.id])).ok,
      false,
    )
    await assert.rejects(process(id, await event('900', '1')), /AUCTION_CLAIM_DELIVERY_BUSY/)
    await one("update auction_deliveries set status='sent' where id=$1", [delivery.id])
    const closed = await process(id, await event('999', '❌'))
    assert.equal(closed.status, 'closed')
    assert.equal(
      (await one('select count(*) n from orders')).n,
      1,
      'closing cannot invent or preannounce a bill',
    )
    assert.equal((await one('select order_id from auctions where id=$1', [id])).order_id, null)
    // Late numeric bids remain valid history even if below the global leader.
    await process(id, await event('900', '275'))
    const updated = await process(id, await event('900', '11', { created_time: '1600000001' }))
    assert.equal(updated.orderId, first.orderId)
    assert.equal(updated.amount, 275)
    order = await one('select * from orders where id=$1', [first.orderId])
    assert.equal(Number(order.amount), 325)
    assert.equal((await one('select count(*) n from customer_tab_items')).n, 1)
    assert.equal(
      (await one("select count(*) n from auction_deliveries where status='pending'")).n,
      1,
    )
    const other = await process(id, await event('901', '1'))
    assert.equal(other.amount, 500)
    assert.notEqual(other.orderId, first.orderId)
    assert.equal((await one('select count(*) n from orders')).n, 2)
    await assert.rejects(
      process(id, await event('900', '1', { post_id: '789' })),
      /AUCTION_POST_MISMATCH/,
    )
    await assert.rejects(process(id, await event('900', '1'), randomUUID()), /AUCTION_NOT_FOUND/)
    const second = await round()
    assert.equal((await process(second, confirmation)).reason, 'COMMENT_ALREADY_PROCESSED')
    const fresh = await process(second, await event('900', '1'))
    assert.equal(fresh.reason, 'NO_BID_HISTORY', 'previous product history cannot be reused')
    await process(second, await event('900', '100'))
    const cumulative = await process(second, await event('900', '1'))
    const nextOrder = await one('select * from orders where id=$1', [cumulative.orderId])
    assert.equal(nextOrder.customer_tab_id, order.customer_tab_id)
    assert.equal(Number(nextOrder.amount), 100, 'shipping is charged once per tab')
    let tab = await one('select * from customer_tabs where id=$1', [order.customer_tab_id])
    assert.equal(Number(tab.total_amount), 425)
    assert.equal(
      (await one('select live_session_dashboard($1,$2) snapshot', [tenant, order.live_session_id]))
        .snapshot.metrics.auctionSales,
      875,
    )
    // On-demand claims can be settled while the new product round is still active.
    const slip = (
      await one(
        `insert into slips(tenant_id,customer_id,customer_tab_id,expected_amount)
      values($1,$2,$3,$4) returning id`,
        [tenant, order.customer_id, tab.id, tab.remaining_amount],
      )
    ).id
    await assert.rejects(
      one('select complete_auction_customer_tab_slip($1,$2,$3,$4,$5,$6,now(),$7,$8)', [
        slip,
        tenant,
        order.customer_id,
        '901',
        tab.remaining_amount,
        'ref-foreign',
        '{}',
        'verified',
      ]),
      /AUCTION_WINNER_MISMATCH/,
    )
    await one('select complete_auction_customer_tab_slip($1,$2,$3,$4,$5,$6,now(),$7,$8)', [
      slip,
      tenant,
      order.customer_id,
      '900',
      tab.remaining_amount,
      'ref-own',
      '{}',
      'verified',
    ])
    assert.equal(
      (await one('select status from orders where id=$1', [cumulative.orderId])).status,
      'paid',
    )
    await process(second, await event('900', '150'))
    const protectedBill = await process(second, await event('900', '1'))
    assert.equal(protectedBill.reason, 'BILL_REQUIRES_REVIEW')
    assert.equal(
      Number((await one('select amount from orders where id=$1', [cumulative.orderId])).amount),
      100,
    )
    await db.exec(fs.readFileSync('supabase/live-auction-on-demand.sql', 'utf8'))
    assert.equal(
      (await one('select count(*) n from auction_winner_claims')).n,
      3,
      'migration reruns preserve claims',
    )
  } finally {
    await db.close()
  }
})
