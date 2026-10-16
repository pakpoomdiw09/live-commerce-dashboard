-- Run LAST after payments.sql, billing-auto-approval.sql, bank-accounts.sql,
-- feature-access.sql and smart-follow-ups.sql. Additive, opt-in only; no network calls.
begin;
create table if not exists public.payment_pro_settings(
 tenant_id uuid primary key references public.tenants(id),enabled boolean not null default false,
 flags jsonb not null default '{}' check(jsonb_typeof(flags)='object')
);
create table if not exists public.payment_pro_attempts(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 customer_id uuid references public.customers(id),slip_id uuid not null unique references public.slips(id) on delete restrict,
 message_id uuid references public.messages(id),proof_sha256 text not null check(proof_sha256~'^[0-9a-f]{64}$'),
 proof_kind text not null check(proof_kind in ('image','qr')),image_path text,
 status text not null default 'PENDING' check(status in ('PENDING','VERIFYING','VERIFIED','REVIEW_REQUIRED','REJECTED','CANCELLED')),
 reason text,order_ids uuid[] not null default '{}',expected_satang bigint,earliest_order_at timestamptz,
 claim_token uuid,claim_until timestamptz,provider_started_at timestamptz,credit_charged boolean not null default false,credit_refunded boolean not null default false,
 local_attempts integer not null default 1 check(local_attempts between 1 and 3),
 evidence jsonb,eligible boolean not null default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(tenant_id,proof_sha256)
);
create table if not exists public.payment_pro_audit(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),attempt_id uuid references public.payment_pro_attempts(id),
 actor_id uuid references auth.users(id),event text not null,reason text,created_at timestamptz not null default now()
);
create index if not exists payment_pro_review_queue on public.payment_pro_attempts(tenant_id,created_at desc) where status='REVIEW_REQUIRED';
create index if not exists payment_pro_recovery on public.payment_pro_attempts(claim_until) where status='VERIFYING';
do $$declare tab text;begin
 foreach tab in array array['payment_pro_settings','payment_pro_attempts','payment_pro_audit'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated',tab);
  execute format('grant select on public.%I to authenticated',tab);
  execute format('grant all on public.%I to service_role',tab);
  execute format('drop policy if exists tenant_read on public.%I',tab);
  execute format('create policy tenant_read on public.%I for select to authenticated using(public.can_access_tenant(tenant_id) and public.has_tenant_feature(tenant_id,''slip_auto_pilot''))',tab);
 end loop;
end $$;
-- Expand only the accepted source vocabulary; retain every prior image claim.
revoke select on public.payment_pro_attempts from authenticated;
grant select(id,tenant_id,customer_id,slip_id,message_id,status,reason,expected_satang,eligible,credit_charged,credit_refunded,provider_started_at,created_at,updated_at) on public.payment_pro_attempts to authenticated;
alter table public.payment_image_ledger drop constraint if exists payment_image_ledger_source_check;
alter table public.payment_image_ledger add constraint payment_image_ledger_source_check check(source in ('package','billing','sale_pro'));

create or replace function public.payment_pro_state_guard() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.status<>old.status and not (
  old.status='PENDING' and new.status in ('VERIFYING','CANCELLED') or
  old.status='VERIFYING' and new.status in ('VERIFIED','REVIEW_REQUIRED','REJECTED') or
  old.status='REVIEW_REQUIRED' and new.status in ('VERIFYING','VERIFIED','REJECTED','CANCELLED')) then
  raise exception 'Invalid payment transition' using errcode='40001';end if;
 if new.tenant_id<>old.tenant_id or new.slip_id<>old.slip_id or new.proof_sha256<>old.proof_sha256 or new.customer_id is distinct from old.customer_id then raise exception 'Payment identity immutable';end if;
 new.updated_at:=now();return new;
end $$;
drop trigger if exists payment_pro_state_guard on public.payment_pro_attempts;
create trigger payment_pro_state_guard before update on public.payment_pro_attempts for each row execute function public.payment_pro_state_guard();
create or replace function public.payment_pro_audit_state() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op='INSERT' or new.status is distinct from old.status or new.reason is distinct from old.reason then
  insert into public.payment_pro_audit(tenant_id,attempt_id,event,reason) values(new.tenant_id,new.id,new.status,new.reason);
 end if;return null;
end $$;
drop trigger if exists payment_pro_audit_state on public.payment_pro_attempts;
create trigger payment_pro_audit_state after insert or update on public.payment_pro_attempts for each row execute function public.payment_pro_audit_state();

create or replace function public.payment_pro_bank(p_bank text) returns text language sql immutable set search_path=pg_catalog,public as $$
 select case upper(trim(p_bank)) when 'KBANK' then '004' when 'SCB' then '014' when 'BBL' then '002' when 'KTB' then '006' when 'BAY' then '025' when 'TTB' then '011' when 'TMB' then '011' when 'TTBNK' then '011' when 'GSB' then '030' else case when trim(p_bank)~'^[0-9]{1,3}$' then lpad(trim(p_bank),3,'0') else upper(trim(p_bank)) end end
$$;
create or replace function public.payment_pro_account(p_full text,p_mask text) returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
declare full_no text:=regexp_replace(coalesce(p_full,''),'[^0-9]','','g');masked text:=lower(regexp_replace(replace(coalesce(p_mask,''),'*','x'),'[^0-9xX]','','g'));i integer;parts text[];
begin
 if length(regexp_replace(masked,'x','','g'))<3 or full_no='' then return false;end if;
 if length(full_no)=length(masked) then
  for i in 1..length(masked) loop if substr(masked,i,1)<>'x' and substr(masked,i,1)<>substr(full_no,i,1) then return false;end if;end loop;return true;
 end if;
 parts:=regexp_match(masked,'^([0-9]*)x+([0-9]*)$');
 return coalesce(parts is not null and length(parts[1])+length(parts[2])<=length(full_no) and starts_with(full_no,parts[1]) and right(full_no,length(parts[2]))=parts[2],false);
end $$;
create or replace function public.payment_pro_receiver(p_tenant uuid,p_bank text,p_account text,p_proxy text) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.bank_accounts b where b.tenant_id=p_tenant and b.is_active and
  case when b.bank_code='PROMPTPAY' then public.payment_pro_account(b.account_number,regexp_replace(regexp_replace(coalesce(p_proxy,''),'[[:space:]-]','','g'),'^(\+?66|0066)(?=[0-9xX*]{9}$)','0'))
  else public.payment_pro_bank(b.bank_code)=public.payment_pro_bank(p_bank) and public.payment_pro_account(b.account_number,p_account) end)
