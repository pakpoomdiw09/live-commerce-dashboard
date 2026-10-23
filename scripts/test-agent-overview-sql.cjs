const { PGlite } = require('@electric-sql/pglite'),
  assert = require('node:assert/strict'),
  fs = require('node:fs')
;(async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;
 create table tenants(id uuid primary key,is_active boolean default true,plan_expires_at timestamptz default now()+interval '1 month',auto_reply_enabled boolean default false,auto_verify_enabled boolean default false,slip_quota int default 20,slip_quota_credits int default 0,slip_used int default 0);
 create table tenant_members(tenant_id uuid,user_id uuid,role text);create table platform_admins(user_id uuid);
 create table features(tenant_id uuid,feature text);create function has_tenant_feature(t uuid,f text) returns boolean language sql as 'select exists(select 1 from features join tenants on tenants.id=features.tenant_id where tenant_id=t and feature=f and tenants.is_active and tenants.plan_expires_at>now())';
 create table agent_control_settings(tenant_id uuid primary key,flags jsonb default '{}',ai_monthly_limit integer default 100);create table agent_ai_monthly_usage(tenant_id uuid,month date,used integer);
 create table agent_control_audit(tenant_id uuid,actor_id uuid,event text,detail text);
 create table bank_accounts(tenant_id uuid,is_active boolean default true);
 create table follow_up_policies(tenant_id uuid primary key,enabled boolean default false);
 create table follow_up_jobs(tenant_id uuid,status text,reason text,dispatch_started_at timestamptz);
 grant all on all tables in schema public to service_role;grant execute on all functions in schema public to service_role;`)
    const sql = fs.readFileSync('supabase/agent-overview.sql', 'utf8')
    await db.exec(sql)
    await db.exec(sql)
    const tenant = '11111111-1111-4111-8111-111111111111',
      owner = '22222222-2222-4222-8222-222222222222',
      staff = '33333333-3333-4333-8333-333333333333'
    await db.query('insert into tenants(id) values($1)', [tenant])
    await db.query("insert into tenant_members values($1,$2,'owner'),($1,$3,'staff')", [
      tenant,
      owner,
      staff,
    ])
    await db.query(
      "insert into features values($1,'ai_agent'),($1,'slip_auto_pilot'),($1,'customer_follow_up')",
      [tenant],
    )
    await db.query(
      `insert into agent_control_settings(tenant_id,flags) values($1,'{"agent_orchestrator_enabled":true,"untouched":true}')`,
      [tenant],
    )
    await db.query('insert into follow_up_policies values($1,true)', [tenant])
    await db.query(
      "insert into follow_up_jobs values($1,'pending',null,null),($1,'processing',null,now())",
      [tenant],
    )
    const act = (key, value, actor = owner) =>
      db.query('select set_agent_overview_capability($1,$2,$3,$4)', [tenant, actor, key, value])
    const one = async (sql) => (await db.query(sql, [tenant])).rows[0]
    await assert.rejects(act('master', true, staff), (e) => e.code === '42501')
    await assert.rejects(
      act('master', true, '99999999-9999-4999-8999-999999999999'),
      (e) => e.code === '42501',
    )
    await assert.rejects(act('invalid', true), (e) => e.code === '22023')
    assert.equal(
      (await one('select auto_reply_enabled from tenants where id=$1')).auto_reply_enabled,
      false,
    )
    await act('master', true)
    assert.equal(
      (await one('select auto_reply_enabled from tenants where id=$1')).auto_reply_enabled,
      true,
    )
    for (const key of ['answers', 'products', 'handoff', 'intent']) {
      await act(key, false)
      const s = await one('select flags from agent_control_settings where tenant_id=$1')
      assert.equal(s.flags['capability_' + key], false)
      assert.equal(s.flags.untouched, true)
    }
    await assert.rejects(act('slips', true), (e) => e.code === '22023')
    assert.equal(
      (await one('select auto_verify_enabled from tenants where id=$1')).auto_verify_enabled,
      false,
    )
    await db.query('insert into bank_accounts values($1,true)', [tenant])
    await act('slips', true)
    assert.equal(
      (await one('select auto_verify_enabled from tenants where id=$1')).auto_verify_enabled,
      true,
    )
    await act('followup', false)
    assert.equal(
      (await one('select enabled from follow_up_policies where tenant_id=$1')).enabled,
      false,
    )
    assert.equal(
      (
        await one(
          "select count(*)::int n from follow_up_jobs where tenant_id=$1 and status='cancelled'",
        )
      ).n,
      1,
    )
    assert.equal(
      (
        await one(
          "select count(*)::int n from follow_up_jobs where tenant_id=$1 and status='processing'",
        )
      ).n,
      1,
    )
    await db.query("delete from features where tenant_id=$1 and feature='slip_auto_pilot'", [
      tenant,
    ])
    await assert.rejects(act('slips', true), (e) => e.code === 'P0403')
    assert.equal(
      (await one('select count(*)::int n from agent_control_audit where tenant_id=$1')).n,
      7,
    )
    // Rejected enables cannot change settings or audit. Every capability uses current UTC quota.
    const keys = ['answers', 'products', 'slips', 'handoff', 'intent', 'followup']
    await db.query("insert into features values($1,'slip_auto_pilot')", [tenant])
    await db.query(
      "insert into agent_ai_monthly_usage values($1,date_trunc('month',timezone('UTC',now()))::date,100)",
      [tenant],
    )
    for (const key of keys) await assert.rejects(act(key, true), (e) => e.code === 'P0402')
    assert.equal(
      (await one('select count(*)::int n from agent_control_audit where tenant_id=$1')).n,
      7,
    )
    // Even an exhausted/expired shop can always turn settings off.
    await db.query("update tenants set plan_expires_at=now()-interval '1 day' where id=$1", [
      tenant,
    ])
    for (const key of keys) await assert.rejects(act(key, true), (e) => e.code === 'P0403')
    await db.query(
      'update agent_control_settings set flags=flags||\'{"agent_orchestrator_enabled":false}\'::jsonb where tenant_id=$1',
      [tenant],
    )
    for (const key of [...keys, 'master']) await act(key, false)
    await db.query(
      "update tenants set plan_expires_at=now()+interval '1 month',slip_used=20 where id=$1",
      [tenant],
    )
    await db.query('update agent_ai_monthly_usage set used=0 where tenant_id=$1', [tenant])
    await assert.rejects(act('slips', true), (e) => e.code === 'P0404')
    await db.query('update tenants set slip_used=0 where id=$1', [tenant])
    await db.query(
      'update agent_control_settings set flags=flags||\'{"agent_orchestrator_enabled":true}\'::jsonb where tenant_id=$1',
      [tenant],
    )
    for (const key of keys) await act(key, true)
    assert.equal(
      (await one('select used from agent_ai_monthly_usage where tenant_id=$1')).used,
      0,
      'switches do not consume AI quota',
    )
    await db.query('update agent_ai_monthly_usage set used=100 where tenant_id=$1', [tenant])
    await assert.rejects(
      act('products', true),
      (e) => e.code === 'P0402',
      'a stale frontend cannot bypass a newly exhausted quota',
    )
    await db.query(
      "update agent_ai_monthly_usage set month=(date_trunc('month',timezone('UTC',now()))-interval '1 month')::date where tenant_id=$1",
      [tenant],
    )
    await act('products', true) // previous month's usage cannot block the new month
    await db.exec('set role authenticated')
    await assert.rejects(act('master', false), (e) => e.code === '42501')
    await db.exec('reset role;set role service_role')
    await act('master', false)
    console.log(
      'PASS: owner authorization, tenant isolation, feature checks, all capability settings, atomic audit, follow-up cancellation, in-flight preservation, restricted RPC and safe migration reruns',
    )
  } finally {
    await db.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
