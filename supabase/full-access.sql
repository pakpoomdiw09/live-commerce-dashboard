-- Run the entire file in the production SQL Editor after the existing schema migrations.
-- Static function definitions: no matching, parsing or executing installed function text.
-- Package and monthly credit limits are bypassed for ACTIVE shops. Membership,
-- owner authorization, leases, message windows and rate protections remain enforced.
begin;

create table if not exists public.full_access_function_backup (
  signature text primary key,
  definition text not null,
  saved_at timestamptz not null default now()
);
alter table public.full_access_function_backup enable row level security;
revoke all on public.full_access_function_backup from public, anon, authenticated, service_role;

-- Save originals verbatim for rollback only. They are never parsed or executed here.
-- Missing functions are created below and do not abort this snapshot.
insert into public.full_access_function_backup(signature, definition)
select expected.signature, pg_get_functiondef(to_regprocedure(expected.signature))
from (values
  ('public.has_tenant_feature(uuid,text)'),
  ('public.tenant_has_paid_ai_access(uuid)'),
  ('public.consume_slip_credit(uuid)'),
  ('public.refund_slip_credit(uuid)'),
  ('public.reserve_broadcast_credits(uuid,integer)'),
  ('public.refund_broadcast_credits(uuid,integer,integer)'),
  ('public.start_agent_ai_call(uuid,uuid,uuid,uuid,uuid)'),
  ('public.set_agent_overview_capability(uuid,uuid,text,boolean)'),
  ('public.guard_keyword_reply_limit()'),
  ('public.guard_followup_plan()'),
  ('public.commerce_plan(uuid)'),
  ('public.claim_vision_job(uuid)'),
  ('public.begin_vision_dispatch(uuid,uuid)'),
  ('public.save_vision_settings(uuid,uuid,boolean,text,numeric,boolean)')
) expected(signature)
where to_regprocedure(expected.signature) is not null
on conflict do nothing;

create or replace function public.start_agent_ai_call(p_tenant uuid,p_key uuid,p_customer uuid default null,p_job uuid default null,p_claim uuid default null)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare s public.agent_control_settings;j public.agent_message_jobs;used_count integer;usage_id uuid;month_start date:=date_trunc('month',now() at time zone 'UTC')::date;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if not public.tenant_has_paid_ai_access(p_tenant) or not public.has_tenant_feature(p_tenant,'ai_agent') then return jsonb_build_object('reason','FEATURE_LOCKED');end if;
 select * into s from public.agent_control_settings where tenant_id=p_tenant;
 if not found then return jsonb_build_object('reason','AI_NOT_CONFIGURED');end if;
 if p_key is null then return jsonb_build_object('reason','INVALID_REQUEST');end if;
 if p_customer is not null and not exists(select 1 from public.customers where id=p_customer and tenant_id=p_tenant and not agent_opted_out) then return jsonb_build_object('reason','CUSTOMER_UNAVAILABLE');end if;
 if p_job is not null then
   perform 1 from public.customers where id=p_customer for update;
   select * into j from public.agent_message_jobs where id=p_job and tenant_id=p_tenant and customer_id=p_customer for update;
   if not found or j.status<>'processing' or j.claim_token is distinct from p_claim or j.claim_until<=clock_timestamp()
   or not exists(select 1 from public.customers where id=p_customer and tenant_id=p_tenant and bot_enabled and assigned_user_id is null and conversation_status<>'closed' and inbound_seq=j.inbound_seq and not agent_opted_out) then return jsonb_build_object('reason','CONVERSATION_CHANGED');end if;
 end if;
 if exists(select 1 from public.agent_ai_usage where invocation_key=p_key or (p_job is not null and job_id=p_job)) then return jsonb_build_object('reason','DUPLICATE_AI_INVOCATION');end if;
 if (select count(*) from public.agent_ai_usage where tenant_id=p_tenant and created_at>clock_timestamp()-interval '1 minute')>=s.requests_per_minute then return jsonb_build_object('reason','AI_RATE_LIMIT');end if;
 insert into public.agent_ai_monthly_usage(tenant_id,month) values(p_tenant,month_start) on conflict do nothing;
 update public.agent_ai_monthly_usage set used=used+1 where tenant_id=p_tenant and month=month_start returning used into used_count;
 if not found then return jsonb_build_object('reason','AI_USAGE_UNAVAILABLE');end if;
 insert into public.agent_ai_usage(tenant_id,customer_id,job_id,invocation_key) values(p_tenant,p_customer,p_job,p_key) returning id into usage_id;
 return jsonb_build_object('id',usage_id);
