-- Run LAST after free-message-quota.sql. Service-only mutations; safe to rerun.
begin;
alter table public.customers add column if not exists assigned_user_id uuid references auth.users(id) on delete set null;
alter table public.customers add column if not exists conversation_status text not null default 'open' check(conversation_status in ('open','closed'));
alter table public.customers add column if not exists conversation_version integer not null default 0;
alter table public.customers add column if not exists inbound_seq bigint not null default 0;
alter table public.customers add column if not exists outbound_lock uuid;
alter table public.customers add column if not exists outbound_lock_until timestamptz;
alter table public.messages add column if not exists inbound_seq bigint;
alter table public.messages add column if not exists provider_message_id text;
alter table public.messages add column if not exists delivery_status text check(delivery_status in ('pending','sent','delivered','read','failed','unknown'));
create index if not exists messages_provider_id on public.messages(provider_message_id) where provider_message_id is not null;
grant select(assigned_user_id,conversation_status,conversation_version,inbound_seq) on public.customers to authenticated;
-- Sequence legacy incoming messages once; counters never move backwards on reruns.
with numbered as(select id,row_number() over(partition by customer_id order by created_at,id) seq from public.messages where sender='customer')
 update public.messages m set inbound_seq=n.seq from numbered n where m.id=n.id and m.inbound_seq is null;
update public.customers c set inbound_seq=greatest(c.inbound_seq,coalesce((select max(m.inbound_seq) from public.messages m where m.customer_id=c.id),0));

create table if not exists public.conversation_reads(
 customer_id uuid not null references public.customers(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 read_seq bigint not null default 0, primary key(customer_id,user_id)
);
create table if not exists public.conversation_events(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,
 customer_id uuid not null references public.customers(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,action text not null,
 previous_assignee uuid,next_assignee uuid,created_at timestamptz not null default now()
);
alter table public.conversation_reads enable row level security;
alter table public.conversation_events enable row level security;
revoke all on public.conversation_reads,public.conversation_events from public,anon,authenticated;
grant select on public.conversation_reads,public.conversation_events to authenticated;
grant all on public.conversation_reads,public.conversation_events to service_role;
drop policy if exists own_read on public.conversation_reads;
create policy own_read on public.conversation_reads for select to authenticated using(user_id=auth.uid() and exists(select 1 from public.customers c where c.id=customer_id and public.can_access_tenant(c.tenant_id) and public.has_tenant_feature(c.tenant_id,'customer_management')));
drop policy if exists member_read on public.conversation_events;
create policy member_read on public.conversation_events for select to authenticated using(public.can_access_tenant(tenant_id) and public.has_tenant_feature(tenant_id,'customer_management'));

create or replace function public.inbox_incoming_message() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.sender='customer' then
  update public.customers set inbound_seq=inbound_seq+1,conversation_status='open',conversation_version=conversation_version+1,
    last_message_at=greatest(coalesce(last_message_at,new.created_at),new.created_at)
    where id=new.customer_id returning inbound_seq into new.inbound_seq;
 end if;
 return new;
end $$;
drop trigger if exists inbox_message_counter on public.messages;
create trigger inbox_message_counter before insert on public.messages for each row execute function public.inbox_incoming_message();

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
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.mark_inbox_read(p_customer uuid,p_actor uuid,p_message uuid) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare c public.customers;seq bigint;
begin
 select * into c from public.customers where id=p_customer;
 if not found or not public.has_tenant_feature(c.tenant_id,'customer_management') or not(exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_actor) or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Forbidden' using errcode='42501';end if;
 select inbound_seq into seq from public.messages where id=p_message and customer_id=p_customer and sender='customer';
 if seq is null then return;end if;
 insert into public.conversation_reads(customer_id,user_id,read_seq) values(p_customer,p_actor,seq)
 on conflict(customer_id,user_id) do update set read_seq=greatest(conversation_reads.read_seq,excluded.read_seq);
end $$;

-- A short delivery lease serializes handoff against actual network sends. AI drafting holds no lease.
create or replace function public.start_inbox_delivery(p_customer uuid,p_actor uuid default null) returns uuid
language plpgsql set search_path=pg_catalog,public as $$
declare c public.customers;lease uuid:=gen_random_uuid();
begin
 select * into c from public.customers where id=p_customer for update;
 if not found or c.conversation_status='closed' or not exists(select 1 from public.tenants where id=c.tenant_id and is_active) then raise exception 'Conversation unavailable' using errcode='40001';end if;
 if p_actor is null then
  if not c.bot_enabled then raise exception 'Bot paused for human handoff' using errcode='40001';end if;
 else
  if c.assigned_user_id is distinct from p_actor or c.bot_enabled or not public.has_tenant_feature(c.tenant_id,'customer_management') then raise exception 'Claim the conversation first' using errcode='42501';end if;
  if not(exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_actor) or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Forbidden' using errcode='42501';end if;
 end if;
 if c.outbound_lock_until>clock_timestamp() then raise exception 'Delivery busy' using errcode='55P03';end if;
 update public.customers set outbound_lock=lease,outbound_lock_until=clock_timestamp()+interval '2 minutes' where id=p_customer;
 return lease;
end $$;
create or replace function public.end_inbox_delivery(p_customer uuid,p_lease uuid) returns void
language sql set search_path=pg_catalog,public as $$update public.customers set outbound_lock=null,outbound_lock_until=null where id=p_customer and outbound_lock=p_lease$$;
create or replace function public.start_inbox_handover(p_customer uuid) returns uuid
language plpgsql set search_path=pg_catalog,public as $$
declare lease uuid;target uuid;
begin
 lease:=public.start_inbox_delivery(p_customer,null);
 update public.customers set bot_enabled=false,handover_at=now(),conversation_version=conversation_version+1 where id=p_customer returning tenant_id into target;
 insert into public.conversation_events(tenant_id,customer_id,action) values(target,p_customer,'handover');
 return lease;
end $$;

-- Browser writes cannot bypass versioning, audit or delivery leases through BotToggle.
revoke update(bot_enabled) on public.customers from authenticated;
revoke all on function public.manage_inbox_conversation(uuid,uuid,text,integer,uuid),public.mark_inbox_read(uuid,uuid,uuid),public.start_inbox_delivery(uuid,uuid),public.end_inbox_delivery(uuid,uuid),public.inbox_incoming_message() from public,anon,authenticated;
grant execute on function public.manage_inbox_conversation(uuid,uuid,text,integer,uuid),public.mark_inbox_read(uuid,uuid,uuid),public.start_inbox_delivery(uuid,uuid),public.end_inbox_delivery(uuid,uuid) to service_role;
revoke all on function public.start_inbox_handover(uuid) from public,anon,authenticated;
grant execute on function public.start_inbox_handover(uuid) to service_role;

create table if not exists public.inbox_media(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,uploaded_by uuid not null references auth.users(id),path text not null unique,name text not null,mime text not null,kind text not null check(kind in ('image','file')),created_at timestamptz not null default now());
alter table public.inbox_media enable row level security;
revoke all on public.inbox_media from public,anon,authenticated;
grant select,insert,delete on public.inbox_media to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('inbox-media','inbox-media',false,8388608,array['image/jpeg','image/png','image/gif','image/webp','application/pdf']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
do $$begin alter publication supabase_realtime add table public.conversation_reads;exception when duplicate_object then null;end $$;
commit;
