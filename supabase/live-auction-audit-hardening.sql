-- Forward-only fixes for audited live auction and poller bugs.
begin;

create or replace function public.auction_comment_timestamp(value text) returns timestamptz
language plpgsql stable set search_path=pg_catalog,public as $$
declare n numeric;
begin
 if value is null or btrim(value)='' then return null; end if;
 if value ~ '^[0-9]+(?:\.[0-9]+)?$' then
  n:=value::numeric;
  if length(split_part(value,'.',1))>=13 then n:=n/1000; end if;
  return to_timestamp(n);
 end if;
 return value::timestamptz;
exception when others then return null;
end $$;

create table if not exists public.auction_poll_cursors (
 cursor_id uuid primary key,
 auction_id uuid not null references public.auctions(id) on delete cascade,
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 session_id uuid,
 live_video_id text not null,
 high_water_at timestamptz not null,
 continuation_url text,
 updated_at timestamptz not null default clock_timestamp()
);
alter table public.auction_poll_cursors enable row level security;
revoke all on public.auction_poll_cursors from public,anon,authenticated;
grant all on public.auction_poll_cursors to service_role;

create or replace function public.finalize_live_auction(p_auction uuid,p_tenant uuid,p_event uuid default null,p_cancel boolean default false)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare a public.auctions;locked_at timestamptz;
begin
 select * into a from public.auctions where id=p_auction and tenant_id=p_tenant for update;
 if not found then raise exception 'AUCTION_NOT_FOUND' using errcode='P0002'; end if;
 if a.status='cancelled' then return jsonb_build_object('status','cancelled','orderId',a.order_id);end if;
 if a.status='closed' then
  return jsonb_build_object('status',case when a.winner_locked_at is not null and a.order_id is null then 'awaiting_confirmation' else 'closed' end,'orderId',a.order_id,'winnerId',a.leading_bidder_id);
 end if;
 if a.status<>'active' then return jsonb_build_object('status',a.status,'orderId',a.order_id);end if;
 if p_cancel then
  update public.auctions set status='cancelled',closed_at=clock_timestamp(),close_event_id=p_event where id=a.id;
  return jsonb_build_object('status','cancelled','orderId',null);
 end if;
 -- The locked auctions row is the authoritative leader for both winner flows.
 -- Closing creates no order; the winner's later confirmation creates it atomically.
 if a.leading_bidder_id is not null and coalesce(a.current_price,0)>0 then
  locked_at:=coalesce(a.winner_locked_at,clock_timestamp());
  update public.auctions set status='closed',closed_at=clock_timestamp(),close_event_id=p_event,
   winner_locked_at=locked_at where id=a.id;
  if a.public_reply_enabled then
   if a.session_automation ? 'closeKeywords' then
    insert into public.auction_deliveries(auction_id,channel,comment_id)
     values(a.id,'public',a.leading_comment_id)
     on conflict(auction_id,channel) where claim_id is null do nothing;
   elsif p_event is not null then
    insert into public.auction_deliveries(auction_id,channel,comment_id)
     select a.id,'public',payload->'value'->>'comment_id'
      from public.facebook_webhook_events where id=p_event
     on conflict(auction_id,channel) where claim_id is null do nothing;
   end if;
  end if;
  return jsonb_build_object('status','awaiting_confirmation','orderId',null,'winnerId',a.leading_bidder_id,'amount',a.current_price);
 end if;
 update public.auctions set status='closed',closed_at=clock_timestamp(),close_event_id=p_event where id=a.id;
 if p_event is not null and a.public_reply_enabled then
  insert into public.auction_deliveries(auction_id,channel,comment_id)
   select a.id,'public',payload->'value'->>'comment_id'
    from public.facebook_webhook_events where id=p_event
   on conflict(auction_id,channel) where claim_id is null do nothing;
 end if;
 return jsonb_build_object('status','closed','orderId',null);
end $$;

-- Keep historical bidding/confirmation behavior, but enforce the source comment's round window
-- before any confirmation, host close, or host count changes state.
create or replace function public.process_live_auction_comment(
 p_auction uuid,p_tenant uuid,p_event uuid,p_kind text,p_amount numeric default null,p_control text default null
) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare a public.auctions;e public.facebook_webhook_events;v jsonb;prior jsonb;r jsonb;
 sender text;cid text;message text;keywords text[];close_keywords text[];settings jsonb;host boolean;confirming boolean;counting boolean:=false;numeric_price numeric;source_at timestamptz;
