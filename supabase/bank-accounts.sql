-- Run after platform-dashboard.sql. Safe to rerun; legacy accounts migrate once.
begin;
alter table public.tenants alter column bank_code drop not null;
alter table public.tenants alter column account_number drop not null;
create table if not exists public.bank_accounts (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
 bank_code text not null check(bank_code in ('KBANK','SCB','BBL','KTB','BAY','TTB','GSB','PROMPTPAY')),
 account_name text not null check(length(trim(account_name)) between 1 and 120),
 account_number text not null check(account_number ~ '^[0-9]{10,15}$'),
 is_active boolean not null default true, created_at timestamptz not null default now(),
 unique(tenant_id,bank_code,account_number)
);
alter table public.bank_accounts enable row level security;
create index if not exists bank_accounts_active on public.bank_accounts(tenant_id,is_active);
create or replace function public.can_manage_bank_accounts(p_tenant uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select public.is_platform_admin() or (public.can_access_tenant(p_tenant) and exists(
 select 1 from public.tenant_members where tenant_id=p_tenant and user_id=auth.uid() and role='owner'))
$$;
revoke all on function public.can_manage_bank_accounts(uuid) from public,anon;
grant execute on function public.can_manage_bank_accounts(uuid) to authenticated;
drop policy if exists member_read on public.bank_accounts;
create policy member_read on public.bank_accounts for select to authenticated using(public.can_access_tenant(tenant_id));
drop policy if exists owner_write on public.bank_accounts;
create policy owner_write on public.bank_accounts for all to authenticated using(public.can_manage_bank_accounts(tenant_id)) with check(public.can_manage_bank_accounts(tenant_id));
revoke all on public.bank_accounts from anon;
grant select,insert,update,delete on public.bank_accounts to authenticated,service_role;
alter table public.tenants add column if not exists bank_accounts_migrated boolean not null default false;
insert into public.bank_accounts(tenant_id,bank_code,account_name,account_number)
 select id,case when bank_code in ('TMB','TTBNK','011') then 'TTB' when bank_code='004' then 'KBANK' when bank_code='014' then 'SCB' when bank_code='002' then 'BBL' when bank_code='006' then 'KTB' when bank_code='025' then 'BAY' when bank_code='030' then 'GSB' else bank_code end,
 left(coalesce(nullif(trim(account_name),''),name),120),regexp_replace(account_number,'[[:space:]-]','','g')
 from public.tenants where not bank_accounts_migrated
 and bank_code in ('KBANK','SCB','BBL','KTB','BAY','TTB','TMB','TTBNK','GSB','PROMPTPAY','004','014','002','006','025','030','011')
 and regexp_replace(account_number,'[[:space:]-]','','g') ~ '^[0-9]{10,15}$'
 on conflict do nothing;
update public.tenants set bank_accounts_migrated=true where not bank_accounts_migrated;

-- The first active account remains available to existing CF payment instructions.
create or replace function public.sync_primary_bank_account() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare target uuid; selected public.bank_accounts;
begin
 target:=case when tg_op='DELETE' then old.tenant_id else new.tenant_id end;
 if tg_op='UPDATE' and new.tenant_id<>old.tenant_id then raise exception 'Cannot move bank accounts between shops'; end if;
 perform 1 from public.tenants where id=target for update;
 select * into selected from public.bank_accounts where tenant_id=target and is_active order by created_at,id limit 1;
 update public.tenants set bank_code=selected.bank_code,account_name=selected.account_name,account_number=selected.account_number where id=target;
 return null;
end $$;
drop trigger if exists bank_accounts_primary on public.bank_accounts;
create trigger bank_accounts_primary after insert or update or delete on public.bank_accounts for each row execute function public.sync_primary_bank_account();
create or replace function public.seed_tenant_bank_account() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 update public.tenants set bank_accounts_migrated=true where id=new.id;
 if new.bank_code in ('KBANK','SCB','BBL','KTB','BAY','TTB','GSB','PROMPTPAY') and new.account_number ~ '^[0-9]{10,15}$' then
 insert into public.bank_accounts(tenant_id,bank_code,account_name,account_number) values(new.id,new.bank_code,coalesce(nullif(trim(new.account_name),''),new.name),new.account_number) on conflict do nothing;
 end if;
 return null;
end $$;
drop trigger if exists tenants_seed_bank_account on public.tenants;
create trigger tenants_seed_bank_account after insert on public.tenants for each row execute function public.seed_tenant_bank_account();
revoke all on function public.sync_primary_bank_account(),public.seed_tenant_bank_account() from public,anon,authenticated;
commit;
