-- Apply after live-auction-audit-hardening-2.sql. Explicit null means host-close only.
-- Preserve timed RPC callers that omit durationSeconds or supply a valid duration.
begin;
create or replace function public.save_auction_workspace(p_tenant uuid,p_actor uuid,p_request uuid,p_input jsonb)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare result jsonb;duration integer;replay boolean;
begin
 if p_input ? 'durationSeconds' and p_input->'durationSeconds'='null'::jsonb then
  duration:=null;
 else
  duration:=coalesce((p_input->>'durationSeconds')::integer,300);
  if duration not between 30 and 86400 then raise exception 'AUCTION_DURATION_INVALID' using errcode='23514';end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':auction-workspace',0));
 replay:=exists(select 1 from public.auction_workspace_requests where tenant_id=p_tenant and request_id=p_request);
 result:=public.save_auction_workspace_without_deadline(p_tenant,p_actor,p_request,p_input);
 if replay then return result;end if;
 -- The insert trigger may initialize a timer; clear it inside this same transaction.
 -- Existing timed rounds switch to manual only on an authorized, non-replayed save.
 if duration is null then
  update public.auctions set duration_seconds=null,timer_started_at=null,ends_at=null
   where id=(result->>'auctionId')::uuid and tenant_id=p_tenant and status='active';
 else
  update public.auctions set duration_seconds=duration,
   timer_started_at=coalesce(timer_started_at,clock_timestamp()),
   ends_at=coalesce(timer_started_at,clock_timestamp())+make_interval(secs=>duration)
   where id=(result->>'auctionId')::uuid and tenant_id=p_tenant and status='active'
    and (duration_seconds is distinct from duration or ends_at is null);
 end if;
 return result;
end $$;
revoke all on function public.save_auction_workspace(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_auction_workspace(uuid,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
