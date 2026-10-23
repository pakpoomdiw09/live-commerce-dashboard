// Real PostgreSQL in isolation. No .env, Supabase, AI, SlipOK or Messenger network calls.
const assert = require('node:assert/strict'),
  fs = require('node:fs')
const { PGlite } = require(process.argv[2] || '@electric-sql/pglite')
;(async () => {
  const db = new PGlite()
  let checks = 0
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key default gen_random_uuid());
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.user',true),'')::uuid$$;
 create table tenants(id uuid primary key default gen_random_uuid(),plan text default 'pro',plan_expires_at timestamptz default now()+interval '30 days',is_active boolean default true,auto_reply_enabled boolean default true,auto_verify_enabled boolean default true,slip_quota integer default 10,slip_used integer default 0,slip_quota_credits integer default 0);
 create table tenant_members(tenant_id uuid references tenants(id),user_id uuid references auth.users(id),role text);create table platform_admins(user_id uuid primary key references auth.users(id));
 create function is_platform_admin() returns boolean language sql security definer as $$select exists(select 1 from platform_admins where user_id=auth.uid())$$;
 create function can_access_tenant(p_tenant uuid) returns boolean language sql security definer as $$select exists(select 1 from tenant_members where tenant_id=p_tenant and user_id=auth.uid())$$;
 create table customers(id uuid primary key default gen_random_uuid(),platform text not null default 'facebook',tenant_id uuid references tenants(id),bot_enabled boolean default true,assigned_user_id uuid references auth.users(id),conversation_status text default 'open',last_message_at timestamptz default now(),outbound_lock_until timestamptz,handover_at timestamptz);
 create table messages(id uuid primary key default gen_random_uuid(),customer_id uuid references customers(id),sender text default 'customer',created_at timestamptz default now());
 create table bot_settings(tenant_id uuid primary key references tenants(id),reply_mode text default 'keyword',ai_instructions text);
 create table comments(id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id));
 create table orders(id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id));
 create table slips(id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id));
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 grant usage on schema public,auth,storage to authenticated,service_role;
 grant all on all tables in schema public,auth,storage to service_role;create publication supabase_realtime;`)
    await db.exec(fs.readFileSync('supabase/image-response-rules.sql', 'utf8'))
    await db.exec(fs.readFileSync('supabase/feature-access.sql', 'utf8'))
    await db.exec(fs.readFileSync('supabase/smart-inbox.sql', 'utf8'))
    const migration = fs.readFileSync('supabase/ai-vision.sql', 'utf8')
    await db.exec(migration)
    await db.exec(migration)
    checks++
    const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
    const owner = (await one('insert into auth.users default values returning id')).id,
      staff = (await one('insert into auth.users default values returning id')).id
    async function setup(plan = 'pro', source = 'test') {
      const tenant = (await one('insert into tenants(plan) values($1) returning id', [plan])).id
      await db.query("insert into tenant_members values($1,$2,'owner'),($1,$3,'staff')", [
        tenant,
        owner,
        staff,
      ])
      await db.query('insert into vision_settings(tenant_id,enabled) values($1,true)', [tenant])
      const customer = (
        await one('insert into customers(tenant_id) values($1) returning id', [tenant])
      ).id
      const message = (
        await one('insert into messages(customer_id) values($1) returning id', [customer])
      ).id
      const job = (
        await one(
          'insert into vision_jobs(tenant_id,source,idempotency_key,image_path,mime_type,customer_id,message_id) values($1,$2,$3,$4,$5,$6,$7) returning id',
          [
            tenant,
            source,
            'first',
            tenant + '/private',
            'image/png',
            source === 'test' ? null : customer,
            source === 'test' ? null : message,
          ],
        )
      ).id
      return { tenant, customer, message, job }
    }
    const claim = async (job) => one('select * from claim_vision_job($1)', [job])
    const state = async (job) => one('select * from vision_jobs where id=$1', [job])
    const used = async (tenant) =>
      (
        await one('select coalesce(sum(used),0)::int n from vision_usage where tenant_id=$1', [
          tenant,
        ])
      ).n
    const start = async (j) =>
      (await one('select start_vision_analysis($1,$2) ok', [j.id, j.claim_token])).ok
    const dispatch = async (j) =>
      (await one('select begin_vision_dispatch($1,$2) ok', [j.id, j.claim_token])).ok
    const setDecision = async (j, action) =>
      db.query('update vision_jobs set decision=$1 where id=$2', [JSON.stringify({ action }), j.id])
    await db.exec('set role service_role')
    assert.equal(
      (await one("select monthly_images from vision_plan_limits where plan='starter'"))
        .monthly_images,
      100,
    )
    assert.equal(
      (await one("select monthly_images from vision_plan_limits where plan='pro'")).monthly_images,
      1000,
    )
    checks++
    const pro = await setup()
    const j = await claim(pro.job)
    assert.ok(j)
    assert.equal(await claim(pro.job), undefined)
    assert.equal(await used(pro.tenant), 1)
    assert.equal(await start(j), true)
    assert.equal(await start(j), false)
    checks++
    const free = await setup('free')
    assert.equal(await claim(free.job), undefined)
    assert.equal((await state(free.job)).reason, 'FEATURE_LOCKED')
    assert.equal(await used(free.tenant), 0)
    checks++
    const expired = await setup()
    await db.query("update tenants set plan_expires_at=now()-interval '1 second' where id=$1", [
      expired.tenant,
    ])
    assert.equal(await claim(expired.job), undefined)
    assert.equal(await used(expired.tenant), 0)
    checks++
    const starter = await setup('starter')
    const sj = await claim(starter.job)
    assert.ok(sj)
    assert.equal(await start(sj), true)
    await assert.rejects(
      db.query("select save_vision_settings($1,$2,true,'catalog',0.8,true)", [
        starter.tenant,
        owner,
      ]),
      (e) => e.code === '42501',
    )
    checks++
    await db.query("select save_vision_settings($1,$2,true,'catalog',0.85,true)", [
      pro.tenant,
      owner,
    ])
    assert.equal(
      (await one('select mode from vision_settings where tenant_id=$1', [pro.tenant])).mode,
      'catalog',
    )
    await assert.rejects(
      db.query("select save_vision_settings($1,$2,true,'rules',0.8,true)", [pro.tenant, staff]),
      (e) => e.code === '42501',
    )
    checks++
    const limited = await setup('starter')
    await db.query(
      "insert into vision_usage values($1,date_trunc('month',now() at time zone 'UTC')::date,100)",
      [limited.tenant],
    )
    assert.equal(await claim(limited.job), undefined)
    assert.equal((await state(limited.job)).reason, 'VISION_QUOTA_EXHAUSTED')
    assert.equal(await used(limited.tenant), 100)
    checks++
    assert.equal(
      (
        await one('select retry_unstarted_vision($1,$2,$3) ok', [
          limited.job,
          limited.tenant,
          owner,
        ])
      ).ok,
      true,
    )
    await db.query('update vision_usage set used=99 where tenant_id=$1', [limited.tenant])
    assert.ok(await claim(limited.job))
    assert.equal(await used(limited.tenant), 100)
    checks++
    await assert.rejects(
      db.query(
        'insert into vision_jobs(tenant_id,source,idempotency_key,image_path,mime_type) values($1,$2,$3,$4,$5)',
        [pro.tenant, 'test', 'first', 'x', 'image/png'],
      ),
      (e) => e.code === '23505',
    )
    checks++
    const before = await setup()
    const bj = await claim(before.job)
    await db.query("update vision_jobs set claim_until=now()-interval '1 minute' where id=$1", [
      bj.id,
    ])
    const recovered = await claim(bj.id)
    assert.ok(recovered)
    assert.notEqual(recovered.claim_token, bj.claim_token)
    assert.equal(await used(before.tenant), 1)
    checks++
    const crash = await setup()
    const cj = await claim(crash.job)
    await start(cj)
    await db.query("update vision_jobs set claim_until=now()-interval '1 minute' where id=$1", [
      cj.id,
    ])
    assert.equal(await claim(cj.id), undefined)
    assert.equal((await state(cj.id)).status, 'requires_review')
    assert.equal(await used(crash.tenant), 1)
    assert.equal(
      (await one('select retry_unstarted_vision($1,$2,$3) ok', [cj.id, crash.tenant, owner])).ok,
      false,
    )
    checks++
    const refund = await setup()
    const rj = await claim(refund.job)
    await db.query('select refund_unstarted_vision($1,$2)', [rj.id, rj.claim_token])
    await db.query('select refund_unstarted_vision($1,$2)', [rj.id, rj.claim_token])
    assert.equal(await used(refund.tenant), 0)
    await db.query('select refund_unstarted_vision($1,$2)', [j.id, j.claim_token])
    assert.equal(await used(pro.tenant), 1)
    checks++
    const manual = await setup('pro', 'messenger')
    await db.query('update customers set assigned_user_id=$1,bot_enabled=false where id=$2', [
      owner,
      manual.customer,
    ])
    assert.equal(await claim(manual.job), undefined)
    assert.equal(await used(manual.tenant), 0)
    checks++
    const late = await setup('pro', 'messenger')
    const lj = await claim(late.job)
    const version = (
      await one('select conversation_version from customers where id=$1', [late.customer])
    ).conversation_version
    await db.query("select manage_inbox_conversation($1,$2,'claim',$3,null)", [
      late.customer,
      owner,
      version,
    ])
    assert.equal(await start(lj), false)
    await setDecision(lj, 'RULE_REPLY')
    assert.equal(await dispatch(lj), false)
    checks++
    const live = await setup('pro', 'messenger')
    const liveJob = await claim(live.job)
    await start(liveJob)
    await setDecision(liveJob, 'RULE_REPLY')
    assert.equal(await dispatch(liveJob), true)
    assert.equal(await dispatch(liveJob), false)
    checks++
    const handoff = await setup('pro', 'messenger')
    const hj = await claim(handoff.job)
    await start(hj)
    await setDecision(hj, 'HUMAN_HANDOFF')
    assert.equal(await dispatch(hj), true)
    const lease = (await one('select start_inbox_handover($1) lease', [handoff.customer])).lease
    assert.equal(
      (await one('select bot_enabled from customers where id=$1', [handoff.customer])).bot_enabled,
      false,
    )
    assert.equal(
      (
        await one(
          "select count(*)::int n from conversation_events where customer_id=$1 and action='handover'",
          [handoff.customer],
        )
      ).n,
      1,
    )
    await db.query('select end_inbox_delivery($1,$2)', [handoff.customer, lease])
    checks++
    const slip = await setup('pro', 'messenger')
    const slipJob = await claim(slip.job)
    await start(slipJob)
    await setDecision(slipJob, 'VERIFY_SLIP')
    await db.query('update tenants set slip_used=slip_quota where id=$1', [slip.tenant])
    assert.equal(await dispatch(slipJob), false)
    await db.query('update tenants set slip_quota_credits=slip_quota_credits+5 where id=$1', [
      slip.tenant,
    ])
    assert.equal(await dispatch(slipJob), true)
    assert.equal(
      (await one('select slip_used from tenants where id=$1', [slip.tenant])).slip_used,
      10,
    )
    checks++
    const cross = await setup('pro', 'messenger')
    await db.query('update vision_jobs set customer_id=$1 where id=$2', [live.customer, cross.job])
    assert.equal(await claim(cross.job), undefined)
    assert.equal(await used(cross.tenant), 0)
    checks++
    const downgraded = await setup('pro', 'messenger')
    const dj = await claim(downgraded.job)
    await start(dj)
    await setDecision(dj, 'PRODUCT_SEARCH')
    await db.query("update tenants set plan='starter' where id=$1", [downgraded.tenant])
    assert.equal(await dispatch(dj), false)
    checks++
    const previous = await setup()
    await db.query(
      "insert into vision_usage values($1,(date_trunc('month',now() at time zone 'UTC')-interval '1 month')::date,1000)",
      [previous.tenant],
    )
    assert.ok(await claim(previous.job))
    assert.equal(await used(previous.tenant), 1001)
    checks++
    await db.exec('reset role')
    await db.query("select set_config('test.user',$1,false)", [owner])
    await db.exec('set role authenticated')
    assert.ok(
      (await db.query('select id from vision_jobs where tenant_id=$1', [pro.tenant])).rows.length,
    )
    await assert.rejects(db.query('select claim_vision_job(null)'), /permission denied/)
    await assert.rejects(db.query('update vision_usage set used=0'), /permission denied/)
    await assert.rejects(db.query('select * from vision_plan_limits'), /permission denied/)
    checks++
    const outsider = '99999999-9999-4999-8999-999999999999'
    await db.query("select set_config('test.user',$1,false)", [outsider])
    assert.equal((await db.query('select id from vision_jobs')).rows.length, 0)
    checks++
    await db.query("select set_config('test.user',$1,false)", [owner])
    assert.equal(
      (await db.query('select id from vision_jobs where tenant_id=$1', [expired.tenant])).rows
        .length,
      0,
    )
    checks++
    await db.exec('reset role')
    await db.exec("update vision_plan_limits set monthly_images=123 where plan='starter'")
    await db.exec(migration)
    assert.equal(
      (await one("select monthly_images from vision_plan_limits where plan='starter'"))
        .monthly_images,
      123,
    )
    assert.equal(
      (await one("select public from storage.buckets where id='vision-images'")).public,
      false,
    )
    checks++
    console.log(
      `PASS: ${checks} PostgreSQL Vision scenarios: real entitlement migration, reruns, Free/Starter/Pro, expiry, quota, duplicate claims, refunds, recovery, safe retry, handoff, slip credits, tenant isolation, RLS and service-only RPCs`,
    )
  } finally {
    await db.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
