-- Service-only durable ingress. Apply before deploying the queue-backed webhook.
begin;
alter table public.customers add column if not exists last_interaction_at timestamptz;
create table if not exists public.facebook_webhook_payloads (
 id uuid primary key default gen_random_uuid(), payload_sha256 text not null unique check(payload_sha256 ~ '^[a-f0-9]{64}$'),
 raw_payload text not null check(octet_length(raw_payload)<=2097152), received_at timestamptz not null default clock_timestamp(),
 last_received_at timestamptz not null default clock_timestamp(), delivery_count integer not null default 1
);
create table if not exists public.facebook_webhook_events (
 id uuid primary key default gen_random_uuid(), payload_id uuid not null references public.facebook_webhook_payloads(id),
 sequence bigint generated always as identity unique, page_id text not null, event_key text not null, ordering_key text not null,
 kind text not null check(kind in ('message','change')), payload jsonb not null,
 status text not null default 'pending' check(status in ('pending','processing','completed','dead','requires_review')),
 attempts integer not null default 0, available_at timestamptz not null default clock_timestamp(),
 claim_token uuid, lease_until timestamptz, last_error text, created_at timestamptz not null default clock_timestamp(), completed_at timestamptz,
 unique(page_id,event_key)
);
create index if not exists facebook_webhook_due on public.facebook_webhook_events(available_at,sequence) where status='pending';
create index if not exists facebook_webhook_ordering on public.facebook_webhook_events(page_id,ordering_key,sequence) where status in ('pending','processing','requires_review','dead');
create index if not exists facebook_webhook_leases on public.facebook_webhook_events(lease_until) where status='processing';
create table if not exists public.facebook_webhook_steps (
 event_id uuid not null references public.facebook_webhook_events(id), name text not null check(length(name) between 1 and 120),
 status text not null check(status in ('started','completed')), result jsonb, started_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz, primary key(event_id,name)
);
alter table public.facebook_webhook_payloads enable row level security;
alter table public.facebook_webhook_events enable row level security;
alter table public.facebook_webhook_steps enable row level security;
revoke all on public.facebook_webhook_payloads,public.facebook_webhook_events,public.facebook_webhook_steps from public,anon,authenticated;
grant select,insert,update,delete on public.facebook_webhook_payloads,public.facebook_webhook_events,public.facebook_webhook_steps to service_role;
grant usage,select on sequence public.facebook_webhook_events_sequence_seq to service_role;

create or replace function public.enqueue_facebook_webhook(p_raw text,p_hash text,p_events jsonb) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare receipt uuid; item jsonb; accepted integer:=0; affected integer;
begin
 if p_raw is null or octet_length(p_raw)>2097152 or p_hash is null or p_hash !~ '^[a-f0-9]{64}$'
 or (p_raw::jsonb)->>'object' is distinct from 'page' or jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events)>1000 then
  raise exception 'Invalid webhook envelope' using errcode='22023';
 end if;
 insert into public.facebook_webhook_payloads(raw_payload,payload_sha256) values(p_raw,p_hash)
 on conflict(payload_sha256) do update set last_received_at=clock_timestamp(),delivery_count=facebook_webhook_payloads.delivery_count+1 returning id into receipt;
 for item in select value from jsonb_array_elements(p_events) loop
  if item->>'pageId' is null or item->>'pageId' !~ '^\d{1,64}$' or item->>'orderingKey' is null or item->>'orderingKey' !~ '^\d{1,64}$'
  or item->>'eventKey' is null or item->>'eventKey' !~ '^[a-f0-9]{64}$' or item->>'kind' is null or item->>'kind' not in ('message','change')
  or jsonb_typeof(item->'payload') is distinct from 'object' then raise exception 'Invalid webhook event' using errcode='22023';end if;
  insert into public.facebook_webhook_events(payload_id,page_id,event_key,ordering_key,kind,payload)
  values(receipt,item->>'pageId',item->>'eventKey',item->>'orderingKey',item->>'kind',item->'payload') on conflict(page_id,event_key) do nothing;
  get diagnostics affected=row_count;accepted:=accepted+affected;
 end loop;
 return jsonb_build_object('id',receipt,'accepted',accepted);
end $$;

