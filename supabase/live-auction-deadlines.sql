begin;
-- Add nullable first: never assign an invented deadline to existing rounds.
alter table public.auctions add column if not exists duration_seconds integer;
alter table public.auctions add column if not exists timer_started_at timestamptz;
alter table public.auctions add column if not exists ends_at timestamptz;
alter table public.auctions drop constraint if exists auction_duration_valid;
alter table public.auctions add constraint auction_duration_valid
 check(duration_seconds is null or duration_seconds between 30 and 86400);
alter table public.auctions alter column duration_seconds set default 300;
create index if not exists auctions_due on public.auctions(ends_at)
 where status='active' and ends_at is not null;

create or replace function public.initialize_auction_deadline() returns trigger
language plpgsql set search_path=pg_catalog,public as $$ begin
 new.duration_seconds:=coalesce(new.duration_seconds,300);
 new.timer_started_at:=clock_timestamp();
 new.ends_at:=new.timer_started_at+make_interval(secs=>new.duration_seconds);
 return new;
end $$;
drop trigger if exists initialize_auction_deadline on public.auctions;
create trigger initialize_auction_deadline before insert on public.auctions
 for each row execute function public.initialize_auction_deadline();

-- One row lock serializes bids, manual close, browser retries and cron workers.
-- Use the existing atomic order/tab/invoice/outbox transaction directly rather
-- than the legacy on_demand finalizer, which only changes status to closed.
create or replace function public.close_due_live_auction(
 p_auction uuid,p_tenant uuid,p_due_only boolean default true,p_cancel boolean default false
) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare a public.auctions; result jsonb;
begin
 select * into a from public.auctions where id=p_auction and tenant_id=p_tenant for update;
 if not found then raise exception 'AUCTION_NOT_FOUND' using errcode='P0002';end if;
 if a.status<>'active' then
  return jsonb_build_object('status',a.status,'orderId',a.order_id);
 end if;
 if p_due_only and (a.ends_at is null or a.ends_at>clock_timestamp()) then
  return jsonb_build_object('status','not_due');
 end if;
 -- Give durably received pre-deadline comments their turn before locking the
 -- winner. Late comments never extend the deadline. Failed/dead events are not
 -- an endless barrier; queue retries/alerts remain owned by the webhook worker.
 if not p_cancel and exists(select 1 from public.facebook_webhook_events e
  where e.page_id=a.page_id and e.kind='change' and e.status in ('pending','processing')
   and e.created_at>=a.created_at and (a.ends_at is null or e.created_at<a.ends_at)
   and (a.live_post_id=regexp_replace(e.payload->'value'->>'post_id','^.*_','')
    or a.live_post_id=e.payload->'value'->>'video_id'
    or a.live_post_id=e.payload->'value'->>'live_video_id'
    or e.payload->'value'->>'post_id'=any(a.live_post_aliases))
 ) then return jsonb_build_object('status','draining');end if;
 update public.auctions set winner_locked_at=clock_timestamp() where id=a.id;
 result:=public.finalize_live_auction_highest_bid(a.id,a.tenant_id,null,p_cancel);
 return result;
end $$;

create or replace function public.expire_live_auctions(p_tenant uuid default null)
returns integer language plpgsql set search_path=pg_catalog,public as $$
declare a record; result jsonb; count_closed integer:=0;
begin
 for a in select id,tenant_id from public.auctions
  where status='active' and ends_at<=clock_timestamp()
   and (p_tenant is null or tenant_id=p_tenant)
  order by ends_at limit 100 for update skip locked
 loop
  begin
   result:=public.close_due_live_auction(a.id,a.tenant_id);
   if result->>'status'='closed' then count_closed:=count_closed+1;end if;
  exception when others then
   -- Isolate a bad round; keep other shops closing and make the fault visible.
   raise warning 'Auction % resolution failed [%]: %',a.id,sqlstate,sqlerrm;
  end;
 end loop;
 return count_closed;
end $$;

-- Enforce the same cutoff in ingestion, including direct calls of the numeric
-- bid RPC. The deadline is server time, independent of browser timezone/clock.
create or replace function public.enforce_auction_bid_deadline() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
declare a public.auctions; received_at timestamptz;
begin
 if new.status='accepted' then
  select * into a from public.auctions where id=new.auction_id for update;
  select created_at into received_at from public.facebook_webhook_events where id=new.event_id;
  if a.ends_at is not null and coalesce(received_at,clock_timestamp())>=a.ends_at then
   raise exception 'AUCTION_DEADLINE_PASSED' using errcode='22023';
  end if;
 end if;
 return new;
end $$;
drop trigger if exists enforce_auction_bid_deadline on public.auction_bids;
create trigger enforce_auction_bid_deadline before insert on public.auction_bids
 for each row execute function public.enforce_auction_bid_deadline();