$$;

create or replace function public.claim_payment_pro(p_tenant uuid,p_customer uuid,p_message uuid,p_hash text,p_image text,p_kind text) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare a public.payment_pro_attempts;slip uuid;ids uuid[];total bigint;earliest timestamptz;token uuid:=gen_random_uuid();
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if not public.has_tenant_feature(p_tenant,'slip_auto_pilot') or not exists(select 1 from public.payment_pro_settings where tenant_id=p_tenant and enabled and flags->'riskEngine'='true'::jsonb) then raise exception 'FEATURE_LOCKED' using errcode='42501';end if;
 if p_customer is not null and not exists(select 1 from public.customers where id=p_customer and tenant_id=p_tenant) or p_message is not null and not exists(select 1 from public.messages where id=p_message and customer_id=p_customer) then raise exception 'Invalid tenant references' using errcode='42501';end if;
 select * into a from public.payment_pro_attempts where tenant_id=p_tenant and proof_sha256=p_hash;
 if found then return jsonb_build_object('id',a.id,'slip_id',a.slip_id,'customer_id',a.customer_id,'claim_token',null,'image_path',a.image_path);end if;
 perform 1 from public.customers where id=p_customer and tenant_id=p_tenant for update;
 perform 1 from public.orders where tenant_id=p_tenant and customer_id=p_customer and status='pending_payment' order by id for update;
 select array_agg(id order by id),sum(amount*100)::bigint,min(created_at) into ids,total,earliest from public.orders where tenant_id=p_tenant and customer_id=p_customer and status='pending_payment';
 insert into public.slips(tenant_id,customer_id,message_id,image_path,expected_amount) values(p_tenant,p_customer,p_message,p_image,total::numeric/100) returning id into slip;
 insert into public.payment_pro_attempts(tenant_id,customer_id,message_id,slip_id,proof_sha256,proof_kind,image_path,status,order_ids,expected_satang,earliest_order_at,claim_token,claim_until)
 values(p_tenant,p_customer,p_message,slip,p_hash,p_kind,p_image,'VERIFYING',coalesce(ids,'{}'),total,earliest,token,clock_timestamp()+interval '3 minutes') returning * into a;
 return to_jsonb(a);
