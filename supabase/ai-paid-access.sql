-- Run after billing/payment approval, feature-access.sql, agent-control.sql and agent-overview.sql.
-- No payments are approved here. No balances or monthly limits are increased or reset.
begin;
create or replace function public.tenant_has_paid_ai_access(p_tenant uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.tenants t where t.id=p_tenant and t.is_active
   and t.plan in ('starter','pro') and t.plan_expires_at>now()
   and exists(select 1 from public.billing_requests r where r.tenant_id=t.id
     and r.item=t.plan and r.status='approved' and r.price_baht>0));
$$;
revoke all on function public.tenant_has_paid_ai_access(uuid) from public,anon,authenticated;
grant execute on function public.tenant_has_paid_ai_access(uuid) to service_role;

insert into public.plan_features(plan,feature,enabled) values('starter','ai_agent',true),('pro','ai_agent',true)
on conflict(plan,feature) do update set enabled=true;
create or replace function public.has_tenant_feature(p_tenant uuid,p_feature text) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.tenants t join public.plan_features f on f.plan=t.plan
   where t.id=p_tenant and t.is_active and t.plan in ('starter','pro') and t.plan_expires_at>now()
   and f.feature=p_feature and f.enabled
   and (p_feature not in ('ai_agent','image_assistant') or public.tenant_has_paid_ai_access(t.id)));
$$;

-- New paid purchases prepare the UI; existing positive tenant limits unlock managed AI.
-- Keep the owner's capability choices. A missing limit stays zero until configured.
create or replace function public.normalize_paid_ai_settings() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if public.has_tenant_feature(new.tenant_id,'ai_agent') then
   new.flags := '{"agent_control_center_enabled":true,"agent_knowledge_base_enabled":true,"agent_playground_enabled":true,"agent_analytics_enabled":true,"agent_advanced_guardrails_enabled":true}'::jsonb
     ||coalesce(new.flags,'{}'::jsonb)||jsonb_build_object('agent_control_center_enabled',true,'agent_orchestrator_enabled',new.ai_monthly_limit>0);
 end if;
 return new;
end $$;
drop trigger if exists paid_ai_settings_ready on public.agent_control_settings;
create trigger paid_ai_settings_ready before insert or update of ai_monthly_limit on public.agent_control_settings
for each row execute function public.normalize_paid_ai_settings();

create or replace function public.prepare_paid_ai_purchase() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.status='approved' and new.item in ('starter','pro') and public.has_tenant_feature(new.tenant_id,'ai_agent') then
   insert into public.agent_control_settings(tenant_id) values(new.tenant_id)
   on conflict(tenant_id) do update set ai_monthly_limit=public.agent_control_settings.ai_monthly_limit;
 end if;
 return new;
end $$;
drop trigger if exists paid_ai_purchase_ready on public.billing_requests;
create trigger paid_ai_purchase_ready after insert or update of status on public.billing_requests
for each row execute function public.prepare_paid_ai_purchase();
insert into public.agent_control_settings(tenant_id)
select id from public.tenants where public.has_tenant_feature(id,'ai_agent')
on conflict(tenant_id) do update set ai_monthly_limit=public.agent_control_settings.ai_monthly_limit;

create or replace function public.start_agent_ai_call(p_tenant uuid,p_key uuid,p_customer uuid default null,p_job uuid default null,p_claim uuid default null)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare s public.agent_control_settings;j public.agent_message_jobs;used_count integer;usage_id uuid;month_start date:=date_trunc('month',now() at time zone 'UTC')::date;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if not public.tenant_has_paid_ai_access(p_tenant) or not public.has_tenant_feature(p_tenant,'ai_agent') then return jsonb_build_object('reason','FEATURE_LOCKED');end if;
 select * into s from public.agent_control_settings where tenant_id=p_tenant;
 if not found or s.ai_monthly_limit<=0 then return jsonb_build_object('reason','AI_QUOTA_EXHAUSTED');end if;
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
 update public.agent_ai_monthly_usage set used=used+1 where tenant_id=p_tenant and month=month_start and used<s.ai_monthly_limit returning used into used_count;
 if not found then return jsonb_build_object('reason','AI_QUOTA_EXHAUSTED');end if;
 insert into public.agent_ai_usage(tenant_id,customer_id,job_id,invocation_key) values(p_tenant,p_customer,p_job,p_key) returning id into usage_id;
 return jsonb_build_object('id',usage_id);
end $$;
revoke all on function public.start_agent_ai_call(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.start_agent_ai_call(uuid,uuid,uuid,uuid,uuid) to service_role;
revoke all on function public.normalize_paid_ai_settings(),public.prepare_paid_ai_purchase() from public,anon,authenticated,service_role;
commit;
