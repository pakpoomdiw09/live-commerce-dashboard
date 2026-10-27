-- Run after smart-inbox.sql and agent-control.sql (and full-access.sql if used).
-- Rerunnable. Keeps existing quota values; does not replay messages or reset a period.
begin;
alter table public.tenants add column if not exists ai_quota_limit integer default 1000;
alter table public.tenants add column if not exists ai_quota_used integer default 0;
alter table public.tenants alter column ai_quota_limit set default 1000;
alter table public.tenants alter column ai_quota_used set default 0;
update public.tenants set ai_quota_limit=coalesce(ai_quota_limit,1000),ai_quota_used=coalesce(ai_quota_used,0)
 where ai_quota_limit is null or ai_quota_used is null;
alter table public.tenants alter column ai_quota_limit set not null;
alter table public.tenants alter column ai_quota_used set not null;
do $$begin
 if not exists(select 1 from pg_constraint where conrelid='public.tenants'::regclass and conname='tenants_ai_quota_nonnegative') then
  alter table public.tenants add constraint tenants_ai_quota_nonnegative check(ai_quota_limit>=0 and ai_quota_used>=0);
 end if;
end $$;
alter table public.conversation_events add column if not exists reason text;

create table if not exists public.tenant_ai_reply_reservations(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,
 customer_id uuid not null references public.customers(id) on delete cascade,
 source_message_id uuid not null references public.messages(id),external_id text not null,
 status text not null default 'reserved' check(status in ('reserved','dispatching','unknown','sent','released')),
 created_at timestamptz not null default clock_timestamp(),completed_at timestamptz,
 unique(tenant_id,source_message_id),unique(tenant_id,external_id)
);
create index if not exists tenant_ai_reply_capacity on public.tenant_ai_reply_reservations(tenant_id,status)
 where status in ('reserved','dispatching','unknown');
alter table public.tenant_ai_reply_reservations enable row level security;
revoke all on public.tenant_ai_reply_reservations from public,anon,authenticated;
grant all on public.tenant_ai_reply_reservations to service_role;

create or replace function public.guard_tenant_ai_quota() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if current_user in ('anon','authenticated') and
  ((tg_op='UPDATE' and (new.ai_quota_limit is distinct from old.ai_quota_limit or new.ai_quota_used is distinct from old.ai_quota_used))
   or (tg_op='INSERT' and (new.ai_quota_limit<>1000 or new.ai_quota_used<>0))) then
  raise exception 'AI quota is server managed' using errcode='42501';
 end if;
 return new;
end $$;
drop trigger if exists tenants_ai_quota_server_only on public.tenants;
create trigger tenants_ai_quota_server_only before insert or update on public.tenants
 for each row execute function public.guard_tenant_ai_quota();

create or replace function public.reserve_tenant_ai_reply(p_tenant uuid,p_customer uuid,p_message uuid)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare t public.tenants;reservation uuid;held bigint;
begin
 select * into t from public.tenants where id=p_tenant and is_active for update;
 if not found or not t.auto_reply_enabled or not public.has_tenant_feature(p_tenant,'ai_agent') then
  return jsonb_build_object('status','blocked');end if;
 if not exists(select 1 from public.customers where id=p_customer and tenant_id=p_tenant
  and bot_enabled and assigned_user_id is null and conversation_status<>'closed')
  or not exists(select 1 from public.messages where id=p_message and customer_id=p_customer and sender='customer') then
  return jsonb_build_object('status','blocked');end if;
 if exists(select 1 from public.tenant_ai_reply_reservations where tenant_id=p_tenant and source_message_id=p_message)
  or exists(select 1 from public.messages where customer_id=p_customer and external_id='reply:'||p_message::text) then
  return jsonb_build_object('status','duplicate');end if;
 select count(*) into held from public.tenant_ai_reply_reservations
  where tenant_id=p_tenant and status in ('reserved','dispatching','unknown');
 if t.ai_quota_used::bigint+held>=t.ai_quota_limit then return jsonb_build_object('status','quota_exceeded');end if;
 insert into public.tenant_ai_reply_reservations(tenant_id,customer_id,source_message_id,external_id)
 values(p_tenant,p_customer,p_message,'reply:'||p_message::text) returning id into reservation;
 return jsonb_build_object('status','reserved','id',reservation);
end $$;

create or replace function public.authorize_tenant_ai_reply(p_reservation uuid)
returns text language plpgsql set search_path=pg_catalog,public as $$
declare r public.tenant_ai_reply_reservations;t public.tenants;held bigint;
begin
 select * into r from public.tenant_ai_reply_reservations where id=p_reservation;
 if not found then return 'blocked';end if;
 select * into t from public.tenants where id=r.tenant_id for update;
 select * into r from public.tenant_ai_reply_reservations where id=p_reservation for update;
 if r.status<>'reserved' or not t.is_active or not t.auto_reply_enabled then return 'blocked';end if;
 select count(*) into held from public.tenant_ai_reply_reservations where tenant_id=r.tenant_id and status in ('dispatching','unknown');
 if t.ai_quota_used::bigint+held>=t.ai_quota_limit then return 'quota_exceeded';end if;
 update public.tenant_ai_reply_reservations set status='dispatching' where id=r.id;
 return 'authorized';
end $$;

