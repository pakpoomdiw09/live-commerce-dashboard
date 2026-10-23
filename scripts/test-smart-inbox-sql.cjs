const assert = require('node:assert/strict'),
  fs = require('node:fs')
const { PGlite } = require(process.argv[2] || '@electric-sql/pglite')
;(async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create schema storage;
 create table auth.users(id uuid primary key default gen_random_uuid());
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.user',true),'')::uuid$$;
 create table tenants(id uuid primary key default gen_random_uuid(),plan text default 'starter',is_active boolean default true,auto_reply_enabled boolean default true);
 create table tenant_members(tenant_id uuid references tenants(id),user_id uuid references auth.users(id),role text);
 create table platform_admins(user_id uuid primary key references auth.users(id));
 create table customers(id uuid primary key default gen_random_uuid(),platform text not null default 'facebook',tenant_id uuid references tenants(id),bot_enabled boolean default true,last_message_at timestamptz,handover_at timestamptz);
 create table messages(id uuid primary key default gen_random_uuid(),customer_id uuid references customers(id),sender text,external_id text unique,created_at timestamptz default now());
 create table bot_settings(tenant_id uuid primary key references tenants(id),reply_mode text);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create function has_tenant_feature(p_tenant uuid,p_feature text) returns boolean language sql as $$select is_active and plan in ('starter','pro') and (p_feature<>'ai_agent' or plan='pro') from tenants where id=p_tenant$$;
 create function can_access_tenant(p_tenant uuid) returns boolean language sql security definer as $$select exists(select 1 from tenant_members where tenant_id=p_tenant and user_id=auth.uid())$$;
 grant usage on schema public,auth,storage to authenticated,service_role;
 grant all on all tables in schema public,storage,auth to service_role;
 grant update(bot_enabled) on customers to authenticated;
 grant select on customers,tenants to authenticated;
 create publication supabase_realtime;`)
    const sql = fs.readFileSync('supabase/smart-inbox.sql', 'utf8')
    await db.exec(sql)
    await db.exec(sql)
    await db.exec('set role service_role')
    const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
    const owner = (await one('insert into auth.users default values returning id')).id,
      staff = (await one('insert into auth.users default values returning id')).id,
      foreign = (await one('insert into auth.users default values returning id')).id
    const shop = (await one('insert into tenants default values returning id')).id,
      other = (await one('insert into tenants default values returning id')).id
    await db.query(
      "insert into tenant_members values($1,$2,'owner'),($1,$3,'staff'),($4,$5,'owner')",
      [shop, owner, staff, other, foreign],
    )
    await db.query("insert into bot_settings values($1,'ai')", [shop])
    const c = (await one('insert into customers(tenant_id) values($1) returning id', [shop])).id
    const call = (actor, action, version, target = null) =>
      db.query('select manage_inbox_conversation($1,$2,$3,$4,$5)', [
        c,
        actor,
        action,
        version,
        target,
      ])
    const version = async () =>
      (await one('select conversation_version n from customers where id=$1', [c])).n
    await call(owner, 'claim', 0)
    assert.equal(
      (await one('select bot_enabled from customers where id=$1', [c])).bot_enabled,
      false,
    )
    await assert.rejects(call(staff, 'claim', 0), (e) => e.code === '40001')
    await assert.rejects(call(staff, 'claim', 1), (e) => e.code === '40001')
    await assert.rejects(call(owner, 'transfer', 1, foreign), (e) => e.code === '22023')
    await assert.rejects(call(foreign, 'close', 1), (e) => e.code === '42501')
    await call(owner, 'transfer', 1, staff)
    await assert.rejects(call(owner, 'bot', await version()), (e) => e.code === '42501') // Starter cannot enable AI.
    const lease = (await one('select start_inbox_delivery($1,$2) lease', [c, staff])).lease
    await assert.rejects(call(staff, 'close', await version()), (e) => e.code === '55P03')
    await assert.rejects(
      db.query('select start_inbox_delivery($1,null)', [c]),
      (e) => e.code === '40001',
    )
    await db.query('select end_inbox_delivery($1,$2)', [c, owner]) // wrong token cannot release
    await assert.rejects(call(staff, 'close', await version()), (e) => e.code === '55P03')
    await db.query('select end_inbox_delivery($1,$2)', [c, lease])
    await call(staff, 'close', await version())
    const first = (
      await one(
        "insert into messages(customer_id,sender,external_id) values($1,'customer','incoming') returning id",
        [c],
      )
    ).id
    assert.equal(
      (await one('select conversation_status from customers where id=$1', [c])).conversation_status,
      'open',
    )
    await assert.rejects(
      db.query(
        "insert into messages(customer_id,sender,external_id) values($1,'customer','incoming')",
        [c],
      ),
      (e) => e.code === '23505',
    )
    assert.equal((await one('select inbound_seq from customers where id=$1', [c])).inbound_seq, 1)
    await db.query('select mark_inbox_read($1,$2,$3)', [c, owner, first])
    assert.equal((await one('select count(*)::int n from conversation_reads')).n, 1)
    const second = (
      await one("insert into messages(customer_id,sender) values($1,'customer') returning id", [c])
    ).id
    await db.query('select mark_inbox_read($1,$2,$3)', [c, owner, first])
    assert.equal(
      (await one('select read_seq from conversation_reads where user_id=$1', [owner])).read_seq,
      1,
    )
    await db.query('select mark_inbox_read($1,$2,$3)', [c, staff, second])
    await db.query("update tenants set plan='pro' where id=$1", [shop])
    await call(staff, 'bot', await version())
    const botLease = (await one('select start_inbox_delivery($1,null) lease', [c])).lease
    await assert.rejects(call(owner, 'claim', await version()), (e) => e.code === '55P03')
    await db.query('select end_inbox_delivery($1,$2)', [c, botLease])
    await call(owner, 'claim', await version())
    await assert.rejects(
      db.query('select start_inbox_delivery($1,null)', [c]),
      (e) => e.code === '40001',
    )
    await db.query("update tenants set plan='free' where id=$1", [shop])
    await assert.rejects(call(owner, 'reopen', await version()), (e) => e.code === '42501')
    await db.query("update tenants set plan='pro' where id=$1", [shop])
    await call(owner, 'bot', await version())
    const handover = (await one('select start_inbox_handover($1) lease', [c])).lease
    assert.equal(
      (await one('select bot_enabled from customers where id=$1', [c])).bot_enabled,
      false,
    )
    await assert.rejects(call(staff, 'claim', await version()), (e) => e.code === '55P03')
    await db.query('select end_inbox_delivery($1,$2)', [c, handover])
    await db.query("select set_config('test.user',$1,false)", [owner])
    await db.exec('set role authenticated')
    assert.equal((await one('select count(*)::int n from conversation_reads')).n, 1)
    await assert.rejects(
      db.query('select manage_inbox_conversation($1,$2,$3,$4,null)', [c, owner, 'close', 0]),
      /permission denied/,
    )
    await assert.rejects(
      db.query('update customers set bot_enabled=true where id=$1', [c]),
      /permission denied/,
    )
    await db.exec('reset role')
    assert.equal((await one('select count(*)::int n from conversation_events')).n, 7)
    console.log(
      'PASS: migration reruns, version races, tenant isolation, assignment, handoff delivery lease, AI package gate, inbound dedup, per-user reads, audit and service-only mutations',
    )
  } finally {
    await db.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