end $$;
create or replace function public.start_payment_pro_provider(p_attempt uuid,p_claim uuid) returns boolean language plpgsql set search_path=pg_catalog,public as $$
declare a public.payment_pro_attempts;
begin
 select * into a from public.payment_pro_attempts where id=p_attempt;
 if not found then return false;end if;
 perform 1 from public.tenants where id=a.tenant_id for update;
 select * into a from public.payment_pro_attempts where id=p_attempt for update;
 if a.status<>'VERIFYING' or a.claim_token is distinct from p_claim or a.claim_until<=clock_timestamp() or a.provider_started_at is not null then return false;end if;
 if not public.has_tenant_feature(a.tenant_id,'slip_auto_pilot') or not exists(select 1 from public.payment_pro_settings where tenant_id=a.tenant_id and enabled and flags->'riskEngine'='true'::jsonb) then
  update public.payment_pro_attempts set status='REVIEW_REQUIRED',reason='FEATURE_DISABLED' where id=a.id;
  update public.slips set status='error',note='Payment Pro ถูกปิดหรือแพ็กเกจหมดอายุ',verified_at=now() where id=a.slip_id;return false;
 end if;
 if not public.consume_slip_credit(a.tenant_id) then
  update public.payment_pro_attempts set status='REVIEW_REQUIRED',reason='INSUFFICIENT_CREDITS' where id=a.id;
  update public.slips set status='error',note='เครดิตตรวจสลิปหมด กรุณาเติมเครดิต',verified_at=now() where id=a.slip_id;return false;
 end if;
 update public.payment_pro_attempts set provider_started_at=clock_timestamp(),credit_charged=true where id=a.id;return true;
end $$;

