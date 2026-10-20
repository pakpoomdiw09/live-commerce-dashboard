-- Run after agent-control.sql, smart-follow-ups.sql and bank-accounts.sql.
-- Adds a service-only, owner-authorized setting action. No settings change on installation.
begin;
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
 -- Serialize with start_agent_ai_call, which also locks the tenant before reserving quota.
 -- Enabling a switch does not consume quota. Disabling remains available after expiry.
 if p_enabled then
   if not public.has_tenant_feature(p_tenant,'ai_agent')
   or p_capability='slips' and not public.has_tenant_feature(p_tenant,'slip_auto_pilot')
   or p_capability='followup' and not public.has_tenant_feature(p_tenant,'customer_follow_up') then raise exception 'Feature locked' using errcode='P0403';end if;
   select used into used_count from public.agent_ai_monthly_usage where tenant_id=p_tenant and month=date_trunc('month',timezone('UTC',now()))::date for update;
   if settings.ai_monthly_limit<=coalesce(used_count,0) then raise exception 'AI quota exhausted' using errcode='P0402';end if;
   if p_capability='slips' then
     select coalesce(slip_quota,0)::bigint+coalesce(slip_quota_credits,0)::bigint-coalesce(slip_used,0)::bigint into slip_remaining from public.tenants where id=p_tenant;
     if slip_remaining<=0 then raise exception 'Slip quota exhausted' using errcode='P0404';end if;
   end if;
 end if;
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
revoke all on function public.set_agent_overview_capability(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.set_agent_overview_capability(uuid,uuid,text,boolean) to service_role;
commit;
