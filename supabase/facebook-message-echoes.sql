-- Run after facebook-message-window.sql and smart-inbox.sql. Service-only, lease-fenced.
-- Echoes affect outgoing history, never inbound counters, unread state or the 24-hour window.
begin;
-- Send responses and webhook receipts may race. A late acknowledgement cannot undo a read receipt.
create or replace function public.preserve_message_receipt_status() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if old.delivery_status='read' then new.delivery_status:='read';
 elsif old.delivery_status='delivered' and new.delivery_status is distinct from 'read' then new.delivery_status:='delivered';end if;
 return new;
end $$;
drop trigger if exists messages_preserve_receipt_status on public.messages;
create trigger messages_preserve_receipt_status before update of delivery_status on public.messages
for each row execute function public.preserve_message_receipt_status();
revoke all on function public.preserve_message_receipt_status() from public,anon,authenticated;

create or replace function public.persist_facebook_message_echo(
  p_event uuid,p_claim uuid,p_tenant uuid,p_app text default null
) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare e public.facebook_webhook_events; c public.customers; m jsonb; mirrored jsonb;
 event_time timestamptz; existing_id uuid; message_id uuid; provider_id text; local_key text; result jsonb;
begin
 select * into e from public.facebook_webhook_events where id=p_event and claim_token=p_claim
  and status='processing' and lease_until>clock_timestamp() for update;
 if not found then raise exception 'Webhook lease lost' using errcode='40001';end if;
 if p_tenant is null or not exists(select 1 from public.tenants where id=p_tenant and page_id=e.page_id and is_active)
  then raise exception 'Page tenant changed' using errcode='42501';end if;
 select s.result into result from public.facebook_webhook_steps s
  where s.event_id=e.id and s.name='echo' and s.status='completed';
 if found then return result;end if;
 m:=e.payload->'message';
 if e.kind<>'message' or m->'is_echo' is distinct from 'true'::jsonb
  or e.payload->'sender'->>'id' is distinct from e.page_id then
  raise exception 'Invalid echo' using errcode='22023';end if;
 mirrored:=e.payload||jsonb_build_object('sender',e.payload->'recipient','recipient',e.payload->'sender','message',m-'is_echo');
 event_time:=public.facebook_inbound_message_at(mirrored,e.page_id,e.created_at);
 if event_time is null then raise exception 'Invalid echo content or time' using errcode='22023';end if;
 provider_id:=m->>'mid';
 -- Serialize duplicates/echoes from concurrent receivers for this Page-scoped customer.
 perform pg_advisory_xact_lock(hashtextextended('fb-echo:'||p_tenant::text||':'||(e.payload->'recipient'->>'id'),0));
 insert into public.customers(platform,platform_user_id,tenant_id)
 values('facebook',e.payload->'recipient'->>'id',p_tenant)
 on conflict(platform,platform_user_id) do update set tenant_id=coalesce(customers.tenant_id,excluded.tenant_id)
 returning * into c;
 if c.tenant_id is distinct from p_tenant then raise exception 'Customer tenant mismatch' using errcode='42501';end if;
 select id into existing_id from public.messages where customer_id=c.id
  and (provider_message_id=provider_id or external_id=provider_id) order by created_at limit 1 for update;
 -- Our outgoing metadata identifies the durable row even when an echo beats the Send API response.
 if existing_id is null and nullif(p_app,'') is not null and m->>'app_id'=p_app
  and left(m->>'metadata',8)='snapbot:' then
  local_key:=substr(m->>'metadata',9);
  select id into existing_id from public.messages where customer_id=c.id and external_id=local_key
   and sender<>'customer' limit 1 for update;
 end if;
 if existing_id is not null then
  update public.messages set provider_message_id=coalesce(provider_message_id,provider_id),
   delivery_status=case when delivery_status in ('delivered','read') then delivery_status else 'sent' end
   where id=existing_id;
  message_id:=existing_id;
 elsif nullif(p_app,'') is not null and m->>'app_id'=p_app then
  -- Old uncorrelated sends already have dashboard rows. Never invent a duplicate or guess by text.
  result:=jsonb_build_object('id',null,'ignored',true,'reason','UNMATCHED_APP_ECHO');
 else
  insert into public.messages(customer_id,external_id,provider_message_id,sender,body,attachments,created_at,delivery_status)
  values(c.id,'fb-echo:'||e.page_id||':'||provider_id,provider_id,'agent',m->>'text',coalesce(m->'attachments','[]'::jsonb),event_time,'sent')
  on conflict(external_id) do update set provider_message_id=excluded.provider_message_id
  returning id into message_id;
 end if;
 if message_id is not null then
  update public.customers set last_message_at=greatest(coalesce(last_message_at,event_time),event_time) where id=c.id;
  result:=jsonb_build_object('id',message_id,'ignored',false);
 end if;
 insert into public.facebook_webhook_steps(event_id,name,status,result,completed_at)
 values(e.id,'echo','completed',result,clock_timestamp());
 return result;
end $$;
revoke all on function public.persist_facebook_message_echo(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.persist_facebook_message_echo(uuid,uuid,uuid,text) to service_role;
-- Supabase streams committed table changes; no separate application emitter is needed.
do $$ declare tab text; begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach tab in array array['messages','customers','comments','slips','conversation_reads'] loop
   if to_regclass(format('public.%I',tab)) is not null and not exists(
    select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=tab
   ) then execute format('alter publication supabase_realtime add table public.%I',tab);end if;
  end loop;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
