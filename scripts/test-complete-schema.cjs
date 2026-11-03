const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { PGlite } = require('@electric-sql/pglite')
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto')
const { build, validateOrder } = require('./build-full-database-setup.cjs')
const { completeSchema, functionIdentity } = require('./lib/complete-schema.cjs')

async function database() {
  const db = new PGlite({ extensions: { pgcrypto } })
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
  return db
}
const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0]
async function seed(db) {
  const tenant = (await one(db, "insert into tenants(name) values('Preserved shop') returning id"))
    .id
  await db.query(
    'update tenants set broadcast_topup_credits=137,ai_quota_limit=777,ai_quota_used=12,auto_reply_enabled=false where id=$1',
    [tenant],
  )
  const customer = (
    await one(
      db,
      "insert into customers(tenant_id,platform_user_id,display_name) values($1,'test-user','Preserved name') returning id",
      [tenant],
    )
  ).id
  await db.query(
    "insert into slips(tenant_id,customer_id,trans_ref,amount,status) values($1,$2,'sale-existing',159,'valid')",
    [tenant, customer],
  )
  await db.query(
    "insert into standalone_slips(tenant_id,trans_ref,amount,trans_timestamp) values($1,'standalone-existing',159,now())",
    [tenant],
  )
  return tenant
}

test('complete schema runs in one SQL Editor request and re-runs without altering application data', async () => {
  const result = build()
  assert.equal(fs.readFileSync('supabase/complete_schema.sql', 'utf8'), result.completeSql)
  const db = await database()
  try {
    await db.exec(result.completeSql)
    assert.equal(
      (await one(db, 'select count(*)::int n from snapbot_schema_migrations')).n,
      result.sources.length,
    )
    const tenant = await seed(db)
    // Exercise the FINAL definitions, not only successful DDL parsing.
    await db.query(
      "update tenants set page_id='100',plan='pro',plan_expires_at=now()+interval '1 day' where id=$1",
      [tenant],
    )
    const customer = (await one(db, 'select id from customers where tenant_id=$1', [tenant])).id
    const product = (
      await one(
        db,
        "insert into products(tenant_id,code,name,price,stock) values($1,'SKU159','Live product',159,2) returning id",
        [tenant],
      )
    ).id
    await db.query(
      "insert into commerce_stores(tenant_id,slug,name,is_open) values($1,'test-store','Test store',true)",
      [tenant],
    )
    const rule = (
      await one(
        db,
        "insert into comment_rules(tenant_id,name,page_ids,keywords,mode,live_product_id) values($1,'Live',array['100'],array['159'],'live_cf',$2) returning id",
        [tenant, product],
      )
    ).id
    const orderArgs = [tenant, customer, rule, '159', 'comment-one', null, '100']
    const ordered = await one(db, 'select * from place_cf_order($1,$2,$3,$4,$5,$6,$7)', orderArgs)
    assert.equal(ordered.r_status, 'created')
    assert.equal(
      (await one(db, 'select * from place_cf_order($1,$2,$3,$4,$5,$6,$7)', orderArgs)).r_order_id,
      ordered.r_order_id,
    )
    assert.equal((await one(db, 'select stock from products where id=$1', [product])).stock, 1)
    assert.equal(
      (await one(db, "select * from messenger_product_lookup($1,'SKU159')", [tenant])).id,
      product,
    )
    const before = await one(
      db,
      'select name,broadcast_topup_credits,ai_quota_limit,ai_quota_used,auto_reply_enabled from tenants where id=$1',
      [tenant],
    )
    await db.exec(result.completeSql)
    assert.deepEqual(
      await one(
        db,
        'select name,broadcast_topup_credits,ai_quota_limit,ai_quota_used,auto_reply_enabled from tenants where id=$1',
        [tenant],
      ),
      before,
    )
    assert.equal((await one(db, 'select count(*)::int n from payment_transfer_ledger')).n, 2)
    assert.equal(
      (
        await one(
          db,
          "select to_regprocedure('public.messenger_product_lookup(uuid,text)') is not null installed",
        )
      ).installed,
      true,
    )
    assert.equal(
      (
        await one(
          db,
          "select to_regprocedure('public.place_cf_order(uuid,uuid,uuid,text,text,text,text)') is not null installed",
        )
      ).installed,
      true,
    )
    assert.equal(
      (
        await one(
          db,
          "select count(*)::int n from pg_class where relnamespace='public'::regnamespace and relkind='r' and not relrowsecurity",
        )
      ).n,
      0,
    )
    assert.equal(
      (
        await one(
          db,
          "select has_table_privilege('authenticated','snapbot_schema_migrations','insert') allowed",
        )
      ).allowed,
      false,
    )
  } finally {
    await db.close()
  }
})

