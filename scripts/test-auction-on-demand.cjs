const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { PGlite } = require('@electric-sql/pglite')
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto')
const { build } = require('./build-full-database-setup.cjs')
const fs = require('node:fs')

test('only the active highest bidder can confirm; invoices, outbox, replay and tenant guards are atomic', async () => {
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
      privateReply: true,
      publicReply: false,
      privateText: '{product_name} {price} {bank_account} {payment_link}',
      bidText: '{product_name} {price}',
      closeText: '{product_name} {price}',
      bankAccountId: bank,
      countEnabled: false,
      heartCloses: false,
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
              created_time: new Date().toISOString(),
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
    assert.equal((await process(id, await event('902', '1'))).status, 'not_winner')
    assert.equal((await one('select count(*)::int n from orders')).n, 0)
    await process(id, await event('900', '250'))
    await process(id, await event('901', '500'))
    assert.equal((await process(id, await event('900', '400'))).status, 'too_low')
    let auction = await one('select * from auctions where id=$1', [id])
    assert.equal(auction.leading_bidder_id, '901')
    assert.equal(Number(auction.current_price), 500)
    assert.equal((await process(id, await event('900', '+1'))).status, 'not_winner')
    assert.equal((await one('select count(*)::int n from orders')).n, 0)
    const confirmation = await event('901', '1')
    const winner = await process(id, confirmation)
    assert.equal(winner.status, 'confirmed')
    assert.equal(
      winner.amount,
      500,
      'the confirmation is never a bid of 1 or a forged client quote',
    )
    assert.deepEqual(await process(id, confirmation), winner)
    auction = await one('select * from auctions where id=$1', [id])
    assert.equal(auction.status, 'closed')
    assert.ok(auction.winner_confirmed_at)
    assert.equal(auction.winner_confirmation_event_id, confirmation.id)
    const order = await one(
      'select o.*,c.platform_user_id from orders o join customers c on c.id=o.customer_id where o.id=$1',
      [winner.orderId],
    )
    assert.equal(order.platform_user_id, '901')
    assert.equal(Number(order.item_amount), 500)
    assert.equal(
      Number(order.amount),
      550,
      'winning item price plus separately configured shipping',
    )
    const deliveries = (
      await db.query('select * from auction_deliveries where auction_id=$1', [id])
    ).rows
    assert.equal(deliveries.length, 1)
    assert.equal(deliveries[0].channel, 'private')
    assert.equal(
      deliveries[0].status,
      'pending',
      'confirmation releases immediate Messenger dispatch',
    )
    assert.equal(deliveries[0].comment_id, confirmation.payload.value.comment_id)
    assert.equal((await process(id, await event('900', '1000'))).status, 'closed')
    assert.equal((await process(id, await event('901', '1'))).status, 'closed')
    assert.equal((await one('select count(*)::int n from orders')).n, 1)
    assert.equal((await one('select count(*)::int n from auction_deliveries')).n, 1)
    assert.equal(
      Number((await one('select current_price from auctions where id=$1', [id])).current_price),
      500,
    )

    const custom = await round()
    await db.query(
      "update auctions set session_automation=jsonb_set(session_automation,'{keywords}','[\"confirm\"]') where id=$1",
      [custom],
    )
    await process(custom, await event('900', '300'))
    await process(custom, await event('901', '300'))
    assert.equal(
      (await one('select leading_bidder_id from auctions where id=$1', [custom])).leading_bidder_id,
      '900',
      'a tie cannot replace the leader',
    )
    assert.equal((await process(custom, await event('901', 'CONFIRM'))).status, 'not_winner')
    assert.equal((await process(custom, await event('900', ' CoNfIrM '))).status, 'confirmed')

    const defaultRound = await round()
    await db.query(
      "update auctions set session_automation=jsonb_set(session_automation,'{keywords}','[]') where id=$1",
      [defaultRound],
    )
    await process(defaultRound, await event('902', '350'))
    assert.equal(
      (await process(defaultRound, await event('902', '1'))).status,
      'confirmed',
      'empty legacy settings default to confirmation keyword 1',
    )

    const guarded = await round()
    await db.query(
      "update auctions set session_automation=jsonb_set(session_automation,'{winnerFlow}','\"highest_bid\"') where id=$1",
      [guarded],
    )
    const older = await event('900', '200')
    await db.query("update facebook_webhook_events set status='pending' where id=$1", [older.id])
    const later = await event('901', '1')
    await assert.rejects(process(guarded, later), /AUCTION_EVENT_OUT_OF_ORDER/)
    await db.query("update facebook_webhook_events set status='completed' where id=$1", [older.id])
    await process(guarded, older)
    assert.equal((await process(guarded, later)).status, 'not_winner')
    const wrongPost = await event('900', '1', { post_id: '999' })
    await assert.rejects(process(guarded, wrongPost), /AUCTION_POST_MISMATCH/)
    assert.equal(
      (await process(guarded, await event('900', '1', { verb: 'edited' }))).status,
      'ignored',
    )
    const other = (
      await one("insert into tenants(name,page_id) values('Other','200') returning id")
    ).id
    await assert.rejects(process(guarded, await event('900', '1'), other), /AUCTION_NOT_FOUND/)
    const concurrent = await Promise.all([
      process(guarded, await event('900', '1')),
      process(guarded, await event('900', '1')),
    ])
    assert.deepEqual(concurrent.map((r) => r.status).sort(), ['closed', 'confirmed'])
    const locked = await round()
    const dynamicSettings = {
      ...settings,
      keywords: ['11', '111'],
      closeKeywords: ['XXX', 'XX', 'X'],
    }
    await db.query(
      'update live_sessions set auction_settings=$1 where tenant_id=$2 and live_post_id=$3',
      [JSON.stringify(dynamicSettings), tenant, '456'],
    )
    await process(locked, await event('900', '500'))
    await process(locked, await event('901', '600'))
    await process(locked, await event('999', 'ปิด'))
    assert.equal(
      (await one('select status from auctions where id=$1', [locked])).status,
      'active',
      'custom close tags replace the default',
    )
    assert.equal(
      (await process(locked, await event('900', 'XX'))).status,
      'ignored',
      'customers cannot use admin closing tags',
    )
    const closedByAdmin = await process(locked, await event('999', ' xx '))
    assert.equal(closedByAdmin.status, 'awaiting_confirmation')
    assert.equal(closedByAdmin.winnerId, '901')
    assert.equal(
      (await one('select count(*)::int n from orders')).n,
      4,
      'closing does not create an invoice',
    )
    const snapshot = await one('select * from auctions where id=$1', [locked])
    assert.equal(snapshot.status, 'closed')
    assert.ok(snapshot.winner_locked_at)
    assert.equal((await process(locked, await event('900', '1000'))).status, 'closed')
    assert.equal((await process(locked, await event('900', '11'))).status, 'not_winner')
    assert.equal(
      (await process(locked, await event('901', '1'))).status,
      'closed',
      'default confirmation cannot override saved tags',
    )
    // Opening the next item must not prevent the locked winner from paying the previous one.
    const next = await round()
    const lockedWinner = await process(locked, await event('901', '111'))
    assert.equal(lockedWinner.status, 'confirmed')
    assert.equal(lockedWinner.amount, 600)
    assert.equal((await one('select status from auctions where id=$1', [next])).status, 'active')
    assert.equal(
      (await one('select leading_bidder_id from auctions where id=$1', [locked])).leading_bidder_id,
      '901',
    )

    await db.query(
      'update live_sessions set auction_settings=$1 where tenant_id=$2 and live_post_id=$3',
      [JSON.stringify({ ...settings, keywords: [], closeKeywords: [] }), tenant, '456'],
    )
    await process(next, await event('900', '400'))
    assert.equal((await process(next, await event('100', 'ปิด'))).status, 'ignored')
    assert.equal(
      (await process(next, await event('100', 'XX'))).status,
      'awaiting_confirmation',
      'empty session arrays fall through to the configured round snapshot',
    )
    assert.equal((await process(next, await event('900', '1'))).status, 'closed')
    assert.equal((await process(next, await event('900', '111'))).status, 'confirmed')
    const modeRound = await round()
    for (const mode of ['cf', 'auto']) {
      await db.query('update live_sessions set mode=$1 where tenant_id=$2', [mode, tenant])
      assert.equal((await process(modeRound, await event('900', '500'))).reason, 'SESSION_MODE')
    }
    await db.query(
      `update live_sessions set mode='auction',confirmation_keywords=array['ACCEPT'],closing_keywords=array['FINAL'],
      auction_settings=auction_settings||'{"keywords":["DASHBOARD"],"closeKeywords":["ENDROUND"]}',
      comment_settings='{"opening_tags":["start"],"counting_tags":{"last":"last"},"countEnabled":true}' where tenant_id=$1`,
      [tenant],
    )
    assert.equal((await process(modeRound, await event('900', 'start'))).status, 'accepted')
    assert.equal((await process(modeRound, await event('999', 'last'))).status, 'count')
    assert.equal(
      (await process(modeRound, await event('999', 'ENDROUND'))).status,
      'awaiting_confirmation',
    )
    assert.equal((await process(modeRound, await event('900', 'DASHBOARD'))).status, 'confirmed')
    await db.exec(fs.readFileSync('supabase/live-auction-dynamic-tags.sql', 'utf8'))
    await db.exec(fs.readFileSync('supabase/live-auction-dynamic-tags.sql', 'utf8'))
    assert.equal(
      (await one('select count(*)::int n from orders')).n,
      7,
      'migration reruns never generate invoices',
    )
  } finally {
    await db.close()
  }
})
