const assert = require('node:assert/strict'),
  fs = require('node:fs')
const { PGlite } = require(process.argv[2] || '@electric-sql/pglite')
const sql = (name) => fs.readFileSync('supabase/' + name, 'utf8')
;(async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);
 create table tenants(id uuid primary key default gen_random_uuid(),is_active boolean default true,slip_quota int default 0,slip_used int default 0,slip_quota_credits int default 0);
 create table slips(id uuid primary key default gen_random_uuid(),trans_ref text,status text);
 create table bot_settings(tenant_id uuid primary key references tenants(id),reply_mode text,followup_enabled boolean default false);
 create table follow_up_jobs(tenant_id uuid references tenants(id));
 alter table follow_up_jobs enable row level security;create policy member_read on follow_up_jobs for all to authenticated using(true) with check(true);
 create table platform_admins(user_id uuid);create table platform_tenant_audit(tenant_id uuid,admin_id uuid,before_state jsonb,after_state jsonb);
 grant usage on schema public to authenticated,service_role;grant all on tenants,slips,bot_settings,follow_up_jobs to service_role;grant select on follow_up_jobs to authenticated;
 create table plan_features(plan text,feature text,enabled boolean,primary key(plan,feature));`)
    await db.exec(sql('billing.sql').replace(/^do \$\$ begin alter publication.*$/gm, ''))
    await db.exec(sql('payments.sql'))
    await db.exec(sql('package-access.sql'))
    const feat = sql('feature-access.sql')
    const start = feat.indexOf('create or replace function public.has_tenant_feature')
    const body = feat.indexOf('$$', start),
      end = feat.indexOf('$$;', body + 2) + 3
    await db.exec(feat.slice(start, end))
    const legacy = (
      await db.query(
        'insert into tenants(broadcast_allowance,broadcast_credits,broadcast_topup_credits) values(200,50,80) returning id',
      )
    ).rows[0].id
    await db.exec(sql('free-message-quota.sql'))
    await db.exec(sql('free-message-quota.sql'))
    assert.deepEqual(
      (
        await db.query(
          'select broadcast_allowance,broadcast_credits,broadcast_topup_credits from tenants where id=$1',
          [legacy],
        )
      ).rows[0],
      { broadcast_allowance: 100, broadcast_credits: 0, broadcast_topup_credits: 80 },
    )
    const shop = (await db.query('insert into tenants default values returning id')).rows[0].id
    const reserve = async (id, n = 1) =>
      (await db.query('select * from reserve_broadcast_credits($1,$2)', [id, n])).rows[0]
    const results = await Promise.all(Array.from({ length: 101 }, () => reserve(shop)))
    assert.equal(
      results.reduce((sum, r) => sum + r.monthly + r.topup, 0),
      100,
    )
    assert.deepEqual(await reserve(shop), { monthly: 0, topup: 0 })
    const buy = async (item, credits) => {
      const id = (
        await db.query(
          'insert into billing_requests(tenant_id,item,price_baht,credits) values($1,$2,100,$3) returning id',
          [shop, item, credits],
        )
      ).rows[0].id
      await db.query('select approve_billing_request($1,null)', [id])
      await db.query('select approve_billing_request($1,null)', [id])
    }
    await buy('topup_s', 400)
    await buy('topup_m', 1500)
    await buy('topup_l', 3000)
    await buy('slip_topup_s', 500)
    await buy('slip_topup_m', 2000)
    await buy('slip_topup_l', 5000)
    assert.deepEqual(
      (
        await db.query(
          'select broadcast_topup_credits,slip_quota_credits from tenants where id=$1',
          [shop],
        )
      ).rows[0],
      { broadcast_topup_credits: 4900, slip_quota_credits: 7500 },
    )
    assert.deepEqual(await reserve(shop), { monthly: 0, topup: 1 })
    await db.query('select refund_broadcast_credits($1,0,1)', [shop])
    await db.query("update tenants set broadcast_period='2000-01' where id=$1", [shop])
    assert.deepEqual(await reserve(shop), { monthly: 1, topup: 0 })
    assert.deepEqual(
      (
        await db.query(
          'select broadcast_credits,broadcast_topup_credits from tenants where id=$1',
          [shop],
        )
      ).rows[0],
      { broadcast_credits: 99, broadcast_topup_credits: 4900 },
    )
    await db.query('select refund_broadcast_credits($1,1,0)', [shop])
    assert.deepEqual(await reserve(shop, 101), { monthly: 100, topup: 1 })
    await assert.rejects(
      db.query('insert into bot_settings(tenant_id,followup_enabled) values($1,true)', [shop]),
      /FEATURE_LOCKED/,
    )
    await db.query(
      "update tenants set plan='starter',plan_expires_at=now()+interval '1 day' where id=$1",
      [shop],
    )
    await db.query('insert into bot_settings(tenant_id,followup_enabled) values($1,true)', [shop])
    await db.query("update tenants set plan_expires_at=now()-interval '1 day' where id=$1", [shop])
    assert.equal(
      (await db.query("select has_tenant_feature($1,'customer_follow_up') ok", [shop])).rows[0].ok,
      false,
    )
    await db.query('update tenants set is_active=false where id=$1', [legacy])
    assert.deepEqual(await reserve(legacy), { monthly: 0, topup: 0 })
    console.log(
      'PASS: 100 atomic shared message reservations, message 101 blocked, used-quota migration, monthly reset, refunds, all S/M/L cumulative/idempotent purchases, expiry and Follow-up locks',
    )
  } finally {
    await db.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