end $$;

create or replace function public.set_agent_overview_capability(p_tenant uuid,p_actor uuid,p_capability text,p_enabled boolean)
returns void language plpgsql set search_path=pg_catalog,public as $$
declare settings public.agent_control_settings; used_count integer; slip_remaining bigint;
begin
 if not exists(select 1 from public.tenants where id=p_tenant and is_active)
 or not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner')
 or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_enabled is null or p_capability is null or p_capability not in ('master','answers','products','slips','handoff','intent','followup') then raise exception 'Invalid input' using errcode='22023';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 select * into settings from public.agent_control_settings where tenant_id=p_tenant for update;
 if not found then raise exception 'Configure AI settings first' using errcode='22023';end if;
 if p_capability='master' then
   update public.tenants set auto_reply_enabled=p_enabled where id=p_tenant;
 elsif p_capability='slips' then
   if p_enabled and (not public.has_tenant_feature(p_tenant,'slip_auto_pilot') or not exists(select 1 from public.bank_accounts where tenant_id=p_tenant and is_active)) then raise exception 'Configure receiving bank accounts and slip access first' using errcode='22023';end if;
   update public.tenants set auto_verify_enabled=p_enabled where id=p_tenant;
 elsif p_capability='followup' then
   if p_enabled and not public.has_tenant_feature(p_tenant,'customer_follow_up') then raise exception 'Forbidden' using errcode='42501';end if;
   update public.follow_up_policies set enabled=p_enabled where tenant_id=p_tenant;
   if not found then raise exception 'Configure follow-up policy first' using errcode='22023';end if;
   if not p_enabled then
     update public.follow_up_jobs set status='cancelled',reason='disabled' where tenant_id=p_tenant and (status in ('pending','requires_review') or status='processing' and dispatch_started_at is null);
   end if;
 else
   if p_enabled and settings.flags->'agent_orchestrator_enabled' is distinct from 'true'::jsonb then raise exception 'Enable managed AI first' using errcode='22023';end if;
   update public.agent_control_settings set flags=jsonb_set(flags,array['capability_'||p_capability],to_jsonb(p_enabled)) where tenant_id=p_tenant;
 end if;
 insert into public.agent_control_audit(tenant_id,actor_id,event,detail) values(p_tenant,p_actor,'capability_changed',p_capability||':'||p_enabled::text);
end $$;

create or replace function public.guard_keyword_reply_limit() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  return new;
end $$;

create or replace function public.guard_followup_plan() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  return new;
end $$;


