-- Run after security.sql, payments.sql, billing-slip-topups.sql and admin-feature-bypass.sql.
-- Run as postgres in Supabase SQL Editor. Safe to rerun; no existing balances are reset.
begin;
alter table public.tenants add column if not exists is_active boolean not null default true;
alter table public.billing_requests add column if not exists proof_path text;
alter table public.billing_requests add column if not exists proof_uploaded_at timestamptz;
grant select (is_active) on public.tenants to authenticated;

create table if not exists public.platform_tenant_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete set null,
  admin_id uuid references auth.users(id) on delete set null,
  before_state jsonb not null,
  after_state jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.platform_tenant_audit enable row level security;
revoke all on public.platform_tenant_audit from anon, authenticated;
grant select, insert on public.platform_tenant_audit to service_role;

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated, service_role;

create or replace function public.can_access_tenant(p_tenant uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select public.is_platform_admin() or (
    p_tenant is not null
    and exists (select 1 from public.tenants where id = p_tenant and is_active)
    and exists (select 1 from public.tenant_members where tenant_id = p_tenant and user_id = auth.uid())
  )
$$;
revoke all on function public.can_access_tenant(uuid) from public, anon;
grant execute on function public.can_access_tenant(uuid) to authenticated;

create or replace function public.platform_dashboard_overview() returns jsonb
language sql set search_path = pg_catalog, public as $$
  with bounds as (
    select date_trunc('month', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok' as starts_at,
      (date_trunc('month', now() at time zone 'Asia/Bangkok') + interval '1 month') at time zone 'Asia/Bangkok' as ends_at
  )
  select jsonb_build_object(
    'tenantCount', (select count(*) from public.tenants),
    'activeTenantCount', (select count(*) from public.tenants where is_active),
    'pendingCount', (select count(*) from public.billing_requests where status = 'pending'),
    'pendingAmount', (select coalesce(sum(price_baht), 0) from public.billing_requests where status = 'pending'),
    'monthRevenue', (
      select coalesce(sum(amount), 0) from (
        select price_baht as amount from public.billing_requests, bounds
          where status = 'approved' and decided_at >= starts_at and decided_at < ends_at
        union all
        select price_baht as amount from public.payment_sessions, bounds
          where status = 'paid' and paid_at >= starts_at and paid_at < ends_at
      ) received
    )
  )
$$;
revoke all on function public.platform_dashboard_overview() from public, anon, authenticated;
grant execute on function public.platform_dashboard_overview() to service_role;

-- Plan changes replace included plan credits only; both top-up balances are retained.
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
revoke all on function public.platform_update_tenant(uuid,uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.platform_update_tenant(uuid,uuid,text,boolean) to service_role;

-- Private proof images are uploaded/read through authenticated server API routes only.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('billing-proofs','billing-proofs',false,5242880,array['image/jpeg','image/png','image/webp'])
  on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;
commit;
