-- Apply after smart-inbox.sql and feature-access.sql. Keeps Pro receipts and triggers intact.
-- Repairs the legacy atomic action RPC also called by manage_inbox_pro.
-- No direct unconditional UPDATE fallback; owner/member, version and delivery leases remain enforced.
begin;
create or replace function public.manage_inbox_conversation(p_customer uuid,p_actor uuid,p_action text,p_version integer,p_assignee uuid default null) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare c public.customers;previous uuid; mode text;
begin
 select * into c from public.customers where id=p_customer for update;
 if not found or not(exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_actor)
    or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Forbidden' using errcode='42501';end if;
 if not public.has_tenant_feature(c.tenant_id,'customer_management') then raise exception 'FEATURE_LOCKED' using errcode='42501';end if;
 if p_version is null or c.conversation_version<>p_version then raise exception 'Conversation changed; reload and retry' using errcode='40001';end if;
 if c.outbound_lock_until>clock_timestamp() then raise exception 'A message is being sent; retry shortly' using errcode='55P03';end if;
 previous:=c.assigned_user_id;
 if p_action in ('close','reopen','pause','bot') and c.assigned_user_id is not null and c.assigned_user_id<>p_actor
  and not exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_actor and role='owner')
  and not exists(select 1 from public.platform_admins where user_id=p_actor) then raise exception 'Conversation belongs to another agent' using errcode='42501';end if;
 if p_action='claim' then
  if c.assigned_user_id is not null and c.assigned_user_id<>p_actor then raise exception 'Already assigned' using errcode='40001';end if;
  c.assigned_user_id:=p_actor;c.bot_enabled:=false;c.conversation_status:='open';
 elsif p_action='transfer' then
  if c.assigned_user_id is distinct from p_actor and not exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_actor and role='owner')
   and not exists(select 1 from public.platform_admins where user_id=p_actor) then raise exception 'Forbidden' using errcode='42501';end if;
  if not exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_assignee) then raise exception 'Assignee is not a shop member' using errcode='22023';end if;
  c.assigned_user_id:=p_assignee;c.bot_enabled:=false;c.conversation_status:='open';
 elsif p_action='close' then c.conversation_status:='closed';c.bot_enabled:=false;
 elsif p_action='reopen' then c.conversation_status:='open';c.bot_enabled:=false;
 elsif p_action='pause' then c.bot_enabled:=false;
 elsif p_action='bot' then
  select reply_mode into mode from public.bot_settings where tenant_id=c.tenant_id;
  if mode is null or not exists(select 1 from public.tenants where id=c.tenant_id and auto_reply_enabled) then raise exception 'Bot is not configured or enabled' using errcode='22023';end if;
  if mode='ai' and not public.has_tenant_feature(c.tenant_id,'ai_agent') then raise exception 'FEATURE_LOCKED: ai_agent' using errcode='42501';end if;
  c.bot_enabled:=true;c.assigned_user_id:=null;c.conversation_status:='open';
 else raise exception 'Unknown action' using errcode='22023';end if;
 update public.customers set assigned_user_id=c.assigned_user_id,bot_enabled=c.bot_enabled,conversation_status=c.conversation_status,
  conversation_version=conversation_version+1,handover_at=case when c.bot_enabled then null else now() end where id=c.id;
 insert into public.conversation_events(tenant_id,customer_id,actor_id,action,previous_assignee,next_assignee)
 values(c.tenant_id,c.id,p_actor,p_action,previous,c.assigned_user_id);
 return jsonb_build_object('ok',true,'customer',(
  select jsonb_build_object('id',id,'tenant_id',tenant_id,'assigned_user_id',assigned_user_id,
    'bot_enabled',bot_enabled,'conversation_status',conversation_status,
    'conversation_version',conversation_version,'inbound_seq',inbound_seq)
  from public.customers where id=c.id and tenant_id=c.tenant_id
  ));
end $$;
revoke all on function public.manage_inbox_conversation(uuid,uuid,text,integer,uuid) from public,anon,authenticated;
grant execute on function public.manage_inbox_conversation(uuid,uuid,text,integer,uuid) to service_role;
commit;
