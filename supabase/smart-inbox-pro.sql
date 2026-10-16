-- Additive. Run after smart-inbox.sql. No network, credential changes or data deletion.
begin;
alter table public.customers add column if not exists inbox_stage text;
alter table public.customers add column if not exists closed_at timestamptz;
alter table public.customers add column if not exists closed_by uuid references auth.users(id);
alter table public.customers add column if not exists close_reason text;
update public.customers set inbox_stage=case when conversation_status='closed' then 'CLOSED' when assigned_user_id is not null then 'ASSIGNED' else 'UNASSIGNED' end where inbox_stage is null;
alter table public.customers alter column inbox_stage set default 'UNASSIGNED';
alter table public.customers alter column inbox_stage set not null;
do $$begin if not exists(select 1 from pg_constraint where conname='customers_inbox_stage_check' and conrelid='public.customers'::regclass) then
 alter table public.customers add constraint customers_inbox_stage_check check(inbox_stage in ('UNASSIGNED','ASSIGNED','IN_PROGRESS','RESOLVED','CLOSED'));
end if;end $$;
alter table public.conversation_events add column if not exists reason text;
alter table public.conversation_events add column if not exists request_id uuid;
grant select(inbox_stage,closed_at,closed_by,close_reason) on public.customers to authenticated;
create table if not exists public.inbox_action_receipts(
 tenant_id uuid not null references public.tenants(id),actor_id uuid not null references auth.users(id),request_id uuid not null,
 customer_id uuid not null references public.customers(id),payload jsonb not null,result jsonb not null,
 created_at timestamptz not null default now(),primary key(tenant_id,actor_id,request_id)
);
create index if not exists inbox_action_rate on public.inbox_action_receipts(tenant_id,actor_id,created_at);
create index if not exists customers_inbox_pro_queue on public.customers(tenant_id,inbox_stage,last_message_at);
create index if not exists messages_inbox_pro_reply on public.messages(customer_id,created_at,id) where sender='agent' and delivery_status in ('sent','delivered','read');
alter table public.inbox_action_receipts enable row level security;
revoke all on public.inbox_action_receipts from public,anon,authenticated;
grant select,insert on public.inbox_action_receipts to service_role;

-- Existing legacy/webhook/handoff writers keep the new lifecycle consistent.
create or replace function public.sync_inbox_pro_stage() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.conversation_status='closed' then new.inbox_stage:='CLOSED';
 elsif tg_op='INSERT' then new.inbox_stage:=case when new.assigned_user_id is null then 'UNASSIGNED' else 'ASSIGNED' end;
 elsif new.assigned_user_id is distinct from old.assigned_user_id or new.conversation_status is distinct from old.conversation_status or new.bot_enabled and not old.bot_enabled then
  new.inbox_stage:=case when new.assigned_user_id is null then 'UNASSIGNED' else 'ASSIGNED' end;
 end if;
 if new.conversation_status<>'closed' then new.closed_at:=null;new.closed_by:=null;new.close_reason:=null;end if;
 return new;
end $$;
drop trigger if exists customers_inbox_pro_stage on public.customers;
create trigger customers_inbox_pro_stage before insert or update on public.customers for each row execute function public.sync_inbox_pro_stage();

create or replace function public.manage_inbox_pro(p_customer uuid,p_actor uuid,p_action text,p_version integer,p_key uuid,p_reason text default null,p_assignee uuid default null) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare c public.customers;manager boolean;payload jsonb;receipt public.inbox_action_receipts;result jsonb;previous uuid;event_id uuid;
begin
 select * into c from public.customers where id=p_customer for update;
 if not found or not public.has_tenant_feature(c.tenant_id,'customer_management') or not (
  exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_actor) or exists(select 1 from public.platform_admins where user_id=p_actor)
 ) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_key is null or p_action is null or p_action not in ('claim','transfer','release','start','resolve','close','reopen','pause','bot') or p_version is null or p_version<0 or length(coalesce(p_reason,''))>500 then raise exception 'Invalid action' using errcode='22023';end if;
 payload:=jsonb_build_object('customer',p_customer,'action',p_action,'version',p_version,'reason',p_reason,'assignee',p_assignee);
 -- Serialize per actor too: different customer requests cannot race the rate limit/key.
 perform pg_advisory_xact_lock(hashtextextended(c.tenant_id::text||':'||p_actor::text,0));
 select * into receipt from public.inbox_action_receipts where tenant_id=c.tenant_id and actor_id=p_actor and request_id=p_key;
 if found then
  if receipt.payload<>payload then raise exception 'Request key reused' using errcode='22023';end if;
  return receipt.result;
 end if;
 if (select count(*) from public.inbox_action_receipts where tenant_id=c.tenant_id and actor_id=p_actor and created_at>clock_timestamp()-interval '1 minute')>=30 then raise exception 'Rate limit' using errcode='P0429';end if;
 if c.conversation_version<>p_version then raise exception 'Conversation changed' using errcode='40001';end if;
 if c.outbound_lock_until>clock_timestamp() then raise exception 'Delivery busy' using errcode='55P03';end if;
 manager:=exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_actor and role='owner') or exists(select 1 from public.platform_admins where user_id=p_actor);
 previous:=c.assigned_user_id;
 if p_action='transfer' and p_assignee=c.assigned_user_id or p_action='start' and c.inbox_stage='IN_PROGRESS' or p_action='resolve' and c.inbox_stage='RESOLVED' or p_action='release' and c.assigned_user_id is null then raise exception 'State already applied' using errcode='40001';end if;
 if p_action='close' and nullif(trim(p_reason),'') is null then raise exception 'Close reason required' using errcode='22023';end if;
 if p_action in ('release','start','resolve') then
  if c.conversation_status='closed' or (c.assigned_user_id is distinct from p_actor and not manager) then raise exception 'Not assigned to actor' using errcode='42501';end if;
  if p_action in ('start','resolve') and c.assigned_user_id is null then raise exception 'Claim first' using errcode='22023';end if;
  update public.customers set assigned_user_id=case when p_action='release' then null else assigned_user_id end,
   bot_enabled=false,conversation_version=conversation_version+1,handover_at=coalesce(handover_at,now()),
   inbox_stage=case p_action when 'release' then 'UNASSIGNED' when 'start' then 'IN_PROGRESS' else 'RESOLVED' end where id=c.id;
  insert into public.conversation_events(tenant_id,customer_id,actor_id,action,previous_assignee,next_assignee,reason,request_id)
   values(c.tenant_id,c.id,p_actor,p_action,previous,case when p_action='release' then null else previous end,p_reason,p_key);
 else
  if p_action='claim' and c.conversation_status='closed' then raise exception 'Reopen first' using errcode='22023';end if;
  if p_action='claim' and c.assigned_user_id=p_actor then raise exception 'Already assigned' using errcode='40001';end if;
  if p_action='close' and c.conversation_status='closed' or p_action='reopen' and c.conversation_status<>'closed' then raise exception 'Conversation changed' using errcode='40001';end if;
  perform public.manage_inbox_conversation(p_customer,p_actor,p_action,p_version,p_assignee);
  select id into event_id from public.conversation_events where customer_id=c.id and actor_id=p_actor and action=p_action order by created_at desc,id desc limit 1;
  update public.conversation_events set reason=p_reason,request_id=p_key where id=event_id;
  if p_action='close' then update public.customers set closed_at=now(),closed_by=p_actor,close_reason=trim(p_reason) where id=c.id;end if;
 end if;
 select jsonb_build_object('ok',true,'stage',inbox_stage,'version',conversation_version) into result from public.customers where id=c.id;
 insert into public.inbox_action_receipts(tenant_id,actor_id,request_id,customer_id,payload,result) values(c.tenant_id,p_actor,p_key,c.id,payload,result);
 return result;
