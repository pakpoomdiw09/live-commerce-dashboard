-- Run after bank-qr-upload.sql. Preserve the previous shop QR and its version.
begin;
do $$ begin
 if exists(select 1 from pg_constraint where conrelid='public.bank_receiving_qr'::regclass
  and contype='p' and pg_get_constraintdef(oid)='PRIMARY KEY (tenant_id)') then
  alter table public.bank_receiving_qr drop constraint bank_receiving_qr_pkey;
  alter table public.bank_receiving_qr add primary key(tenant_id,account_id);
 end if;
end $$;

create or replace function public.save_bank_account_qr(
 p_tenant uuid,p_actor uuid,p_account uuid,p_bank text,p_number text,p_path text,p_payload text,p_version integer
) returns integer language plpgsql set search_path=pg_catalog,public as $$
declare account public.bank_accounts; previous public.bank_receiving_qr; next_version integer;
begin
 if not exists(select 1 from public.tenants where id=p_tenant and is_active) or not (
  exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or
  exists(select 1 from public.platform_admins where user_id=p_actor)
 ) then raise exception 'Forbidden' using errcode='42501';end if;
 if not public.has_tenant_feature(p_tenant,'slip_auto_pilot') then raise exception 'Feature locked' using errcode='42501';end if;
 if p_account is null or p_bank is null or p_number is null or p_path is null or
  p_path not like p_tenant::text||'/'||p_account::text||'/%' or p_path like '%..%' or
  p_payload is null or length(p_payload) not between 20 and 2048 or p_version is null or p_version<0
 then raise exception 'Invalid account QR' using errcode='22023';end if;
 -- Serialize with existing account-edit/toggle/primary RPCs; never change their settings here.
 perform 1 from public.tenants where id=p_tenant for update;
 select * into account from public.bank_accounts where tenant_id=p_tenant and id=p_account for update;
 if not found then raise exception 'Account not found' using errcode='P0002';end if;
 if account.bank_code<>p_bank or account.account_number<>p_number then
  raise exception 'Account changed' using errcode='40001';end if;
 if account.bank_code not in ('KBANK','SCB','KTB','BBL','BAY','KKP','CIMB','TTB','TISCO','TCRB','SME','BAAC','EXIM','UOB','LH','GSB','GHB','ICBC') then
  raise exception 'Unsupported bank' using errcode='22023';end if;
 select * into previous from public.bank_receiving_qr where tenant_id=p_tenant and account_id=p_account for update;
 if coalesce(previous.version,0)<>p_version then raise exception 'QR changed' using errcode='40001';end if;
 next_version:=p_version+1;
 insert into public.bank_receiving_qr(tenant_id,account_id,bank_code_snapshot,account_number_snapshot,image_path,payload,version)
 values(p_tenant,p_account,p_bank,p_number,p_path,p_payload,next_version)
 on conflict(tenant_id,account_id) do update set bank_code_snapshot=excluded.bank_code_snapshot,
  account_number_snapshot=excluded.account_number_snapshot,image_path=excluded.image_path,payload=excluded.payload,
  version=excluded.version,updated_at=now();
 insert into public.bank_account_audit(tenant_id,account_id,actor_id,action,last_four)
 values(p_tenant,p_account,p_actor,'qr_upload',right(account.account_number,4));
 return next_version;
end $$;
revoke all on function public.save_bank_account_qr(uuid,uuid,uuid,text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.save_bank_account_qr(uuid,uuid,uuid,text,text,text,text,integer) to service_role;
notify pgrst,'reload schema';
commit;
