const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { PGlite } = require('@electric-sql/pglite')
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto')
const { splitSql } = require('./lib/safe-db-migration.cjs')
const { build, manifest } = require('./build-full-database-setup.cjs')
const root = path.resolve(__dirname, '..')

// Supabase owns these schemas/roles. This fixture emulates only that platform
// surface; every application table/function/policy must come from the bundle.
async function platformFixture() {
  const db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage; create schema extensions;
    create table auth.users(id uuid primary key default gen_random_uuid(),email text);
    create function auth.uid() returns uuid language sql as $$
      select nullif(current_setting('test.user',true),'')::uuid
    $$;
    create table storage.buckets(id text primary key,name text,public boolean,
      file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create publication supabase_realtime;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
  `)
  return db
}

test('fresh-install bundle executes every source in dependency order and keeps tenant/security boundaries', async () => {
  const result = build(root)
  assert.equal(
    fs.readFileSync(path.join(root, 'supabase/full_database_setup.sql'), 'utf8'),
    result.sql,
  )
  assert.equal(
    fs.readFileSync(path.join(root, 'supabase/full_database_setup-manifest.md'), 'utf8'),
    manifest(result),
  )
  const db = await platformFixture()
  try {
    let section = 'preflight'
    const statements = splitSql(result.sql)
    let index = 0
    for (const sql of statements) {
      if (/^set local search_path/.test(sql)) section = result.sources[index++]
      try {
        await db.exec(sql + ';')
      } catch (error) {
        throw new Error(`${section}: ${sql.slice(0, 180)}\n${error.message}`, { cause: error })
      }
    }
    const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
    const tables = (
      await db.query(
        "select relname,relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r'",
      )
    ).rows
    assert.ok(tables.length > 70)
    assert.deepEqual(
      tables.filter((t) => !t.relrowsecurity),
      [],
      'every application table has RLS',
    )
    assert.equal((await one('select count(*)::integer n from tenants')).n, 0)
    assert.equal((await one('select count(*)::integer n from customers')).n, 0)
    assert.equal((await one('select count(*)::integer n from payment_transfer_ledger')).n, 0)
    assert.equal(
      (await one("select enabled from plan_features where plan='starter' and feature='ai_agent'"))
        .enabled,
      true,
    )
    assert.equal(
      (await one("select to_regclass('public.full_access_function_backup') is null absent")).absent,
      true,
    )
    assert.equal(
      (
        await one(
          "select has_function_privilege('authenticated','public.manage_inbox_conversation(uuid,uuid,text,integer,uuid)','execute') allowed",
        )
      ).allowed,
      false,
    )
    assert.equal(
      (
        await one(
          "select has_column_privilege('authenticated','public.tenants','page_access_token','select') allowed",
        )
      ).allowed,
      false,
    )
    assert.equal(
      (
        await one(
          "select has_column_privilege('authenticated','public.facebook_pages','access_token','select') allowed",
        )
      ).allowed,
      false,
    )

    const owner = (await one('insert into auth.users default values returning id')).id
    const stranger = (await one('insert into auth.users default values returning id')).id
    const tenant = (await one("insert into tenants(name) values('Fresh Shop') returning id")).id
    await db.query("insert into tenant_members(tenant_id,user_id,role) values($1,$2,'owner')", [
      tenant,
      owner,
    ])
    assert.equal(
      (await one("select public.has_tenant_feature($1,'ai_agent') allowed", [tenant])).allowed,
      false,
    )
    await db.query("select set_config('test.user',$1,false)", [owner])
    assert.equal((await one('select public.can_access_tenant($1) allowed', [tenant])).allowed, true)
    await db.query("select set_config('test.user',$1,false)", [stranger])
    assert.equal(
      (await one('select public.can_access_tenant($1) allowed', [tenant])).allowed,
      false,
    )

    // Enable a real plan in the test database only to exercise the actual read models.
    await db.query(
      "update tenants set plan='pro',plan_expires_at=now()+interval '1 day' where id=$1",
      [tenant],
    )
    const customer = (
      await one(
        "insert into customers(tenant_id,platform_user_id,display_name,last_message_at) values($1,'psid-test','Sample',now()) returning id",
        [tenant],
      )
    ).id
    await db.query("select set_config('test.user',$1,false)", [owner])
    await db.exec('set role authenticated')
    assert.equal((await one('select count(*)::integer n from customers')).n, 1)
    await assert.rejects(db.query('select customer_directory($1)', [tenant]), /permission denied/)
    await db.exec('reset role')
    await db.query("select set_config('test.user',$1,false)", [stranger])
    await db.exec('set role authenticated')
    assert.equal((await one('select count(*)::integer n from customers')).n, 0)
    await db.exec('reset role')
    await db.exec('set role service_role')
    const directory = (await one('select customer_directory($1) data', [tenant])).data
    assert.equal(directory.total, 1)
    assert.equal(directory.rows[0].id, customer)
    const basic = (await one('select basic_overview_stats($1,now()) data', [tenant])).data
    assert.equal(basic.totalSlips, 0)
    assert.equal(basic.points.length, 14)
    const agent = (await one('select agent_overview_stats($1,30,now()) data', [tenant])).data
    assert.equal(agent.repliesToday, 0)
    assert.equal(agent.points.length, 30)
    const premium = (
      await one("select premium_overview_summary($1,now()-interval '30 days',now()) data", [tenant])
    ).data
    assert.equal(
      premium.chats[0].unread_count,
      0,
      'current schema has no stored unread_count column',
    )
    const claimed = (
      await one("select manage_inbox_conversation($1,$2,'claim',0) data", [customer, owner])
    ).data
    assert.ok(claimed)
    assert.equal(
      (await one('select assigned_user_id from customers where id=$1', [customer]))
        .assigned_user_id,
      owner,
    )
    await db.exec('reset role')
    const sku = (
      await one(
        "select indexdef from pg_indexes where schemaname='public' and indexname='products_tenant_code'",
      )
    ).indexdef
    assert.match(sku, /WHERE \(NOT commerce_archived\)/)
    assert.equal(
      (
        await one(
          "select count(*)::integer n from pg_publication_tables where pubname='supabase_realtime' and tablename in ('customers','messages','comments','slips')",
        )
      ).n,
      4,
    )

    // The first statement must refuse reuse before modifying an existing database.
    await assert.rejects(db.exec(statements[0]), /Fresh database only/)
    assert.equal((await one('select count(*)::integer n from tenants')).n, 1)
  } finally {
    await db.close()
  }
})

test('the complete SQL file runs as one SQL Editor request and refuses reuse before DDL', async () => {
  const db = await platformFixture()
  try {
    const { sql } = build(root)
    await db.exec(sql)
    assert.equal((await db.query('select count(*)::integer n from tenants')).rows[0].n, 0)
    await assert.rejects(db.exec(sql), /Fresh database only/)
    // A failed implicit request requires rollback on some PostgreSQL clients.
    await db.exec('rollback')
    assert.equal((await db.query('select count(*)::integer n from tenants')).rows[0].n, 0)
  } finally {
    await db.close()
  }
})

test('setup only keeps reviewed config seeds and excludes historical locks/backfills and operational scripts', () => {
  const result = build(root)
  const retained = result.sections.flatMap((s) => s.statements.filter((q) => !q.omitted))
  assert.ok(!retained.some((s) => /^(lock table|update public\.|delete\b|with\b)/i.test(s.sql)))
  assert.ok(!retained.some((s) => /^do\b/i.test(s.sql) && /disable trigger/i.test(s.sql)))
  for (const q of retained.filter((s) => /^insert\b/i.test(s.sql))) {
    assert.match(
      q.sql,
      /^insert into (storage\.buckets|(?:public\.)?(plan_features|vision_plan_limits|commerce_limits))\b/i,
    )
  }
  for (const name of [
    'backfill_patch.sql',
    'reset-facebook-tenants.sql',
    'test-grant-ai-pro-diw.sql',
    'full-access.sql',
  ]) {
    assert.ok(!result.sources.includes(name))
  }
  assert.equal(new Set(result.files).size, result.files.length)
  assert.equal(result.files.length, result.sources.length + 17)
})
