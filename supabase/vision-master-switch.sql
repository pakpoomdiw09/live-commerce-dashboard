-- Run LAST after ai-vision.sql and smart-inbox.sql (and full-access.sql if used).
-- Rerunnable. Installs the single-store-switch behavior; no sends or historical replays.
begin;

-- Preserve the installed quota/Full Access and delivery guards. Vision's store
-- switch is independent of the separate text chatbot's auto_reply_enabled flag.
do $$
declare signature text; definition text;
begin
 foreach signature in array array['public.claim_vision_job(uuid)',
  'public.start_vision_analysis(uuid,uuid)','public.begin_vision_dispatch(uuid,uuid)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if position('vision_settings' in definition)=0 then
   raise exception 'Missing Vision Master Switch guard in %',signature;
  end if;
  definition:=replace(definition,' and t.auto_reply_enabled',' and t.is_active');
  definition:=replace(definition,'where id=j.tenant_id and auto_reply_enabled','where id=j.tenant_id and is_active');
  if position('auto_reply_enabled' in definition)>0 then
   raise exception 'Unrecognized Vision gate in %; no changes committed',signature;
  end if;
  execute definition;
 end loop;
end $$;

create or replace function public.save_vision_settings(p_tenant uuid,p_actor uuid,p_enabled boolean,p_mode text,p_confidence numeric,p_handoff boolean) returns void
language plpgsql set search_path=pg_catalog,public as $$
begin
 if not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner')
  or exists(select 1 from public.platform_admins where user_id=p_actor))
  or not public.has_tenant_feature(p_tenant,'image_assistant') then
  raise exception 'FEATURE_LOCKED' using errcode='42501';
 end if;
 if p_enabled is null then raise exception 'Invalid enabled setting' using errcode='22023';end if;
 insert into public.vision_settings(tenant_id,enabled,mode,confidence_threshold,handoff_enabled)
 values(p_tenant,p_enabled,'rules',0.8,true)
 on conflict(tenant_id) do update set enabled=excluded.enabled,mode='rules',confidence_threshold=0.8,handoff_enabled=true;
 insert into public.vision_audit_logs(tenant_id,actor_id,event,detail)
 values(p_tenant,p_actor,'settings_updated',case when p_enabled then 'enabled' else 'disabled' end);
end $$;

-- A handover performs no provider request, so it needs no messaging window or
-- outgoing delivery lease. Pause future automation while preserving any in-flight
-- lease and the current admin's assignment/closed state. Job + Inbox update commit
-- together; test jobs and stale/cross-customer claims cannot trigger a handover.
create or replace function public.handover_vision_job(p_job uuid,p_claim uuid,p_reason text)
returns boolean language plpgsql set search_path=pg_catalog,public as $$
declare j public.vision_jobs;c public.customers;
begin
 select * into j from public.vision_jobs where id=p_job;
 if not found or j.source<>'messenger' or j.customer_id is null then return false;end if;
 perform 1 from public.tenants where id=j.tenant_id and is_active for update;
 if not found then return false;end if;
 select * into c from public.customers where id=j.customer_id and tenant_id=j.tenant_id for update;
 select * into j from public.vision_jobs where id=p_job for update;
 if j.status<>'processing' or p_claim is null or j.claim_token is distinct from p_claim
  or c.id is null or not exists(select 1 from public.vision_settings where tenant_id=j.tenant_id and enabled)
  or not exists(select 1 from public.messages where id=j.message_id and customer_id=c.id and sender='customer') then return false;end if;
 if c.bot_enabled and c.assigned_user_id is null and c.conversation_status<>'closed' then
  update public.customers set bot_enabled=false,handover_at=clock_timestamp(),conversation_version=conversation_version+1 where id=c.id;
  insert into public.conversation_events(tenant_id,customer_id,action) values(j.tenant_id,c.id,'handover');
 end if;
 update public.vision_jobs set status='requires_review',reason=left(coalesce(nullif(p_reason,''),'VISION_ANALYSIS_FAILED'),200),
  claim_token=null,claim_until=null,updated_at=clock_timestamp() where id=j.id;
 return true;
end $$;

revoke all on function public.handover_vision_job(uuid,uuid,text),public.save_vision_settings(uuid,uuid,boolean,text,numeric,boolean) from public,anon,authenticated;
grant execute on function public.handover_vision_job(uuid,uuid,text),public.save_vision_settings(uuid,uuid,boolean,text,numeric,boolean) to service_role;
notify pgrst,'reload schema';
commit;
