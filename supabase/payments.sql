-- Automatic package payments. Run AFTER schema/platform/automation/billing/security.sql.
-- Run the WHOLE file as postgres. Re-run after billing.sql; all changes are transactional.
-- SlipOK verification belongs to the server API, never the browser or this migration.
begin;

alter table public.tenants add column if not exists broadcast_credit_mode text not null
  default 'calendar' check (broadcast_credit_mode in ('calendar', 'purchased'));

create table if not exists public.payment_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete set null,
  plan text not null check (plan in ('starter', 'pro')),
  price_baht integer not null check (price_baht > 0),
  credits integer not null check (credits > 0),
  status text not null default 'pending' check (status in ('pending', 'paid')),
  requested_by uuid references auth.users(id) on delete set null,
  receiver_promptpay_id text not null check (receiver_promptpay_id ~ '^(0[0-9]{9}|[0-9]{13}|[0-9]{15})$'),
  receiver_account_no text not null check (length(trim(receiver_account_no)) > 0),
  receiver_account_name text not null check (length(trim(receiver_account_name)) > 0),
  receiver_bank_name text not null check (length(trim(receiver_bank_name)) > 0),
  receiver_bank_code text not null check (length(trim(receiver_bank_code)) > 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '20 minutes'),
  paid_at timestamptz,
  check (expires_at > created_at),
  check ((status = 'paid') = (paid_at is not null))
);
create index if not exists payment_sessions_tenant on public.payment_sessions (tenant_id, created_at desc);

-- No cascading deletion: accepted proof must remain after users/tenants disappear.
create table if not exists public.payment_receipts (
  session_id uuid primary key references public.payment_sessions(id) on delete restrict,
  trans_ref text not null unique check (length(trim(trans_ref)) between 1 and 200 and trans_ref = trim(trans_ref)),
  image_sha256 text not null unique check (image_sha256 ~ '^[0-9a-f]{64}$'),
  amount numeric(12,2) not null check (amount > 0),
  paid_at timestamptz not null,
  verified_at timestamptz not null default now(),
  applied_at timestamptz
);

-- A permanent, shared uniqueness constraint arbitrates concurrent package/sales slips.
-- No foreign keys: deleting a source row must never make a bank transfer reusable.
create table if not exists public.payment_transfer_ledger (
  trans_ref text primary key,
  source text not null check (source in ('package', 'sale')),
  source_id uuid not null,
  created_at timestamptz not null default now(),
  unique (source, source_id)
);

-- Block source writes while backfilling and installing the cross-table guards.
lock table public.slips, public.payment_receipts in share row exclusive mode;
insert into public.payment_transfer_ledger (trans_ref, source, source_id)
select trans_ref, 'sale', id from public.slips where status = 'valid' and trans_ref is not null
on conflict do nothing;
insert into public.payment_transfer_ledger (trans_ref, source, source_id)
select trans_ref, 'package', session_id from public.payment_receipts
on conflict do nothing;
do $$ begin
  if exists (
    select 1 from public.slips s left join public.payment_transfer_ledger l on l.trans_ref = s.trans_ref
    where s.status = 'valid' and s.trans_ref is not null
      and (l.source is distinct from 'sale' or l.source_id is distinct from s.id)
  ) or exists (
    select 1 from public.payment_receipts r left join public.payment_transfer_ledger l on l.trans_ref = r.trans_ref
    where l.source is distinct from 'package' or l.source_id is distinct from r.session_id
  ) then raise exception 'Existing transfers conflict; resolve duplicate proofs before migrating'; end if;
end $$;

