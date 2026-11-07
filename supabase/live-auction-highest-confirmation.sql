-- Apply after live-auction-on-demand.sql. No messages are sent by this migration.
begin;
-- Preserve the installed numeric bid/host-command implementation behind the public guard.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text)'::regprocedure);
 if position('process_live_auction_comment_legacy' in definition)=0 then
  execute replace(definition,'FUNCTION public.process_live_auction_comment(', 'FUNCTION public.process_live_auction_comment_legacy(');
 end if;
end $$;

create or replace function public.process_live_auction_comment(
 p_auction uuid,p_tenant uuid,p_event uuid,p_kind text,p_amount numeric default null,p_control text default null
) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare a public.auctions;e public.facebook_webhook_events;v jsonb;prior jsonb;r jsonb;
 sender text;cid text;message text;keywords text[];host boolean;confirming boolean;numeric_price numeric;
begin
 select * into a from public.auctions where id=p_auction and tenant_id=p_tenant for update;
 if not found then raise exception 'AUCTION_NOT_FOUND' using errcode='P0002';end if;
 if not exists(select 1 from public.tenants where id=p_tenant and page_id=a.page_id and is_active) then
  raise exception 'AUCTION_TENANT_INVALID' using errcode='42501';end if;
 select * into e from public.facebook_webhook_events where id=p_event and page_id=a.page_id;
 if not found or e.kind<>'change' then raise exception 'AUCTION_EVENT_INVALID' using errcode='42501';end if;
 v:=e.payload->'value';sender:=v->'from'->>'id';cid:=v->>'comment_id';
 if sender is null or cid is null or v->>'verb' is distinct from 'add'
  or coalesce(v->>'item','') not in ('comment','live_comment') then return jsonb_build_object('status','ignored');end if;
 if not coalesce((a.live_post_id=regexp_replace(v->>'post_id','^.*_','') or a.live_post_id=v->>'video_id'
  or a.live_post_id=v->>'live_video_id' or v->>'post_id'=any(a.live_post_aliases)),false) then
  raise exception 'AUCTION_POST_MISMATCH' using errcode='42501';end if;
 select result into prior from public.auction_bids where auction_id=a.id and comment_id=cid;
 if found then return prior;end if;
 if e.created_at<a.created_at then return jsonb_build_object('status','stale');end if;
 if exists(select 1 from public.facebook_webhook_events older where older.page_id=e.page_id
  and older.ordering_key=e.ordering_key and older.sequence<e.sequence and older.status in ('pending','processing')) then
  raise exception 'AUCTION_EVENT_OUT_OF_ORDER' using errcode='40001';end if;
 host:=sender=a.page_id or sender=any(a.host_ids);
 message:=lower(regexp_replace(normalize(trim(coalesce(v->>'message','')),NFKC),'\s+',' ','g'));
 select coalesce(array_agg(lower(regexp_replace(normalize(trim(k),NFKC),'\s+',' ','g')))
  filter(where length(trim(k))>0),array['1']) into keywords
 from jsonb_array_elements_text(case when jsonb_typeof(a.session_automation->'keywords')='array'
  then a.session_automation->'keywords' else '[]'::jsonb end) k;
 confirming:=not host and message=any(keywords);
 if a.status<>'active' then return jsonb_build_object('status','closed','orderId',a.order_id);end if;
 if not confirming then
  numeric_price:=public.auction_numeric_price(v->>'message');
  return public.process_live_auction_comment_legacy(p_auction,p_tenant,p_event,
   case when numeric_price is not null and not host then 'NUMERIC_BID' else p_kind end,
   case when numeric_price is not null then numeric_price else null end,p_control);
 end if;
 if sender is distinct from a.leading_bidder_id or a.current_price<=0 then
  r:=jsonb_build_object('status','not_winner');
 else
  -- The leader and price cannot change until the invoice/outbox transaction commits.
  update public.auctions set winner_confirmation_comment_id=cid,winner_confirmation_event_id=e.id,
   winner_confirmed_at=clock_timestamp() where id=a.id;
  r:=public.finalize_live_auction_highest_bid(a.id,a.tenant_id,e.id);
  update public.auction_deliveries set comment_id=cid
   where auction_id=a.id and status in ('pending','awaiting_confirmation');
  r:=r||jsonb_build_object('status','confirmed','amount',a.current_price,'name',a.leading_bidder_name);
 end if;
 insert into public.auction_bids(auction_id,event_id,comment_id,bidder_id,bidder_name,comment_text,bid_amount,is_opening,status,result)
 values(a.id,e.id,cid,sender,left(v->'from'->>'name',200),left(coalesce(v->>'message',''),2000),null,false,r->>'status',r);
 return r;
end $$;
revoke all on function public.process_live_auction_comment_legacy(uuid,uuid,uuid,text,numeric,text),
 public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text) from public,anon,authenticated;
grant execute on function public.process_live_auction_comment_legacy(uuid,uuid,uuid,text,numeric,text),
 public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text) to service_role;
notify pgrst,'reload schema';
commit;