-- Provider success is recorded by the existing durable messages UPDATE. Debit in
-- that same transaction, once per AI reply even for multipart/product messages.
create or replace function public.account_tenant_ai_reply() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.tenant_ai_reply_reservations;
begin
 if new.sender<>'bot' or new.external_id is null or new.delivery_status is null
  or new.delivery_status not in ('sent','delivered','read','failed','unknown') then return new;end if;
 select * into r from public.tenant_ai_reply_reservations where customer_id=new.customer_id and external_id=new.external_id;
 if not found then return new;end if;
 perform 1 from public.tenants where id=r.tenant_id for update;
 select * into r from public.tenant_ai_reply_reservations where id=r.id for update;
 if r.status='sent' then return new;end if;
 if new.delivery_status in ('sent','delivered','read') then
  update public.tenants set ai_quota_used=ai_quota_used+1 where id=r.tenant_id;
  update public.tenant_ai_reply_reservations set status='sent',completed_at=clock_timestamp() where id=r.id;
 elsif new.delivery_status='failed' then
  update public.tenant_ai_reply_reservations set status='released',completed_at=clock_timestamp() where id=r.id;
 else
  update public.tenant_ai_reply_reservations set status='unknown' where id=r.id;
 end if;
 return new;
end $$;
drop trigger if exists messages_account_tenant_ai_reply on public.messages;
create trigger messages_account_tenant_ai_reply after insert or update of delivery_status on public.messages
 for each row execute function public.account_tenant_ai_reply();

create or replace function public.settle_tenant_ai_reply(p_reservation uuid)
returns text language plpgsql set search_path=pg_catalog,public as $$
declare r public.tenant_ai_reply_reservations;delivery text;
begin
 select * into r from public.tenant_ai_reply_reservations where id=p_reservation;
 if not found then return 'missing';end if;
 perform 1 from public.tenants where id=r.tenant_id for update;
 select * into r from public.tenant_ai_reply_reservations where id=p_reservation for update;
 if r.status in ('sent','released') then return r.status;end if;
 select delivery_status into delivery from public.messages where customer_id=r.customer_id and external_id=r.external_id;
 if delivery in ('sent','delivered','read') then
  update public.tenants set ai_quota_used=ai_quota_used+1 where id=r.tenant_id;
  update public.tenant_ai_reply_reservations set status='sent',completed_at=clock_timestamp() where id=r.id;
  return 'sent';
 elsif not found or delivery='failed' then
  update public.tenant_ai_reply_reservations set status='released',completed_at=clock_timestamp() where id=r.id;
  return 'released';
 end if;
 -- Pending/unknown sends may have reached Meta: keep the capacity held for review.
 update public.tenant_ai_reply_reservations set status='unknown' where id=r.id;
 return 'unknown';
end $$;

create or replace function public.handover_tenant_ai_quota(p_tenant uuid,p_customer uuid,p_message uuid)
returns boolean language plpgsql set search_path=pg_catalog,public as $$
declare c public.customers;
begin
 perform 1 from public.tenants where id=p_tenant and is_active for update;
 if not found then return false;end if;
 select * into c from public.customers where id=p_customer and tenant_id=p_tenant for update;
 if not found or not exists(select 1 from public.messages where id=p_message and customer_id=c.id and sender='customer') then return false;end if;
 if c.bot_enabled and c.assigned_user_id is null and c.conversation_status<>'closed' then
  update public.customers set bot_enabled=false,handover_at=clock_timestamp(),conversation_version=conversation_version+1 where id=c.id;
  insert into public.conversation_events(tenant_id,customer_id,action,reason) values(p_tenant,c.id,'handover','quota_exceeded');
 end if;
 return true;
end $$;

-- Simulator requests use the tenant's AI quota, independent of the monthly
-- paid-plan allowance. The conditional update is atomic under concurrent tests.
create or replace function public.reserve_tenant_ai_simulation(p_tenant uuid)
returns boolean language plpgsql set search_path=pg_catalog,public as $$
begin
 update public.tenants set ai_quota_used=ai_quota_used+1
  where id=p_tenant and is_active and ai_quota_used<ai_quota_limit;
 return found;
end $$;

revoke all on function public.guard_tenant_ai_quota(),public.account_tenant_ai_reply() from public,anon,authenticated,service_role;
revoke all on function public.reserve_tenant_ai_reply(uuid,uuid,uuid),public.authorize_tenant_ai_reply(uuid),public.settle_tenant_ai_reply(uuid),public.handover_tenant_ai_quota(uuid,uuid,uuid),public.reserve_tenant_ai_simulation(uuid) from public,anon,authenticated;
grant execute on function public.reserve_tenant_ai_reply(uuid,uuid,uuid),public.authorize_tenant_ai_reply(uuid),public.settle_tenant_ai_reply(uuid),public.handover_tenant_ai_quota(uuid,uuid,uuid),public.reserve_tenant_ai_simulation(uuid) to service_role;

-- Auto replies use the reserved tenant reply budget, not a second monthly LLM
-- ceiling. Keep monthly invocation telemetry, rate/feature/ownership guards and
-- the installed Full Access behavior for all other calls (sandbox/manual drafts).
-- The reservation UUID is also the existing unique invocation key: no repeated
-- provider call can reuse it. A caller-supplied random key cannot bypass limits.
do $$
declare definition text;proof text;
begin
 if to_regprocedure('public.start_agent_ai_call(uuid,uuid,uuid,uuid,uuid)') is not null then
  definition:=pg_get_functiondef('public.start_agent_ai_call(uuid,uuid,uuid,uuid,uuid)'::regprocedure);
  if position('tenant_ai_reply_reservations' in definition)=0 then
   proof:='exists(select 1 from public.tenant_ai_reply_reservations r where r.id=p_key and r.tenant_id=p_tenant and r.customer_id=p_customer and r.status=''reserved'' and (p_job is null or exists(select 1 from public.agent_message_jobs q where q.id=p_job and q.message_id=r.source_message_id)))';
   definition:=replace(definition,'s.ai_monthly_limit<=0','(s.ai_monthly_limit<=0 and not '||proof||')');
   definition:=replace(definition,'used<s.ai_monthly_limit','(used<s.ai_monthly_limit or '||proof||')');
   execute definition;
  end if;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
