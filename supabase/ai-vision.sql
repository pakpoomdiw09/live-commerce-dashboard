-- Run LAST after image-response-rules.sql, feature-access.sql, smart-inbox.sql,
-- free-message-quota.sql and bank-accounts.sql. Additive; no network requests.
begin;
alter table public.image_response_rules add column if not exists priority integer not null default 0 check(priority between 0 and 1000);
create table if not exists public.vision_plan_limits(
 plan text primary key check(plan in ('free','starter','pro')),monthly_images integer not null check(monthly_images>=0),product_search boolean not null default false
);
insert into public.vision_plan_limits values('free',0,false),('starter',100,false),('pro',1000,true) on conflict do nothing;
alter table public.vision_plan_limits enable row level security;
revoke all on public.vision_plan_limits from public,anon,authenticated;
grant all on public.vision_plan_limits to service_role;
create table if not exists public.vision_settings(
 tenant_id uuid primary key references public.tenants(id) on delete cascade,enabled boolean not null default false,
 mode text not null default 'rules' check(mode in ('rules','catalog')),confidence_threshold numeric not null default 0.8 check(confidence_threshold between 0.8 and 1),handoff_enabled boolean not null default true
);
create table if not exists public.vision_usage(
 tenant_id uuid not null references public.tenants(id) on delete cascade,month date not null,used integer not null default 0 check(used>=0),primary key(tenant_id,month)
);
create table if not exists public.vision_jobs(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),customer_id uuid references public.customers(id),message_id uuid references public.messages(id),
 source text not null check(source in ('test','messenger')),idempotency_key text not null check(length(idempotency_key) between 1 and 200),
 image_path text not null,mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp')),
 status text not null default 'pending' check(status in ('pending','processing','completed','failed','requires_review','cancelled')),
 claim_token uuid,claim_until timestamptz,analysis_started_at timestamptz,dispatch_started_at timestamptz,
 ai_request_started_at timestamptz,usage_month date,quota_reserved boolean not null default false,attempts integer not null default 0,
 result jsonb,decision jsonb,reason text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(tenant_id,source,idempotency_key),check((source='test' and customer_id is null and message_id is null) or (source='messenger' and customer_id is not null and message_id is not null))
);
create index if not exists vision_jobs_pending on public.vision_jobs(created_at) where status='pending';
create table if not exists public.vision_audit_logs(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),job_id uuid references public.vision_jobs(id),actor_id uuid references auth.users(id),event text not null,detail text,created_at timestamptz not null default now()
);
do $$declare tab text;begin
 foreach tab in array array['vision_settings','vision_usage','vision_jobs','vision_audit_logs'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated',tab);
  execute format('grant select on public.%I to authenticated',tab);
  execute format('grant all on public.%I to service_role',tab);
  execute format('drop policy if exists tenant_read on public.%I',tab);
  execute format('create policy tenant_read on public.%I for select to authenticated using(public.can_access_tenant(tenant_id) and public.has_tenant_feature(tenant_id,''image_assistant''))',tab);
 end loop;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('vision-images','vision-images',false,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
update storage.buckets set public=false,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'] where id='vision-images';

create or replace function public.vision_job_audit() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op='INSERT' or new.status is distinct from old.status then
  insert into public.vision_audit_logs(tenant_id,job_id,event,detail) values(new.tenant_id,new.id,new.status,new.reason);
 end if;return new;
end $$;
create or replace function public.retry_unstarted_vision(p_job uuid,p_tenant uuid,p_actor uuid) returns boolean
language plpgsql set search_path=pg_catalog,public as $$
declare changed uuid;
begin
 if not public.has_tenant_feature(p_tenant,'image_assistant') or not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Forbidden' using errcode='42501';end if;
 -- Only a request which has NEVER reached the provider is safe to automatically retry.
 update public.vision_jobs set status='pending',reason=null where id=p_job and tenant_id=p_tenant and status in ('requires_review','cancelled') and ai_request_started_at is null and dispatch_started_at is null and not quota_reserved and attempts<3 returning id into changed;
 if changed is not null then insert into public.vision_audit_logs(tenant_id,job_id,actor_id,event) values(p_tenant,p_job,p_actor,'safe_retry');end if;
 return changed is not null;
end $$;
revoke all on function public.retry_unstarted_vision(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.retry_unstarted_vision(uuid,uuid,uuid) to service_role;
-- AFTER trigger: FK job must exist before audit insertion.
drop trigger if exists vision_job_audit on public.vision_jobs;
create trigger vision_job_audit after insert or update on public.vision_jobs for each row execute function public.vision_job_audit();

create or replace function public.claim_vision_job(p_job uuid default null) returns setof public.vision_jobs
language plpgsql set search_path=pg_catalog,public as $$
declare j public.vision_jobs;stale public.vision_jobs;limit_images integer;used_images integer;month_start date:=date_trunc('month',now() at time zone 'UTC')::date;
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
 select l.monthly_images into limit_images from public.tenants t join public.vision_plan_limits l on l.plan=t.plan where t.id=j.tenant_id;
 insert into public.vision_usage(tenant_id,month) values(j.tenant_id,month_start) on conflict do nothing;
 update public.vision_usage set used=used+1 where tenant_id=j.tenant_id and month=month_start and used<coalesce(limit_images,0) returning used into used_images;
 if not found then update public.vision_jobs set status='requires_review',reason='VISION_QUOTA_EXHAUSTED' where id=j.id;return;end if;
 return query update public.vision_jobs set status='processing',claim_token=gen_random_uuid(),claim_until=clock_timestamp()+interval '3 minutes',analysis_started_at=clock_timestamp(),usage_month=month_start,quota_reserved=true,attempts=attempts+1 where id=j.id returning *;
end $$;
create or replace function public.start_vision_analysis(p_job uuid,p_claim uuid) returns boolean
language plpgsql set search_path=pg_catalog,public as $$
declare j public.vision_jobs;
begin
 select * into j from public.vision_jobs where id=p_job for update;
 if not found or j.status<>'processing' or j.claim_token is distinct from p_claim or j.claim_until<=clock_timestamp() or j.ai_request_started_at is not null or not j.quota_reserved then return false;end if;
 if not public.has_tenant_feature(j.tenant_id,'image_assistant') then return false;end if;
 if j.source='messenger' and (not exists(select 1 from public.vision_settings where tenant_id=j.tenant_id and enabled) or not exists(select 1 from public.customers c join public.tenants t on t.id=c.tenant_id where c.id=j.customer_id and c.tenant_id=j.tenant_id and c.bot_enabled and c.assigned_user_id is null and c.conversation_status<>'closed' and t.auto_reply_enabled)) then return false;end if;
 update public.vision_jobs set ai_request_started_at=clock_timestamp() where id=j.id;return true;
end $$;
create or replace function public.refund_unstarted_vision(p_job uuid,p_claim uuid) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare j public.vision_jobs;
begin
 select * into j from public.vision_jobs where id=p_job for update;
 if found and j.status='processing' and j.claim_token=p_claim and j.ai_request_started_at is null and j.quota_reserved then
  update public.vision_usage set used=greatest(0,used-1) where tenant_id=j.tenant_id and month=j.usage_month;
  update public.vision_jobs set quota_reserved=false where id=j.id;
 end if;
end $$;
revoke all on function public.start_vision_analysis(uuid,uuid),public.refund_unstarted_vision(uuid,uuid) from public,anon,authenticated;
grant execute on function public.start_vision_analysis(uuid,uuid),public.refund_unstarted_vision(uuid,uuid) to service_role;
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
 if j.decision->>'action'='PRODUCT_SEARCH' and (not public.has_tenant_feature(j.tenant_id,'ai_agent') or not exists(select 1 from public.tenants t join public.vision_plan_limits l on l.plan=t.plan join public.vision_settings s on s.tenant_id=t.id where t.id=j.tenant_id and l.product_search and s.mode='catalog')) then return false;end if;
 if j.decision->>'action'='VERIFY_SLIP' and (not public.has_tenant_feature(j.tenant_id,'slip_auto_pilot') or not exists(select 1 from public.tenants where id=j.tenant_id and auto_verify_enabled and slip_used::bigint<slip_quota::bigint+slip_quota_credits::bigint)) then return false;end if;
 update public.vision_jobs set dispatch_started_at=clock_timestamp() where id=j.id;
 return true;
end $$;
create or replace function public.save_vision_settings(p_tenant uuid,p_actor uuid,p_enabled boolean,p_mode text,p_confidence numeric,p_handoff boolean) returns void
language plpgsql set search_path=pg_catalog,public as $$
begin
 if not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or exists(select 1 from public.platform_admins where user_id=p_actor)) or not public.has_tenant_feature(p_tenant,'image_assistant') then raise exception 'FEATURE_LOCKED' using errcode='42501';end if;
 if p_mode='catalog' and (not public.has_tenant_feature(p_tenant,'ai_agent') or not exists(select 1 from public.tenants t join public.vision_plan_limits l on l.plan=t.plan where t.id=p_tenant and l.product_search)) then raise exception 'FEATURE_LOCKED: product_search' using errcode='42501';end if;
 insert into public.vision_settings(tenant_id,enabled,mode,confidence_threshold,handoff_enabled) values(p_tenant,p_enabled,p_mode,p_confidence,p_handoff)
 on conflict(tenant_id) do update set enabled=excluded.enabled,mode=excluded.mode,confidence_threshold=excluded.confidence_threshold,handoff_enabled=excluded.handoff_enabled;
 insert into public.vision_audit_logs(tenant_id,actor_id,event,detail) values(p_tenant,p_actor,'settings_updated',case when p_enabled then 'enabled' else 'disabled' end);
end $$;
create or replace function public.audit_image_rule_change() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 insert into public.vision_audit_logs(tenant_id,actor_id,event,detail) values(case when tg_op='DELETE' then old.tenant_id else new.tenant_id end,auth.uid(),'rule_'||lower(tg_op),case when tg_op='DELETE' then old.id::text else new.id::text end);
 return null;
end $$;
drop trigger if exists image_rule_vision_audit on public.image_response_rules;
create trigger image_rule_vision_audit after insert or update or delete on public.image_response_rules for each row execute function public.audit_image_rule_change();
revoke all on function public.begin_vision_dispatch(uuid,uuid),public.save_vision_settings(uuid,uuid,boolean,text,numeric,boolean),public.audit_image_rule_change() from public,anon,authenticated;
grant execute on function public.begin_vision_dispatch(uuid,uuid),public.save_vision_settings(uuid,uuid,boolean,text,numeric,boolean) to service_role;
revoke all on function public.claim_vision_job(uuid),public.vision_job_audit() from public,anon,authenticated;
grant execute on function public.claim_vision_job(uuid) to service_role;
notify pgrst,'reload schema';
commit;
