-- Run after bank-qr-upload.sql and bank-qr-per-account.sql. No existing account/QR is deleted.
begin;
create table if not exists public.bank_account_save_requests (
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 request_id uuid not null,
 actor_id uuid not null,
 fingerprint text not null check(fingerprint ~ '^[0-9a-f]{64}$'),
 result jsonb not null,
 created_at timestamptz not null default now(),
 primary key(tenant_id,request_id)
);
alter table public.bank_account_save_requests enable row level security;
revoke all on public.bank_account_save_requests from public,anon,authenticated;
grant select,insert on public.bank_account_save_requests to service_role;

create or replace function public.save_bank_account_with_qr(
 p_tenant uuid,p_actor uuid,p_account uuid,p_create boolean,p_data jsonb,p_original jsonb,
 p_path text,p_payload text,p_version integer,p_request uuid,p_fingerprint text
) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare account public.bank_accounts; previous public.bank_receiving_qr; cached public.bank_account_save_requests;
 saved uuid; result jsonb; next_version integer;
begin
 if not exists(select 1 from public.tenants where id=p_tenant and is_active) or not (
  exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or
  exists(select 1 from public.platform_admins where user_id=p_actor)
 ) then raise exception 'Forbidden' using errcode='42501';end if;
 if not public.has_tenant_feature(p_tenant,'slip_auto_pilot') then raise exception 'Feature locked' using errcode='42501';end if;
 if p_request is null or p_account is null or p_create is null or p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$'
 then raise exception 'Invalid save request' using errcode='22023';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 select * into cached from public.bank_account_save_requests where tenant_id=p_tenant and request_id=p_request;
 if found then
  if cached.actor_id<>p_actor or cached.fingerprint<>p_fingerprint then raise exception 'Save request changed' using errcode='40001';end if;
  return cached.result;
 end if;
 if p_data->>'bank_code' is null or p_data->>'bank_code' not in ('KBANK','SCB','KTB','BBL','BAY','KKP','CIMB','TTB','TISCO','TCRB','SME','BAAC','EXIM','UOB','LH','GSB','GHB','ICBC') or
  p_data->>'account_name' is null or length(trim(p_data->>'account_name')) not between 1 and 120 or
  p_data->>'account_number' is null or p_data->>'account_number' !~ '^[0-9]{10,15}$' or
  jsonb_typeof(p_data->'is_active') is distinct from 'boolean' or p_version is null or p_version<0
 then raise exception 'Invalid account data' using errcode='22023';end if;
 if (p_path is null)<>(p_payload is null) or (p_path is not null and
  (p_path not like p_tenant::text||'/'||p_account::text||'/%' or p_path like '%..%' or length(p_payload) not between 20 and 2048))
 then raise exception 'Invalid QR' using errcode='22023';end if;
 if p_create then
  if p_original is not null and p_original<>'null'::jsonb then raise exception 'Invalid original account' using errcode='22023';end if;
  if exists(select 1 from public.bank_accounts where id=p_account) then raise exception 'Account already exists' using errcode='40001';end if;
  insert into public.bank_accounts(id,tenant_id,bank_code,account_name,account_number,is_active)
  values(p_account,p_tenant,p_data->>'bank_code',trim(p_data->>'account_name'),p_data->>'account_number',(p_data->>'is_active')::boolean);
 else
  select * into account from public.bank_accounts where tenant_id=p_tenant and id=p_account for update;
  if not found then raise exception 'Account not found' using errcode='P0002';end if;
  if p_original is distinct from jsonb_build_object('bank_code',account.bank_code,'account_name',trim(account.account_name),
   'account_number',account.account_number,'is_active',account.is_active)
  then raise exception 'Account changed' using errcode='40001';end if;
 end if;
 select * into previous from public.bank_receiving_qr where tenant_id=p_tenant and account_id=p_account for update;
 if coalesce(previous.version,0)<>p_version then raise exception 'QR changed' using errcode='40001';end if;
 if previous.account_id is not null and p_path is null and
  (previous.bank_code_snapshot<>p_data->>'bank_code' or previous.account_number_snapshot<>p_data->>'account_number')
 then raise exception 'Upload QR for changed account' using errcode='22023';end if;
 saved:=public.manage_slip_bank_account(p_tenant,p_actor,'save',p_account,p_data,true);
 next_version:=p_version;
 if p_path is not null then
  next_version:=public.save_bank_account_qr(p_tenant,p_actor,p_account,p_data->>'bank_code',p_data->>'account_number',p_path,p_payload,p_version);
 end if;
 result:=jsonb_build_object('id',saved,'version',next_version,'image_path',coalesce(p_path,previous.image_path));
 insert into public.bank_account_save_requests(tenant_id,request_id,actor_id,fingerprint,result)
 values(p_tenant,p_request,p_actor,p_fingerprint,result);
 return result;
end $$;
revoke all on function public.save_bank_account_with_qr(uuid,uuid,uuid,boolean,jsonb,jsonb,text,text,integer,uuid,text) from public,anon,authenticated;
grant execute on function public.save_bank_account_with_qr(uuid,uuid,uuid,boolean,jsonb,jsonb,text,text,integer,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
