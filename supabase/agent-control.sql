-- Run LAST after feature-access.sql, smart-inbox.sql, smart-follow-ups.sql, automation.sql.
-- Additive and off by default. Never calls an AI provider or sends messages.
begin;
alter table public.customers add column if not exists agent_opted_out boolean not null default false;
create table if not exists public.agent_control_settings(
 tenant_id uuid primary key references public.tenants(id),flags jsonb not null default '{}' check(jsonb_typeof(flags)='object'),
 ai_monthly_limit integer not null default 0 check(ai_monthly_limit between 0 and 1000000),requests_per_minute integer not null default 10 check(requests_per_minute between 1 and 100)
);
create table if not exists public.agent_knowledge_sources(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 kind text not null check(kind in ('shop','shipping','warranty','returns','faq','forbidden','handoff')),title text not null check(length(trim(title)) between 1 and 100),
 content text not null check(length(trim(content)) between 1 and 2000),is_active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.agent_prompt_versions(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),version integer not null,instructions text,
 actor_id uuid references auth.users(id),created_at timestamptz not null default now(),unique(tenant_id,version)
);
create table if not exists public.agent_message_jobs(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),customer_id uuid not null references public.customers(id),message_id uuid not null unique references public.messages(id),
 inbound_seq bigint not null,status text not null default 'processing' check(status in ('processing','draft','sent','review','skipped','failed')),route text,reason text,
 claim_token uuid,claim_until timestamptz,dispatch_started_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.agent_ai_monthly_usage(tenant_id uuid not null references public.tenants(id),month date not null,used integer not null default 0 check(used>=0),primary key(tenant_id,month));
