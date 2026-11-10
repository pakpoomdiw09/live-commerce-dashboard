-- Owners and platform admins may take over a conversation before replying.
-- Staff still need to claim an unassigned conversation or already own its assignment.
begin;

create or replace function public.manage_inbox_conversation(
  p_customer uuid,
  p_actor uuid,
  p_action text,
  p_version integer,
  p_assignee uuid default null
) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare
  c public.customers;
  previous uuid;
  mode text;
  manager boolean;
begin
  select * into c from public.customers where id=p_customer for update;
  if not found or not (
    exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_actor)
    or exists(select 1 from public.platform_admins where user_id=p_actor)
  ) then
    raise exception 'Forbidden' using errcode='42501';
  end if;
  if not public.has_tenant_feature(c.tenant_id,'customer_management') then
    raise exception 'FEATURE_LOCKED' using errcode='42501';
  end if;
  if p_version is null or c.conversation_version<>p_version then
    raise exception 'Conversation changed; reload and retry' using errcode='40001';
  end if;
  if c.outbound_lock_until>clock_timestamp() then
    raise exception 'A message is being sent; retry shortly' using errcode='55P03';
  end if;

  manager := exists(
    select 1 from public.tenant_members
    where tenant_id=c.tenant_id and user_id=p_actor and role='owner'
  ) or exists(select 1 from public.platform_admins where user_id=p_actor);
  previous := c.assigned_user_id;

  if p_action in ('close','reopen','pause','bot')
     and c.assigned_user_id is not null and c.assigned_user_id<>p_actor and not manager then
    raise exception 'Conversation belongs to another agent' using errcode='42501';
  end if;

  if p_action='claim' then
    if c.assigned_user_id is not null and c.assigned_user_id<>p_actor and not manager then
      raise exception 'Already assigned' using errcode='40001';
    end if;
    c.assigned_user_id:=p_actor;
    c.bot_enabled:=false;
    c.conversation_status:='open';
  elsif p_action='transfer' then
    if c.assigned_user_id is distinct from p_actor and not manager then
      raise exception 'Forbidden' using errcode='42501';
    end if;
    if not exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_assignee) then
      raise exception 'Assignee is not a shop member' using errcode='22023';
    end if;
    c.assigned_user_id:=p_assignee;
    c.bot_enabled:=false;
    c.conversation_status:='open';
  elsif p_action='close' then
    c.conversation_status:='closed';
    c.bot_enabled:=false;
  elsif p_action='reopen' then
    c.conversation_status:='open';
    c.bot_enabled:=false;
  elsif p_action='pause' then
    c.bot_enabled:=false;
  elsif p_action='bot' then
    select reply_mode into mode from public.bot_settings where tenant_id=c.tenant_id;
    if mode is null or not exists(select 1 from public.tenants where id=c.tenant_id and auto_reply_enabled) then
      raise exception 'Bot is not configured or enabled' using errcode='22023';
    end if;
    if mode='ai' and not public.has_tenant_feature(c.tenant_id,'ai_agent') then
      raise exception 'FEATURE_LOCKED: ai_agent' using errcode='42501';
    end if;
    c.bot_enabled:=true;
    c.assigned_user_id:=null;
    c.conversation_status:='open';
  else
    raise exception 'Unknown action' using errcode='22023';
  end if;

  update public.customers
  set assigned_user_id=c.assigned_user_id,
      bot_enabled=c.bot_enabled,
      conversation_status=c.conversation_status,
      conversation_version=conversation_version+1,
      handover_at=case when c.bot_enabled then null else now() end
  where id=c.id;
  insert into public.conversation_events(tenant_id,customer_id,actor_id,action,previous_assignee,next_assignee)
  values(c.tenant_id,c.id,p_actor,p_action,previous,c.assigned_user_id);
  return jsonb_build_object('ok',true,'customer',(
    select jsonb_build_object(
      'id',id,'tenant_id',tenant_id,'assigned_user_id',assigned_user_id,
      'bot_enabled',bot_enabled,'conversation_status',conversation_status,
      'conversation_version',conversation_version,'inbound_seq',inbound_seq
    )
    from public.customers where id=c.id and tenant_id=c.tenant_id
  ));
end $$;

create or replace function public.claim_and_start_inbox_reply(
  p_customer uuid,
  p_actor uuid,
  p_version integer
) returns uuid
language plpgsql set search_path=pg_catalog,public as $$
declare
  c public.customers;
  manager boolean;