create or replace function public.claim_facebook_webhook(p_lease_seconds integer default 120) returns setof public.facebook_webhook_events
language plpgsql set search_path=pg_catalog,public as $$
begin
 -- A side effect whose outcome was not committed is never automatically repeated.
 update public.facebook_webhook_events e set status=case
  when e.kind='message' and exists(select 1 from public.facebook_webhook_steps record where record.event_id=e.id and record.name='record' and record.status='completed' and record.result->>'id' is not null and coalesce(record.result->>'ignored','false')<>'true') then 'completed'
  when exists(select 1 from public.facebook_webhook_steps s where s.event_id=e.id and s.status='started') then 'requires_review'
  when e.attempts>=8 then 'dead' else 'pending' end,
  last_error='WORKER_LEASE_EXPIRED',claim_token=null,lease_until=null,
  completed_at=case when e.kind='message' and exists(select 1 from public.facebook_webhook_steps record where record.event_id=e.id and record.name='record' and record.status='completed' and record.result->>'id' is not null and coalesce(record.result->>'ignored','false')<>'true') then clock_timestamp() else e.completed_at end,
  available_at=clock_timestamp()+make_interval(secs=>least(3600,5*power(2,least(e.attempts-1,10))::integer))
 where e.status='processing' and e.lease_until<clock_timestamp();
 -- Invalid/exhausted pending jobs must not remain ordering barriers.
 update public.facebook_webhook_events set status='dead',last_error=coalesce(last_error,'RETRY_LIMIT_REACHED') where status='pending' and attempts>=8;
 return query with candidate as (
  select e.id from public.facebook_webhook_events e where e.status='pending' and e.available_at<=clock_timestamp() and e.attempts<8
  and not exists(select 1 from public.facebook_webhook_events older where older.page_id=e.page_id and older.ordering_key=e.ordering_key
   and older.sequence<e.sequence and older.status in ('pending','processing'))
  order by e.sequence limit 1 for update skip locked
 ) update public.facebook_webhook_events e set status='processing',attempts=e.attempts+1,claim_token=gen_random_uuid(),
 lease_until=clock_timestamp()+make_interval(secs=>least(300,greatest(30,p_lease_seconds)))
 from candidate where e.id=candidate.id returning e.*;
end $$;

create or replace function public.heartbeat_facebook_webhook(p_event uuid,p_claim uuid) returns boolean
language plpgsql set search_path=pg_catalog,public as $$
begin
 update public.facebook_webhook_events set lease_until=clock_timestamp()+interval '120 seconds'
 where id=p_event and claim_token=p_claim and status='processing' and lease_until>clock_timestamp();return found;
end $$;

create or replace function public.begin_facebook_webhook_step(p_event uuid,p_claim uuid,p_name text) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare step public.facebook_webhook_steps;
begin
 perform 1 from public.facebook_webhook_events where id=p_event and claim_token=p_claim and status='processing' and lease_until>clock_timestamp() for update;
 if not found then raise exception 'Webhook lease lost' using errcode='40001';end if;
 select * into step from public.facebook_webhook_steps where event_id=p_event and name=p_name;
 if found then return jsonb_build_object('status',step.status,'result',step.result);end if;
 insert into public.facebook_webhook_steps(event_id,name,status) values(p_event,p_name,'started');
 return jsonb_build_object('status','new');
end $$;

create or replace function public.complete_facebook_webhook_step(p_event uuid,p_claim uuid,p_name text,p_result jsonb) returns boolean
language plpgsql set search_path=pg_catalog,public as $$
begin
 perform 1 from public.facebook_webhook_events where id=p_event and claim_token=p_claim and status='processing' and lease_until>clock_timestamp() for update;
 if not found then return false;end if;
 update public.facebook_webhook_steps set status='completed',result=p_result,completed_at=clock_timestamp() where event_id=p_event and name=p_name and status='started';return found;
end $$;

create or replace function public.finish_facebook_webhook(p_event uuid,p_claim uuid,p_outcome text,p_error text default null) returns text
language plpgsql set search_path=pg_catalog,public as $$
declare e public.facebook_webhook_events;next_state text;
begin
 select * into e from public.facebook_webhook_events where id=p_event and claim_token=p_claim and status='processing' and lease_until>clock_timestamp() for update;
 if not found then return null;end if;
 if p_outcome not in ('completed','retry','requires_review') or p_outcome is null then raise exception 'Invalid outcome' using errcode='22023';end if;
 next_state:=case when p_outcome='completed' and e.kind='message' and exists(select 1 from public.facebook_webhook_steps record where record.event_id=e.id and record.name='record' and record.status='completed' and record.result->>'id' is not null and coalesce(record.result->>'ignored','false')<>'true') then 'completed'
  when exists(select 1 from public.facebook_webhook_steps where event_id=e.id and status='started') then 'requires_review'
  when p_outcome='retry' and e.attempts>=8 then 'dead' when p_outcome='retry' then 'pending' else p_outcome end;
 update public.facebook_webhook_events set status=next_state,last_error=left(p_error,160),claim_token=null,lease_until=null,
 available_at=case when next_state='pending' then clock_timestamp()+make_interval(secs=>least(3600,5*power(2,least(e.attempts-1,10))::integer))+random()*interval '2 seconds' else available_at end,
 completed_at=case when next_state='completed' then clock_timestamp() else null end where id=e.id;
 return next_state;