-- Apply only the snapshotted orders, under locks. Ledger + order + customer + follow-up commit together.
create or replace function public.apply_payment_pro(p_attempt uuid,p_actor uuid default null) returns boolean language plpgsql set search_path=pg_catalog,public as $$
declare a public.payment_pro_attempts;total bigint;count_orders integer;matched boolean;
begin
 select * into a from public.payment_pro_attempts where id=p_attempt;
 if not found then return false;end if;
 perform 1 from public.tenants where id=a.tenant_id for update;
 perform 1 from public.customers where id=a.customer_id and tenant_id=a.tenant_id for update;
 select * into a from public.payment_pro_attempts where id=p_attempt for update;
 if a.status='VERIFIED' then return true;end if;
 if a.status not in ('VERIFYING','REVIEW_REQUIRED') or not a.eligible or not public.has_tenant_feature(a.tenant_id,'slip_auto_pilot') then return false;end if;
 if not exists(select 1 from public.payment_pro_settings where tenant_id=a.tenant_id and enabled and flags->'riskEngine'='true'::jsonb) then return false;end if;
 if p_actor is null then
  if not exists(select 1 from public.payment_pro_settings where tenant_id=a.tenant_id and enabled and flags->'riskEngine'='true'::jsonb and flags->'autoConfirmation'='true'::jsonb and flags->'orderMatching'='true'::jsonb) then return false;end if;
 elsif not(exists(select 1 from public.tenant_members where tenant_id=a.tenant_id and user_id=p_actor and role='owner') or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Owner required' using errcode='42501';end if;
 matched:=public.payment_pro_receiver(a.tenant_id,a.evidence->>'receiver_bank',a.evidence->>'receiver_account',a.evidence->>'receiver_proxy');
 if not matched then update public.payment_pro_attempts set eligible=false,reason='RECEIVER_CHANGED' where id=a.id;return false;end if;
 perform 1 from public.orders where id=any(a.order_ids) order by id for update;
 select count(*),sum(amount*100)::bigint into count_orders,total from public.orders where id=any(a.order_ids) and tenant_id=a.tenant_id and customer_id=a.customer_id and status='pending_payment';
 if count_orders=0 or count_orders<>cardinality(a.order_ids) or total<>a.expected_satang or total<>(a.evidence->>'amount_satang')::bigint then
  update public.payment_pro_attempts set eligible=false,reason='ORDER_CHANGED' where id=a.id;return false;end if;
 begin
  perform public.claim_payment_transfer(a.evidence->>'trans_ref','sale',a.slip_id);
  if a.proof_kind='image' then perform public.claim_payment_image(a.proof_sha256,'sale_pro',a.slip_id);end if;
  update public.payment_pro_attempts set status='VERIFIED',reason='ALL_CHECKS_PASSED',claim_token=null,claim_until=null where id=a.id;
  update public.slips set status='valid',note=null,approved_at=coalesce(approved_at,now()),approved_by=p_actor where id=a.slip_id;
  update public.orders set status='paid',paid_at=coalesce(paid_at,now()),slip_id=a.slip_id where id=any(a.order_ids) and tenant_id=a.tenant_id and customer_id=a.customer_id and status='pending_payment';
  update public.customers set order_status='paid' where id=a.customer_id and tenant_id=a.tenant_id;
  -- Existing paid-order triggers always cancel payment reminders; never disable this safety.
  update public.follow_up_jobs set status='cancelled',reason='paid' where tenant_id=a.tenant_id and order_id=any(a.order_ids) and kind='payment' and (status in ('scheduled','pending','requires_review') or status='processing' and dispatch_started_at is null);
  insert into public.payment_pro_audit(tenant_id,attempt_id,actor_id,event,reason) values(a.tenant_id,a.id,p_actor,'payment_applied','server_verified_proof');
  return true;
 exception when unique_violation then
  update public.payment_pro_attempts set status='REJECTED',reason='DUPLICATE_TRANSACTION',eligible=false,claim_token=null,claim_until=null where id=a.id;
  update public.slips set status='duplicate',note='หลักฐานนี้ถูกใช้ชำระเงินแล้ว' where id=a.slip_id;return false;
 end;
end $$;

create or replace function public.complete_payment_pro(p_attempt uuid,p_claim uuid,p_evidence jsonb) returns void language plpgsql set search_path=pg_catalog,public as $$
<<completion>>
declare a public.payment_pro_attempts;reason text;paid timestamptz;amount bigint;valid boolean;applied boolean;
begin
 select * into a from public.payment_pro_attempts where id=p_attempt;
 if not found then raise exception 'Attempt not found';end if;
 perform 1 from public.tenants where id=a.tenant_id for update;
 perform 1 from public.customers where id=a.customer_id and tenant_id=a.tenant_id for update;
 select * into a from public.payment_pro_attempts where id=p_attempt for update;
 if a.status<>'VERIFYING' or a.claim_token is distinct from p_claim or a.provider_started_at is null or a.evidence is not null then return;end if;
 amount:=(p_evidence->>'amount_satang')::bigint;paid:=(p_evidence->>'paid_at')::timestamptz;
 if p_evidence->>'provider_verdict'='duplicate' or exists(select 1 from public.payment_transfer_ledger where trans_ref=p_evidence->>'trans_ref' and source_id<>a.slip_id) then reason:='DUPLICATE_TRANSACTION';
 elsif coalesce((p_evidence->>'provider_fault')::boolean,false) then reason:='PROVIDER_ERROR';
 elsif not coalesce((p_evidence->>'provider_verified')::boolean,false) then reason:='NOT_PROVIDER_VERIFIED';
 elsif nullif(trim(p_evidence->>'trans_ref'),'') is null or length(p_evidence->>'trans_ref')>200 then reason:='MISSING_TRANSACTION_REFERENCE';
 elsif a.expected_satang is null or a.expected_satang<=0 or cardinality(a.order_ids)=0 then reason:='ORDER_REQUIRED';
 elsif amount is null or amount<=0 or amount<>a.expected_satang then reason:='AMOUNT_MISMATCH';
 elsif not public.payment_pro_receiver(a.tenant_id,p_evidence->>'receiver_bank',p_evidence->>'receiver_account',p_evidence->>'receiver_proxy') then reason:='RECEIVER_NOT_CONFIRMED';
 elsif paid is null or paid<clock_timestamp()-interval '24 hours' or paid>clock_timestamp()+interval '2 minutes' or paid<a.earliest_order_at-interval '2 minutes' then reason:='PAYMENT_TIME_INVALID';end if;
 if coalesce((p_evidence->>'provider_fault')::boolean,false) and a.credit_charged and not a.credit_refunded then
  perform public.refund_slip_credit(a.tenant_id);update public.payment_pro_attempts set credit_refunded=true where id=a.id;
 end if;
 valid:=reason is null;
 update public.payment_pro_attempts set evidence=p_evidence,eligible=valid,reason=completion.reason where id=a.id;
 update public.slips set amount=completion.amount::numeric/100,trans_ref=p_evidence->>'trans_ref',raw=p_evidence->'raw',verified_at=now() where id=a.slip_id;
 if valid and coalesce((p_evidence->>'auto_permitted')::boolean,false) then applied:=public.apply_payment_pro(a.id,null);end if;
 if not coalesce(applied,false) then
  -- apply may already have rejected a unique ledger conflict.
  update public.payment_pro_attempts set status=case when completion.reason='DUPLICATE_TRANSACTION' then 'REJECTED' else 'REVIEW_REQUIRED' end,reason=coalesce(payment_pro_attempts.reason,'AUTO_CONFIRM_DISABLED'),claim_token=null,claim_until=null where id=a.id and status='VERIFYING';
  update public.slips set status=case when completion.reason='DUPLICATE_TRANSACTION' then 'duplicate' when completion.reason='AMOUNT_MISMATCH' then 'amount_mismatch' when completion.reason='RECEIVER_NOT_CONFIRMED' then 'wrong_receiver' else 'error' end,note='Payment Pro: '||coalesce(completion.reason,'รอเจ้าของร้านอนุมัติ') where id=a.slip_id and status<>'duplicate';
  update public.customers set order_status='pending_review' where id=a.customer_id and tenant_id=a.tenant_id;
 end if;
end $$;
create or replace function public.review_payment_pro_failure(p_attempt uuid,p_claim uuid) returns void language plpgsql set search_path=pg_catalog,public as $$
declare a public.payment_pro_attempts;
begin
 select * into a from public.payment_pro_attempts where id=p_attempt for update;
 if found and a.status='VERIFYING' and a.claim_token=p_claim then
  update public.payment_pro_attempts set status='REVIEW_REQUIRED',reason=case when provider_started_at is null then 'PROCESSING_FAILED_BEFORE_PROVIDER' else 'PROVIDER_RESULT_UNKNOWN' end,claim_token=null,claim_until=null where id=a.id;
  update public.slips set status='error',note='รอตรวจสอบเพิ่มเติม ระบบไม่ลองเรียก Provider ซ้ำอัตโนมัติ',verified_at=now() where id=a.slip_id;
 end if;
end $$;
create or replace function public.recover_payment_pro() returns integer language plpgsql set search_path=pg_catalog,public as $$
declare a public.payment_pro_attempts;n integer:=0;
begin
 for a in select * from public.payment_pro_attempts where status='VERIFYING' and claim_until<clock_timestamp() for update skip locked loop
  perform public.review_payment_pro_failure(a.id,a.claim_token);n:=n+1;
 end loop;return n;
end $$;
create or replace function public.act_payment_pro(p_attempt uuid,p_tenant uuid,p_actor uuid,p_action text,p_reason text) returns boolean language plpgsql set search_path=pg_catalog,public as $$
declare a public.payment_pro_attempts;applied boolean;
begin
 if not public.has_tenant_feature(p_tenant,'slip_auto_pilot') or not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Owner required' using errcode='42501';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 select * into a from public.payment_pro_attempts where id=p_attempt and tenant_id=p_tenant for update;
 if not found then raise exception 'Attempt not found' using errcode='P0002';end if;
 if length(trim(coalesce(p_reason,''))) not between 5 and 1000 then raise exception 'Review reason required' using errcode='22023';end if;
 if p_action='approve' then applied:=public.apply_payment_pro(a.id,p_actor);
 elsif p_action='retry' and a.status='REVIEW_REQUIRED' and a.provider_started_at is null and not a.credit_charged and a.proof_kind='image' and a.image_path is not null and a.local_attempts<3 then
  update public.payment_pro_attempts set status='VERIFYING',reason=null,claim_token=gen_random_uuid(),claim_until=clock_timestamp()+interval '3 minutes',local_attempts=local_attempts+1 where id=a.id;
  update public.slips set status='pending',note=null,verified_at=null where id=a.slip_id;applied:=true;
 elsif a.status='REVIEW_REQUIRED' and p_action in ('reject','cancel') then
  update public.payment_pro_attempts set status=case when p_action='reject' then 'REJECTED' else 'CANCELLED' end,reason='MANUAL_'||upper(p_action),eligible=false where id=a.id;
  update public.slips set status='error',note=p_reason where id=a.slip_id;applied:=true;
 else return false;end if;
 insert into public.payment_pro_audit(tenant_id,attempt_id,actor_id,event,reason) values(p_tenant,a.id,p_actor,'manual_'||p_action,p_reason);
 return applied;
end $$;
-- A legacy approval endpoint/browser write cannot bypass the Pro proof transaction.
create or replace function public.payment_pro_overview(p_tenant uuid) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('total',count(*),'verified',count(*) filter(where status='VERIFIED'),'review',count(*) filter(where status='REVIEW_REQUIRED'),
 'duplicates',count(*) filter(where reason='DUPLICATE_TRANSACTION'),'amountMismatch',count(*) filter(where reason='AMOUNT_MISMATCH'),
 'receiverMismatch',count(*) filter(where reason in ('RECEIVER_NOT_CONFIRMED','RECEIVER_CHANGED')),
 'charged',count(*) filter(where credit_charged),'refunded',count(*) filter(where credit_refunded),
 'verifiedSatang',coalesce(sum(expected_satang) filter(where status='VERIFIED'),0))
 from public.payment_pro_attempts where tenant_id=p_tenant and created_at>now()-interval '30 days'
$$;
create or replace function public.guard_payment_pro_slip() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if (new.status='valid' or new.approved_at is not null) and exists(select 1 from public.payment_pro_attempts where slip_id=new.id and status<>'VERIFIED') then raise exception 'Payment Pro proof approval required' using errcode='42501';end if;return new;
end $$;
drop trigger if exists slips_payment_pro_guard on public.slips;
create trigger slips_payment_pro_guard before update on public.slips for each row execute function public.guard_payment_pro_slip();
create or replace function public.guard_payment_pro_order() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.status='paid' and (old.status is distinct from new.status or old.slip_id is distinct from new.slip_id) and exists(select 1 from public.payment_pro_attempts where slip_id=new.slip_id) and not exists(select 1 from public.payment_pro_attempts a where a.slip_id=new.slip_id and a.status='VERIFIED' and a.tenant_id=new.tenant_id and a.customer_id=new.customer_id and new.id=any(a.order_ids)) then
  raise exception 'Payment Pro order snapshot required' using errcode='42501';end if;return new;
end $$;
drop trigger if exists orders_payment_pro_guard on public.orders;
create trigger orders_payment_pro_guard before update of status,slip_id on public.orders for each row execute function public.guard_payment_pro_order();
-- Every execution primitive is service-only, including helper functions with account information.
do $$declare fn record;begin
 for fn in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like '%payment_pro%' or p.proname in ('payment_pro_bank','payment_pro_account','payment_pro_receiver')) loop
  execute format('revoke all on function %s from public,anon,authenticated',fn.signature);
  execute format('grant execute on function %s to service_role',fn.signature);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
