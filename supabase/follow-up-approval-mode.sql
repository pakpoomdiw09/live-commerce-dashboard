-- Run LAST after follow-up-24h-window.sql and follow-up-step-settings.sql.
-- Rerunnable. Existing jobs are never approved or replayed by this migration.
begin;

alter table public.follow_up_policies add column if not exists approval_mode text
 not null default 'manual_review' check(approval_mode in ('manual_review','auto_approve'));

create or replace function public.set_follow_up_approval_mode(p_tenant uuid,p_actor uuid,p_mode text)
returns text language plpgsql set search_path=pg_catalog,public as $$
begin
 if not public.has_tenant_feature(p_tenant,'customer_follow_up') or not (
  exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor)
  or exists(select 1 from public.platform_admins where user_id=p_actor)) then
  raise exception 'Forbidden' using errcode='42501';
 end if;
 if p_mode is null or p_mode not in ('manual_review','auto_approve') then
  raise exception 'Invalid approval mode' using errcode='22023';
 end if;
 perform 1 from public.tenants where id=p_tenant for update;
 -- Update only the approval setting: do not toggle automation, revise workflows,
 -- cancel queues or approve historical drafts.
 insert into public.follow_up_policies(tenant_id,approval_mode) values(p_tenant,p_mode)
 on conflict(tenant_id) do update set approval_mode=excluded.approval_mode;
 return p_mode;
end $$;

-- Both enqueue_follow_up and add_manual_follow_up pass through this gate.
-- Keep approval decisions at creation time instead of re-reading a mutable
-- setting when the worker picks up an old draft.
create or replace function public.apply_follow_up_approval_mode() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare mode text;
begin
 if new.status in ('pending','scheduled') or new.status='requires_review' and new.reason='ai_draft' then
  select approval_mode into mode from public.follow_up_policies where tenant_id=new.tenant_id;
  new.ai_approved:=coalesce(mode,'manual_review')='auto_approve';
  new.status:=case when new.ai_approved then 'pending' else 'requires_review' end;
  new.reason:=case when new.ai_approved then null else 'ai_draft' end;
 end if;
 return new;
end $$;
drop trigger if exists follow_up_approval_mode on public.follow_up_jobs;
create trigger follow_up_approval_mode before insert on public.follow_up_jobs
 for each row execute function public.apply_follow_up_approval_mode();

-- An explicit admin retry is allowed only for a durable, confirmed refusal.
-- Unknown outcomes, timeouts, accepted sends and window cancellations never retry.
-- Archive the failed message's deduplication marker before a new dispatch so
-- prepare_follow_up can create its next message while retaining the old history.
create or replace function public.retry_rejected_follow_up(p_job uuid,p_tenant uuid,p_actor uuid)
returns text language plpgsql set search_path=pg_catalog,public as $$
declare j public.follow_up_jobs; m public.messages;
begin
 if not public.has_tenant_feature(p_tenant,'customer_follow_up') or not (
  exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor)
  or exists(select 1 from public.platform_admins where user_id=p_actor)) then
  raise exception 'Forbidden' using errcode='42501';
 end if;
 select * into j from public.follow_up_jobs where id=p_job and tenant_id=p_tenant;
 if not found then raise exception 'Job not found' using errcode='P0002';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 perform 1 from public.customers where id=j.customer_id and tenant_id=p_tenant for update;
 select * into j from public.follow_up_jobs where id=p_job and tenant_id=p_tenant for update;
 if j.status<>'failed' or coalesce(j.reason,'') not in ('api_rejected','page_restricted')
 or j.dispatch_started_at is null or j.provider_message_id is not null
 or j.claim_token is not null or j.claim_until is not null
 or j.reserved_monthly<>0 or j.reserved_topup<>0 then
  raise exception 'Only confirmed rejected sends can retry' using errcode='40001';
 end if;
 select * into m from public.messages where id=j.message_id and customer_id=j.customer_id for update;
 if m.id is null or m.delivery_status is distinct from 'failed' or m.provider_message_id is not null
 or m.external_id is distinct from 'followup:'||j.id::text then
  raise exception 'Delivery outcome is not a confirmed refusal' using errcode='40001';
 end if;
 if not public.follow_up_window_open(p_tenant,j.customer_id) then
  update public.follow_up_jobs set status='cancelled',reason='outside_24h_window' where id=j.id;
  insert into public.follow_up_execution_logs(tenant_id,job_id,status,reason,actor_id)
  values(p_tenant,j.id,'admin_action','retry_outside_24h_window',p_actor);
  return 'cancelled';
 end if;
 update public.messages set external_id='followup:'||j.id::text||':rejected:'||m.id::text where id=m.id;
 update public.follow_up_jobs set status='pending',reason=null,attempts=0,
  run_at=greatest(run_at,clock_timestamp()),dispatch_started_at=null,send_authorized_at=null,
  message_id=null,delivery_lease=null,sent_at=null where id=j.id;
 insert into public.follow_up_execution_logs(tenant_id,job_id,status,reason,actor_id)
 values(p_tenant,j.id,'admin_action','retry_confirmed_refusal',p_actor);
 return 'pending';
end $$;

revoke all on function public.apply_follow_up_approval_mode() from public,anon,authenticated,service_role;
revoke all on function public.set_follow_up_approval_mode(uuid,uuid,text),public.retry_rejected_follow_up(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.set_follow_up_approval_mode(uuid,uuid,text),public.retry_rejected_follow_up(uuid,uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