begin
  select * into c from public.customers where id=p_customer for update;
  if not found then raise exception 'Conversation unavailable' using errcode='40001';end if;
  if not public.has_tenant_feature(c.tenant_id,'customer_management') or not (
    exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_actor)
    or exists(select 1 from public.platform_admins where user_id=p_actor)
  ) then
    raise exception 'Forbidden' using errcode='42501';
  end if;
  manager := exists(
    select 1 from public.tenant_members
    where tenant_id=c.tenant_id and user_id=p_actor and role='owner'
  ) or exists(select 1 from public.platform_admins where user_id=p_actor);
  if c.conversation_version is distinct from p_version
     or c.conversation_status='closed'
     or (c.assigned_user_id is not null and c.assigned_user_id<>p_actor and not manager) then
    raise exception 'Conversation changed' using errcode='40001';
  end if;
  if c.bot_enabled or c.assigned_user_id is distinct from p_actor then
    perform public.manage_inbox_conversation(p_customer,p_actor,'claim',p_version);
  end if;
  return public.start_inbox_delivery(p_customer,p_actor);
end $$;

create or replace function public.start_inbox_delivery(
  p_customer uuid,
  p_actor uuid default null
) returns uuid
language plpgsql set search_path=pg_catalog,public as $$
declare
  c public.customers;
  lease uuid:=gen_random_uuid();
  inbound_at timestamptz;
  manager boolean:=false;
begin
  select * into c from public.customers where id=p_customer for update;
  if not found or c.conversation_status='closed'
     or not exists(select 1 from public.tenants where id=c.tenant_id and is_active) then
    raise exception 'Conversation unavailable' using errcode='40001';
  end if;

  if p_actor is null then
    if not c.bot_enabled or c.assigned_user_id is not null then
      raise exception 'Automation paused for human handoff' using errcode='40001';
    end if;
  else
    if not public.has_tenant_feature(c.tenant_id,'customer_management') or not (
      exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_actor)
      or exists(select 1 from public.platform_admins where user_id=p_actor)
    ) then
      raise exception 'Forbidden' using errcode='42501';
    end if;
    manager := exists(
      select 1 from public.tenant_members
      where tenant_id=c.tenant_id and user_id=p_actor and role='owner'
    ) or exists(select 1 from public.platform_admins where user_id=p_actor);
    if manager then
      if c.assigned_user_id is distinct from p_actor or c.bot_enabled then
        update public.customers
        set assigned_user_id=p_actor,
            bot_enabled=false,
            conversation_status='open',
            conversation_version=conversation_version+1,
            handover_at=coalesce(handover_at,clock_timestamp())
        where id=c.id;
        insert into public.conversation_events(
          tenant_id,customer_id,actor_id,action,previous_assignee,next_assignee
        ) values(c.tenant_id,c.id,p_actor,'claim',c.assigned_user_id,p_actor);
        c.assigned_user_id:=p_actor;
        c.bot_enabled:=false;
      end if;
    elsif c.assigned_user_id is distinct from p_actor or c.bot_enabled then
      raise exception 'Claim the conversation first' using errcode='42501';
    end if;
  end if;

  if c.platform='facebook' then
    inbound_at:=public.inbox_verified_inbound_at(c.tenant_id,c.id);
    if inbound_at is null or inbound_at<=clock_timestamp()-(
      case when p_actor is null then interval '24 hours' else interval '7 days' end
    ) then
      raise exception 'Messaging window closed' using errcode='P0424';
    end if;
  end if;
  if c.outbound_lock_until>clock_timestamp() then
    raise exception 'Delivery busy' using errcode='55P03';
  end if;
  update public.customers
  set outbound_lock=lease,outbound_lock_until=clock_timestamp()+interval '2 minutes'
  where id=p_customer;
  return lease;
end $$;

revoke all on function public.manage_inbox_conversation(uuid,uuid,text,integer,uuid) from public,anon,authenticated;
grant execute on function public.manage_inbox_conversation(uuid,uuid,text,integer,uuid) to service_role;
revoke all on function public.claim_and_start_inbox_reply(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_and_start_inbox_reply(uuid,uuid,integer) to service_role;
revoke all on function public.start_inbox_delivery(uuid,uuid) from public,anon,authenticated;
grant execute on function public.start_inbox_delivery(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