end $$;
-- Only signature-verified queue messages may advance a Facebook service window.
create or replace function public.facebook_inbound_message_at(p_payload jsonb,p_page text,p_received_at timestamptz) returns timestamptz
language plpgsql immutable set search_path=pg_catalog,public as $$
declare m jsonb; flag text; has_text boolean; has_media boolean; milliseconds numeric;
 whitespace text:=U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]';
begin
 if jsonb_typeof(p_payload) is distinct from 'object' or p_page is null or p_page !~ '^\d{1,64}$'
 or p_received_at is null or not isfinite(p_received_at) then return null;end if;
 if p_payload ?| array['delivery','read','postback','optin','referral','account_linking','reaction','message_reaction','message_edit','pass_thread_control','take_thread_control','request_thread_control'] then return null;end if;
 if jsonb_typeof(p_payload->'sender'->'id') is distinct from 'string' or p_payload->'sender'->>'id' !~ '^\d{1,64}$'
 or p_payload->'sender'->>'id'=p_page or jsonb_typeof(p_payload->'recipient'->'id') is distinct from 'string'
 or p_payload->'recipient'->>'id' is distinct from p_page then return null;end if;
 m:=p_payload->'message';
 if jsonb_typeof(m) is distinct from 'object' then return null;end if;
 foreach flag in array array['is_echo','is_deleted','is_unsupported'] loop
  if m ? flag and m->flag is distinct from 'false'::jsonb then return null;end if;
 end loop;
 if jsonb_typeof(m->'mid') is distinct from 'string' or regexp_replace(m->>'mid',whitespace,'','g')='' or length(m->>'mid')>512 then return null;end if;
 has_text:=jsonb_typeof(m->'text')='string' and regexp_replace(m->>'text',whitespace,'','g')<>'';
 select exists(select 1 from jsonb_array_elements(case when jsonb_typeof(m->'attachments')='array' then m->'attachments' else '[]'::jsonb end) a
  where jsonb_typeof(a)='object' and a->>'type' in ('image','audio','video','file','location','fallback') and jsonb_typeof(a->'payload')='object') into has_media;
 if not coalesce(has_text,false) and not has_media then return null;end if;
 if jsonb_typeof(p_payload->'timestamp') is distinct from 'number' then return null;end if;
 milliseconds:=(p_payload->>'timestamp')::numeric;
 if milliseconds<=0 or milliseconds<>trunc(milliseconds) or milliseconds>9007199254740991
 or milliseconds>floor(extract(epoch from p_received_at)*1000) then return null;end if;
 return to_timestamp(floor(milliseconds/1000)::double precision)+(mod(milliseconds,1000)::integer*interval '1 millisecond');
end $$;
revoke all on function public.facebook_inbound_message_at(jsonb,text,timestamptz) from public,anon,authenticated;
grant execute on function public.facebook_inbound_message_at(jsonb,text,timestamptz) to service_role;

create or replace function public.inbox_incoming_message() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.sender='customer' then
  -- Facebook timestamps are applied after a real insert by persist_facebook_webhook_record.
  update public.customers set inbound_seq=inbound_seq+1,conversation_status='open',conversation_version=conversation_version+1,
   last_message_at=case when platform='facebook' then last_message_at else greatest(coalesce(last_message_at,new.created_at),new.created_at) end
   where id=new.customer_id returning inbound_seq into new.inbound_seq;
 end if;
 return new;
end $$;

