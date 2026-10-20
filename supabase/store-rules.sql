-- Run after automation.sql, agent-control.sql and ai-paid-access.sql.
-- Expands Store Rules to 50,000 characters. No provider calls, balance changes or data deletion.
begin;
alter table public.bot_settings drop constraint if exists bot_settings_ai_instructions_check;
alter table public.bot_settings add constraint bot_settings_ai_instructions_check check(length(ai_instructions)<=50000);
create or replace function public.save_agent_prompt(p_tenant uuid,p_actor uuid,p_instructions text) returns void
language plpgsql set search_path=pg_catalog,public as $$
begin
 if not public.has_tenant_feature(p_tenant,'ai_agent')
 or not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner')
 or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Owner required' using errcode='42501';end if;
 if length(p_instructions)>50000 then raise exception 'Store rules exceed 50000 characters' using errcode='22023';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 perform set_config('snapbot.agent_actor',p_actor::text,true);
 insert into public.bot_settings(tenant_id,ai_instructions) values(p_tenant,p_instructions)
 on conflict(tenant_id) do update set ai_instructions=excluded.ai_instructions;
 insert into public.agent_control_audit(tenant_id,actor_id,event) values(p_tenant,p_actor,'prompt_saved');
end $$;
revoke all on function public.save_agent_prompt(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.save_agent_prompt(uuid,uuid,text) to service_role;
-- Archived Q&A records remain intact, but their management RPC is retired.
revoke all on function public.manage_agent_knowledge(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