create or replace function public.claim_payment_transfer(p_ref text, p_source text, p_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  insert into public.payment_transfer_ledger (trans_ref, source, source_id)
  values (p_ref, p_source, p_id) on conflict do nothing;
  if not exists (select 1 from public.payment_transfer_ledger
                 where trans_ref = p_ref and source = p_source and source_id = p_id) then
    raise exception 'Transfer already accepted' using errcode = '23505';
  end if;
end $$;

create or replace function public.guard_payment_receipt() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare s public.payment_sessions;
begin
  if tg_op = 'UPDATE' then
    if new.session_id is distinct from old.session_id or new.trans_ref is distinct from old.trans_ref
       or new.image_sha256 is distinct from old.image_sha256 or new.amount is distinct from old.amount
       or new.paid_at is distinct from old.paid_at or new.verified_at is distinct from old.verified_at
       or (old.applied_at is not null and new.applied_at is distinct from old.applied_at) then
      raise exception 'Verified payment proof is immutable';
    end if;
    return new;
  end if;
  select * into s from public.payment_sessions where id = new.session_id for update;
  if not found or s.tenant_id is null or s.status <> 'pending' then
    raise exception 'Checkout is not payable';
  end if;
  if new.applied_at is not null or new.amount <> s.price_baht
     or new.paid_at < s.created_at - interval '2 minutes'
     or new.paid_at > s.expires_at or new.paid_at > clock_timestamp() + interval '2 minutes'
     or clock_timestamp() > s.expires_at then
    raise exception 'Payment amount or transfer window is invalid';
  end if;
  perform public.claim_payment_transfer(new.trans_ref, 'package', new.session_id);
  return new;
end $$;
drop trigger if exists payment_receipts_guard on public.payment_receipts;
create trigger payment_receipts_guard before insert or update on public.payment_receipts
for each row execute function public.guard_payment_receipt();

create or replace function public.guard_sale_payment_transfer() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.status = 'valid' then
    if new.trans_ref is null or length(trim(new.trans_ref)) = 0 then
      raise exception 'Accepted slip requires a bank transaction reference';
    end if;
    perform public.claim_payment_transfer(new.trans_ref, 'sale', new.id);
  end if;
  return new;
end $$;
drop trigger if exists slips_payment_transfer_guard on public.slips;
create trigger slips_payment_transfer_guard before insert or update on public.slips
for each row execute function public.guard_sale_payment_transfer();

-- Lock before refreshing so expiry/month rollover and credit mutations serialize.
create or replace function public.refresh_broadcast_credits(p_tenant uuid) returns void
language plpgsql set search_path = pg_catalog, public as $$
declare t public.tenants; this_month text := to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM');
begin
  select * into t from public.tenants where id = p_tenant for update;
  if not found then return; end if;
  if t.plan <> 'free' and t.plan_expires_at is not null and t.plan_expires_at <= now() then
    update public.tenants set plan = 'free', plan_expires_at = null, broadcast_allowance = 100,
      broadcast_credits = least(broadcast_credits, 100), broadcast_credit_mode = 'calendar'
    where id = p_tenant;
    t.broadcast_credit_mode := 'calendar';
  end if;
  if t.broadcast_credit_mode = 'calendar' and t.broadcast_period <> this_month then
    update public.tenants set broadcast_credits = broadcast_allowance, broadcast_period = this_month
    where id = p_tenant;
  end if;
end $$;

create or replace function public.reserve_broadcast_credits(p_tenant uuid, p_count integer)
returns table (monthly integer, topup integer)
language plpgsql set search_path = pg_catalog, public as $$
declare t public.tenants; m integer; u integer;
begin
  if p_count is null or p_count <= 0 then return query select 0, 0; return; end if;
  perform public.refresh_broadcast_credits(p_tenant);
  select * into t from public.tenants where id = p_tenant for update;
  if not found or not t.is_active then return query select 0, 0; return; end if;
  m := least(p_count, t.broadcast_credits);
  u := least(p_count - m, t.broadcast_topup_credits);
  update public.tenants set broadcast_credits = broadcast_credits - m,
    broadcast_topup_credits = broadcast_topup_credits - u where id = p_tenant;
  return query select m, u;
end $$;

-- Service callers must refund only their unused reservation, once (lib/billing.ts).
-- Existing RPC has no reservation ID, so duplicate refund requests cannot be deduplicated here.
create or replace function public.refund_broadcast_credits(p_tenant uuid, p_monthly integer, p_topup integer)
returns void language plpgsql set search_path = pg_catalog, public as $$
begin
  perform public.refresh_broadcast_credits(p_tenant);
  update public.tenants set
    broadcast_credits = case when broadcast_credit_mode = 'purchased'
      then broadcast_credits + greatest(coalesce(p_monthly, 0), 0)
      else least(broadcast_allowance, broadcast_credits + greatest(coalesce(p_monthly, 0), 0)) end,
    broadcast_topup_credits = broadcast_topup_credits + greatest(coalesce(p_topup, 0), 0)
  where id = p_tenant;
end $$;

create or replace function public.activate_payment(p_session uuid) returns jsonb
language plpgsql set search_path = pg_catalog, public as $$
declare s public.payment_sessions; r public.payment_receipts; t public.tenants;
begin
  select * into s from public.payment_sessions where id = p_session for update;
  if not found or s.tenant_id is null then raise exception 'Checkout not found'; end if;
  select * into r from public.payment_receipts where session_id = p_session for update;
  if not found then raise exception 'Server-verified payment proof required'; end if;
  if r.amount <> s.price_baht then raise exception 'Payment amount mismatch'; end if;
  if (s.status = 'paid') <> (r.applied_at is not null) then
    raise exception 'Inconsistent payment state';
  end if;
  perform public.refresh_broadcast_credits(s.tenant_id);
  select * into t from public.tenants where id = s.tenant_id for update;
  if not found then raise exception 'Tenant not found'; end if;
  -- Stored proof can be retried after QR expiry; no second credit grant.
  if s.status <> 'paid' then
    update public.tenants set plan = s.plan,
      plan_expires_at = greatest(now(), coalesce(t.plan_expires_at, now())) + interval '720 hours',
      broadcast_credit_mode = 'purchased', broadcast_allowance = s.credits,
      broadcast_credits = broadcast_credits + s.credits,
      broadcast_period = to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM')
    where id = s.tenant_id returning * into t;
    update public.payment_receipts set applied_at = now() where session_id = p_session;
    update public.payment_sessions set status = 'paid', paid_at = now() where id = p_session;
  end if;
  return jsonb_build_object('plan', t.plan, 'planExpiresAt', t.plan_expires_at,
    'monthly', t.broadcast_credits, 'allowance', t.broadcast_allowance, 'topup', t.broadcast_topup_credits);
end $$;

-- Legacy manual plan approvals use the calendar allowance. Top-ups keep the current mode.
create or replace function public.payment_legacy_credit_mode() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.status = 'approved' and old.status <> 'approved' and new.item in ('starter', 'pro') then
    update public.tenants set broadcast_credit_mode = 'purchased' where id = new.tenant_id;
  end if;
  return new;
end $$;
drop trigger if exists billing_requests_credit_mode on public.billing_requests;
create trigger billing_requests_credit_mode after update on public.billing_requests
for each row execute function public.payment_legacy_credit_mode();

-- Payment tables are API-only: getActor/canAccessTenant enforce owner access in the routes.
alter table public.payment_sessions enable row level security;
alter table public.payment_receipts enable row level security;
alter table public.payment_transfer_ledger enable row level security;
revoke all on public.payment_sessions, public.payment_receipts, public.payment_transfer_ledger from public, anon, authenticated, service_role;
grant select, insert, update on public.payment_sessions to service_role;
grant select, insert on public.payment_receipts to service_role;
grant update (applied_at) on public.payment_receipts to service_role;
grant select on public.payment_transfer_ledger to service_role;

revoke all on function public.claim_payment_transfer(text, text, uuid),
  public.guard_payment_receipt(), public.guard_sale_payment_transfer(), public.payment_legacy_credit_mode()
  from public, anon, authenticated, service_role;
revoke all on function public.activate_payment(uuid), public.refresh_broadcast_credits(uuid),
  public.reserve_broadcast_credits(uuid, integer), public.refund_broadcast_credits(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.activate_payment(uuid), public.refresh_broadcast_credits(uuid),
  public.reserve_broadcast_credits(uuid, integer), public.refund_broadcast_credits(uuid, integer, integer)
  to service_role;

commit;