create table if not exists public.agent_ai_usage(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),customer_id uuid references public.customers(id),job_id uuid unique references public.agent_message_jobs(id),
 invocation_key uuid not null unique,status text not null default 'started' check(status in ('started','completed','review','provider_error')),
 input_tokens integer,output_tokens integer,cost_baht numeric,source_ids jsonb not null default '[]',reason text,created_at timestamptz not null default now(),completed_at timestamptz
);
create table if not exists public.agent_control_audit(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),actor_id uuid references auth.users(id),event text not null,subject_id uuid,detail text,created_at timestamptz not null default now());
create index if not exists agent_jobs_tenant on public.agent_message_jobs(tenant_id,created_at desc);
create index if not exists agent_usage_rate on public.agent_ai_usage(tenant_id,created_at desc);
create index if not exists agent_knowledge_tenant on public.agent_knowledge_sources(tenant_id,is_active);
create index if not exists agent_audit_tenant on public.agent_control_audit(tenant_id,created_at desc);
do $$declare tab text;begin
 foreach tab in array array['agent_control_settings','agent_knowledge_sources','agent_prompt_versions','agent_message_jobs','agent_ai_monthly_usage','agent_ai_usage','agent_control_audit'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated',tab);
  execute format('grant select on public.%I to authenticated',tab);
  execute format('grant all on public.%I to service_role',tab);
  execute format('drop policy if exists tenant_read on public.%I',tab);
  execute format('create policy tenant_read on public.%I for select to authenticated using(public.can_access_tenant(tenant_id) and public.has_tenant_feature(tenant_id,''ai_agent''))',tab);
 end loop;
end $$;
grant select(agent_opted_out) on public.customers to authenticated;
revoke select on public.agent_message_jobs,public.agent_ai_usage,public.agent_prompt_versions from authenticated;
grant select(id,tenant_id,status,route,reason,created_at,updated_at) on public.agent_message_jobs to authenticated;
grant select(id,tenant_id,status,input_tokens,output_tokens,cost_baht,source_ids,reason,created_at,completed_at) on public.agent_ai_usage to authenticated;
grant select(id,tenant_id,version,actor_id,created_at) on public.agent_prompt_versions to authenticated;
insert into public.agent_prompt_versions(tenant_id,version,instructions) select tenant_id,1,ai_instructions from public.bot_settings where ai_instructions is not null on conflict do nothing;
create or replace function public.record_agent_prompt() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare revision integer;actor uuid:=coalesce(auth.uid(),nullif(current_setting('snapbot.agent_actor',true),'')::uuid);
begin
 if tg_op='INSERT' or new.ai_instructions is distinct from old.ai_instructions then
  select coalesce(max(version),0)+1 into revision from public.agent_prompt_versions where tenant_id=new.tenant_id;
  insert into public.agent_prompt_versions(tenant_id,version,instructions,actor_id) values(new.tenant_id,revision,new.ai_instructions,actor);
  insert into public.agent_control_audit(tenant_id,actor_id,event,detail) values(new.tenant_id,actor,'prompt_version',revision::text);
 end if;return null;
end $$;
drop trigger if exists bot_settings_agent_version on public.bot_settings;
create trigger bot_settings_agent_version after insert or update of ai_instructions on public.bot_settings for each row execute function public.record_agent_prompt();
create or replace function public.agent_customer_consent() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare target uuid;normalized text;
begin
 if new.sender<>'customer' then return null;end if;
 select tenant_id into target from public.customers where id=new.customer_id;
 if not exists(select 1 from public.agent_control_settings where tenant_id=target and flags->'agent_orchestrator_enabled'='true'::jsonb) then return null;end if;
 normalized:=lower(regexp_replace(coalesce(new.body,''),'[[:space:][:punct:]]','','g'));
 if normalized in ('stop','unsubscribe','หยุดส่งข้อความ','ไม่รับข้อความ','ไม่ต้องส่งแล้ว') then
  update public.customers set agent_opted_out=true,bot_enabled=false,handover_at=now(),conversation_version=conversation_version+1 where id=new.customer_id;
  insert into public.agent_control_audit(tenant_id,event,subject_id) values(target,'customer_opt_out',new.customer_id);
 elsif normalized in ('start','subscribe','รับข้อความ','เริ่มรับข้อความ') then
  update public.customers set agent_opted_out=false where id=new.customer_id;
  insert into public.agent_control_audit(tenant_id,event,subject_id) values(target,'customer_opt_in',new.customer_id);
 end if;return null;
end $$;
drop trigger if exists messages_agent_consent on public.messages;
create trigger messages_agent_consent after insert on public.messages for each row execute function public.agent_customer_consent();
create or replace function public.guard_agent_consent() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.bot_enabled and new.agent_opted_out then raise exception 'Customer opted out' using errcode='42501';end if;return new;
end $$;
drop trigger if exists customers_agent_consent_guard on public.customers;
create trigger customers_agent_consent_guard before update of bot_enabled on public.customers for each row execute function public.guard_agent_consent();

create or replace function public.claim_agent_message(p_tenant uuid,p_customer uuid,p_message uuid) returns setof public.agent_message_jobs language plpgsql set search_path=pg_catalog,public as $$
declare c public.customers;m public.messages;
begin
 perform 1 from public.tenants where id=p_tenant and is_active and auto_reply_enabled for update;
 if not found or not exists(select 1 from public.agent_control_settings where tenant_id=p_tenant and flags->'agent_orchestrator_enabled'='true'::jsonb) then return;end if;
 select * into c from public.customers where id=p_customer and tenant_id=p_tenant for update;
 if not found or c.id is null or c.last_message_at is null or c.last_message_at>clock_timestamp()+interval '2 minutes' or c.agent_opted_out or not c.bot_enabled or c.assigned_user_id is not null or c.conversation_status='closed' then return;end if;
 select * into m from public.messages where id=p_message and customer_id=c.id and sender='customer' and inbound_seq=c.inbound_seq;
 if not found or exists(select 1 from public.messages where external_id in ('reply:'||p_message::text,'handover:reply:'||p_message::text)) then return;end if;
 return query insert into public.agent_message_jobs(tenant_id,customer_id,message_id,inbound_seq,claim_token,claim_until) values(p_tenant,c.id,m.id,c.inbound_seq,gen_random_uuid(),clock_timestamp()+interval '3 minutes') on conflict do nothing returning *;
end $$;
create or replace function public.start_agent_ai_call(p_tenant uuid,p_key uuid,p_customer uuid default null,p_job uuid default null,p_claim uuid default null) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare s public.agent_control_settings;j public.agent_message_jobs;used_count integer;usage_id uuid;month_start date:=date_trunc('month',now() at time zone 'UTC')::date;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if not public.has_tenant_feature(p_tenant,'ai_agent') then return jsonb_build_object('reason','FEATURE_LOCKED');end if;
 select * into s from public.agent_control_settings where tenant_id=p_tenant;
 if not found or s.flags->'agent_orchestrator_enabled' is distinct from 'true'::jsonb then return jsonb_build_object('reason','ORCHESTRATOR_DISABLED');end if;
 if p_customer is not null and not exists(select 1 from public.customers where id=p_customer and tenant_id=p_tenant and not agent_opted_out) then return jsonb_build_object('reason','CUSTOMER_UNAVAILABLE');end if;
 if p_job is not null then
  perform 1 from public.customers where id=p_customer for update;
  select * into j from public.agent_message_jobs where id=p_job and tenant_id=p_tenant and customer_id=p_customer for update;
  if not found or j.status<>'processing' or j.claim_token is distinct from p_claim or j.claim_until<=clock_timestamp() or not exists(select 1 from public.customers where id=p_customer and tenant_id=p_tenant and bot_enabled and assigned_user_id is null and conversation_status<>'closed' and inbound_seq=j.inbound_seq and not agent_opted_out) then return jsonb_build_object('reason','CONVERSATION_CHANGED');end if;
 end if;
 if exists(select 1 from public.agent_ai_usage where invocation_key=p_key or (p_job is not null and job_id=p_job)) then return jsonb_build_object('reason','DUPLICATE_AI_INVOCATION');end if;
 if (select count(*) from public.agent_ai_usage where tenant_id=p_tenant and created_at>clock_timestamp()-interval '1 minute')>=s.requests_per_minute then return jsonb_build_object('reason','AI_RATE_LIMIT');end if;
 insert into public.agent_ai_monthly_usage(tenant_id,month) values(p_tenant,month_start) on conflict do nothing;
 update public.agent_ai_monthly_usage set used=used+1 where tenant_id=p_tenant and month=month_start and used<s.ai_monthly_limit returning used into used_count;
 if not found then return jsonb_build_object('reason','AI_QUOTA_EXHAUSTED');end if;
 insert into public.agent_ai_usage(tenant_id,customer_id,job_id,invocation_key) values(p_tenant,p_customer,p_job,p_key) returning id into usage_id;
 return jsonb_build_object('id',usage_id);
end $$;
create or replace function public.begin_agent_dispatch(p_job uuid,p_claim uuid) returns boolean language plpgsql set search_path=pg_catalog,public as $$
declare j public.agent_message_jobs;c public.customers;
begin
 select * into j from public.agent_message_jobs where id=p_job;
 if not found then return false;end if;
 perform 1 from public.tenants where id=j.tenant_id for update;
 select * into c from public.customers where id=j.customer_id and tenant_id=j.tenant_id for update;
 select * into j from public.agent_message_jobs where id=p_job for update;
 if j.status<>'processing' or j.claim_token is distinct from p_claim or j.claim_until<=clock_timestamp() or j.dispatch_started_at is not null or c.id is null or c.last_message_at is null or c.last_message_at>clock_timestamp()+interval '2 minutes' or c.agent_opted_out or not c.bot_enabled or c.assigned_user_id is not null or c.conversation_status='closed' or c.inbound_seq<>j.inbound_seq or c.outbound_lock_until>clock_timestamp() or c.last_message_at<clock_timestamp()-interval '24 hours' then return false;end if;
 if not exists(select 1 from public.tenants where id=j.tenant_id and is_active and auto_reply_enabled) or not exists(select 1 from public.agent_control_settings where tenant_id=j.tenant_id and flags->'agent_orchestrator_enabled'='true'::jsonb) then return false;end if;
 if j.route='AI' and not public.has_tenant_feature(j.tenant_id,'ai_agent') then return false;end if;
 update public.agent_message_jobs set dispatch_started_at=clock_timestamp() where id=j.id;return true;
end $$;
create or replace function public.recover_agent_jobs() returns integer language plpgsql set search_path=pg_catalog,public as $$
declare n integer;
begin
 update public.agent_ai_usage u set status='review',reason='WORKER_RESTARTED',completed_at=now() from public.agent_message_jobs j where u.job_id=j.id and u.status='started' and j.status='processing' and j.claim_until<clock_timestamp();
 update public.agent_message_jobs set status='review',reason='WORKER_RESTARTED',claim_token=null,claim_until=null,updated_at=now() where status='processing' and claim_until<clock_timestamp();get diagnostics n=row_count;return n;
end $$;
create or replace function public.agent_job_audit() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op='INSERT' or new.status is distinct from old.status then insert into public.agent_control_audit(tenant_id,event,subject_id,detail) values(new.tenant_id,'job_'||new.status,new.id,new.reason);end if;return null;
end $$;
drop trigger if exists agent_job_audit on public.agent_message_jobs;
create trigger agent_job_audit after insert or update on public.agent_message_jobs for each row execute function public.agent_job_audit();
create or replace function public.save_agent_prompt(p_tenant uuid,p_actor uuid,p_instructions text) returns void language plpgsql set search_path=pg_catalog,public as $$
begin
 if not public.has_tenant_feature(p_tenant,'ai_agent') or not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Owner required' using errcode='42501';end if;
 if length(p_instructions)>8000 then raise exception 'Prompt too long' using errcode='22023';end if;
 perform set_config('snapbot.agent_actor',p_actor::text,true);
 insert into public.bot_settings(tenant_id,ai_instructions) values(p_tenant,p_instructions) on conflict(tenant_id) do update set ai_instructions=excluded.ai_instructions;
 insert into public.agent_control_audit(tenant_id,actor_id,event) values(p_tenant,p_actor,'prompt_saved');
end $$;
create or replace function public.manage_agent_knowledge(p_tenant uuid,p_actor uuid,p_action text,p_id uuid,p_data jsonb) returns uuid language plpgsql set search_path=pg_catalog,public as $$
declare changed uuid;
begin
 if not public.has_tenant_feature(p_tenant,'ai_agent') or not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Owner required' using errcode='42501';end if;
 if not exists(select 1 from public.agent_control_settings where tenant_id=p_tenant and flags->'agent_knowledge_base_enabled'='true'::jsonb) then raise exception 'Feature disabled' using errcode='42501';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 if p_action='delete' then delete from public.agent_knowledge_sources where id=p_id and tenant_id=p_tenant returning id into changed;
 elsif p_action='save' and p_id is not null then update public.agent_knowledge_sources set kind=p_data->>'kind',title=trim(p_data->>'title'),content=trim(p_data->>'content'),is_active=(p_data->>'is_active')::boolean,updated_at=now() where id=p_id and tenant_id=p_tenant returning id into changed;
 elsif p_action='save' then
  if (select count(*) from public.agent_knowledge_sources where tenant_id=p_tenant)>=100 then raise exception 'Knowledge limit 100' using errcode='22023';end if;
  insert into public.agent_knowledge_sources(tenant_id,kind,title,content,is_active) values(p_tenant,p_data->>'kind',trim(p_data->>'title'),trim(p_data->>'content'),(p_data->>'is_active')::boolean) returning id into changed;
 else raise exception 'Invalid action' using errcode='22023';end if;
 if changed is null then raise exception 'Knowledge not found' using errcode='P0002';end if;
 insert into public.agent_control_audit(tenant_id,actor_id,event,subject_id) values(p_tenant,p_actor,'knowledge_'||p_action,changed);return changed;
end $$;
create or replace function public.restore_agent_prompt(p_tenant uuid,p_actor uuid,p_version integer) returns boolean language plpgsql set search_path=pg_catalog,public as $$
declare content text;
begin
 if not public.has_tenant_feature(p_tenant,'ai_agent') or not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Owner required' using errcode='42501';end if;
 select instructions into content from public.agent_prompt_versions where tenant_id=p_tenant and version=p_version;
 if not found then return false;end if;
 perform public.save_agent_prompt(p_tenant,p_actor,content);
 insert into public.agent_control_audit(tenant_id,actor_id,event,detail) values(p_tenant,p_actor,'prompt_restored',p_version::text);return true;
end $$;
create or replace function public.agent_control_overview(p_tenant uuid) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('jobs',count(*),'sent',count(*) filter(where status='sent'),'draft',count(*) filter(where status='draft'),'review',count(*) filter(where status='review'),'handoffs',count(*) filter(where route='ADMIN'),'ai',count(*) filter(where route='AI'),'keyword',count(*) filter(where route='KEYWORD')) from public.agent_message_jobs where tenant_id=p_tenant and created_at>now()-interval '30 days'
$$;
do $$declare fn record;begin
 for fn in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('record_agent_prompt','agent_customer_consent','guard_agent_consent','claim_agent_message','start_agent_ai_call','begin_agent_dispatch','recover_agent_jobs','agent_job_audit','restore_agent_prompt','save_agent_prompt','manage_agent_knowledge','agent_control_overview') loop
  execute format('revoke all on function %s from public,anon,authenticated',fn.signature);execute format('grant execute on function %s to service_role',fn.signature);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
