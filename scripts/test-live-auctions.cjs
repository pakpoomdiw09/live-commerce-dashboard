const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { PGlite } = require('@electric-sql/pglite')
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto')
const { build } = require('./build-full-database-setup.cjs')
const fs = require('node:fs')

test('live auctions execute against the complete schema: ordering, steps, close, replay, proof and isolation', async () => {
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
    await db.exec(fs.readFileSync('supabase/live-auctions.sql', 'utf8'))
    await db.exec(fs.readFileSync('supabase/auction-experience.sql', 'utf8'))
    const tenant = (
      await one("insert into tenants(name,page_id) values('Auction shop','100') returning id")
    ).id
    const other = (
      await one("insert into tenants(name,page_id) values('Other shop','200') returning id")
    ).id
    const bank = (
      await one(
        "insert into bank_accounts(tenant_id,bank_code,account_name,account_number) values($1,'KBANK','Shop','1234567890') returning id",
        [tenant],
      )
    ).id
    const receipt = (
      await one(
        "insert into facebook_webhook_payloads(payload_sha256,raw_payload) values($1,'{}') returning id",
        ['a'.repeat(64)],
      )
    ).id
    async function auction(post = '456') {
      return (
        await one(
          `insert into auctions(tenant_id,page_id,live_post_id,item_name,start_price,min_step,shipping_fee,bank_account_id,host_ids)
        values($1,'100',$3,'เหรียญรุ่น 1',200,20,50,$2,array['999']) returning id`,
          [tenant, bank, post],
        )
      ).id
    }
    async function event(sender, text, status = 'completed', post = '456', extra = {}) {
      const value = {
        item: 'comment',
        verb: 'add',
        post_id: post,
        comment_id: '456_' + randomUUID(),
        from: { id: sender, name: 'Bidder ' + sender },
        message: text,
        ...extra,
      }
      return await one(
        `insert into facebook_webhook_events(payload_id,page_id,event_key,ordering_key,kind,payload,status)
        values($1,'100',$2,$3,'change',$4::jsonb,$5) returning *`,
        [receipt, randomUUID(), sender, JSON.stringify({ field: 'feed', value }), status],
      )
    }
    async function process(auctionId, ev, kind, amount = null, control = null, tenantId = tenant) {
      return (
        await one('select process_live_auction_comment($1,$2,$3,$4,$5,$6) result', [
          auctionId,
          tenantId,
          ev.id,
          kind,
          amount,
          control,
        ])
      ).result
    }
    const id = await auction()
    await assert.rejects(auction(), /duplicate key/)
    const first = await event('900', 'เปิดให้ 10 ลุ้น')
    const accepted = await process(id, first, 'OPENING_BID')
    assert.equal(accepted.status, 'accepted')
    assert.equal(accepted.amount, 200)
    assert.deepEqual(await process(id, first, 'OPENING_BID'), accepted)
    assert.equal(
      (await process(id, await event('901', 'เปิด'), 'OPENING_BID')).status,
      'already_opened',
    )
    assert.equal(
      (await process(id, await event('901', '219'), 'NUMERIC_BID', 219)).status,
      'too_low',
    )
    assert.equal((await process(id, await event('901', '1'), 'STEP_BID')).amount, 220)
    assert.equal((await process(id, await event('902', '250'), 'NUMERIC_BID', 250)).amount, 250)
    assert.equal(
      (await process(id, await event('902', 'ปิด'), 'HOST_CONTROL', null, 'close')).status,
      'ignored',
    )
    assert.equal(
      (await process(id, await event('999', 'เคาะ 3'), 'HOST_CONTROL', null, '3')).status,
      'count',
    )
    assert.equal(
      (await one('select status,host_count from auctions where id=$1', [id])).status,
      'active',
    )
    // Accepted bids reset the host count and the next step uses the locked current price.
    assert.equal((await process(id, await event('903', '+1'), 'STEP_BID')).amount, 270)
    assert.equal((await one('select host_count from auctions where id=$1', [id])).host_count, null)
    const earlier = await event('904', '300', 'pending')
    const closing = await event('100', 'ปิด', 'pending')
    assert.equal(earlier.ordering_key, closing.ordering_key)
    await assert.rejects(
      process(id, closing, 'HOST_CONTROL', null, 'close'),
      /AUCTION_EVENT_OUT_OF_ORDER/,
    )
    assert.equal((await process(id, earlier, 'NUMERIC_BID', 300)).amount, 300)
    await db.query("update facebook_webhook_events set status='completed' where id=$1", [
      earlier.id,
    ])
    const closed = await process(id, closing, 'HOST_CONTROL', null, 'close')
    await db.query("update facebook_webhook_events set status='completed' where id=$1", [
      closing.id,
    ])
    assert.equal(closed.status, 'closed')
    assert.ok(closed.orderId)
    assert.deepEqual(await process(id, closing, 'HOST_CONTROL', null, 'close'), closed)
    const bill = await one('select amount,source,status from orders where id=$1', [closed.orderId])
    assert.equal(Number(bill.amount), 350)
    assert.equal(bill.source, 'live_auction')
    assert.equal(bill.status, 'pending_payment')
    assert.equal(
      (await process(id, await event('905', '999'), 'NUMERIC_BID', 999)).status,
      'closed',
    )
    assert.equal(
      (await one('select leading_bidder_id from auctions where id=$1', [id])).leading_bidder_id,
      '904',
    )
    assert.equal((await one('select count(*)::int n from orders')).n, 1)
    const quiet = await auction('666')
    await db.query(
      'update auctions set private_reply_enabled=false,public_reply_enabled=false where id=$1',
      [quiet],
    )
    await process(quiet, await event('920', 'เปิด', 'completed', '666'), 'OPENING_BID')
    await process(
      quiet,
      await event('100', '❌', 'completed', '666'),
      'HOST_CONTROL',
      null,
      'close',
    )
    assert.equal(
      (await one('select count(*)::int n from auction_deliveries where auction_id=$1', [quiet])).n,
      0,
    )
    assert.equal(
      (
        await one('select count(*)::int n from messages where external_id=$1', [
          'auction-event:' + quiet,
        ])
      ).n,
      1,
      'switching off replies preserves the immediate local Inbox event and sale',
    )
    assert.equal(
      (await one('select count(*)::int n from auction_deliveries where auction_id=$1', [id])).n,
      2,
    )
    assert.equal(
      (await one('select finalize_live_auction($1,$2) r', [id, tenant])).r.orderId,
      closed.orderId,
    )
    const proof = await one("select submit_auction_payment_proof($1,'auction/proof.png') id", [
      closed.orderId,
    ])
    assert.ok(proof.id)
    assert.equal(
      (await one('select status from orders where id=$1', [closed.orderId])).status,
      'pending_payment',
      'upload alone must not mark paid',
    )
    await assert.rejects(
      one("select submit_auction_payment_proof($1,'another.png')", [closed.orderId]),
      /AUCTION_PROOF_EXISTS/,
    )
    const owner = (await one('insert into auth.users default values returning id')).id
    const secondOrder = (
      await one(
        "insert into orders(tenant_id,customer_id,product_name,amount) select tenant_id,customer_id,'Other purchase',500 from orders where id=$1 returning id",
        [closed.orderId],
      )
    ).id
    await assert.rejects(
      one('select approve_auction_payment_proof($1,$2,$3)', [proof.id, tenant, owner]),
      /TAB_PAYMENT_NOT_COVERED/,
    )
    assert.equal(
      (await one('select status from orders where id=$1', [closed.orderId])).status,
      'pending_payment',
    )
    assert.equal(
      (await one('select status from orders where id=$1', [secondOrder])).status,
      'pending_payment',
    )
    await assert.rejects(
      one('select approve_auction_payment_proof($1,$2,$3)', [proof.id, other, owner]),
      /AUCTION_PROOF_NOT_APPROVABLE/,
    )
    await db.query('delete from orders where id=$1', [secondOrder])
    await assert.rejects(
      one('select finalize_live_auction($1,$2)', [id, other]),
      /AUCTION_NOT_FOUND/,
    )
    await assert.rejects(
      process(id, await event('900', '300', 'completed', '777'), 'NUMERIC_BID', 300),
      /AUCTION_POST_MISMATCH/,
    )
    await assert.rejects(
      process(
        id,
        await event('900', '300', 'completed', '456', { post_id: null }),
        'NUMERIC_BID',
        300,
      ),
      /AUCTION_POST_MISMATCH/,
    )
    const empty = await auction('777')
    const emptyClosed = (await one('select finalize_live_auction($1,$2) r', [empty, tenant])).r
    assert.equal(emptyClosed.orderId, null)
    const cancelled = await auction('888')
    assert.equal(
      (await one('select finalize_live_auction($1,$2,null,true) r', [cancelled, tenant])).r.status,
      'cancelled',
    )
    assert.equal((await one('select count(*)::int n from orders')).n, 2)
    // The DB trigger also protects events enqueued by older application instances.
    const q1 = await event('910', 'เปิด', 'pending', '777')
    const q2 = await event('100', 'ปิด', 'pending', '777')
    const claimed = await one('select * from claim_facebook_webhook()')
    assert.equal(claimed.id, q1.id)
    assert.equal(
      await one('select * from claim_facebook_webhook()'),
      undefined,
      'host close waits for first bidder',
    )
    await db.query("update facebook_webhook_events set status='completed' where id=$1", [q1.id])
    assert.equal((await one('select * from claim_facebook_webhook()')).id, q2.id)
    for (const table of [
      'auctions',
      'auction_bids',
      'auction_deliveries',
      'auction_payment_proofs',
    ]) {
      assert.equal(
        (await one('select relrowsecurity from pg_class where oid=$1::regclass', [table]))
          .relrowsecurity,
        true,
      )
      assert.equal(
        (await one("select has_table_privilege('authenticated',$1,'insert') allowed", [table]))
          .allowed,
        false,
      )
    }
    assert.equal(
      (
        await one(
          "select has_function_privilege('authenticated','process_live_auction_comment(uuid,uuid,uuid,text,numeric,text)','execute') allowed",
        )
      ).allowed,
      false,
    )
  } finally {
    await db.close()
  }
})
