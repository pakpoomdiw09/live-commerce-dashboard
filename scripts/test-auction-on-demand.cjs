const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { PGlite } = require('@electric-sql/pglite')
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto')
const { build } = require('./build-full-database-setup.cjs')
const fs = require('node:fs')

test('only the host-designated bidder can confirm; winner pricing, invoices, outbox and tenant guards are atomic', async () => {
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
      const auction = await one('select status from auctions where id=$1', [id])
      const value = ev.payload.value
      const host = value.from.id === '999' || value.from.id === '100'
      const kind = host
        ? 'HOST_CONTROL'
        : auction.status === 'closed'
          ? 'CONFIRM_BID'
          : 'NUMERIC_BID'
      return (
        await one(
          'select process_live_auction_comment($1,$2,$3,$4,null,null) result',
          [id, tenantId, ev.id, kind],
        )
      ).result
    }
    const id = await round()
    assert.equal((await process(id, await event('902', '1'))).status, 'too_low')
    assert.equal((await one('select count(*)::int n from orders')).n, 0)
    await process(id, await event('900', '250'))
    await process(id, await event('901', '500'))
    assert.equal((await process(id, await event('900', '400'))).status, 'too_low')
    let auction = await one('select * from auctions where id=$1', [id])
    assert.equal(auction.leading_bidder_id, '901')
    assert.equal(Number(auction.current_price), 500)
    assert.equal((await process(id, await event('999', '❌'))).status, 'awaiting_confirmation')
    await one('select designate_live_auction_winner($1,$2,$3)', [id, tenant, '900'])
    assert.equal((await process(id, await event('901', '1'))).status, 'ignored')
    assert.equal((await one('select count(*)::int n from orders')).n, 0)
    const confirmation = await event('900', '1')
    const winner = await process(id, confirmation)
    assert.equal(winner.status, 'confirmed')
    assert.equal(
      winner.amount,
      250,
      'the designated winner pays their own highest bid, never another bidder\'s price',
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
    assert.equal(order.platform_user_id, '900')
    assert.equal(Number(order.item_amount), 250, JSON.stringify(order))
    assert.equal(
      Number(order.amount),
      300,
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
    assert.equal((await process(id, await event('900', '1000'))).status, 'ignored')
    assert.equal((await process(id, await event('900', '1'))).status, 'ignored')
    assert.equal((await one('select count(*)::int n from orders')).n, 1)
    assert.equal((await one('select count(*)::int n from auction_deliveries')).n, 1)
    assert.equal(
      Number((await one('select current_price from auctions where id=$1', [id])).current_price),
      250,
    )

    const other = (await one("insert into tenants(name,page_id) values('Other','200') returning id")).id
    await assert.rejects(process(id, await event('900', '1'), other), /AUCTION_NOT_FOUND/)

    const expiring = await round()
    await process(expiring, await event('900', '600'))
    assert.equal((await process(expiring, await event('999', '❌'))).status, 'awaiting_confirmation')
    await one('select designate_live_auction_winner($1,$2,$3)', [expiring, tenant, '900'])
    await db.query("update auctions set closed_at=clock_timestamp()-interval '5 minutes 1 second' where id=$1", [expiring])
    assert.equal((await process(expiring, await event('900', '1'))).status, 'expired')
    assert.equal((await one('select status from auctions where id=$1', [expiring])).status, 'expired')
    assert.equal((await one('select count(*)::int n from orders where live_auction_id=$1', [expiring])).n, 0)

    const priorRound = await round()
    await process(priorRound, await event('900', '700'))
    assert.equal((await process(priorRound, await event('999', '❌'))).status, 'awaiting_confirmation')
    await one('select designate_live_auction_winner($1,$2,$3)', [priorRound, tenant, '900'])
    await round()
    assert.equal((await process(priorRound, await event('900', '1'))).status, 'ignored')
    assert.equal((await one('select count(*)::int n from orders where live_auction_id=$1', [priorRound])).n, 0)

    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`)
      await assert.rejects(db.query('select * from auction_poll_cursors'), (error) => error.code === '42501')
      await assert.rejects(db.query('select expire_live_auctions()'), (error) => error.code === '42501')
      await db.exec('reset role')
    }  } finally {
    await db.close()
  }
})