create or replace function public.persist_facebook_webhook_record(p_event uuid,p_claim uuid,p_tenant uuid) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare e public.facebook_webhook_events; prior jsonb; v jsonb; c public.customers; record_id uuid; result jsonb; event_time timestamptz; duplicate boolean;
begin
 select * into e from public.facebook_webhook_events where id=p_event and claim_token=p_claim and status='processing' and lease_until>clock_timestamp() for update;
 if not found then raise exception 'Webhook lease lost' using errcode='40001';end if;
 if e.kind='message' then
  event_time:=public.facebook_inbound_message_at(e.payload,e.page_id,e.created_at);
  if event_time is null then
   result:=jsonb_build_object('id',null,'tenantId',p_tenant,'duplicate',false,'ignored',true,'reason','INELIGIBLE_INBOUND_MESSAGE','customer',null);
   insert into public.facebook_webhook_steps(event_id,name,status,result,completed_at) values(e.id,'record','completed',result,clock_timestamp()) on conflict(event_id,name) do nothing;
   return result;
  end if;
 end if;
 select s.result into prior from public.facebook_webhook_steps s where s.event_id=e.id and s.name='record' and s.status='completed';
 if found then
  if prior->>'tenantId' is distinct from p_tenant::text then raise exception 'Page tenant changed' using errcode='40001';end if;
  return prior;
 end if;
 if p_tenant is not null and not exists(select 1 from public.tenants where id=p_tenant and page_id=e.page_id and is_active) then raise exception 'Page tenant changed' using errcode='40001';end if;
 v:=case when e.kind='message' then e.payload else e.payload->'value' end;
 if e.kind='message' and exists(select 1 from public.messages where external_id=v->'message'->>'mid') then
  result:=jsonb_build_object('id',null,'tenantId',p_tenant,'duplicate',true,'customer',null);
  insert into public.facebook_webhook_steps(event_id,name,status,result,completed_at) values(e.id,'record','completed',result,clock_timestamp());
  return result;
 end if;
 if e.kind='message' or v->'from'->>'id' is not null then
  insert into public.customers(platform,platform_user_id,tenant_id)
  values('facebook',case when e.kind='message' then v->'sender'->>'id' else v->'from'->>'id' end,p_tenant)
  on conflict(platform,platform_user_id) do update set tenant_id=coalesce(customers.tenant_id,excluded.tenant_id)
  returning * into c;
  if c.tenant_id is distinct from p_tenant then raise exception 'Customer tenant mismatch' using errcode='42501';end if;
  if e.kind='change' and nullif(trim(v->'from'->>'name'),'') is not null then
   update public.customers set display_name=v->'from'->>'name' where id=c.id;
  end if;
 end if;
 if e.kind='message' then
  insert into public.messages(customer_id,external_id,sender,body,attachments,created_at)
  values(c.id,v->'message'->>'mid','customer',v->'message'->>'text',coalesce(v->'message'->'attachments','[]'::jsonb),event_time)
  on conflict(external_id) do nothing returning id into record_id;
  duplicate:=record_id is null;
  if not duplicate then
   update public.customers set
    last_message_at=greatest(coalesce(last_message_at,event_time),event_time),
    last_interaction_at=greatest(coalesce(last_interaction_at,event_time),event_time)
   where id=c.id;
  end if;
 else
  insert into public.comments(customer_id,tenant_id,external_id,post_id,author_name,body)
  values(c.id,p_tenant,v->>'comment_id',v->>'post_id',v->'from'->>'name',v->>'message')
  on conflict(external_id) do nothing returning id into record_id;
  duplicate:=record_id is null;
 end if;
 result:=jsonb_build_object('id',record_id,'tenantId',p_tenant,'duplicate',duplicate,'customer',case when c.id is null then null else jsonb_build_object('id',c.id,'display_name',c.display_name,'bot_enabled',c.bot_enabled) end);
 insert into public.facebook_webhook_steps(event_id,name,status,result,completed_at) values(e.id,'record','completed',result,clock_timestamp());
 return result;
end $$;
revoke all on function public.persist_facebook_webhook_record(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.persist_facebook_webhook_record(uuid,uuid,uuid) to service_role;
revoke all on function public.enqueue_facebook_webhook(text,text,jsonb),public.claim_facebook_webhook(integer),public.heartbeat_facebook_webhook(uuid,uuid),public.begin_facebook_webhook_step(uuid,uuid,text),public.complete_facebook_webhook_step(uuid,uuid,text,jsonb),public.finish_facebook_webhook(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.enqueue_facebook_webhook(text,text,jsonb),public.claim_facebook_webhook(integer),public.heartbeat_facebook_webhook(uuid,uuid),public.begin_facebook_webhook_step(uuid,uuid,text),public.complete_facebook_webhook_step(uuid,uuid,text,jsonb),public.finish_facebook_webhook(uuid,uuid,text,text) to service_role;
notify pgrst,'reload schema';
commit;