end $$;
revoke all on function public.manage_inbox_pro(uuid,uuid,text,integer,uuid,text,uuid),public.sync_inbox_pro_stage() from public,anon,authenticated;
grant execute on function public.manage_inbox_pro(uuid,uuid,text,integer,uuid,text,uuid) to service_role;
create or replace function public.inbox_pro_message_progress() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.sender='agent' then
  update public.customers set inbox_stage='IN_PROGRESS',conversation_version=conversation_version+1 where id=new.customer_id and assigned_user_id is not null and conversation_status='open' and inbox_stage in ('ASSIGNED','RESOLVED');
 elsif new.sender='customer' then
  update public.customers set inbox_stage=case when assigned_user_id is null then 'UNASSIGNED' else 'IN_PROGRESS' end,conversation_version=conversation_version+1 where id=new.customer_id and inbox_stage='RESOLVED';
 end if;
 return null;
end $$;
drop trigger if exists messages_inbox_pro_progress on public.messages;
create trigger messages_inbox_pro_progress after insert on public.messages for each row execute function public.inbox_pro_message_progress();
revoke all on function public.inbox_pro_message_progress() from public,anon,authenticated;

create or replace function public.inbox_pro_overview(p_tenant uuid) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 with counters as (
  select count(*) total,count(*) filter(where inbox_stage='UNASSIGNED' and not bot_enabled) waiting,
   count(*) filter(where inbox_stage in ('ASSIGNED','IN_PROGRESS')) active,
   count(*) filter(where inbox_stage='CLOSED') closed,count(*) filter(where inbox_stage='RESOLVED') resolved,
   count(*) filter(where bot_enabled and conversation_status='open' and assigned_user_id is null) bot,
   count(*) filter(where bot_enabled and conversation_status='open' and assigned_user_id is null and exists(select 1 from public.bot_settings where tenant_id=p_tenant and reply_mode='ai') and public.has_tenant_feature(p_tenant,'ai_agent')) ai,
   count(*) filter(where conversation_status='open' and not bot_enabled and assigned_user_id is null and last_message_at<now()-interval '15 minutes') overdue
  from public.customers where tenant_id=p_tenant
 ), responses as (
  select extract(epoch from(reply.created_at-m.created_at)) seconds from public.messages m
  join public.customers c on c.id=m.customer_id and c.tenant_id=p_tenant
  join lateral (select a.created_at from public.messages a where a.customer_id=c.id and a.sender='agent' and a.delivery_status in ('sent','delivered','read') and a.created_at>=m.created_at order by a.created_at,a.id limit 1) reply on true
  where m.sender='customer' and m.created_at>now()-interval '30 days'
 ), team as (
  select actor_id,count(*) filter(where action='close') closed,count(*) filter(where action='claim') claimed from public.conversation_events where tenant_id=p_tenant and created_at>now()-interval '30 days' and actor_id is not null group by actor_id
 )
 select jsonb_build_object('counts',(select row_to_json(counters) from counters),'averageResponseSeconds',(select round(avg(seconds)) from responses),
  'responseSamples',(select count(*) from responses),'team',coalesce((select jsonb_agg(row_to_json(team)) from team),'[]'::jsonb),'overdueMinutes',15,'days',30)
$$;
revoke all on function public.inbox_pro_overview(uuid) from public,anon,authenticated;
grant execute on function public.inbox_pro_overview(uuid) to service_role;
notify pgrst,'reload schema';
commit;
