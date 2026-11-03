-- Apply after facebook-webhook-queue.sql. Accept the parser's canonical Page-wide
-- comment ordering key; numeric sender keys remain valid for Messenger/legacy jobs.
begin;
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
  if item->>'pageId' is null or item->>'pageId' !~ '^\d{1,64}$' or item->>'orderingKey' is null
  or not (item->>'orderingKey' ~ '^\d{1,64}$' or
    coalesce((item->>'kind'='change' and item->'payload'->'value'->>'item'='comment'
      and item->>'orderingKey'='comments:'||(item->>'pageId')),false))
  or item->>'eventKey' is null or item->>'eventKey' !~ '^[a-f0-9]{64}$' or item->>'kind' is null or item->>'kind' not in ('message','change')
  or jsonb_typeof(item->'payload') is distinct from 'object' then raise exception 'Invalid webhook event' using errcode='22023';end if;
  insert into public.facebook_webhook_events(payload_id,page_id,event_key,ordering_key,kind,payload)
  values(receipt,item->>'pageId',item->>'eventKey',item->>'orderingKey',item->>'kind',item->'payload') on conflict(page_id,event_key) do nothing;
  get diagnostics affected=row_count;accepted:=accepted+affected;
 end loop;
 return jsonb_build_object('id',receipt,'accepted',accepted);
end $$;
revoke all on function public.enqueue_facebook_webhook(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.enqueue_facebook_webhook(text,text,jsonb) to service_role;
commit;
