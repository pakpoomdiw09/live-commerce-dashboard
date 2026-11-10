// Real SQL transactions in an isolated database. No tokens, network or sends.
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { randomUUID } = require('node:crypto')
const { PGlite } = require('@electric-sql/pglite')
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto')
const { build } = require('./build-full-database-setup.cjs')

test('deadline resolution, queue ordering, retry fencing and inbox tenant RLS', async (t) => {
  const db = new PGlite({ extensions: { pgcrypto } })
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create schema storage;create schema extensions;
      create table auth.users(id uuid primary key default gen_random_uuid(),email text);
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.user',true),'')::uuid$$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      alter table storage.objects enable row level security;create publication supabase_realtime;
      grant usage on schema public,auth,storage to anon,authenticated,service_role;
      alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
      alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;`)
    await db.exec(build().completeSql)
    const tenant = (
      await one(
        "insert into tenants(name,page_id) values('Deadline fixture','122099866472012045') returning id",
      )
    ).id
    const bank = (
      await one(
        "insert into bank_accounts(tenant_id,bank_code,account_name,account_number) values($1,'KBANK','Fixture','0000000000') returning id",
        [tenant],
      )
    ).id
    const actor = (await one('insert into auth.users default values returning id')).id
    const automation = {
      keywords: ['1'],
      closeKeywords: ['close'],
      winnerFlow: 'on_demand',
      publicReply: true,
      privateReply: true,
      bankAccountId: bank,
      closeEnabled: true,
      heartCloses: false,
      bidText: '{bidder_name} {price}',
      closeText: '{bidder_name} {price}',
      privateText: '{total}',
    }
    const create = async (post = randomUUID().replace(/\D/g, '').padEnd(10, '1')) =>
      one(
        `
      insert into auctions(tenant_id,page_id,live_post_id,item_name,start_price,min_step,shipping_fee,
        bank_account_id,host_ids,session_automation,public_reply_enabled,private_reply_enabled)
      values($1,'122099866472012045',$2,'Timed item',200,20,35,$3,array['999'],$4,true,true) returning *`,
        [tenant, post, bank, automation],
      )
    const close = async (a) =>
      (await one('select close_due_live_auction($1,$2) result', [a.id, tenant])).result
    const due = async (a) =>
      db.query("update auctions set ends_at=clock_timestamp()-interval '1 second' where id=$1", [
        a.id,
      ])
    const receipt = (
      await one(
        "insert into facebook_webhook_payloads(payload_sha256,raw_payload) values($1,'{}') returning id",
        ['b'.repeat(64)],
      )
    ).id
    const event = async (a, text, status = 'completed', received) =>
      one(
        `
      insert into facebook_webhook_events(payload_id,page_id,event_key,ordering_key,kind,payload,status,created_at)
      values($1,'122099866472012045',$2,$3,'change',$4,$5,coalesce($6::timestamptz,clock_timestamp())) returning *`,
        [
          receipt,
          randomUUID(),
          'comments:' + a.id,
          {
            field: 'feed',
            value: {
              item: 'comment',
              verb: 'add',
              post_id: a.live_post_id,
              comment_id: a.live_post_id + '_' + randomUUID(),
              from: { id: '900', name: 'Winner' },
              message: text,
              created_time: new Date().toISOString(),
            },
          },
          status,
          received ?? null,
        ],
      )

    await t.test(
      'new rounds use a five minute UTC deadline; future and wrong-tenant closes cannot resolve',
      async () => {
        const a = await create()
        assert.equal(a.duration_seconds, 300)
        assert.equal(Date.parse(a.ends_at) - Date.parse(a.timer_started_at), 300000)
        assert.equal((await close(a)).status, 'not_due')
        await assert.rejects(
          db.query('select close_due_live_auction($1,$2)', [a.id, randomUUID()]),
          /AUCTION_NOT_FOUND/,
        )
        await db.query("update auctions set status='cancelled' where id=$1", [a.id])
      },
    )

    let winningAuction, orderId
    await t.test(
      'expiry locks the leader without an order; only winner confirmation creates one invoice',
      async () => {
        const a = await create()
        winningAuction = a
        await db.query(
          "update auctions set current_price=420,leading_bidder_id='900',leading_bidder_name='Winner',leading_comment_id='456_900' where id=$1",
          [a.id],
        )
        await due(a)
        const result = await close(a)
        assert.equal(result.status, 'awaiting_confirmation')
        assert.equal(result.orderId, null)
        assert.equal(
          (await one('select order_id from auctions where id=$1', [a.id])).order_id,
          null,
        )
        const confirmation = await event(a, '1')
        const confirmed = (
          await one("select process_live_auction_comment($1,$2,$3,'CONFIRM_BID') result", [
            a.id,
            tenant,
            confirmation.id,
          ])
        ).result
        assert.equal(confirmed.status, 'confirmed')
        assert.ok(confirmed.orderId)
        orderId = confirmed.orderId
        const order = await one('select * from orders where id=$1', [orderId])
        assert.equal(Number(order.amount), 455)
        assert.ok(order.customer_tab_id)
        assert.equal(
          (await one('select winner_locked_at from auctions where id=$1', [a.id]))
            .winner_locked_at !== null,
          true,
        )
        assert.equal((await close(a)).orderId, orderId)
        assert.equal(
          (await one('select count(*)::int n from orders where source_id=$1', [a.id])).n,
          1,
        )
        assert.equal(
          (await one('select count(*)::int n from auction_deliveries where auction_id=$1', [a.id]))
            .n,
          2,
        )
      },
    )

    await t.test(
      'empty rounds close without inventing a buyer or order; cron recovers missed browser timers',
      async () => {
        const a = await create()
        await due(a)
        assert.equal((await one('select expire_live_auctions($1) n', [tenant])).n, 1)
        const row = await one('select status,order_id from auctions where id=$1', [a.id])
        assert.equal(row.status, 'closed')
        assert.equal(row.order_id, null)
      },
    )

    await t.test(
      'pre-deadline queued comments drain first; late comments cannot change the winner',
      async () => {
        const a = await create()
        const e = await event(a, '500', 'pending')
        await db.query(
          "update auctions set ends_at=$2::timestamptz+interval '0.001 seconds' where id=$1",
          [a.id, e.created_at],
        )
        assert.equal((await close(a)).status, 'draining')
        const bid = (
          await one("select process_live_auction_comment($1,$2,$3,'NUMERIC_BID',500) result", [
            a.id,
            tenant,
            e.id,
          ])
        ).result
        assert.equal(bid.status, 'accepted')
        await db.query("update facebook_webhook_events set status='completed' where id=$1", [e.id])
        const late = await event(a, '999')
        const ignored = (
          await one("select process_live_auction_comment($1,$2,$3,'NUMERIC_BID',999) result", [
            a.id,
            tenant,
            late.id,
          ])
        ).result
        assert.equal(ignored.reason, 'AUCTION_DEADLINE_PASSED')
        assert.equal(
          Number(
            (await one('select current_price from auctions where id=$1', [a.id])).current_price,
          ),
          500,
        )
        assert.equal((await close(a)).status, 'awaiting_confirmation')
      },
    )

    await t.test(
      'legacy rounds only start a timer explicitly; duplicate starts cannot extend it',
      async () => {
        const a = await create()
        await db.query(
          'update auctions set ends_at=null,timer_started_at=null,duration_seconds=null where id=$1',
          [a.id],
        )
        assert.equal((await close(a)).status, 'not_due')
        await db.query('select start_legacy_auction_timer($1,$2)', [a.id, tenant])
        const before = (await one('select ends_at from auctions where id=$1', [a.id])).ends_at
        await db.query('select start_legacy_auction_timer($1,$2)', [a.id, tenant])
        assert.equal(
          Date.parse((await one('select ends_at from auctions where id=$1', [a.id])).ends_at),
          Date.parse(before),
        )
        await db.query("update auctions set status='cancelled' where id=$1", [a.id])
      },
    )

    await t.test(
      'workspace duration saves and old idempotency keys never restart/revert the deadline',
      async () => {
        const input = {
          pageId: '122099866472012045',
          livePostId: '987654321',
          itemName: 'Workspace timer',
          startPrice: 200,
          minStep: 20,
          shippingFee: 35,
          settings: automation,
          hostIds: ['999'],
          finance: { cost: 0, ads: 0, shipping: 0, fees: 0 },
          durationSeconds: 180,
        }
        const request = randomUUID()
        const save = async (data, key) =>
          (
            await one('select save_auction_workspace($1,$2,$3,$4) result', [
              tenant,
              actor,
              key,
              data,
            ])
          ).result
        const first = await save(input, request)
        const a = await one('select * from auctions where id=$1', [first.auctionId])
        assert.equal(Date.parse(a.ends_at) - Date.parse(a.timer_started_at), 180000)
        const edit = {
          ...input,
          sessionId: first.sessionId,
          roundId: first.auctionId,
          revision: first.revision,
          financialRevision: first.financialRevision,
          durationSeconds: 600,
        }
        await save(edit, randomUUID())
        const changed = (await one('select ends_at from auctions where id=$1', [a.id])).ends_at
        await save(input, request)
        assert.equal(
          Date.parse((await one('select ends_at from auctions where id=$1', [a.id])).ends_at),
          Date.parse(changed),
        )
      },
    )

    await t.test(
      'authenticated inbox reads remain tenant scoped even with no customer_management entitlement',
      async () => {
        await db.query("insert into tenant_members(tenant_id,user_id,role) values($1,$2,'owner')", [
          tenant,
          actor,
        ])
        await db.query('select set_config($1,$2,false)', ['test.user', actor])
        const other = (
          await one("insert into tenants(name,page_id) values('Other','200') returning id")
        ).id
        const foreign = (
          await one(
            "insert into customers(platform,platform_user_id,tenant_id) values('facebook','888',$1) returning id",
            [other],
          )
        ).id
        await db.query(
          "insert into messages(customer_id,external_id,sender,body) values($1,'foreign-event','customer','Secret')",
          [foreign],
        )
        // Explicitly deny the package in the DB to reproduce the former restrictive policy.
        await db.exec(
          'create or replace function public.has_tenant_feature(p_tenant uuid,p_feature text) returns boolean language sql stable as $$select false$$;',
        )
        await db.exec('set role authenticated')
        assert.equal((await one('select count(*)::int n from orders where id=$1', [orderId])).n, 0)
        const rows = (await db.query('select * from messages')).rows
        assert.ok(rows.some((r) => r.external_id === 'auction-event:' + winningAuction.id))
        assert.equal(
          rows.some((r) => r.customer_id === foreign),
          false,
        )
        await assert.rejects(db.query('select expire_live_auctions()'), /permission denied/)
        await db.exec('reset role')
        const published = (
          await db.query(
            "select tablename from pg_publication_tables where pubname='supabase_realtime'",
          )
        ).rows.map((r) => r.tablename)
        assert.ok(published.includes('messages') && published.includes('customers'))
      },
    )
  } finally {
    await db.close()
  }
})