test('complete schema adopts the installed latest schema without a registry and preserves transfers and quotas', async () => {
  const result = build()
  const db = await database()
  try {
    await db.exec(result.sql)
    const tenant = await seed(db)
    await db.exec(result.completeSql)
    assert.equal(
      (await one(db, 'select count(*)::int n from snapbot_schema_migrations')).n,
      result.sources.length,
    )
    assert.equal(
      (await one(db, 'select broadcast_topup_credits from tenants where id=$1', [tenant]))
        .broadcast_topup_credits,
      137,
    )
    assert.equal(
      (await one(db, 'select ai_quota_used from tenants where id=$1', [tenant])).ai_quota_used,
      12,
    )
    assert.equal((await one(db, 'select count(*)::int n from payment_transfer_ledger')).n, 2)
    await db.exec(result.completeSql)
  } finally {
    await db.close()
  }
})

test('appending a new replacement migration does not change installed source checksums', async () => {
  const result = build()
  const db = await database()
  try {
    await db.exec(result.completeSql)
    const sql =
      'create or replace function public.messenger_product_lookup(p_tenant uuid,p_code text) returns table(id uuid,name text,price numeric,description text,images jsonb,store_slug text,sales_page_url text,variant_id uuid,variant_label text) language sql as $$select null::uuid,null::text,null::numeric,null::text,null::jsonb,null::text,null::text,null::uuid,null::text where false$$'
    const section = {
      file: 'future-messenger-patch.sql',
      sha256: crypto.createHash('sha256').update(sql).digest('hex'),
      statements: [{ number: 1, sql, omitted: null }],
    }
    await db.exec(completeSchema({ ...result, sections: [...result.sections, section] }))
    assert.equal(
      (await one(db, 'select count(*)::int n from snapbot_schema_migrations')).n,
      result.sources.length + 1,
    )
  } finally {
    await db.close()
  }
})

test('function identity handles overloaded arguments, defaults containing commas and input parameter renames', () => {
  assert.equal(
    functionIdentity(
      'create or replace function public.f(p_id uuid,p_value numeric(12,2) default 1,p_json jsonb default \'{"x":[1,2]}\') returns void language sql as $$$$',
    ),
    'f(uuid,numeric,jsonb)',
  )
  assert.equal(
    functionIdentity(
      'create or replace function f(other uuid,another numeric(10,2),payload jsonb) returns void language sql as $$$$',
    ),
    'f(uuid,numeric,jsonb)',
  )
})

test('dependency registry rejects security, Messenger or standalone migrations placed before their prerequisites', () => {
  const result = build()
  for (const file of ['security.sql', 'messenger-product-lookup.sql', 'standalone-slips.sql']) {
    const reordered = result.sources.filter((source) => source !== file)
    reordered.unshift(file)
    assert.throws(() => validateOrder(reordered), /must precede/)
  }
})

