-- Plans, monthly broadcast credits and top-ups. Run after automation.sql, then run security.sql again.
-- Safe to re-run. Prices and credits live in lib/plans.ts; the only number repeated here is the
-- Free plan's 100 credits (what a tenant falls back to when a paid plan lapses).
--
-- How credits work:
--   broadcast_credits        this month's plan credits; reset to broadcast_allowance every calendar month (Asia/Bangkok)
--   broadcast_topup_credits  bought credits (Starter/Pro only); never expire, spent after the plan credits
--   One credit = one broadcast message that Meta accepted. The send route reserves a batch, then
--   gives back the ones that failed (reserve_broadcast_credits / refund_broadcast_credits).
-- Payments are manual: a shop owner files a billing_request, a platform admin approves it after
-- the money arrives (approve_billing_request applies it).

alter table tenants add column if not exists plan text not null default 'free';
alter table tenants drop constraint if exists tenants_plan_check;
alter table tenants add constraint tenants_plan_check check (plan in ('free', 'starter', 'pro'));
alter table tenants add column if not exists plan_expires_at timestamptz;           -- null: no expiry (Free, or set by hand)
alter table tenants add column if not exists broadcast_allowance integer not null default 100 check (broadcast_allowance >= 0);
alter table tenants add column if not exists broadcast_credits integer not null default 100 check (broadcast_credits >= 0);
alter table tenants add column if not exists broadcast_topup_credits integer not null default 0 check (broadcast_topup_credits >= 0);
-- Accumulated slip entitlement; remaining = slip_quota + slip_quota_credits - slip_used.
alter table tenants add column if not exists slip_quota_credits integer not null default 0 check (slip_quota_credits >= 0);
alter table tenants add column if not exists broadcast_period text not null
  default to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM');

/** Lapse an expired paid plan to Free, and refill the plan credits when a new month starts. */
create or replace function refresh_broadcast_credits(p_tenant uuid) returns void
language plpgsql as $$
declare
  this_month text := to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM');
begin
  update tenants set plan = 'free', plan_expires_at = null, broadcast_allowance = 100,
                     broadcast_credits = least(broadcast_credits, 100)
  where id = p_tenant and plan <> 'free' and plan_expires_at is not null and plan_expires_at <= now();
  update tenants set broadcast_credits = broadcast_allowance, broadcast_period = this_month
  where id = p_tenant and broadcast_period <> this_month;
end $$;

/**
 * Take up to p_count credits: plan credits first, then top-ups. Returns how many came from each
 * (fewer than asked = ran out). Row lock: concurrent sends never overspend.
 */
create or replace function reserve_broadcast_credits(p_tenant uuid, p_count integer)
returns table (monthly integer, topup integer)
language plpgsql as $$
declare
  t tenants;
  m integer;
  u integer;
begin
  perform refresh_broadcast_credits(p_tenant);
  select * into t from tenants where id = p_tenant for update;
  if not found or p_count <= 0 then
    return query select 0, 0;
    return;
  end if;
  m := least(p_count, t.broadcast_credits);
  u := least(p_count - m, t.broadcast_topup_credits);
  update tenants set broadcast_credits = broadcast_credits - m, broadcast_topup_credits = broadcast_topup_credits - u where id = p_tenant;
  return query select m, u;
end $$;

/** Give back reserved credits that weren't used (the message failed or had already gone out). */
create or replace function refund_broadcast_credits(p_tenant uuid, p_monthly integer, p_topup integer) returns void
language sql as $$
  update tenants
  set broadcast_credits = least(broadcast_allowance, broadcast_credits + greatest(p_monthly, 0)),
      broadcast_topup_credits = broadcast_topup_credits + greatest(p_topup, 0)
  where id = p_tenant
$$;

-- only the service role (API routes) may move credits
revoke execute on function refresh_broadcast_credits(uuid) from public, anon, authenticated;
revoke execute on function reserve_broadcast_credits(uuid, integer) from public, anon, authenticated;
revoke execute on function refund_broadcast_credits(uuid, integer, integer) from public, anon, authenticated;

-- ── purchases: a plan month or a top-up pack, paid outside the app ──
create table if not exists billing_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  item text not null check (item in ('starter', 'pro', 'topup_s', 'topup_m', 'topup_l', 'slip_topup_s', 'slip_topup_m', 'slip_topup_l')),
  price_baht integer not null check (price_baht >= 0),
  credits integer not null check (credits > 0),            -- plan: monthly allowance; top-up: credits added
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  note text check (length(note) <= 500),                    -- admin's reason when rejecting
  requested_by uuid references auth.users(id) on delete set null,
  decided_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists billing_requests_tenant on billing_requests (tenant_id, created_at desc);
alter table billing_requests drop constraint if exists billing_requests_item_check;
alter table billing_requests add constraint billing_requests_item_check
  check (item in ('starter', 'pro', 'topup_s', 'topup_m', 'topup_l', 'slip_topup_s', 'slip_topup_m', 'slip_topup_l'));
create index if not exists billing_requests_pending on billing_requests (created_at) where status = 'pending';
-- one open request per item per shop
create unique index if not exists billing_requests_one_pending on billing_requests (tenant_id, item) where status = 'pending';

/**
 * Apply a pending request. Plan: one month from now (or from the current expiry when renewing
 * the same plan), with a full month of credits right away. Top-up: needs an active paid plan.
 * Returns null on success, or why it was refused.
 */
create or replace function approve_billing_request(p_request uuid, p_admin uuid) returns text
language plpgsql as $$
declare
  r billing_requests;
  t tenants;
  this_month text := to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM');
begin
  select * into r from billing_requests where id = p_request for update;
  if not found then return 'ไม่พบคำขอนี้'; end if;
  if r.status = 'approved' then return null; end if;
  if r.status <> 'pending' then return 'คำขอนี้ถูกดำเนินการไปแล้ว'; end if;
  perform refresh_broadcast_credits(r.tenant_id);
  select * into t from tenants where id = r.tenant_id for update;

  if r.item in ('starter', 'pro') then
    update tenants set
      plan = r.item,
      plan_expires_at = (case when t.plan = r.item and t.plan_expires_at > now() then t.plan_expires_at else now() end) + interval '30 days',
      broadcast_allowance = r.credits,
      broadcast_credits = broadcast_credits + r.credits,
      broadcast_period = this_month
    where id = r.tenant_id;
  else
    if r.item in ('slip_topup_s', 'slip_topup_m', 'slip_topup_l') then
      update tenants set slip_quota_credits = slip_quota_credits + r.credits where id = r.tenant_id;
    elsif r.item in ('topup_s', 'topup_m', 'topup_l') then
      -- Keep purchased broadcast credits in their non-expiring bucket.
      update tenants set broadcast_topup_credits = broadcast_topup_credits + r.credits where id = r.tenant_id;
    else
      return 'ไม่พบแพ็กเกจเติมเงินนี้';
    end if;
  end if;

  update billing_requests set status = 'approved', decided_by = p_admin, decided_at = now() where id = p_request;
  return null;
end $$;
revoke execute on function approve_billing_request(uuid, uuid) from public, anon, authenticated;

-- policies: supabase/security.sql
alter table billing_requests enable row level security;
do $$ begin alter publication supabase_realtime add table billing_requests; exception when duplicate_object then null; end $$;
