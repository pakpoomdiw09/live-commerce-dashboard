// Runs against cwd, so the identical tests can exercise an isolated HEAD worktree.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { PGlite } = require('@electric-sql/pglite')
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto')
const root = process.env.AUCTION_AUDIT_ROOT ?? process.cwd()
const { build } = require(path.join(root, 'scripts/build-full-database-setup.cjs'))
const load = require(path.join(root, 'scripts/helpers/load-typescript.cjs'))
const config = load('lib/features/commerce/comment-config.ts')
const { parseAuctionComment } = load('lib/integrations/facebook/auction-comment-parser.ts', {
  '@/lib/features/commerce/comment-config': config,
})

async function fixture() {
  const db = new PGlite({ extensions: { pgcrypto } })
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
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
  await db.exec(build(root).completeSql)
  const tenant = (
    await one("insert into tenants(name,page_id) values('Audit fixture','100') returning id")
  ).id
  const bank = (
    await one(
      "insert into bank_accounts(tenant_id,bank_code,account_name,account_number) values($1,'KBANK','Fixture','0000000000') returning id",
      [tenant],
    )
  ).id
  const payload = (
    await one(
      "insert into facebook_webhook_payloads(payload_sha256,raw_payload) values($1,'{}') returning id",
      ['c'.repeat(64)],
    )
  ).id
  const settings = {
    winnerFlow: 'highest_bid',
    keywords: ['confirm'],
    closeKeywords: ['close'],
    closeEnabled: true,
    privateReply: false,
    publicReply: false,
    bankAccountId: bank,
  }
  const open = async () =>
    await one(
      `insert into auctions(tenant_id,page_id,live_post_id,item_name,start_price,min_step,shipping_fee,
    bank_account_id,host_ids,session_automation,public_reply_enabled,private_reply_enabled)
    values($1,'100',$2,'Fixture item',100,10,20,$3,array['999'],$4,false,false) returning *`,
      [tenant, String(Math.floor(Math.random() * 1e12)), bank, settings],
    )
  const event = async (a, sender, message, sourceAt = new Date().toISOString()) =>
    one(
      `insert into facebook_webhook_events(
    payload_id,page_id,event_key,ordering_key,kind,payload,status) values($1,'100',$2,'comments:100','change',$3,'completed') returning *`,
      [
        payload,
        randomUUID(),
        {
          field: 'feed',
          value: {
            item: 'comment',
            verb: 'add',
            post_id: a.live_post_id,
            comment_id: a.live_post_id + '_' + randomUUID(),
            from: sender == null ? null : { id: sender },
            message,
            created_time: sourceAt,
          },
        },
      ],
    )
  const processEvent = async (a, e, parsed) =>
    (
      await one('select process_live_auction_comment($1,$2,$3,$4,$5,$6) result', [
        a.id,
        tenant,
        e.id,
        parsed.type,
        parsed.amount ?? null,
        parsed.type === 'HOST_CONTROL'
          ? parsed.action === 'close'
            ? 'close'
            : parsed.count
          : null,
      ])
    ).result
  const receive = async (a, sender, text, sourceAt) => {
    const e = await event(a, sender, text, sourceAt)
    return {
      event: e,
      parsed: parseAuctionComment(text, sender === '999', settings),
      result: await processEvent(a, e, parseAuctionComment(text, sender === '999', settings)),
    }
  }
  return { db, one, tenant, settings, open, event, receive, processEvent }
}

test('normal round lifecycle: real parser, two bidders, close without order, confirmed once, cancellation and stale boundaries', async () => {
  const f = await fixture()
  try {
    const a = await f.open()
    assert.equal((await f.receive(a, '900', '100')).result.status, 'accepted')
    assert.equal((await f.receive(a, '901', '200')).result.status, 'accepted')
    assert.equal((await f.receive(a, '999', 'last call')).result.status, 'count')
    const { created_at: start } = await f.one('select created_at from auctions where id=$1', [a.id])
    assert.equal(
      (await f.receive(a, '901', 'confirm', new Date(Date.parse(start) - 1).toISOString())).result
        .status,
      'stale',
    )
    assert.equal((await f.receive(a, '900', 'confirm')).result.status, 'not_winner')
    assert.equal((await f.receive(a, '999', 'close')).result.status, 'awaiting_confirmation')
    let row = await f.one('select * from auctions where id=$1', [a.id])
    assert.equal(row.status, 'closed')
    assert.ok(row.winner_locked_at)
    assert.equal(row.order_id, null)
    assert.equal((await f.one('select count(*)::int n from orders')).n, 0)
    assert.equal((await f.receive(a, '999', 'close')).result.status, 'stale')
    const confirmed = await f.receive(a, '901', 'confirm')
    assert.equal(confirmed.result.status, 'confirmed')
    assert.deepEqual(await f.processEvent(a, confirmed.event, confirmed.parsed), confirmed.result)
    row = await f.one('select * from auctions where id=$1', [a.id])
    assert.ok(row.order_id)
    assert.equal(
      (await f.one('select count(*)::int n from orders where source_id=$1', [a.id])).n,
      1,
    )
    const cancelled = await f.open()
    await f.receive(cancelled, '900', '100')
    await f.one('select finalize_live_auction($1,$2,null,true)', [cancelled.id, f.tenant])
    assert.equal((await f.receive(cancelled, '900', 'confirm')).result.status, 'closed')
    assert.equal(
      (await f.one('select order_id from auctions where id=$1', [cancelled.id])).order_id,
      null,
    )
  } finally {
    await f.db.close()
  }
})
