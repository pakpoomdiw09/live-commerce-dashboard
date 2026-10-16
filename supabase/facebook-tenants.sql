-- Run after platform.sql and security.sql, before using /auth/callback.
-- Run the entire file in the Supabase SQL Editor as postgres. Safe to re-run.
begin;

do $$ begin
  if to_regclass('public.tenants') is null or to_regclass('public.tenant_members') is null
     or to_regclass('public.platform_admins') is null
     or to_regprocedure('public.can_access_tenant(uuid)') is null then
    raise exception 'Run tenants.sql, platform.sql and security.sql before facebook-tenants.sql';
  end if;
end $$;

-- New Facebook tenants can exist before payment details have been configured.
alter table public.tenants alter column bank_code drop not null;
alter table public.tenants alter column account_number drop not null;
alter table public.tenants add column if not exists page_name text;
-- ADD COLUMN IF NOT EXISTS ... UNIQUE does not add uniqueness to an existing column.
do $$ begin
  if not exists (
    select 1 from pg_catalog.pg_index i
    join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attname = 'page_id'
    where i.indrelid = 'public.tenants'::regclass and i.indisunique and i.indisvalid
      and i.indpred is null and i.indexprs is null and i.indnkeyatts = 1 and i.indkey[0] = a.attnum
  ) then
    create unique index tenants_page_id_oauth_key on public.tenants (page_id);
  end if;
end $$;

alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;
drop policy if exists member_read on public.tenants;
create policy member_read on public.tenants for select to authenticated using (public.can_access_tenant(id));
drop policy if exists member_read on public.tenant_members;
create policy member_read on public.tenant_members for select to authenticated
  using (user_id = auth.uid() or public.can_access_tenant(tenant_id));

revoke all on public.tenants from anon, authenticated;
revoke select (page_access_token) on public.tenants from anon, authenticated;
grant select (id, name, account_name, bank_code, page_id, page_name, expected_amount,
              auto_reply_enabled, auto_verify_enabled, slip_quota, slip_used, page_token_set, created_at)
  on public.tenants to authenticated;
grant select on public.tenant_members to authenticated;

-- Only the trusted callback may call this function with Graph-verified Pages.
-- All Pages and owner memberships are saved in one transaction.
create or replace function public.sync_facebook_tenants(p_user_id uuid, p_pages jsonb)
-- SECURITY DEFINER fixes service_role's missing SELECT privilege on auth.users.
-- An empty search_path and fully qualified relations prevent object substitution.
returns integer language plpgsql security definer set search_path = '' as $$
declare
  p jsonb;
  tenant_uuid uuid;
  saved integer := 0;
begin
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception using errcode = '22023', message = 'Invalid user';
  end if;
  if pg_catalog.jsonb_typeof(p_pages) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Invalid Pages array';
  end if;
  -- A consistent lock order avoids deadlocks when two connections share several Pages.
  for p in select value from pg_catalog.jsonb_array_elements(p_pages) order by value->>'page_id' loop
    if coalesce(p->>'page_id', '') = '' or coalesce(p->>'page_name', '') = ''
       or coalesce(p->>'page_access_token', '') = '' then
      raise exception using errcode = '22023', message = 'Invalid Page';
    end if;
    -- Serialize simultaneous connections for this Page, including first-time creation.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p->>'page_id', 0));
    tenant_uuid := null;
    select id into tenant_uuid from public.tenants where page_id = p->>'page_id' for update;
    -- Membership is granted only after the trusted server verifies MANAGE and the Page token.
    -- Reconnecting must never reactivate a tenant suspended by the platform owner.
    if tenant_uuid is not null and exists (
      select 1 from public.tenants where id = tenant_uuid and not is_active
    ) then
      continue;
    end if;
    insert into public.tenants (name, page_id, page_name, page_access_token, auto_reply_enabled, auto_verify_enabled, slip_quota)
    values (p->>'page_name', p->>'page_id', p->>'page_name', p->>'page_access_token', false, false, 0)
    on conflict (page_id) do update
      set page_name = excluded.page_name, page_access_token = excluded.page_access_token
    returning id into tenant_uuid;
    insert into public.tenant_members (tenant_id, user_id, role) values (tenant_uuid, p_user_id, 'owner')
    on conflict (tenant_id, user_id) do update set role = 'owner';
    saved := saved + 1;
  end loop;
  return saved;
end;
$$;
alter function public.sync_facebook_tenants(uuid, jsonb) owner to postgres;
revoke all on function public.sync_facebook_tenants(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sync_facebook_tenants(uuid, jsonb) to service_role;

-- Make PostgREST see the function and column changes after this transaction commits.
notify pgrst, 'reload schema';
commit;
