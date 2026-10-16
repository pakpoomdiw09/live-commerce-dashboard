import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Install this isolated test dependency without changing application dependencies:
// npm install --prefix .tmp/facebook-sql-validation --no-package-lock --no-save @electric-sql/pglite
const { PGlite } = await import(process.argv[2] || '../.tmp/facebook-sql-validation/node_modules/@electric-sql/pglite/dist/index.js')
const migration = await readFile(new URL('../supabase/facebook-tenants.sql', import.meta.url), 'utf8')
const db = new PGlite()

const ownerId = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'
const adminId = '33333333-3333-4333-8333-333333333333'
const pageId = '200200200200'
const page = (id = pageId, name = 'Test Facebook Page', token = 'test-only-page-token') => ({
  page_id: id,
  page_name: name,
  page_access_token: token,
})

async function asRole(role, userId, operation) {
  assert.ok(['anon', 'authenticated', 'service_role'].includes(role))
  await db.exec(`set role ${role}`)
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ''])
  try {
    return await operation()
  } finally {
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub', '', false)")
  }
}

const sync = (userId, pages) => db.query(
  'select public.sync_facebook_tenants($1::uuid, $2::jsonb) as saved',
  [userId, JSON.stringify(pages)],
)
const expectDenied = (operation) => assert.rejects(operation, (error) => error.code === '42501')