-- Preserve existing parsing/confirmation semantics, but ignore late events
-- before they can mutate a timer-expired auction or trigger premature invoices.
do $$ begin
 if to_regprocedure('public.process_live_auction_comment_without_deadline(uuid,uuid,uuid,text,numeric,text)') is null then
  alter function public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text)
   rename to process_live_auction_comment_without_deadline;
 end if;
end $$;
create or replace function public.process_live_auction_comment(
 p_auction uuid,p_tenant uuid,p_event uuid,p_kind text,p_amount numeric default null,p_control text default null
) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare a public.auctions;e public.facebook_webhook_events;
begin
 select * into a from public.auctions where id=p_auction and tenant_id=p_tenant for update;
 if not found then raise exception 'AUCTION_NOT_FOUND' using errcode='P0002';end if;
 select * into e from public.facebook_webhook_events where id=p_event and page_id=a.page_id;
 if not found then raise exception 'AUCTION_EVENT_INVALID' using errcode='42501';end if;
 if a.ends_at is not null and e.created_at>=a.ends_at then
  perform public.close_due_live_auction(a.id,a.tenant_id);
  return jsonb_build_object('status','closed','reason','AUCTION_DEADLINE_PASSED');
 end if;
 return public.process_live_auction_comment_without_deadline(p_auction,p_tenant,p_event,p_kind,p_amount,p_control);
end $$;

-- Keep duration changes inside the existing idempotent workspace transaction.
do $$ begin
 if to_regprocedure('public.save_auction_workspace_without_deadline(uuid,uuid,uuid,jsonb)') is null then
  alter function public.save_auction_workspace(uuid,uuid,uuid,jsonb) rename to save_auction_workspace_without_deadline;
 end if;
end $$;
create or replace function public.save_auction_workspace(p_tenant uuid,p_actor uuid,p_request uuid,p_input jsonb)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare result jsonb; duration integer; replay boolean;
begin
 duration:=coalesce((p_input->>'durationSeconds')::integer,300);
 if duration not between 30 and 86400 then raise exception 'AUCTION_DURATION_INVALID' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':auction-workspace',0));
 replay:=exists(select 1 from public.auction_workspace_requests where tenant_id=p_tenant and request_id=p_request);
 result:=public.save_auction_workspace_without_deadline(p_tenant,p_actor,p_request,p_input);
 if replay then return result;end if;
 update public.auctions set duration_seconds=duration,
  timer_started_at=coalesce(timer_started_at,clock_timestamp()),
  ends_at=coalesce(timer_started_at,clock_timestamp())+make_interval(secs=>duration)
 where id=(result->>'auctionId')::uuid and tenant_id=p_tenant and status='active'
  and (duration_seconds is distinct from duration or ends_at is null);
 return result;
end $$;

create or replace function public.start_legacy_auction_timer(p_auction uuid,p_tenant uuid)
returns void language sql set search_path=pg_catalog,public as $$
 update public.auctions set timer_started_at=clock_timestamp(),duration_seconds=300,
  ends_at=clock_timestamp()+interval '5 minutes'
 where id=p_auction and tenant_id=p_tenant and status='active' and ends_at is null;
$$;

revoke all on function public.close_due_live_auction(uuid,uuid,boolean,boolean),
 public.expire_live_auctions(uuid),public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text),
 public.process_live_auction_comment_without_deadline(uuid,uuid,uuid,text,numeric,text),
 public.save_auction_workspace(uuid,uuid,uuid,jsonb),public.save_auction_workspace_without_deadline(uuid,uuid,uuid,jsonb),
 public.start_legacy_auction_timer(uuid,uuid) from public,anon,authenticated;
grant execute on function public.close_due_live_auction(uuid,uuid,boolean,boolean),
 public.expire_live_auctions(uuid),public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text),
 public.process_live_auction_comment_without_deadline(uuid,uuid,uuid,text,numeric,text),
 public.save_auction_workspace(uuid,uuid,uuid,jsonb),public.save_auction_workspace_without_deadline(uuid,uuid,uuid,jsonb),
 public.start_legacy_auction_timer(uuid,uuid) to service_role;

-- Install pg_cron in Supabase first if absent. No unsupported extension is
-- required by local PostgreSQL/PGlite. Re-running this migration updates one job.
do $$ begin
 if to_regprocedure('cron.schedule(text,text,text)') is not null then
  perform cron.schedule('snapbot-auction-expiry','5 seconds','select public.expire_live_auctions();');
 else
  raise notice 'Enable Supabase Cron and run supabase/live-auction-cron-setup.sql for browser-independent expiry';
 end if;
end $$;
notify pgrst,'reload schema';
commit;