create or replace function public.claim_vision_job(p_job uuid default null) returns setof public.vision_jobs
language plpgsql set search_path=pg_catalog,public as $$
declare j public.vision_jobs;stale public.vision_jobs;used_images integer;month_start date:=date_trunc('month',now() at time zone 'UTC')::date;
begin
 -- A crashed provider/send call is uncertain: never automatically repeat it or charge twice.
 for stale in select * from public.vision_jobs where status='processing' and claim_until<clock_timestamp() and (p_job is null or id=p_job) for update skip locked loop
  if stale.ai_request_started_at is null and stale.quota_reserved then
   update public.vision_usage set used=greatest(0,used-1) where tenant_id=stale.tenant_id and month=stale.usage_month;
  end if;
  update public.vision_jobs set status=case when stale.ai_request_started_at is null and stale.attempts<3 then 'pending' else 'requires_review' end,reason='WORKER_INTERRUPTED',quota_reserved=case when stale.ai_request_started_at is null then false else quota_reserved end,claim_token=null,claim_until=null where id=stale.id;
 end loop;
 select * into j from public.vision_jobs where status='pending' and (p_job is null or id=p_job) order by created_at,id limit 1 for update skip locked;
 if not found then return;end if;
 if not public.has_tenant_feature(j.tenant_id,'image_assistant') then
  update public.vision_jobs set status='cancelled',reason='FEATURE_LOCKED' where id=j.id;return;
 end if;
 if j.source='messenger' and (not exists(select 1 from public.vision_settings where tenant_id=j.tenant_id and enabled) or not exists(select 1 from public.customers c join public.tenants t on t.id=c.tenant_id where c.id=j.customer_id and c.tenant_id=j.tenant_id and c.bot_enabled and c.assigned_user_id is null and c.conversation_status<>'closed' and t.auto_reply_enabled) or not exists(select 1 from public.messages where id=j.message_id and customer_id=j.customer_id and sender='customer')) then
  update public.vision_jobs set status='cancelled',reason='ADMIN_HANDLING_OR_DISABLED' where id=j.id;return;
 end if;
 insert into public.vision_usage(tenant_id,month) values(j.tenant_id,month_start) on conflict do nothing;
 update public.vision_usage set used=used+1 where tenant_id=j.tenant_id and month=month_start returning used into used_images;
 if not found then update public.vision_jobs set status='requires_review',reason='VISION_QUOTA_EXHAUSTED' where id=j.id;return;end if;
 return query update public.vision_jobs set status='processing',claim_token=gen_random_uuid(),claim_until=clock_timestamp()+interval '3 minutes',analysis_started_at=clock_timestamp(),usage_month=month_start,quota_reserved=true,attempts=attempts+1 where id=j.id returning *;
end $$;

create or replace function public.begin_vision_dispatch(p_job uuid,p_claim uuid) returns boolean
language plpgsql set search_path=pg_catalog,public as $$
declare j public.vision_jobs;c public.customers;
begin
 select * into j from public.vision_jobs where id=p_job;
 if not found or j.customer_id is null then return false;end if;
 -- Match the Inbox lease lock order; a human claiming the conversation wins before a send starts.
 select * into c from public.customers where id=j.customer_id and tenant_id=j.tenant_id for update;
 select * into j from public.vision_jobs where id=p_job for update;
 if j.source<>'messenger' or j.status<>'processing' or j.claim_token is distinct from p_claim or j.claim_until<=clock_timestamp() or j.dispatch_started_at is not null
  or not public.has_tenant_feature(j.tenant_id,'image_assistant')
  or not exists(select 1 from public.vision_settings where tenant_id=j.tenant_id and enabled)
  or not exists(select 1 from public.tenants where id=j.tenant_id and auto_reply_enabled)
  or c.id is null or not c.bot_enabled or c.assigned_user_id is not null or c.conversation_status='closed'
  or c.last_message_at is null or c.last_message_at<clock_timestamp()-interval '24 hours'
  or c.outbound_lock_until>clock_timestamp() then return false;end if;
 if j.decision->>'action'='PRODUCT_SEARCH' and (not public.has_tenant_feature(j.tenant_id,'ai_agent') or not exists(select 1 from public.vision_settings s where s.tenant_id=j.tenant_id and s.mode='catalog')) then return false;end if;
 if j.decision->>'action'='VERIFY_SLIP' and (not public.has_tenant_feature(j.tenant_id,'slip_auto_pilot') or not exists(select 1 from public.tenants where id=j.tenant_id and auto_verify_enabled)) then return false;end if;
 update public.vision_jobs set dispatch_started_at=clock_timestamp() where id=j.id;
 return true;
end $$;

