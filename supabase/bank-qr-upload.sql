-- Run after bank-accounts.sql, slip-bank-controls.sql and bank-registry.sql.
-- One private uploaded QR per shop. Existing accounts and payment evidence are preserved.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('bank-receiving-qr','bank-receiving-qr',false,5242880,array['image/png','image/jpeg'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists bank_receiving_qr_private on storage.objects;
create policy bank_receiving_qr_private on storage.objects as restrictive for all to anon,authenticated
using(bucket_id<>'bank-receiving-qr') with check(bucket_id<>'bank-receiving-qr');

create table if not exists public.bank_receiving_qr (
 tenant_id uuid primary key references public.tenants(id) on delete cascade,
 account_id uuid not null references public.bank_accounts(id),
 bank_code_snapshot text not null,
 account_number_snapshot text not null,
 image_path text not null,
 payload text not null check(length(payload) between 20 and 2048),
 version integer not null check(version>0),
 updated_at timestamptz not null default now()
);
alter table public.bank_receiving_qr enable row level security;
revoke all on public.bank_receiving_qr from public,anon,authenticated;
grant select,insert,update,delete on public.bank_receiving_qr to service_role;

create or replace function public.save_bank_receiving_qr(
 p_tenant uuid,p_actor uuid,p_bank text,p_name text,p_number text,p_path text,p_payload text,p_version integer
) returns integer language plpgsql set search_path=pg_catalog,public as $$
declare previous public.bank_receiving_qr; saved uuid; next_version integer;
begin
 if not exists(select 1 from public.tenants where id=p_tenant and is_active) or not (
  exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or
  exists(select 1 from public.platform_admins where user_id=p_actor)
 ) then raise exception 'Forbidden' using errcode='42501';end if;
 if not public.has_tenant_feature(p_tenant,'slip_auto_pilot') then raise exception 'Feature locked' using errcode='42501';end if;
 if p_bank is null or p_bank not in ('KBANK','SCB','KTB','BBL','BAY','KKP','CIMB','TTB','TISCO','TCRB','SME','BAAC','EXIM','UOB','LH','GSB','GHB','ICBC') or
  p_name is null or length(trim(p_name)) not between 1 and 120 or p_number is null or p_number !~ '^[0-9]{10,15}$' or
  p_path is null or p_path not like p_tenant::text||'/%' or p_path like '%..%' or
  p_payload is null or length(p_payload) not between 20 and 2048 or p_version is null or p_version<0
 then raise exception 'Invalid receiving QR' using errcode='22023';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 select * into previous from public.bank_receiving_qr where tenant_id=p_tenant for update;
 if coalesce(previous.version,0)<>p_version then raise exception 'QR changed' using errcode='40001';end if;
 -- An existing image cannot be silently reattached to a different account.
 if previous.image_path=p_path and (previous.bank_code_snapshot<>p_bank or previous.account_number_snapshot<>p_number or previous.payload<>p_payload)
 then raise exception 'Upload QR for new account' using errcode='22023';end if;
 select id into saved from public.bank_accounts where tenant_id=p_tenant and bank_code=p_bank and account_number=p_number;
 saved:=public.manage_slip_bank_account(p_tenant,p_actor,'save',saved,
  jsonb_build_object('bank_code',p_bank,'account_name',trim(p_name),'account_number',p_number,'is_active',true),true);
 perform public.manage_slip_bank_account(p_tenant,p_actor,'primary',saved,'{}',true);
 next_version:=p_version+1;
 insert into public.bank_receiving_qr(tenant_id,account_id,bank_code_snapshot,account_number_snapshot,image_path,payload,version)
 values(p_tenant,saved,p_bank,p_number,p_path,p_payload,next_version)
 on conflict(tenant_id) do update set account_id=excluded.account_id,bank_code_snapshot=excluded.bank_code_snapshot,
  account_number_snapshot=excluded.account_number_snapshot,image_path=excluded.image_path,payload=excluded.payload,
  version=excluded.version,updated_at=now();
 return next_version;
end $$;
revoke all on function public.save_bank_receiving_qr(uuid,uuid,text,text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.save_bank_receiving_qr(uuid,uuid,text,text,text,text,text,integer) to service_role;
notify pgrst,'reload schema';
commit;
