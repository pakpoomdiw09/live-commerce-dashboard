-- Run after security.sql, payments.sql, bank-accounts.sql and facebook-webhook-queue.sql.
-- Does not mark any order/customer paid. Accepted transfers cannot be reused by another payment flow.
begin;

create table if not exists public.standalone_slips (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  trans_ref text not null check(length(trim(trans_ref)) between 1 and 200 and trans_ref=trim(trans_ref)),
  amount numeric(12,2) not null check(amount>0),
  sender_name text,
  sender_bank text,
  receiver_name text,
  receiver_account text,
  trans_timestamp timestamptz not null,
  raw_payload jsonb,
  customer_id uuid references public.customers(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  image_sha256 text check(image_sha256 is null or image_sha256~'^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint uq_standalone_slip_ref unique(tenant_id,trans_ref),
  constraint uq_standalone_slip_image unique(tenant_id,image_sha256)
);
-- Also supports installing over the minimal standalone table from the initial example.
alter table public.standalone_slips add column if not exists customer_id uuid references public.customers(id) on delete set null;
alter table public.standalone_slips add column if not exists message_id uuid references public.messages(id) on delete set null;
alter table public.standalone_slips add column if not exists image_sha256 text check(image_sha256 is null or image_sha256~'^[0-9a-f]{64}$');
create unique index if not exists uq_standalone_slip_image on public.standalone_slips(tenant_id,image_sha256);
create unique index if not exists uq_standalone_slip_ref on public.standalone_slips(tenant_id,trans_ref);
create index if not exists standalone_slips_tenant_created on public.standalone_slips(tenant_id,created_at desc);
alter table public.standalone_slips enable row level security;
revoke all on public.standalone_slips from public,anon,authenticated,service_role;
grant select,insert on public.standalone_slips to service_role;
grant select on public.standalone_slips to authenticated;
drop policy if exists member_read on public.standalone_slips;
create policy member_read on public.standalone_slips for select to authenticated
  using(public.can_access_tenant(tenant_id));

alter table public.payment_transfer_ledger drop constraint if exists payment_transfer_ledger_source_check;
alter table public.payment_transfer_ledger add constraint payment_transfer_ledger_source_check
  check(source in ('package','sale','billing','standalone'));

-- Preserve replay protection if the minimal standalone table already contains accepted proofs.
lock table public.standalone_slips in share row exclusive mode;
insert into public.payment_transfer_ledger(trans_ref,source,source_id)
  select trans_ref,'standalone',id from public.standalone_slips on conflict do nothing;
do $$ begin
  if exists(
    select 1 from public.standalone_slips s left join public.payment_transfer_ledger l on l.trans_ref=s.trans_ref
    where l.source is distinct from 'standalone' or l.source_id is distinct from s.id
  ) then raise exception 'Existing standalone transfers conflict with the payment ledger; review before installing';end if;
end $$;

create or replace function public.guard_standalone_slip() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if not exists(select 1 from public.tenants where id=new.tenant_id and is_active) then
    raise exception 'Standalone tenant is unavailable' using errcode='42501';
  end if;
  if new.customer_id is not null and not exists(
    select 1 from public.customers where id=new.customer_id and tenant_id=new.tenant_id
  ) then raise exception 'Standalone customer scope mismatch' using errcode='42501';end if;
  if new.message_id is not null and not exists(
    select 1 from public.messages m join public.customers c on c.id=m.customer_id
    where m.id=new.message_id and c.id=new.customer_id and c.tenant_id=new.tenant_id
  ) then raise exception 'Standalone message scope mismatch' using errcode='42501';end if;
  perform public.claim_payment_transfer(new.trans_ref,'standalone',new.id);
  return new;
end $$;
drop trigger if exists standalone_slip_transfer_guard on public.standalone_slips;
create trigger standalone_slip_transfer_guard before insert on public.standalone_slips
  for each row execute function public.guard_standalone_slip();
revoke all on function public.guard_standalone_slip() from public,anon,authenticated;

notify pgrst,'reload schema';
commit;
