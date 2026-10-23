// Entirely local PostgreSQL/WASM. No environment files or provider/database connections.
const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs')
const { PGlite } = require('@electric-sql/pglite')
test('additive broadcast migration enforces leases, evidence, isolation, credits and irreversible receipt states', async () => {
  const db = new PGlite()
  const shop = '11111111-1111-4111-8111-111111111111',
    owner = '22222222-2222-4222-8222-222222222222',
    customer = '33333333-3333-4333-8333-333333333333',
    campaign = '44444444-4444-4444-8444-444444444444',
    second = '55555555-5555-4555-8555-555555555555'
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create table tenants(id uuid primary key,page_id text,is_active boolean default true,broadcast_credits integer default 10,broadcast_topup_credits integer default 0,broadcast_allowance integer default 10);
      create table tenant_members(tenant_id uuid,user_id uuid,role text);create table platform_admins(user_id uuid);
      create table customers(id uuid primary key,tenant_id uuid,agent_opted_out boolean default false,bot_enabled boolean default true,conversation_status text default 'open',tags text[] default '{}');
      create table orders(id uuid primary key,tenant_id uuid,customer_id uuid,status text);
      create table messages(id uuid primary key default gen_random_uuid(),external_id text);
      create table broadcasts(id uuid primary key,tenant_id uuid,name text,message text,audience_segment text default 'all',audience_tags text[] default '{}',audience_window text default 'within_24h',message_tag text,status text default 'draft',started_at timestamptz,last_error text);
      create function refresh_broadcast_credits(uuid) returns void language plpgsql as $$begin return;end$$;`)
    const billing = fs.readFileSync('supabase/billing.sql', 'utf8')
    await db.exec(
      billing.slice(
        billing.indexOf('create or replace function reserve_broadcast_credits'),
        billing.indexOf('-- only the service role'),
      ),
    )
    const migration = fs.readFileSync('supabase/broadcast-policy.sql', 'utf8')
    await db.exec(migration)
    await db.exec(migration)
    const fix = fs.readFileSync('supabase/broadcast-recipient-eligibility.sql', 'utf8')
    await db.exec(fix)
    await db.exec(fix)
    await db.query('insert into tenants(id,page_id) values($1,$2)', [shop, 'page'])
    await db.query("insert into tenant_members values($1,$2,'owner')", [shop, owner])
    await db.query('insert into customers(id,tenant_id) values($1,$3),($2,$3)', [
      customer,
      second,
      shop,
    ])
    await db.query(
      "insert into broadcasts(id,tenant_id,name,message) values($1,$2,'News','Hello')",
      [campaign, shop],
    )
    await db.exec('set role authenticated')
    await assert.rejects(db.query('select * from broadcast_messaging_events'))
    await assert.rejects(db.query('select claim_broadcast_run($1,$2)', [campaign, owner]))
    await db.exec('reset role')
    await assert.rejects(db.query('select claim_broadcast_run($1,$2)', [campaign, customer]))
    const lease = (await db.query('select claim_broadcast_run($1,$2) lease', [campaign, owner]))
      .rows[0].lease
    assert.ok(lease)
    assert.equal(
      (await db.query('select claim_broadcast_run($1,$2) lease', [campaign, owner])).rows[0].lease,
      null,
    )
    await assert.rejects(
      db.query("update broadcasts set message='Changed' where id=$1", [campaign]),
    )
    assert.equal(
      (await db.query('select broadcast_recipient_reason($1,$2) reason', [campaign, customer]))
        .rows[0].reason,
      'missing_interaction',
    )
    await db.query(
      "insert into broadcast_messaging_events(tenant_id,customer_id,event_id,page_id,kind,interacted_at) values($1,$2,'mid-one','page','inbound_message',clock_timestamp()-interval '24 hours')",
      [shop, customer],
    )
    assert.equal(
      (await db.query('select broadcast_recipient_reason($1,$2) reason', [campaign, customer]))
        .rows[0].reason,
      'outside_window',
    )
    await db.query(
      "update broadcast_messaging_events set interacted_at=clock_timestamp()-interval '1 minute' where customer_id=$1",
      [customer],
    )
    await db.query('update customers set agent_opted_out=true where id=$1', [customer])
    assert.equal(
      (await db.query('select broadcast_recipient_reason($1,$2) reason', [campaign, customer]))
        .rows[0].reason,
      'opted_out',
    )
    await db.query('update customers set agent_opted_out=false where id=$1', [customer])
    await db.query(
      "update customers set bot_enabled=false,conversation_status='closed' where id=$1",
      [customer],
    )
    assert.equal(
      (await db.query('select broadcast_recipient_reason($1,$2) reason', [campaign, customer]))
        .rows[0].reason,
      'eligible',
    )
    const claim = () =>
      db.query('select claim_broadcast_recipient($1,$2,$3) result', [campaign, customer, lease])
    assert.equal((await claim()).rows[0].result, 'claimed')
    assert.equal((await claim()).rows[0].result, 'duplicate')
    assert.equal(
      (await db.query('select broadcast_credits from tenants')).rows[0].broadcast_credits,
      9,
    )
    assert.equal(
      (
        await db.query('select begin_broadcast_transport($1,$2,$3) started', [
          campaign,
          customer,
          lease,
        ])
      ).rows[0].started,
      true,
    )
    assert.equal(
      (
        await db.query('select begin_broadcast_transport($1,$2,$3) started', [
          campaign,
          customer,
          lease,
        ])
      ).rows[0].started,
      false,
    )
    await db.query("select settle_broadcast_recipient($1,$2,$3,'accepted',null,'provider-mid')", [
      campaign,
      customer,
      lease,
    ])
    await db.query("select settle_broadcast_recipient($1,$2,$3,'failed','late error')", [
      campaign,
      customer,
      lease,
    ])
    assert.equal(
      (await db.query('select status from broadcast_deliveries where customer_id=$1', [customer]))
        .rows[0].status,
      'accepted',
    )
    assert.equal(
      (await db.query('select broadcast_credits from tenants')).rows[0].broadcast_credits,
      9,
    )
    await db.query(
      "insert into broadcast_messaging_events(tenant_id,customer_id,event_id,page_id,kind,interacted_at) values($1,$2,'mid-two','page','inbound_message',clock_timestamp()-interval '1 minute')",
      [shop, second],
    )
    await db.query('select claim_broadcast_recipient($1,$2,$3)', [campaign, second, lease])
    await db.query('update customers set agent_opted_out=true where id=$1', [second])
    assert.equal(
      (
        await db.query('select begin_broadcast_transport($1,$2,$3) started', [
          campaign,
          second,
          lease,
        ])
      ).rows[0].started,
      false,
    )
    assert.equal(
      (await db.query('select status from broadcast_deliveries where customer_id=$1', [second]))
        .rows[0].status,
      'skipped',
    )
    await db.query("select settle_broadcast_recipient($1,$2,$3,'skipped','opted_out')", [
      campaign,
      second,
      lease,
    ])
    assert.equal(
      (await db.query('select broadcast_credits from tenants')).rows[0].broadcast_credits,
      9,
    )
    await db.query("update broadcast_runs set locked_until=clock_timestamp()-interval '1 second'")
    const nextLease = (await db.query('select claim_broadcast_run($1,$2) lease', [campaign, owner]))
      .rows[0].lease
    assert.notEqual(nextLease, lease)
    assert.equal(
      (
        await db.query('select claim_broadcast_recipient($1,$2,$3) result', [
          campaign,
          customer,
          nextLease,
        ])
      ).rows[0].result,
      'duplicate',
    )
    await db.query('update customers set tenant_id=$1 where id=$2', [owner, second])
    assert.equal(
      (await db.query('select broadcast_recipient_reason($1,$2) reason', [campaign, second]))
        .rows[0].reason,
      'scope_unavailable',
    )
  } finally {
    await db.close()
  }
})