begin
 select * into a from public.auctions where id=p_auction and tenant_id=p_tenant for update;
 if not found then raise exception 'AUCTION_NOT_FOUND' using errcode='P0002';end if;
 if not exists(select 1 from public.tenants where id=p_tenant and page_id=a.page_id and is_active) then raise exception 'AUCTION_TENANT_INVALID' using errcode='42501';end if;
 select * into e from public.facebook_webhook_events where id=p_event and page_id=a.page_id;
 if not found or e.kind<>'change' then raise exception 'AUCTION_EVENT_INVALID' using errcode='42501';end if;
 v:=e.payload->'value';sender:=v->'from'->>'id';cid:=v->>'comment_id';
 if sender is null or cid is null or v->>'verb' is distinct from 'add' or coalesce(v->>'item','') not in ('comment','live_comment') then return jsonb_build_object('status','ignored');end if;
 if not coalesce((a.live_post_id=regexp_replace(v->>'post_id','^.*_','') or a.live_post_id=v->>'video_id' or a.live_post_id=v->>'live_video_id' or v->>'post_id'=any(a.live_post_aliases)),false) then raise exception 'AUCTION_POST_MISMATCH' using errcode='42501';end if;
 select result into prior from public.auction_bids where auction_id=a.id and comment_id=cid;
 if found then return prior;end if;
 if e.created_at<a.created_at then return jsonb_build_object('status','stale');end if;
 if exists(select 1 from public.facebook_webhook_events older where older.page_id=e.page_id and older.ordering_key=e.ordering_key and older.sequence<e.sequence and older.status in ('pending','processing')) then raise exception 'AUCTION_EVENT_OUT_OF_ORDER' using errcode='40001';end if;
 host:=sender=a.page_id or sender=any(a.host_ids);
 settings:=public.resolve_facebook_comment_settings((public.facebook_comment_context(p_tenant,a.page_id,array[a.live_post_id]))->'session',a.session_automation);
 if (public.facebook_comment_context(p_tenant,a.page_id,array[a.live_post_id]))->>'mode'<>'auction' then return jsonb_build_object('status','ignored','reason','SESSION_MODE');end if;
 message:=public.normalize_auction_tag(v->>'message');
 keywords:=public.auction_comment_tags(settings,'keywords',settings->'confirmation_tags'->>0);
 close_keywords:=public.auction_comment_tags(settings,'closeKeywords','ปิด');
 confirming:=not host and message=any(keywords);
 if host then
  if coalesce((settings->>'closeEnabled')::boolean,true) and message=any(close_keywords) then p_kind:='HOST_CONTROL';p_control:='close';
  elsif coalesce((settings->>'countEnabled')::boolean,false) and settings->'counting_tags' ? message then p_kind:='HOST_CONTROL';p_control:=settings->'counting_tags'->>message;counting:=true;
  end if;
 end if;
 if confirming then
  source_at:=public.auction_comment_timestamp(v->>'created_time');
  if source_at is null or source_at<a.created_at-interval '1 second'
   or (a.winner_locked_at is not null and source_at<a.winner_locked_at) then
   return jsonb_build_object('status','stale');
  end if;
 elsif p_kind='HOST_CONTROL' and (p_control='close' or counting) then
  source_at:=public.auction_comment_timestamp(v->>'created_time');
  if source_at is null or source_at<a.created_at-interval '1 second'
   or (a.closed_at is not null and source_at>a.closed_at+interval '1 second') then
   return jsonb_build_object('status','stale');
  end if;
 end if;
 if a.session_automation is distinct from settings then
  update public.auctions set session_automation=settings,private_reply_template=coalesce(settings->>'private_reply_template',settings->>'privateText',private_reply_template),bid_reply_template=coalesce(settings->>'public_reply_template',settings->>'bidText',bid_reply_template),private_reply_enabled=coalesce((settings->>'privateReply')::boolean,private_reply_enabled),public_reply_enabled=coalesce((settings->>'publicReply')::boolean,public_reply_enabled) where id=a.id;
 end if;
 if host and a.status='active' and p_kind='HOST_CONTROL' and p_control='close' then
  r:=public.finalize_live_auction(a.id,a.tenant_id,e.id);
  r:=r||jsonb_build_object('status',case when r->>'status'='awaiting_confirmation' then 'awaiting_confirmation' else r->>'status' end);
  insert into public.auction_bids(auction_id,event_id,comment_id,bidder_id,bidder_name,comment_text,bid_amount,is_opening,status,result)
   values(a.id,e.id,cid,sender,left(v->'from'->>'name',200),left(coalesce(v->>'message',''),2000),null,false,'closed',r);
  return r;
 end if;
 if host and a.status='active' and p_kind='HOST_CONTROL' and counting then
  update public.auctions set host_count=p_control where id=a.id;
  r:=jsonb_build_object('status','count');
  insert into public.auction_bids(auction_id,event_id,comment_id,bidder_id,comment_text,status,result) values(a.id,e.id,cid,sender,left(v->>'message',2000),'count',r);
  return r;
 end if;
 if host then return jsonb_build_object('status','ignored');end if;
 if a.status<>'active' and not (a.status='closed' and a.winner_locked_at is not null and a.order_id is null and confirming) then return jsonb_build_object('status','closed','orderId',a.order_id);end if;
 if not confirming then
  numeric_price:=public.auction_numeric_price(v->>'message');
  return public.process_live_auction_highest_bid(p_auction,p_tenant,p_event,case when numeric_price is not null then 'NUMERIC_BID' else case when message<>'' and message=any(public.auction_comment_tags(settings,'opening_tags','')) then 'OPENING_BID' else 'IGNORE' end end,numeric_price,p_control);
 end if;
 if sender is distinct from a.leading_bidder_id or a.current_price<=0 then r:=jsonb_build_object('status','not_winner');
 else
  update public.auctions set winner_confirmation_comment_id=cid,winner_confirmation_event_id=e.id,winner_confirmed_at=clock_timestamp() where id=a.id;
  r:=public.finalize_live_auction_highest_bid(a.id,a.tenant_id,e.id);
  update public.auction_deliveries set comment_id=cid where auction_id=a.id and status in ('pending','awaiting_confirmation');
  r:=r||jsonb_build_object('status','confirmed','amount',a.current_price,'name',a.leading_bidder_name);
 end if;
 insert into public.auction_bids(auction_id,event_id,comment_id,bidder_id,bidder_name,comment_text,bid_amount,is_opening,status,result) values(a.id,e.id,cid,sender,left(v->'from'->>'name',200),left(coalesce(v->>'message',''),2000),null,false,r->>'status',r);
 return r;
end $$;

revoke all on function public.auction_comment_timestamp(text) from public,anon,authenticated;
grant execute on function public.auction_comment_timestamp(text) to service_role;
notify pgrst,'reload schema';
commit;
