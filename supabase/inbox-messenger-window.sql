-- Apply after smart-inbox.sql, broadcast-policy.sql and agent-control.sql.
-- Windows use signed inbound evidence. Installation does not rewrite chat settings or send messages.
begin;
create or replace function public.inbox_verified_inbound_at(p_tenant uuid,p_customer uuid)
returns timestamptz language sql stable set search_path=pg_catalog,public as $$
 select max(e.interacted_at) from public.broadcast_messaging_events e
 join public.tenants t on t.id=e.tenant_id and t.page_id=e.page_id
 where e.tenant_id=p_tenant and e.customer_id=p_customer and e.kind='inbound_message'
 and e.interacted_at<=statement_timestamp();
$$;

create or replace function public.start_inbox_delivery(p_customer uuid,p_actor uuid default null) returns uuid
language plpgsql set search_path=pg_catalog,public as $$
declare c public.customers;lease uuid:=gen_random_uuid();inbound_at timestamptz;
begin
 select * into c from public.customers where id=p_customer for update;
 if not found or c.conversation_status='closed' or not exists(select 1 from public.tenants where id=c.tenant_id and is_active) then raise exception 'Conversation unavailable' using errcode='40001';end if;
 if p_actor is null then
  if not c.bot_enabled or c.assigned_user_id is not null then raise exception 'Automation paused for human handoff' using errcode='40001';end if;
 else
  if c.assigned_user_id is distinct from p_actor or c.bot_enabled or not public.has_tenant_feature(c.tenant_id,'customer_management') then raise exception 'Claim the conversation first' using errcode='42501';end if;
  if not(exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_actor) or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Forbidden' using errcode='42501';end if;
 end if;
 if c.platform='facebook' then
  inbound_at:=public.inbox_verified_inbound_at(c.tenant_id,c.id);
  if inbound_at is null or inbound_at<=clock_timestamp()-(case when p_actor is null then interval '24 hours' else interval '7 days' end) then
   raise exception 'Messaging window closed' using errcode='P0424';
  end if;
 end if;
 if c.outbound_lock_until>clock_timestamp() then raise exception 'Delivery busy' using errcode='55P03';end if;
 update public.customers set outbound_lock=lease,outbound_lock_until=clock_timestamp()+interval '2 minutes' where id=p_customer;
 return lease;
end $$;

create or replace function public.guard_inbox_automation_window() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare inbound_at timestamptz;
begin
 if new.bot_enabled and not old.bot_enabled and new.platform='facebook' then
  inbound_at:=public.inbox_verified_inbound_at(new.tenant_id,new.id);
  if inbound_at is null or inbound_at<=clock_timestamp()-interval '24 hours' then raise exception 'Messaging window closed' using errcode='P0424';end if;
 end if;
 return new;
end $$;
drop trigger if exists inbox_automation_window on public.customers;
create trigger inbox_automation_window before update of bot_enabled on public.customers for each row execute function public.guard_inbox_automation_window();

create or replace function public.guard_agent_dispatch_window() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare inbound_at timestamptz;
begin
 if new.dispatch_started_at is not null and old.dispatch_started_at is null
 and exists(select 1 from public.customers where id=new.customer_id and tenant_id=new.tenant_id and platform='facebook') then
  inbound_at:=public.inbox_verified_inbound_at(new.tenant_id,new.customer_id);
  if inbound_at is null or inbound_at<=clock_timestamp()-interval '24 hours' then raise exception 'Messaging window closed' using errcode='P0424';end if;
 end if;
 return new;
end $$;
drop trigger if exists agent_dispatch_window on public.agent_message_jobs;
create trigger agent_dispatch_window before update of dispatch_started_at on public.agent_message_jobs for each row execute function public.guard_agent_dispatch_window();
revoke all on function public.inbox_verified_inbound_at(uuid,uuid),public.start_inbox_delivery(uuid,uuid),public.guard_inbox_automation_window(),public.guard_agent_dispatch_window() from public,anon,authenticated;
grant execute on function public.inbox_verified_inbound_at(uuid,uuid),public.start_inbox_delivery(uuid,uuid) to service_role;
notify pgrst,'reload schema';
create index if not exists inbox_automation_expiry on public.customers(last_message_at,id) where platform='facebook' and bot_enabled;

create or replace function public.inbox_automation_window_open(p_customer uuid,p_tenant uuid default null)
returns boolean language sql stable set search_path=pg_catalog,public as $$
 select exists(select 1 from public.customers c join public.tenants t on t.id=c.tenant_id and t.is_active
 where c.id=p_customer and (p_tenant is null or c.tenant_id=p_tenant)
 and (c.platform<>'facebook' or public.inbox_verified_inbound_at(c.tenant_id,c.id)>statement_timestamp()-interval '24 hours'));
$$;

create or replace function public.expire_inbox_automation(p_customer uuid) returns boolean
language plpgsql set search_path=pg_catalog,public as $$
declare c public.customers;inbound_at timestamptz;
begin
 select * into c from public.customers where id=p_customer for update;
 if not found or c.platform<>'facebook' or not c.bot_enabled then return false;end if;
 inbound_at:=public.inbox_verified_inbound_at(c.tenant_id,c.id);
 -- The message row may commit just before its signed evidence. Never pause a fresh inbound.
 if inbound_at>clock_timestamp()-interval '24 hours' or c.last_message_at>clock_timestamp()-interval '24 hours' then return false;end if;
 update public.customers set bot_enabled=false,conversation_version=conversation_version+1,handover_at=coalesce(handover_at,clock_timestamp()) where id=c.id;
 insert into public.conversation_events(tenant_id,customer_id,action,previous_assignee,next_assignee) values(c.tenant_id,c.id,'pause',c.assigned_user_id,c.assigned_user_id);
 return true;
end $$;

create or replace function public.expire_inbox_automation_windows(p_limit integer default 200) returns integer
language plpgsql set search_path=pg_catalog,public as $$
declare customer uuid;changed integer:=0;
begin
 if p_limit is null or p_limit not between 1 and 1000 then raise exception 'Invalid batch limit' using errcode='22023';end if;
 for customer in select c.id from public.customers c where c.platform='facebook' and c.bot_enabled
 and (c.last_message_at is null or c.last_message_at<=clock_timestamp()-interval '24 hours')
 and not public.inbox_automation_window_open(c.id,c.tenant_id)
 order by c.last_message_at nulls first,c.id limit p_limit for update skip locked loop
  if public.expire_inbox_automation(customer) then changed:=changed+1;end if;
 end loop;
 return changed;
end $$;
revoke all on function public.inbox_automation_window_open(uuid,uuid),public.expire_inbox_automation(uuid),public.expire_inbox_automation_windows(integer) from public,anon,authenticated;
grant execute on function public.inbox_automation_window_open(uuid,uuid),public.expire_inbox_automation(uuid),public.expire_inbox_automation_windows(integer) to service_role;
commit;
