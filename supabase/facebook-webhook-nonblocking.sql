-- Apply after facebook-webhook-queue.sql, before deploying the updated worker.
-- Retains terminal jobs and side-effect checkpoints; never replays old sends.
begin;
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
commit;
