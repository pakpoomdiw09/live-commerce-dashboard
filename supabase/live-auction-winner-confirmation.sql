-- Apply after live-auction-unlimited-keywords.sql. Lock the sale at close;
-- release notifications only after the latest winner comments a configured keyword.
begin;
alter table public.auctions add column if not exists winner_confirmation_comment_id text;
alter table public.auctions add column if not exists winner_confirmation_event_id uuid references public.facebook_webhook_events(id);
alter table public.auctions add column if not exists winner_confirmed_at timestamptz;
alter table public.auction_deliveries drop constraint if exists auction_deliveries_status_check;
alter table public.auction_deliveries add constraint auction_deliveries_status_check
 check(status in ('awaiting_confirmation','pending','sending','sent','requires_review'));

create or replace function public.hold_auction_winner_notifications() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.status='pending' and exists(select 1 from public.auctions a where a.id=new.auction_id
  and a.session_automation ? 'closeKeywords' and a.winner_confirmation_comment_id is null) then
  new.status:='awaiting_confirmation';
 end if;
 return new;
end $$;
drop trigger if exists auction_winner_confirmation_gate on public.auction_deliveries;
create trigger auction_winner_confirmation_gate before insert on public.auction_deliveries
 for each row execute function public.hold_auction_winner_notifications();

-- Never requeue sent/ambiguous deliveries when upgrading an existing installation.
update public.auction_deliveries d set status='awaiting_confirmation'
 from public.auctions a where a.id=d.auction_id and a.session_automation ? 'closeKeywords'
 and a.winner_confirmation_comment_id is null and d.status='pending';

create or replace function public.confirm_live_auction_winner(p_auction uuid,p_tenant uuid,p_event uuid)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare a public.auctions; e public.facebook_webhook_events; v jsonb; cid text; sender text;
begin
 select * into a from public.auctions where id=p_auction and tenant_id=p_tenant for update;
 if not found then raise exception 'AUCTION_NOT_FOUND' using errcode='P0002';end if;
 select * into e from public.facebook_webhook_events where id=p_event and page_id=a.page_id;
 if not found or e.kind<>'change' then raise exception 'AUCTION_EVENT_INVALID' using errcode='42501';end if;
 v:=e.payload->'value';cid:=v->>'comment_id';sender:=v->'from'->>'id';
 if v->>'verb' is distinct from 'add' or coalesce(v->>'item','') not in ('comment','live_comment')
  or cid is null or sender is null then return jsonb_build_object('status','ignored');end if;
 if not coalesce((a.live_post_id=regexp_replace(v->>'post_id','^.*_','')
  or a.live_post_id=v->>'video_id' or a.live_post_id=v->>'live_video_id'
  or v->>'post_id'=any(a.live_post_aliases)),false) then
  raise exception 'AUCTION_POST_MISMATCH' using errcode='42501';
 end if;
 if exists(select 1 from public.facebook_webhook_events older where older.page_id=e.page_id
  and older.ordering_key=e.ordering_key and older.sequence<e.sequence and older.status in ('pending','processing')) then
  raise exception 'AUCTION_EVENT_OUT_OF_ORDER' using errcode='40001';
 end if;
 if a.status<>'closed' or a.order_id is null or not coalesce(a.session_automation ? 'closeKeywords',false)
  then return jsonb_build_object('status','ignored');end if;
 if exists(select 1 from public.auctions newer where newer.tenant_id=a.tenant_id and newer.page_id=a.page_id
  and newer.live_post_id=a.live_post_id and newer.status='closed'
  and (newer.closed_at,newer.created_at,newer.id)>(a.closed_at,a.created_at,a.id)) then
  return jsonb_build_object('status','not_latest');
 end if;
 if e.created_at<a.created_at or (a.close_event_id is null and e.created_at<a.closed_at)
  or exists(select 1 from public.facebook_webhook_events closing
  where closing.id=a.close_event_id and (e.sequence<=closing.sequence
   or (coalesce(v->>'created_time','') ~ '^[0-9]{10}$' and coalesce(closing.payload->'value'->>'created_time','') ~ '^[0-9]{10}$'
    and (v->>'created_time')::numeric<(closing.payload->'value'->>'created_time')::numeric))) then
  return jsonb_build_object('status','stale');
 end if;
 if sender is distinct from a.leading_bidder_id then return jsonb_build_object('status','not_winner');end if;
 if sender=a.page_id or sender=any(a.host_ids) then return jsonb_build_object('status','ignored');end if;
 if not exists(select 1 from jsonb_array_elements_text(a.session_automation->'keywords') k
  where k=lower(regexp_replace(normalize(trim(coalesce(v->>'message','')),NFKC),'\s+',' ','g'))) then
  return jsonb_build_object('status','ignored');
 end if;
 if a.winner_confirmation_comment_id is not null then
  return jsonb_build_object('status','already_confirmed','orderId',a.order_id);
 end if;
 update public.auctions set winner_confirmation_comment_id=cid,winner_confirmation_event_id=e.id,
  winner_confirmed_at=clock_timestamp() where id=a.id;
 update public.auction_deliveries set status='pending',comment_id=cid
  where auction_id=a.id and status='awaiting_confirmation';
 return jsonb_build_object('status','confirmed','orderId',a.order_id);
end $$;
revoke all on function public.hold_auction_winner_notifications(),public.confirm_live_auction_winner(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.hold_auction_winner_notifications(),public.confirm_live_auction_winner(uuid,uuid,uuid) to service_role;
commit;
