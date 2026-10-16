-- Run after platform-dashboard.sql and admin-feature-bypass.sql. Safe to rerun.
begin;
create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

create or replace function public.tenant_has_feature_bypass(p_tenant uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1 from public.tenant_members m
    join public.platform_admins a on a.user_id = m.user_id
    where m.tenant_id = p_tenant and m.role = 'owner'
  )
$$;

create or replace function public.platform_update_tenant(
  p_tenant uuid, p_admin uuid, p_plan text default null, p_active boolean default null
) returns void
language plpgsql set search_path = pg_catalog, public as $$
declare t public.tenants; updated public.tenants; allowance integer;
begin
  if not exists (select 1 from public.platform_admins where user_id = p_admin) then
    raise exception 'Only platform admins may manage tenants' using errcode = '42501';
  end if;
  if p_plan is not null and p_plan not in ('free', 'starter', 'pro') then
    raise exception 'Unknown plan' using errcode = '22023';
  end if;
  if p_plan is null and p_active is null then raise exception 'No changes supplied' using errcode = '22023'; end if;
  select * into t from public.tenants where id = p_tenant for update;
  if not found then raise exception 'Tenant not found' using errcode = 'P0002'; end if;
  if p_plan is not null then
    allowance := case p_plan when 'free' then 100 when 'starter' then 1500 when 'pro' then 7500 end;
    update public.tenants set plan = p_plan,
      plan_expires_at = case when p_plan = 'free' then null else now() + interval '30 days' end,
      broadcast_allowance = allowance, broadcast_credits = allowance,
      broadcast_credit_mode = case when p_plan = 'free' then 'calendar' else 'purchased' end,
      broadcast_period = to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM')
    where id = p_tenant;
  end if;
  if p_active is not null then update public.tenants set is_active = p_active where id = p_tenant; end if;
  select * into updated from public.tenants where id = p_tenant;
  insert into public.platform_tenant_audit(tenant_id,admin_id,before_state,after_state)
    values(p_tenant,p_admin,
      jsonb_build_object('plan',t.plan,'expiresAt',t.plan_expires_at,'active',t.is_active,'broadcastCredits',t.broadcast_credits),
      jsonb_build_object('plan',updated.plan,'expiresAt',updated.plan_expires_at,'active',updated.is_active,'broadcastCredits',updated.broadcast_credits));
end $$;
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated, service_role;
revoke all on function public.tenant_has_feature_bypass(uuid), public.platform_update_tenant(uuid,uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.tenant_has_feature_bypass(uuid), public.platform_update_tenant(uuid,uuid,text,boolean) to service_role;
notify pgrst, 'reload schema';
commit;
