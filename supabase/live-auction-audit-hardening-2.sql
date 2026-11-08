-- Forward-only successor to live-auction-audit-hardening.sql. Never replay modified history.
begin;
create table if not exists public.auction_expiry_failures (
 sqlstate text not null check(sqlstate ~ '^[A-Z0-9]{5}$'),
 auction_id uuid not null references public.auctions(id) on delete cascade,
 occurred_at timestamptz not null default clock_timestamp()
);
create index if not exists auction_expiry_failures_recent on public.auction_expiry_failures(occurred_at desc);
alter table public.auction_expiry_failures enable row level security;
revoke all on public.auction_expiry_failures from public,anon,authenticated;
grant select,insert on public.auction_expiry_failures to service_role;

-- Add a reporting RPC without changing the existing integer-returning RPC signature.
create or replace function public.expire_live_auctions_report(p_tenant uuid default null)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare a record;result jsonb;closed integer:=0;failed integer:=0;
begin
 for a in select id,tenant_id from public.auctions where status='active' and ends_at<=clock_timestamp()
  and (p_tenant is null or tenant_id=p_tenant) order by ends_at limit 100 for update skip locked
 loop
  begin
   result:=public.close_due_live_auction(a.id,a.tenant_id);
   if result->>'status' in ('closed','awaiting_confirmation') then closed:=closed+1;end if;
  exception when others then
   insert into public.auction_expiry_failures(sqlstate,auction_id,occurred_at) values(sqlstate,a.id,clock_timestamp());
   failed:=failed+1;
  end;
 end loop;
 return jsonb_build_object('closed',closed,'failed',failed);
end $$;
create or replace function public.expire_live_auctions(p_tenant uuid default null)
returns integer language sql set search_path=pg_catalog,public as $$
 select (public.expire_live_auctions_report(p_tenant)->>'closed')::integer
$$;
revoke all on function public.expire_live_auctions_report(uuid),public.expire_live_auctions(uuid) from public,anon,authenticated;
grant execute on function public.expire_live_auctions_report(uuid),public.expire_live_auctions(uuid) to service_role;

create or replace function public.process_live_auction_comment(
 p_auction uuid,p_tenant uuid,p_event uuid,p_kind text,p_amount numeric default null,p_control text default null
) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare a public.auctions;e public.facebook_webhook_events;v jsonb;prior jsonb;r jsonb;
 sender text;cid text;message text;keywords text[];close_keywords text[];settings jsonb;host boolean;confirming boolean;counting boolean:=false;numeric_price numeric;source_at timestamptz;confirmation_floor timestamptz;close_event public.facebook_webhook_events;
begin
 select * into a from public.auctions where id=p_auction and tenant_id=p_tenant for update;
 if not found then raise exception 'AUCTION_NOT_FOUND' using errcode='P0002';end if;
 if not exists(select 1 from public.tenants where id=p_tenant and page_id=a.page_id and is_active) then raise exception 'AUCTION_TENANT_INVALID' using errcode='42501';end if;
 select * into e from public.facebook_webhook_events where id=p_event and page_id=a.page_id;
 if not found or e.kind<>'change' then raise exception 'AUCTION_EVENT_INVALID' using errcode='42501';end if;
 v:=e.payload->'value';sender:=v->'from'->>'id';cid:=v->>'comment_id';
 if sender is null or sender !~ '^[0-9]{1,64}$' or nullif(btrim(cid),'') is null or v->>'verb' is distinct from 'add' or coalesce(v->>'item','') not in ('comment','live_comment') then return jsonb_build_object('status','ignored');end if;
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
  confirmation_floor:=a.winner_locked_at;
  if a.close_event_id is not null then
   select * into close_event from public.facebook_webhook_events where id=a.close_event_id and page_id=a.page_id and kind='change';
   if found and close_event.payload->'value'->>'verb'='add'
    and (close_event.payload->'value'->'from'->>'id'=a.page_id or close_event.payload->'value'->'from'->>'id'=any(a.host_ids)) then
    confirmation_floor:=coalesce(public.auction_comment_timestamp(close_event.payload->'value'->>'created_time'),confirmation_floor);
   end if;
  end if;
  source_at:=public.auction_comment_timestamp(v->>'created_time');
  if source_at is null or source_at<a.created_at
   or (confirmation_floor is not null and source_at<confirmation_floor) then
   return jsonb_build_object('status','stale');
  end if;
 elsif p_kind='HOST_CONTROL' and (p_control='close' or counting) then
  source_at:=public.auction_comment_timestamp(v->>'created_time');
  if source_at is null or source_at<a.created_at
   or (a.closed_at is not null and source_at>a.closed_at) then
   return jsonb_build_object('status','stale');
  end if;
 end if;
 if not confirming and a.status='active' and a.ends_at is not null and e.created_at>=a.ends_at then
  perform public.close_due_live_auction(a.id,a.tenant_id);
  return jsonb_build_object('status','closed','reason','AUCTION_DEADLINE_PASSED');
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
  r:=public.finalize_live_auction_highest_bid(a.id,a.tenant_id,e.id,false);
  update public.auction_deliveries set comment_id=cid where auction_id=a.id and status in ('pending','awaiting_confirmation');
  r:=r||jsonb_build_object('status','confirmed','amount',a.current_price,'name',a.leading_bidder_name);
 end if;
 insert into public.auction_bids(auction_id,event_id,comment_id,bidder_id,bidder_name,comment_text,bid_amount,is_opening,status,result) values(a.id,e.id,cid,sender,left(v->'from'->>'name',200),left(coalesce(v->>'message',''),2000),null,false,r->>'status',r);
 return r;
end $$;
notify pgrst,'reload schema';
commit;