test('complete schema upgrades the older schema lacking newer Live CF, Messenger and banking migrations', async () => {
  const result = build()
  const newer = new Set([
    'bank-account-combined-save.sql',
    'bank-qr-per-account.sql',
    'bank-qr-upload.sql',
    'facebook-inbox-recovery.sql',
    'follow-up-24h-window.sql',
    'follow-up-approval-mode.sql',
    'follow-up-manual-dispatch-fix.sql',
    'live-cf-mode.sql',
    'live-order-types.sql',
    'live-auction-dashboard.sql',
    'live-auction-instant-winners.sql',
    'live-auction-customer-workspace.sql',
    'live-auction-thai-workflow.sql',
    'live-auction-customer-columns.sql',
    'live-auction-close-presets.sql',
    'live-auction-unlimited-keywords.sql',
    'live-auction-empty-keyword-defaults.sql',
    'live-cf-setup.sql',
    'live-cf-customer-variants.sql',
    'live-cf-variants.sql',
    'messenger-product-lookup.sql',
    'slip-confirmation-template.sql',
    'tenant-ai-quota.sql',
    'vision-master-switch.sql',
    'standalone-slips.sql',
  ])
  const db = await database()
  try {
    const older = result.sections
      .filter((s) => !newer.has(s.file))
      .flatMap((s) => s.statements.filter((q) => !q.omitted).map((q) => q.sql + ';'))
      .join('\n')
    await db.exec(older)
    const tenant = (await one(db, "insert into tenants(name) values('Legacy shop') returning id"))
      .id
    await db.query('update tenants set broadcast_topup_credits=321 where id=$1', [tenant])
    await db.query(
      "insert into slips(tenant_id,amount,status,trans_ref) values($1,159,'valid','legacy-transfer')",
      [tenant],
    )
    await db.exec(result.completeSql)
    assert.equal(
      (await one(db, 'select broadcast_topup_credits from tenants where id=$1', [tenant]))
        .broadcast_topup_credits,
      321,
    )
    assert.equal(
      (
        await one(
          db,
          "select source from payment_transfer_ledger where trans_ref='legacy-transfer'",
        )
      ).source,
      'sale',
    )
    assert.equal(
      (await one(db, "select to_regclass('public.standalone_slips') is not null installed"))
        .installed,
      true,
    )
    assert.equal(
      (
        await one(
          db,
          "select to_regprocedure('public.messenger_product_lookup(uuid,text)') is not null installed",
        )
      ).installed,
      true,
    )
    await db.exec(result.completeSql)
  } finally {
    await db.close()
  }
})

test('changed migration history and failing appended DDL roll back without marking migrations applied', async () => {
  const result = build()
  const db = await database()
  try {
    await db.exec(result.completeSql)
    const { checksum } = await one(
      db,
      "select checksum from snapbot_schema_migrations where name='schema.sql'",
    )
    await assert.rejects(
      db.exec(result.completeSql.replaceAll(checksum, 'f'.repeat(64))),
      /Applied migration changed/,
    )
    await db.exec('rollback')
    const sql = 'create table public.must_rollback(id uuid)'
    const failure = {
      file: 'future-invalid.sql',
      sha256: crypto.createHash('sha256').update(sql).digest('hex'),
      statements: [
        { number: 1, sql, omitted: null },
        { number: 2, sql: 'select missing_column from public.tenants', omitted: null },
      ],
    }
    await assert.rejects(
      db.exec(completeSchema({ ...result, sections: [...result.sections, failure] })),
      /missing_column/,
    )
    await db.exec('rollback')
    assert.equal(
      (await one(db, "select to_regclass('public.must_rollback') is null rolled_back")).rolled_back,
      true,
    )
    assert.equal(
      (await one(db, 'select count(*)::int n from snapbot_schema_migrations')).n,
      result.sources.length,
    )
  } finally {
    await db.close()
  }
})

test('complete schema fills a partial base installation and backfills pre-ledger accepted slips', async () => {
  const result = build()
  const db = await database()
  try {
    const base = result.sections.slice(0, result.sources.indexOf('security.sql') + 1)
    await db.exec(
      base
        .flatMap((s) => s.statements.filter((q) => !q.omitted).map((q) => q.sql + ';'))
        .join('\n'),
    )
    const tenant = (
      await one(
        db,
        "insert into tenants(name,bank_code,account_number) values('Partial shop','KBANK','1234567890') returning id",
      )
    ).id
    await db.query(
      "insert into slips(tenant_id,trans_ref,amount,status) values($1,'pre-ledger-transfer',159,'valid')",
      [tenant],
    )
    await db.exec(result.completeSql)
    assert.equal(
      (
        await one(
          db,
          "select source from payment_transfer_ledger where trans_ref='pre-ledger-transfer'",
        )
      ).source,
      'sale',
    )
    assert.equal(
      (await one(db, 'select account_number from tenants where id=$1', [tenant])).account_number,
      '1234567890',
    )
    assert.equal(
      (await one(db, 'select count(*)::int n from snapbot_schema_migrations')).n,
      result.sources.length,
    )
  } finally {
    await db.close()
  }
})
