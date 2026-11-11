const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { PGlite } = require('@electric-sql/pglite')

test('tenant AI override is scoped to one active tenant and preserves plan entitlements', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon;create role authenticated;create role service_role;
      create table tenants(id uuid primary key,is_active boolean not null,plan text not null,plan_expires_at timestamptz);
      create table plan_features(plan text not null,feature text not null,enabled boolean not null,primary key(plan,feature));
      insert into plan_features values('starter','ai_agent',false),('pro','ai_agent',true);
      insert into tenants values
        ('11111111-1111-4111-8111-111111111111',true,'starter',now()+interval '1 month'),
        ('22222222-2222-4222-8222-222222222222',true,'pro',now()+interval '1 month'),
        ('33333333-3333-4333-8333-333333333333',false,'pro',now()+interval '1 month');
    `)
    await db.exec(fs.readFileSync('supabase/tenant-feature-overrides.sql', 'utf8'))
    const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
    assert.equal(
      (await one("select has_tenant_feature($1,'ai_agent') ok", ['11111111-1111-4111-8111-111111111111'])).ok,
      false,
    )
    assert.equal(
      (await one("select has_tenant_feature($1,'ai_agent') ok", ['22222222-2222-4222-8222-222222222222'])).ok,
      true,
    )
    await db.query(
      `insert into tenant_feature_overrides(tenant_id,feature,enabled,reason)
       values($1,'ai_agent',true,'test grant')`,
      ['11111111-1111-4111-8111-111111111111'],
    )
    assert.equal(
      (await one("select has_tenant_feature($1,'ai_agent') ok", ['11111111-1111-4111-8111-111111111111'])).ok,
      true,
    )
    await db.query(
      `insert into tenant_feature_overrides(tenant_id,feature,enabled,reason)
       values($1,'ai_agent',false,'test deny')`,
      ['22222222-2222-4222-8222-222222222222'],
    )
    assert.equal(
      (await one("select has_tenant_feature($1,'ai_agent') ok", ['22222222-2222-4222-8222-222222222222'])).ok,
      false,
    )
    assert.equal(
      (await one("select has_tenant_feature($1,'ai_agent') ok", ['33333333-3333-4333-8333-333333333333'])).ok,
      false,
    )
    assert.equal(
      (await one("select has_table_privilege('authenticated','tenant_feature_overrides','select') ok")).ok,
      false,
    )
  } finally {
    await db.close()
  }
})
