-- Run after bank-accounts.sql, security.sql, smart-inbox.sql and payment-pro.sql.
-- Additive; never sends messages or calls a provider.
begin;
alter table public.bank_accounts add column if not exists is_primary boolean not null default false;
update public.bank_accounts b set is_primary=true where b.id in(select distinct on(tenant_id) id from public.bank_accounts a where is_active and not exists(select 1 from public.bank_accounts p where p.tenant_id=a.tenant_id and p.is_primary) order by tenant_id,created_at,id);
create unique index if not exists bank_accounts_one_primary on public.bank_accounts(tenant_id) where is_primary;
create table if not exists public.bank_account_audit(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),account_id uuid,actor_id uuid references auth.users(id),action text not null,last_four text,created_at timestamptz not null default now());
alter table public.bank_account_audit enable row level security;
revoke all on public.bank_account_audit from public,anon,authenticated;
grant select,insert on public.bank_account_audit to service_role;
create or replace function public.sync_primary_bank_account() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare target uuid;selected public.bank_accounts;
begin
 target:=case when tg_op='DELETE' then old.tenant_id else new.tenant_id end;
 if tg_op='UPDATE' and new.tenant_id<>old.tenant_id then raise exception 'Cannot move bank accounts between shops';end if;
 perform 1 from public.tenants where id=target for update;
 select * into selected from public.bank_accounts where tenant_id=target and is_active order by is_primary desc,created_at,id limit 1;
 update public.tenants set bank_code=selected.bank_code,account_name=selected.account_name,account_number=selected.account_number where id=target;
 return null;
end $$;
-- Browser writes must not bypass confirmation/actor attribution or the atomic primary change.
revoke insert,update,delete on public.bank_accounts from authenticated;
drop policy if exists member_read on public.bank_accounts;
drop policy if exists owner_write on public.bank_accounts;
drop policy if exists owner_read on public.bank_accounts;
create policy owner_read on public.bank_accounts for select to authenticated using(public.can_manage_bank_accounts(tenant_id));
-- Legacy tenant copies must not offer an alternative unmasked browser read.
revoke select(account_number) on public.tenants from authenticated;
create or replace function public.manage_slip_bank_account(p_tenant uuid,p_actor uuid,p_action text,p_id uuid default null,p_data jsonb default '{}',p_confirmed boolean default false) returns uuid
language plpgsql set search_path=pg_catalog,public as $$
declare saved uuid;old_account public.bank_accounts;
begin
 if not exists(select 1 from public.tenants where id=p_tenant and is_active) or not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_confirmed is distinct from true then raise exception 'Confirmation required' using errcode='22023';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 if p_id is not null then select * into old_account from public.bank_accounts where id=p_id and tenant_id=p_tenant for update;if not found then raise exception 'Account not found' using errcode='P0002';end if;end if;
 if p_action='save' then
  if p_id is null then
   insert into public.bank_accounts(tenant_id,bank_code,account_name,account_number,is_active) values(p_tenant,p_data->>'bank_code',p_data->>'account_name',p_data->>'account_number',(p_data->>'is_active')::boolean) returning id into saved;
  else
   update public.bank_accounts set bank_code=p_data->>'bank_code',account_name=p_data->>'account_name',account_number=p_data->>'account_number',is_active=(p_data->>'is_active')::boolean,is_primary=case when (p_data->>'is_active')::boolean then is_primary else false end where id=p_id returning id into saved;
  end if;
 elsif p_action='primary' and old_account.is_active then
  update public.bank_accounts set is_primary=false where tenant_id=p_tenant and is_primary;
  update public.bank_accounts set is_primary=true where id=p_id; saved:=p_id;
 elsif p_action='toggle' and p_id is not null then
  update public.bank_accounts set is_active=not is_active,is_primary=case when is_active then false else is_primary end where id=p_id; saved:=p_id;
 elsif p_action='delete' and p_id is not null then delete from public.bank_accounts where id=p_id;saved:=p_id;
 else raise exception 'Invalid action or inactive primary account' using errcode='22023';end if;
 -- If the primary was disabled/deleted, choose the oldest active account atomically.
 if not exists(select 1 from public.bank_accounts where tenant_id=p_tenant and is_primary and is_active) then
  update public.bank_accounts set is_primary=true where id=(select id from public.bank_accounts where tenant_id=p_tenant and is_active order by created_at,id limit 1);
 end if;
 insert into public.bank_account_audit(tenant_id,account_id,actor_id,action,last_four) values(p_tenant,saved,p_actor,p_action,right(coalesce(p_data->>'account_number',old_account.account_number),4));
 return saved;
end $$;
revoke all on function public.manage_slip_bank_account(uuid,uuid,text,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.manage_slip_bank_account(uuid,uuid,text,uuid,jsonb,boolean) to service_role;
create or replace function public.seed_tenant_bank_account() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 update public.tenants set bank_accounts_migrated=true where id=new.id;
 if new.bank_code in ('KBANK','SCB','BBL','KTB','BAY','TTB','GSB','PROMPTPAY') and new.account_number ~ '^[0-9]{10,15}$' then
  insert into public.bank_accounts(tenant_id,bank_code,account_name,account_number,is_primary)
  values(new.id,new.bank_code,coalesce(nullif(trim(new.account_name),''),new.name),new.account_number,true) on conflict do nothing;
 end if;
 return null;
end $$;
revoke all on function public.seed_tenant_bank_account() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