create or replace function public.save_vision_settings(p_tenant uuid,p_actor uuid,p_enabled boolean,p_mode text,p_confidence numeric,p_handoff boolean) returns void
language plpgsql set search_path=pg_catalog,public as $$
begin
 if not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or exists(select 1 from public.platform_admins where user_id=p_actor)) or not public.has_tenant_feature(p_tenant,'image_assistant') then raise exception 'FEATURE_LOCKED' using errcode='42501';end if;
 if p_mode='catalog' and (not public.has_tenant_feature(p_tenant,'ai_agent')) then raise exception 'FEATURE_LOCKED: product_search' using errcode='42501';end if;
 insert into public.vision_settings(tenant_id,enabled,mode,confidence_threshold,handoff_enabled) values(p_tenant,p_enabled,p_mode,p_confidence,p_handoff)
 on conflict(tenant_id) do update set enabled=excluded.enabled,mode=excluded.mode,confidence_threshold=excluded.confidence_threshold,handoff_enabled=excluded.handoff_enabled;
 insert into public.vision_audit_logs(tenant_id,actor_id,event,detail) values(p_tenant,p_actor,'settings_updated',case when p_enabled then 'enabled' else 'disabled' end);
end $$;

-- Retain active-tenant checks; membership continues to be enforced by routes and RLS.
create or replace function public.has_tenant_feature(p_tenant uuid,p_feature text) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
  select p_feature in ('ai_agent','image_assistant','customer_management','slip_auto_pilot','customer_follow_up')
    and exists(select 1 from public.tenants where id=p_tenant and is_active)
$$;
create or replace function public.tenant_has_paid_ai_access(p_tenant uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
  select exists(select 1 from public.tenants where id=p_tenant and is_active)
$$;
create or replace function public.consume_slip_credit(p_tenant uuid) returns boolean
language sql set search_path=pg_catalog,public as $$
  with used as (
    update public.tenants set slip_used=slip_used+1 where id=p_tenant and is_active returning id
  ) select exists(select 1 from used)
$$;
-- Slip refunds still reverse actual usage; preserve the installed refund implementation.
create or replace function public.reserve_broadcast_credits(p_tenant uuid,p_count integer)
returns table(monthly integer,topup integer)
language sql set search_path=pg_catalog,public as $$
  select greatest(coalesce(p_count,0),0),0
  where exists(select 1 from public.tenants where id=p_tenant and is_active)
$$;
-- No balance was deducted by the temporary reservation: never mint refund credits.
create or replace function public.refund_broadcast_credits(p_tenant uuid,p_monthly integer,p_topup integer)
returns void language plpgsql set search_path=pg_catalog,public as $$ begin return; end $$;
create or replace function public.commerce_plan(p_tenant uuid) returns public.commerce_limits
language sql stable security definer set search_path=pg_catalog,public as $$
  select 'pro'::text,null::integer,2147483647,true,true,true
  from public.tenants where id=p_tenant and is_active
$$;

-- CREATE OR REPLACE retains the original execution grants and function OIDs.
-- No change to customer ownership, authentication, opt-outs, bank validation or AI rate limits.

-- Explicit grants also cover installations where a function was previously absent.
revoke all on function public.has_tenant_feature(uuid,text) from public,anon;
grant execute on function public.has_tenant_feature(uuid,text) to authenticated,service_role;
revoke all on function public.guard_keyword_reply_limit(),public.guard_followup_plan()
  from public,anon,authenticated,service_role;
revoke all on function
  public.tenant_has_paid_ai_access(uuid), public.consume_slip_credit(uuid),
  public.reserve_broadcast_credits(uuid,integer),public.refund_broadcast_credits(uuid,integer,integer),
  public.start_agent_ai_call(uuid,uuid,uuid,uuid,uuid),
  public.set_agent_overview_capability(uuid,uuid,text,boolean),public.commerce_plan(uuid),
  public.claim_vision_job(uuid),public.begin_vision_dispatch(uuid,uuid),
  public.save_vision_settings(uuid,uuid,boolean,text,numeric,boolean)
  from public,anon,authenticated;
grant execute on function
  public.tenant_has_paid_ai_access(uuid), public.consume_slip_credit(uuid),
  public.reserve_broadcast_credits(uuid,integer),public.refund_broadcast_credits(uuid,integer,integer),
  public.start_agent_ai_call(uuid,uuid,uuid,uuid,uuid),
  public.set_agent_overview_capability(uuid,uuid,text,boolean),public.commerce_plan(uuid),
  public.claim_vision_job(uuid),public.begin_vision_dispatch(uuid,uuid),
  public.save_vision_settings(uuid,uuid,boolean,text,numeric,boolean)
  to service_role;

commit;
