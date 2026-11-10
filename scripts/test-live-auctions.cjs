const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { PGlite } = require('@electric-sql/pglite')
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto')
const { build } = require('./build-full-database-setup.cjs')

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
      const id = (
        await one(
          `insert into auctions(tenant_id,page_id,live_post_id,item_name,start_price,min_step,shipping_fee,bank_account_id,host_ids)
        values($1,'100',$3,'เน€เธซเธฃเธตเธขเธเธฃเธธเนเธ 1',200,20,50,$2,array['999']) returning id`,
          [tenant, bank, post],
        )
      ).id
      await db.query("update auctions set session_automation=coalesce(session_automation,'{}'::jsonb)||'{\"keywords\":[\"1\"],\"winnerFlow\":\"on_demand\",\"closeKeywords\":[\"close\"]}'::jsonb where id=$1", [id])
      return id
    }
    async function event(sender, text, status = 'completed', post = '456', extra = {}) {
      const value = {
        item: 'comment',
        verb: 'add',
        post_id: post,
        comment_id: '456_' + randomUUID(),
        from: { id: sender, name: 'Bidder ' + sender },
        message: sender === '100' ? 'close' : text,
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
    const first = await event('900', 'เน€เธเธดเธ”เนเธซเน 10 เธฅเธธเนเธ')
    const accepted = await process(id, first, 'OPENING_BID')
    assert.equal(accepted.status, 'accepted')
    assert.equal(accepted.amount, 200)
    assert.deepEqual(await process(id, first, 'OPENING_BID'), accepted)
    assert.equal(
      (await process(id, await event('901', 'เน€เธเธดเธ”'), 'OPENING_BID')).status,
      'already_opened',
    )
    assert.equal(
      (await process(id, await event('901', '219'), 'NUMERIC_BID', 219)).status,
      'too_low',
    )
    assert.equal((await process(id, await event('901', '1'), 'STEP_BID')).amount, 220)
    assert.equal((await process(id, await event('902', '250'), 'NUMERIC_BID', 250)).amount, 250)
    assert.equal(
      (await process(id, await event('902', 'เธเธดเธ”'), 'HOST_CONTROL', null, 'close')).status,
      'ignored',
    )
    assert.equal(
      (await process(id, await event('999', '3'), 'HOST_CONTROL', null, '3')).status,
      'ignored',
      'legacy numeric host controls cannot change an active round',
    )
    assert.equal(
      (await one('select status from auctions where id=$1', [id])).status,
      'active',
    )
    // Numeric customer bids remain separate from host controls.
    assert.equal((await process(id, await event('903', '+1'), 'STEP_BID')).amount, 270)
    assert.equal((await process(id, await event('905', '300'), 'NUMERIC_BID', 300)).amount, 300)
    for (let index = 0; index < 35; index++) {
      const bidAmount = 320 + index * 20
      assert.equal(
        (await process(id, await event(String(7000 + index), String(bidAmount)), 'NUMERIC_BID', bidAmount)).status,
        'accepted',
      )
    }
    const earlier = await event('904', '299', 'pending')
    const closing = await event('100', 'เธเธดเธ”', 'pending')
    assert.equal(earlier.ordering_key, closing.ordering_key)
    await assert.rejects(
      process(id, closing, 'HOST_CONTROL', null, 'close'),
      /AUCTION_EVENT_OUT_OF_ORDER/,
    )
    assert.equal((await process(id, earlier, 'NUMERIC_BID', 299)).status, 'too_low')
    await db.query("update facebook_webhook_events set status='completed' where id=$1", [
      earlier.id,
    ])
    const closed = await process(id, closing, 'HOST_CONTROL', null, 'close')
    await db.query("update facebook_webhook_events set status='completed' where id=$1", [
      closing.id,
    ])
    assert.equal(closed.status, 'awaiting_confirmation')
    assert.equal(closed.orderId ?? null, null)
    assert.deepEqual(await process(id, closing, 'HOST_CONTROL', null, 'close'), closed)
    const candidates = (await one('select list_live_auction_winner_candidates($1,$2) result', [id, tenant])).result
    assert.ok(candidates.length > 30, 'candidate RPC returns all eligible bidders, not only the latest 30 bids')
    assert.equal(candidates.find((candidate) => candidate.bidder_id === '902').bid_amount, 250)
    assert.equal((await process(id, await event('902', '1'), 'CONFIRM_BID')).status, 'ignored')
    const designated = await one('select designate_live_auction_winner($1,$2,$3) result', [id, tenant, '902'])
    assert.equal(Number(designated.result.amount), 250)
    await assert.rejects(
      one('select designate_live_auction_winner($1,$2,$3)', [id, tenant, '905']),
      /AUCTION_WINNER_ALREADY_DESIGNATED/,
    )
    assert.equal((await process(id, await event('906', '1'), 'CONFIRM_BID')).status, 'ignored')
    assert.equal((await process(id, await event('905', '1'), 'CONFIRM_BID')).status, 'ignored')
    const confirmed = await process(id, await event('902', '1'), 'CONFIRM_BID')
    assert.equal(confirmed.status, 'confirmed')
    assert.equal(Number(confirmed.amount), 250)
    assert.equal((await one('select leading_bidder_id from auctions where id=$1', [id])).leading_bidder_id, '902')
    assert.equal(Number((await one('select current_price from auctions where id=$1', [id])).current_price), 250)
    const invoiceOutbox = await one(
      `select d.channel,d.status,c.highest_amount,c.order_id,o.item_amount,o.amount
       from auction_deliveries d join auction_winner_claims c on c.id=d.claim_id
       join orders o on o.id=c.order_id where d.auction_id=$1 and d.channel='private'`,
      [id],
    )
    assert.equal(invoiceOutbox.channel, 'private')
    assert.equal(invoiceOutbox.status, 'pending')
    assert.equal(Number(invoiceOutbox.highest_amount), 250)
    assert.equal(Number(invoiceOutbox.item_amount), 250)
    assert.equal(Number(invoiceOutbox.amount), 300, 'invoice total includes 50 THB shipping')
    assert.equal((await process(id, await event('905', '1'), 'CONFIRM_BID')).status, 'ignored')
    const bill = await one('select amount,source,status from orders where id=$1', [confirmed.orderId])
    assert.equal(Number(bill.amount), 300)
    assert.equal(bill.source, 'live_auction')
    assert.equal(bill.status, 'pending_payment')
    assert.equal(
      (await process(id, await event('905', '999'), 'NUMERIC_BID', 999)).status,
      'ignored',
    )
    assert.equal(
      (await one('select leading_bidder_id from auctions where id=$1', [id])).leading_bidder_id,
      '902',
    )
    assert.equal((await one('select count(*)::int n from orders')).n, 1)
    const quiet = await auction('666')
    await db.query(
      "update auctions set private_reply_enabled=false,public_reply_enabled=false,session_automation=session_automation||'{\"closeKeywords\":[\"close\"]}'::jsonb where id=$1",
      [quiet],
    )
    await process(quiet, await event('920', '240', 'completed', '666'), 'NUMERIC_BID', 240)
    await process(quiet, await event('920', 'เน€เธเธดเธ”', 'completed', '666'), 'OPENING_BID')
    await process(
      quiet,
      await event('100', 'close', 'completed', '666'),
      'HOST_CONTROL',
      null,
      'close',
    )
    await one('select designate_live_auction_winner($1,$2,$3)', [quiet, tenant, '920'])
    assert.equal((await process(quiet, await event('920', '1', 'completed', '666'), 'CONFIRM_BID')).status, 'confirmed')
    assert.equal(
      (await one('select count(*)::int n from auction_deliveries where auction_id=$1', [quiet])).n,
      1,
    )
    assert.equal((await one("select count(*)::int n from messages where external_id like 'auction-claim:%' and delivery_status='pending'")).n, 2)
    assert.equal(
      (await one('select count(*)::int n from auction_deliveries where auction_id=$1', [id])).n,
      2,
    )
    assert.equal(
      (await one('select finalize_live_auction($1,$2) r', [id, tenant])).r.orderId,
      confirmed.orderId,
    )
    const proof = await one("select submit_auction_payment_proof($1,'auction/proof.png') id", [
      confirmed.orderId,
    ])
    assert.ok(proof.id)
    assert.equal(
      (await one('select status from orders where id=$1', [confirmed.orderId])).status,
      'pending_payment',
      'upload alone must not mark paid',
    )
    await assert.rejects(
      one("select submit_auction_payment_proof($1,'another.png')", [confirmed.orderId]),
      /AUCTION_PROOF_EXISTS/,
    )
    const owner = (await one('insert into auth.users default values returning id')).id
    const secondOrder = (
      await one(
        "insert into orders(tenant_id,customer_id,product_name,amount) select tenant_id,customer_id,'Other purchase',500 from orders where id=$1 returning id",
        [confirmed.orderId],
      )
    ).id
    await assert.rejects(
      one('select approve_auction_payment_proof($1,$2,$3)', [proof.id, tenant, owner]),
      /TAB_PAYMENT_NOT_COVERED/,
    )
    assert.equal(
      (await one('select status from orders where id=$1', [confirmed.orderId])).status,
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
    const timed = await auction('700')
    await db.query("update auctions set session_automation=session_automation||'{\"closeKeywords\":[\"close\"]}'::jsonb where id=$1", [timed])
    await process(timed, await event('930', 'เน€เธโฌเน€เธยเน€เธเธ”เน€เธโ€', 'completed', '700'), 'OPENING_BID')
    await process(timed, await event('100', 'close', 'completed', '700'), 'HOST_CONTROL', null, 'close')
    await db.query("update auctions set closed_at=clock_timestamp()-interval '5 minutes 1 second' where id=$1", [timed])
    assert.equal((await process(timed, await event('930', '1', 'completed', '700'), 'CONFIRM_BID')).status, 'expired')
    assert.equal((await one('select status from auctions where id=$1', [timed])).status, 'expired')
    const oldRound = await auction('701')
    await db.query("update auctions set session_automation=session_automation||'{\"closeKeywords\":[\"close\"]}'::jsonb where id=$1", [oldRound])
    await process(oldRound, await event('931', 'เน€เธโฌเน€เธยเน€เธเธ”เน€เธโ€', 'completed', '701'), 'OPENING_BID')
    await process(oldRound, await event('100', 'close', 'completed', '701'), 'HOST_CONTROL', null, 'close')
    await auction('701')
    assert.equal((await process(oldRound, await event('931', '1', 'completed', '701'), 'CONFIRM_BID')).status, 'ignored')
    assert.equal((await one('select winner_confirmation_comment_id from auctions where id=$1', [oldRound])).winner_confirmation_comment_id, null)
    const payableAuction = await auction('789')
    await process(payableAuction, await event('911', '220', 'completed', '789'), 'NUMERIC_BID', 220)
    await process(payableAuction, await event('911', 'เน€เธเธดเธ”', 'completed', '789'), 'OPENING_BID')
    const payableClose = await process(
      payableAuction,
      await event('100', 'เธเธดเธ”', 'completed', '789'),
      'HOST_CONTROL',
      null,
      'close',
    )
    await one('select designate_live_auction_winner($1,$2,$3)', [payableAuction, tenant, '911'])
    const payableConfirmed = await process(payableAuction, await event('911', '1', 'completed', '789'), 'CONFIRM_BID')
    assert.equal(payableConfirmed.status, 'confirmed')
    const payableOrder = await one(
      'select id,tenant_id,customer_id,amount,customer_tab_id from orders where id=$1',
      [payableConfirmed.orderId],
    )
    const payableTab = await one('select id,remaining_amount from customer_tabs where id=$1', [
      payableOrder.customer_tab_id,
    ])
    const verifiedSlip = (
      await one(
        `insert into slips(tenant_id,customer_id,customer_tab_id,expected_amount)
         values($1,$2,$3,$4) returning id`,
        [tenant, payableOrder.customer_id, payableTab.id, payableTab.remaining_amount],
      )
    ).id
    const ordersBeforeSettlement = (await one('select count(*)::int n from orders')).n
    await assert.rejects(
      one(`select complete_auction_customer_tab_slip($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
        verifiedSlip,
        tenant,
        payableOrder.customer_id,
        '912',
        payableTab.remaining_amount,
        'auction-transfer-789',
        new Date().toISOString(),
        {},
        null,
      ]),
      /AUCTION_WINNER_MISMATCH/,
    )
    await assert.rejects(
      one(`select complete_auction_customer_tab_slip($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
        verifiedSlip,
        tenant,
        payableOrder.customer_id,
        '911',
        Number(payableTab.remaining_amount) - 1,
        'auction-transfer-789',
        new Date().toISOString(),
        {},
        null,
      ]),
      /AUCTION_TAB_AMOUNT_MISMATCH/,
    )
    const paidResult = (
      await one(`select complete_auction_customer_tab_slip($1,$2,$3,$4,$5,$6,$7,$8,$9) result`, [
        verifiedSlip,
        tenant,
        payableOrder.customer_id,
        '911',
        payableTab.remaining_amount,
        'auction-transfer-789',
        new Date().toISOString(),
        {},
        null,
      ])
    ).result
    assert.equal(paidResult.status, 'fully_paid')
    assert.equal(
      (await one('select status,paid_at,slip_id from orders where id=$1', [payableOrder.id]))
        .status,
      'paid',
    )
    assert.ok((await one('select paid_at from orders where id=$1', [payableOrder.id])).paid_at)
    assert.equal(
      (await one('select status from slips where id=$1', [verifiedSlip])).status,
      'valid',
    )
    assert.equal(
      (await one('select slip_id from customer_tab_payments where tab_id=$1', [payableTab.id]))
        .slip_id,
      verifiedSlip,
    )
    assert.equal((await one('select count(*)::int n from orders')).n, ordersBeforeSettlement)
    // The DB trigger also protects events enqueued by older application instances.
    const q1 = await event('910', 'เน€เธเธดเธ”', 'pending', '777')
    const q2 = await event('100', 'เธเธดเธ”', 'pending', '777')
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
    assert.equal(
      (
        await one(
          "select has_function_privilege('authenticated','complete_auction_customer_tab_slip(uuid,uuid,uuid,text,numeric,text,timestamptz,jsonb,text)','execute') allowed",
        )
      ).allowed,
      false,
    )
  } finally {
    await db.close()
  }
})