try {
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit bypassrls;
    create schema auth;
    grant usage on schema public, auth to anon, authenticated, service_role;
    create table auth.users (id uuid primary key);
    insert into auth.users values ('${ownerId}'), ('${otherId}'), ('${adminId}');

    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    create table public.tenants (
      id uuid primary key default gen_random_uuid(),
      is_active boolean not null default true,
      name text not null check (length(trim(name)) > 0),
      bank_code text not null,
      account_number text not null check (account_number ~ '^[0-9]+$'),
      account_name text,
      created_at timestamptz not null default now(),
      page_id text unique,
      expected_amount numeric(12,2) check (expected_amount is null or expected_amount > 0),
      auto_reply_enabled boolean not null default true,
      auto_verify_enabled boolean not null default true,
      slip_quota integer not null default 500 check (slip_quota >= 0),
      slip_used integer not null default 0 check (slip_used >= 0),
      page_access_token text,
      page_token_set boolean generated always as (page_access_token is not null) stored
    );
    create table public.platform_admins (
      user_id uuid primary key references auth.users(id) on delete cascade,
      created_at timestamptz not null default now()
    );
    create table public.tenant_members (
      tenant_id uuid not null references public.tenants(id) on delete cascade,
      user_id uuid not null references auth.users(id) on delete cascade,
      role text not null default 'staff' check (role in ('owner', 'staff')),
      created_at timestamptz not null default now(),
      primary key (tenant_id, user_id)
    );
    insert into public.platform_admins(user_id) values ('${adminId}');

    create function public.is_platform_admin() returns boolean
    language sql stable security definer set search_path = '' as $$
      select exists (select 1 from public.platform_admins where user_id = auth.uid())
    $$;
    create function public.can_access_tenant(p_tenant uuid) returns boolean
    language sql stable security definer set search_path = '' as $$
      select public.is_platform_admin() or exists (
        select 1 from public.tenant_members
        where tenant_id = p_tenant and user_id = auth.uid()
      )
    $$;
    revoke execute on function public.is_platform_admin() from public, anon;
    revoke execute on function public.can_access_tenant(uuid) from public, anon;
    grant execute on function public.is_platform_admin() to authenticated;
    grant execute on function public.can_access_tenant(uuid) to authenticated;

    alter table public.tenants enable row level security;
    alter table public.tenant_members enable row level security;
    alter table public.platform_admins enable row level security;
    create policy member_read on public.tenants for select to authenticated
      using (public.can_access_tenant(id));
    create policy member_read on public.tenant_members for select to authenticated
      using (user_id = auth.uid() or public.can_access_tenant(tenant_id));
    create policy own_row on public.platform_admins for select to authenticated
      using (user_id = auth.uid());

    grant select, insert, update, delete on public.tenants, public.tenant_members, public.platform_admins to service_role;
    grant select on public.tenant_members, public.platform_admins to authenticated;
    grant select (id, name, account_name, account_number, bank_code, page_id, expected_amount,
      auto_reply_enabled, auto_verify_enabled, slip_quota, slip_used, page_token_set, created_at)
      on public.tenants to authenticated;
  `)

  // This is the deployed failure: bypassing RLS does not grant auth.users table access.
  await asRole('service_role', null, () => expectDenied(() => db.query('select id from auth.users')))
  await db.exec(migration)
  await db.exec(migration)
  const multiAdminMigration = await readFile(new URL('../supabase/facebook-multi-admin.sql', import.meta.url), 'utf8')
  await db.exec(multiAdminMigration)
  await db.exec(multiAdminMigration)

  const { rows: privileges } = await db.query(`
    select role_name,
      has_function_privilege(role_name, 'public.sync_facebook_tenants(uuid,jsonb)', 'EXECUTE') as can_execute
    from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name)
    order by role_name
  `)
  assert.deepEqual(privileges, [
    { role_name: 'anon', can_execute: false },
    { role_name: 'authenticated', can_execute: false },
    { role_name: 'service_role', can_execute: true },
  ])
  const { rows: functionInfo } = await db.query(`
    select prosecdef, proconfig from pg_proc
    where oid = 'public.sync_facebook_tenants(uuid,jsonb)'::regprocedure
  `)
  assert.equal(functionInfo[0].prosecdef, true)
  assert.ok(functionInfo[0].proconfig.some((entry) => /^search_path=(""|)$/.test(entry)))

  // The fix must elevate this narrow RPC, while leaving direct auth access restricted.
  await asRole('service_role', null, async () => {
    await expectDenied(() => db.query('select id from auth.users'))
    assert.equal((await sync(ownerId, [])).rows[0].saved, 0)
    assert.equal((await sync(ownerId, [page()])).rows[0].saved, 1)
  })
  const original = (await db.query('select * from public.tenants where page_id = $1', [pageId])).rows[0]
  assert.equal(original.bank_code, null)
  assert.equal(original.account_number, null)
  assert.equal(original.page_token_set, true)
  assert.equal(original.slip_quota, 0)
  assert.equal(original.auto_reply_enabled, false)
  assert.equal(original.auto_verify_enabled, false)
  assert.deepEqual((await db.query(
    'select user_id, role from public.tenant_members where tenant_id = $1', [original.id],
  )).rows, [{ user_id: ownerId, role: 'owner' }])

  await db.query(`
    update public.tenants set name = 'Configured shop', bank_code = 'KBANK', account_number = '1234567890',
      account_name = 'Test account', slip_quota = 900, slip_used = 3,
      auto_reply_enabled = true, auto_verify_enabled = true where id = $1
  `, [original.id])
  await asRole('service_role', null, async () => {
    assert.equal((await sync(ownerId, [page(pageId, 'Updated page name', 'test-only-refreshed-token')])).rows[0].saved, 1)
  })
  const refreshed = (await db.query('select * from public.tenants where page_id = $1', [pageId])).rows[0]
  assert.equal(refreshed.id, original.id)
  assert.equal(refreshed.page_name, 'Updated page name')
  assert.equal(refreshed.page_access_token, 'test-only-refreshed-token')
  assert.equal(refreshed.name, 'Configured shop')
  assert.equal(refreshed.bank_code, 'KBANK')
  assert.equal(refreshed.account_number, '1234567890')
  assert.equal(refreshed.account_name, 'Test account')
  assert.equal(refreshed.slip_quota, 900)
  assert.equal(refreshed.slip_used, 3)
  assert.equal(refreshed.auto_reply_enabled, true)
  assert.equal(refreshed.auto_verify_enabled, true)
  assert.equal((await db.query('select count(*)::int as count from public.tenant_members')).rows[0].count, 1)

  // A malformed Page must roll back every new Page in the same sync.
  await asRole('service_role', null, () => assert.rejects(
    () => sync(otherId, [page('100100100100'), { page_id: '300300300300', page_name: 'Missing token' }]),
    /Invalid Page/i,
  ))
  assert.equal((await db.query('select count(*)::int as count from public.tenants')).rows[0].count, 1)
  assert.equal((await db.query('select count(*)::int as count from public.tenant_members')).rows[0].count, 1)
  assert.equal((await db.query('select page_access_token from public.tenants where id = $1', [original.id])).rows[0].page_access_token, refreshed.page_access_token)

  await asRole('authenticated', otherId, async () => {
    assert.deepEqual((await db.query('select id, page_name from public.tenants')).rows, [])
    await expectDenied(() => sync(otherId, []))
  })
  await asRole('anon', null, () => expectDenied(() => sync(ownerId, [])))
  await asRole('authenticated', ownerId, async () => {
    assert.deepEqual((await db.query('select id, page_name, page_token_set from public.tenants')).rows, [
      { id: original.id, page_name: 'Updated page name', page_token_set: true },
    ])
    await expectDenied(() => db.query('select page_access_token from public.tenants'))
    await expectDenied(() => db.query("update public.tenants set page_name = 'Unauthorized write' where id = $1", [original.id]))
    await expectDenied(() => db.query("insert into public.tenant_members(tenant_id, user_id, role) values ($1, $2, 'owner')", [original.id, otherId]))
  })

  await db.query("insert into public.tenant_members(tenant_id, user_id, role) values ($1, $2, 'staff')", [original.id, otherId])
  await asRole('service_role', null, async () => {
    assert.equal((await sync(otherId, [page()])).rows[0].saved, 1)
    assert.equal((await sync(otherId, [page()])).rows[0].saved, 1)
  })
  assert.equal((await db.query('select role from public.tenant_members where tenant_id = $1 and user_id = $2', [original.id, otherId])).rows[0].role, 'owner')
  assert.equal((await db.query('select count(*)::int n from public.tenant_members where tenant_id=$1', [original.id])).rows[0].n, 2)
  assert.equal((await db.query('select count(*)::int n from public.tenants')).rows[0].n, 1)
  await db.query('update public.tenants set is_active=false where id=$1', [original.id])
  await asRole('service_role', null, async () => assert.equal((await sync(adminId, [page()])).rows[0].saved, 0))
  assert.equal((await db.query('select count(*)::int n from public.tenant_members where user_id=$1', [adminId])).rows[0].n, 0)
  await db.query('update public.tenants set is_active=true where id=$1', [original.id])

  await asRole('service_role', null, async () => {
    assert.equal((await sync(adminId, [page(pageId, 'Admin refreshed page', 'test-only-admin-token')])).rows[0].saved, 1)
    await assert.rejects(() => sync('44444444-4444-4444-8444-444444444444', []), /Invalid user/i)
    await assert.rejects(() => sync(ownerId, [{ page_id: '300300300300', page_name: 'Missing token' }]), /Invalid Page/i)
    await assert.rejects(() => sync(ownerId, null), /Invalid Pages array/i)
    await assert.rejects(() => sync(ownerId, {}), /Invalid Pages array/i)
  })
  assert.equal((await db.query('select count(*)::int as count from public.tenants')).rows[0].count, 1)

  // A preexisting page_id column without uniqueness must receive a usable unique index.
  await db.exec('alter table public.tenants drop constraint tenants_page_id_key')
  await db.exec(migration)
  await db.exec(migration)
  await asRole('service_role', null, async () => {
    assert.equal((await sync(ownerId, [page(pageId, 'Index repair verified')])).rows[0].saved, 1)
  })
  assert.equal((await db.query('select count(*)::int as count from public.tenants')).rows[0].count, 1)

  const checks = await readFile(new URL('../supabase/facebook-tenants-check.sql', import.meta.url), 'utf8')
  assert.equal((await db.exec(checks)).length, 7)

  console.log('Facebook tenant SQL checks passed: migration rerun, unique index repair, narrow auth access, RPC grants, upsert preservation, atomic rollback, ownership, RLS/token restrictions, and all diagnostic SQL statements.')
} finally {
  await db.close()
}
