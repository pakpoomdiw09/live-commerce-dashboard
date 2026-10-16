-- Run after facebook-tenants.sql; preserves existing grants and data. Safe to rerun.
begin;
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

notify pgrst, 'reload schema';
commit;
