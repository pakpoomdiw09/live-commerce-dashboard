-- Run after smart-inbox.sql and facebook-webhook-queue.sql. Rerunnable; no historical timestamps are rewritten.
begin;
alter table public.customers add column if not exists last_interaction_at timestamptz;
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
notify pgrst,'reload schema';
commit;
