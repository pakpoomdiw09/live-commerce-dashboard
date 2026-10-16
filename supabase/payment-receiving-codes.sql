-- Additive; run after slip-bank-controls.sql, orders.sql and feature-access.sql.
-- QR creation never verifies payment, modifies an order or consumes any credit.
begin;
create table if not exists public.payment_receiving_codes(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 account_id uuid not null references public.bank_accounts(id),actor_id uuid not null references auth.users(id),
 request_id uuid not null,label text not null check(length(trim(label)) between 1 and 100),
 payload text not null check(length(payload) between 20 and 1024),
 recipient_snapshot text not null,amount_satang bigint check(amount_satang between 1 and 9999999999),
 order_id uuid references public.orders(id),source text not null check(source in ('generated','imported')),
 is_active boolean not null default true,created_at timestamptz not null default now(),
 unique(tenant_id,actor_id,request_id)
);
create index if not exists receiving_codes_shop on public.payment_receiving_codes(tenant_id,created_at desc);
create table if not exists public.payment_receiving_audit(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 code_id uuid not null references public.payment_receiving_codes(id),actor_id uuid not null references auth.users(id),
 action text not null,created_at timestamptz not null default now()
);
alter table public.payment_receiving_codes enable row level security;
alter table public.payment_receiving_audit enable row level security;
revoke all on public.payment_receiving_codes,public.payment_receiving_audit from public,anon,authenticated;
grant select,insert,update on public.payment_receiving_codes to service_role;
grant select,insert on public.payment_receiving_audit to service_role;

create or replace function public.save_payment_receiving_code(p_tenant uuid,p_actor uuid,p_key uuid,p_account uuid,p_label text,p_payload text,p_recipient text,p_amount bigint,p_order uuid default null,p_source text default 'generated') returns uuid
language plpgsql set search_path=pg_catalog,public as $$
declare account public.bank_accounts;existing public.payment_receiving_codes;saved uuid;order_amount numeric;
begin
 if not public.has_tenant_feature(p_tenant,'slip_auto_pilot') or not (
  exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or exists(select 1 from public.platform_admins where user_id=p_actor)
 ) then raise exception 'Forbidden' using errcode='42501';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 if p_key is null or p_account is null or p_recipient is null or p_label is null or length(trim(p_label)) not between 1 and 100 or p_payload is null or length(p_payload) not between 20 and 1024 or p_source is null or p_source not in ('generated','imported') or p_amount is not null and p_amount not between 1 and 9999999999 then raise exception 'Invalid QR' using errcode='22023';end if;
 select * into existing from public.payment_receiving_codes where tenant_id=p_tenant and actor_id=p_actor and request_id=p_key;
 if found then
  if existing.account_id<>p_account or existing.recipient_snapshot<>p_recipient or existing.label<>trim(p_label) or existing.payload<>p_payload or existing.amount_satang is distinct from p_amount or existing.order_id is distinct from p_order or existing.source<>p_source then raise exception 'Request key reused' using errcode='22023';end if;
  return existing.id;
 end if;
 if (select count(*) from public.payment_receiving_codes where tenant_id=p_tenant and actor_id=p_actor and created_at>now()-interval '1 minute')>=20 then raise exception 'Rate limit' using errcode='P0429';end if;
 select * into account from public.bank_accounts where id=p_account and tenant_id=p_tenant for share;
 if not found or not account.is_active or account.bank_code<>'PROMPTPAY' then raise exception 'Active registered PromptPay required' using errcode='22023';end if;
 if account.account_number<>p_recipient then raise exception 'Receiving account changed' using errcode='40001';end if;
 if p_order is not null then
  select amount into order_amount from public.orders where id=p_order and tenant_id=p_tenant and status='pending_payment' for share;
  if not found or p_amount is null or order_amount*100<>p_amount then raise exception 'Order changed' using errcode='40001';end if;
 end if;
 insert into public.payment_receiving_codes(tenant_id,account_id,actor_id,request_id,label,payload,recipient_snapshot,amount_satang,order_id,source)
  values(p_tenant,p_account,p_actor,p_key,trim(p_label),p_payload,account.account_number,p_amount,p_order,p_source) returning id into saved;
 insert into public.payment_receiving_audit(tenant_id,code_id,actor_id,action) values(p_tenant,saved,p_actor,p_source);
 return saved;
end $$;
create or replace function public.set_payment_receiving_code_active(p_tenant uuid,p_actor uuid,p_id uuid,p_active boolean) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare current_state boolean;
begin
 if p_active is null or not public.has_tenant_feature(p_tenant,'slip_auto_pilot') or not (
  exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or exists(select 1 from public.platform_admins where user_id=p_actor)
 ) then raise exception 'Forbidden' using errcode='42501';end if;
 select is_active into current_state from public.payment_receiving_codes where id=p_id and tenant_id=p_tenant for update;
 if not found then raise exception 'Not found' using errcode='P0002';end if;
 if current_state=p_active then return;end if;
 update public.payment_receiving_codes set is_active=p_active where id=p_id;
 insert into public.payment_receiving_audit(tenant_id,code_id,actor_id,action) values(p_tenant,p_id,p_actor,case when p_active then 'enabled' else 'disabled' end);
end $$;
revoke all on function public.save_payment_receiving_code(uuid,uuid,uuid,uuid,text,text,text,bigint,uuid,text),public.set_payment_receiving_code_active(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.save_payment_receiving_code(uuid,uuid,uuid,uuid,text,text,text,bigint,uuid,text),public.set_payment_receiving_code_active(uuid,uuid,uuid,boolean) to service_role;
notify pgrst,'reload schema';
commit;
