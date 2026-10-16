-- Run LAST after payments.sql, billing-slip-topups.sql, admin-feature-bypass.sql,
-- and platform-dashboard.sql. Service-only verification; safe to rerun.
begin;
alter table public.billing_requests add column if not exists receiver_promptpay_id text;
alter table public.billing_requests add column if not exists receiver_account_no text;
alter table public.billing_requests add column if not exists receiver_bank_code text;
alter table public.billing_requests add column if not exists verification_status text not null default 'pending'
  check (verification_status in ('pending','failed','verified'));
alter table public.billing_requests add column if not exists verification_error text;
alter table public.billing_requests add column if not exists proof_sha256 text check (proof_sha256 ~ '^[0-9a-f]{64}$');

alter table public.payment_transfer_ledger drop constraint if exists payment_transfer_ledger_source_check;
alter table public.payment_transfer_ledger add constraint payment_transfer_ledger_source_check
  check (source in ('package','sale','billing'));

create table if not exists public.payment_image_ledger (
  image_sha256 text primary key check (image_sha256 ~ '^[0-9a-f]{64}$'),
  source text not null check (source in ('package','billing')),
  source_id uuid not null,
  created_at timestamptz not null default now()
);
alter table public.payment_image_ledger enable row level security;
revoke all on public.payment_image_ledger from anon,authenticated;
grant select,insert on public.payment_image_ledger to service_role;
lock table public.payment_receipts in share row exclusive mode;
insert into public.payment_image_ledger(image_sha256,source,source_id)
  select image_sha256,'package',session_id from public.payment_receipts on conflict do nothing;
do $$ begin
  if exists(select 1 from public.payment_receipts r join public.payment_image_ledger l using(image_sha256)
    where l.source <> 'package' or l.source_id <> r.session_id) then
    raise exception 'Existing image proof conflicts';
  end if;
end $$;

create or replace function public.claim_payment_image(p_hash text,p_source text,p_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog,public as $$
begin
  insert into public.payment_image_ledger(image_sha256,source,source_id) values(p_hash,p_source,p_id) on conflict do nothing;
  if not exists(select 1 from public.payment_image_ledger where image_sha256=p_hash and source=p_source and source_id=p_id) then
    raise exception 'Image already accepted' using errcode='23505';
  end if;
end $$;
create or replace function public.guard_package_payment_image() returns trigger
language plpgsql security definer set search_path = pg_catalog,public as $$
begin
  perform public.claim_payment_image(new.image_sha256,'package',new.session_id);
  return new;
end $$;
drop trigger if exists payment_receipts_image_guard on public.payment_receipts;
create trigger payment_receipts_image_guard before insert on public.payment_receipts
for each row execute function public.guard_package_payment_image();

-- QR package checkouts also accept overpayment, retaining all other proof guards.
do $$ declare definition text; begin
  definition := pg_get_functiondef('public.guard_payment_receipt()'::regprocedure);
  execute replace(definition,'new.amount <> s.price_baht','new.amount < s.price_baht');
  definition := pg_get_functiondef('public.activate_payment(uuid)'::regprocedure);
  execute replace(definition,'r.amount <> s.price_baht','r.amount < s.price_baht');
end $$;

create table if not exists public.billing_payment_receipts (
  request_id uuid primary key references public.billing_requests(id) on delete restrict,
  trans_ref text not null unique check (length(trim(trans_ref)) between 1 and 200 and trans_ref=trim(trans_ref)),
  image_sha256 text not null unique check (image_sha256 ~ '^[0-9a-f]{64}$'),
  amount numeric(12,2) not null check (amount>0),
  paid_at timestamptz not null,
  verified_at timestamptz not null default now(),
  applied_at timestamptz
);
alter table public.billing_payment_receipts enable row level security;
revoke all on public.billing_payment_receipts from anon,authenticated;
grant select,insert,update on public.billing_payment_receipts to service_role;

create or replace function public.guard_billing_payment_receipt() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.billing_requests;
begin
  if tg_op='UPDATE' then
    if new.request_id is distinct from old.request_id or new.trans_ref is distinct from old.trans_ref
      or new.image_sha256 is distinct from old.image_sha256 or new.amount is distinct from old.amount
      or new.paid_at is distinct from old.paid_at or new.verified_at is distinct from old.verified_at
      or (old.applied_at is not null and new.applied_at is distinct from old.applied_at) then
      raise exception 'Verified billing proof is immutable';
    end if;
    return new;
  end if;
  select * into r from public.billing_requests where id=new.request_id for update;
  if not found or r.status<>'pending' or r.proof_path is null then raise exception 'Request is not payable'; end if;
  if new.amount<r.price_baht or new.applied_at is not null
    or (r.proof_sha256 is not null and new.image_sha256<>r.proof_sha256)
    or new.paid_at<r.created_at-interval '2 minutes' or new.paid_at>clock_timestamp()+interval '2 minutes' then
    raise exception 'Payment amount or transfer time invalid';
  end if;
  perform public.claim_payment_transfer(new.trans_ref,'billing',new.request_id);
  perform public.claim_payment_image(new.image_sha256,'billing',new.request_id);
  return new;
end $$;
drop trigger if exists billing_payment_receipts_guard on public.billing_payment_receipts;
create trigger billing_payment_receipts_guard before insert or update on public.billing_payment_receipts
for each row execute function public.guard_billing_payment_receipt();

-- A manual approval also consumes its uploaded image, even when Provider verification failed.
create or replace function public.guard_billing_approved_image() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.status='approved' and old.status<>'approved' and new.proof_sha256 is not null then
    perform public.claim_payment_image(new.proof_sha256,'billing',new.id);
  end if;
  return new;
end $$;
drop trigger if exists billing_requests_approved_image_guard on public.billing_requests;
create trigger billing_requests_approved_image_guard before update on public.billing_requests
for each row execute function public.guard_billing_approved_image();

create or replace function public.activate_billing_payment(p_request uuid) returns boolean
language plpgsql set search_path=pg_catalog,public as $$
declare r public.billing_requests; proof public.billing_payment_receipts; refused text;
begin
  select * into r from public.billing_requests where id=p_request for update;
  if not found then raise exception 'Request not found'; end if;
  select * into proof from public.billing_payment_receipts where request_id=p_request for update;
  if not found then raise exception 'Server-verified proof required'; end if;
  if r.status='approved' then
    update public.billing_requests set verification_status='verified',verification_error=null where id=p_request;
    update public.billing_payment_receipts set applied_at=coalesce(applied_at,now()) where request_id=p_request;
    return true;
  end if;
  if r.status<>'pending' then raise exception 'Request is no longer pending'; end if;
  if not exists(select 1 from public.tenants where id=r.tenant_id and is_active) then raise exception 'Tenant inactive'; end if;
  refused := public.approve_billing_request(p_request,null);
  if refused is not null then raise exception '%',refused; end if;
  update public.billing_requests set verification_status='verified',verification_error=null where id=p_request;
  update public.billing_payment_receipts set applied_at=now() where request_id=p_request;
  return true;
end $$;
revoke all on function public.activate_billing_payment(uuid),public.claim_payment_image(text,text,uuid),
  public.guard_package_payment_image(),public.guard_billing_payment_receipt(),public.guard_billing_approved_image() from public,anon,authenticated;
grant execute on function public.activate_billing_payment(uuid) to service_role;
commit;
