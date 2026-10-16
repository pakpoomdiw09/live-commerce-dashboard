-- Additive. Run after payment-receiving-codes.sql. Storage bucket is private.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('payment-qr-assets','payment-qr-assets',false,5242880,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
-- Restrictive policy also blocks broad permissive policies installed elsewhere.
drop policy if exists payment_qr_assets_private on storage.objects;
create policy payment_qr_assets_private on storage.objects as restrictive for all to anon,authenticated
using(bucket_id<>'payment-qr-assets') with check(bucket_id<>'payment-qr-assets');
create table if not exists public.bank_qr_designs(
 account_id uuid primary key references public.bank_accounts(id),
 tenant_id uuid not null references public.tenants(id),
 payload text not null,recipient_snapshot text not null,
 amount_satang bigint check(amount_satang between 1 and 9999999999),
 qr_type text not null default 'promptpay' check(qr_type='promptpay'),
 original_path text,logo_path text,design jsonb not null,
 version integer not null default 1,updated_at timestamptz not null default now(),
 updated_by uuid not null references auth.users(id)
);
alter table public.bank_qr_designs enable row level security;
revoke all on public.bank_qr_designs from public,anon,authenticated;
grant select,insert,update on public.bank_qr_designs to service_role;
create or replace function public.save_bank_qr_design(p_tenant uuid,p_actor uuid,p_account uuid,p_recipient text,p_payload text,p_amount bigint,p_original text,p_logo text,p_design jsonb,p_version integer) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare account public.bank_accounts; current_version integer;
begin
 if not public.has_tenant_feature(p_tenant,'slip_auto_pilot') or not (
 exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Forbidden' using errcode='42501';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 if (select count(*) from public.bank_account_audit where tenant_id=p_tenant and actor_id=p_actor and action='qr_design' and created_at>now()-interval '1 minute')>=20 then raise exception 'Rate limit' using errcode='P0429';end if;
 select * into account from public.bank_accounts where id=p_account and tenant_id=p_tenant for share;
 if not found or not account.is_active or account.bank_code<>'PROMPTPAY' or account.account_number<>p_recipient then raise exception 'Account changed' using errcode='40001';end if;
 select version into current_version from public.bank_qr_designs where account_id=p_account and tenant_id=p_tenant;
 if coalesce(current_version,0)<>p_version then raise exception 'Design changed' using errcode='40001';end if;
 if length(p_payload) not between 20 and 1024 or jsonb_typeof(p_design)<>'object' or
 (p_original is not null and p_original not like p_tenant::text||'/'||p_account::text||'/%') or
 (p_logo is not null and p_logo not like p_tenant::text||'/'||p_account::text||'/%') then raise exception 'Invalid design' using errcode='22023';end if;
 insert into public.bank_qr_designs(account_id,tenant_id,payload,recipient_snapshot,amount_satang,original_path,logo_path,design,updated_by)
 values(p_account,p_tenant,p_payload,p_recipient,p_amount,p_original,p_logo,p_design,p_actor)
 on conflict(account_id) do update set payload=excluded.payload,recipient_snapshot=excluded.recipient_snapshot,amount_satang=excluded.amount_satang,original_path=excluded.original_path,logo_path=excluded.logo_path,design=excluded.design,version=bank_qr_designs.version+1,updated_at=now(),updated_by=p_actor;
 insert into public.bank_account_audit(tenant_id,actor_id,account_id,action,last_four)
 values(p_tenant,p_actor,p_account,'qr_design',right(p_recipient,4));
end $$;
revoke all on function public.save_bank_qr_design(uuid,uuid,uuid,text,text,bigint,text,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.save_bank_qr_design(uuid,uuid,uuid,text,text,bigint,text,text,jsonb,integer) to service_role;
-- No client storage policies: access only through authenticated, tenant-scoped API.
notify pgrst,'reload schema';
commit;
