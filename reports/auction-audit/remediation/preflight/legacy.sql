CREATE OR REPLACE FUNCTION public.process_live_auction_comment(p_auction uuid, p_tenant uuid, p_event uuid, p_kind text, p_amount numeric DEFAULT NULL::numeric, p_control text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare a public.auctions; e public.facebook_webhook_events; v jsonb; prior jsonb; r jsonb;
 sender text; cid text; bidder text; amount numeric; minimum numeric; outcome text; host boolean;
begin
 select * into a from public.auctions where id=p_auction and tenant_id=p_tenant for update;
 if not found then raise exception 'AUCTION_NOT_FOUND' using errcode='P0002';end if;
 select * into e from public.facebook_webhook_events where id=p_event and page_id=a.page_id;
 if not found or e.kind<>'change' then raise exception 'AUCTION_EVENT_INVALID' using errcode='42501';end if;
 v:=e.payload->'value'; sender:=v->'from'->>'id'; cid:=v->>'comment_id';bidder:=left(v->'from'->>'name',200);
 if sender is null or cid is null or v->>'verb'<>'add' then return jsonb_build_object('status','ignored');end if;
 if not coalesce((a.live_post_id=split_part(v->>'post_id','_',array_length(string_to_array(v->>'post_id','_'),1))
   or a.live_post_id=v->>'video_id' or a.live_post_id=v->>'live_video_id'
   or v->>'post_id'=any(a.live_post_aliases)),false) then
  raise exception 'AUCTION_POST_MISMATCH' using errcode='42501';
 end if;
 select result into prior from public.auction_bids where auction_id=a.id and comment_id=cid;
 if found then return prior;end if;
 if e.created_at<a.created_at then return jsonb_build_object('status','stale');end if;
 if coalesce(v->>'created_time','') ~ '^[0-9]{10}$' and (v->>'created_time')::numeric<floor(extract(epoch from a.created_at)) then
  return jsonb_build_object('status','stale');
 end if;
 -- No worker may overtake an earlier comment even if called outside the queue loop.
 if exists(select 1 from public.facebook_webhook_events older where older.page_id=e.page_id
  and older.ordering_key=e.ordering_key and older.sequence<e.sequence and older.status in ('pending','processing')) then
  raise exception 'AUCTION_EVENT_OUT_OF_ORDER' using errcode='40001';
 end if;
 host:=sender=a.page_id or sender=any(a.host_ids);
 minimum:=case when a.leading_bidder_id is null then a.start_price else a.current_price+a.min_step end;
 if a.status<>'active' then outcome:='closed';
 elsif p_kind='HOST_CONTROL' and host then
  if p_control='close' then r:=public.finalize_live_auction(a.id,a.tenant_id,e.id);outcome:='closed';
  elsif p_control in ('1','2','3','นับขิง') then
   update public.auctions set host_count=p_control where id=a.id;outcome:='count';
  else return jsonb_build_object('status','ignored');end if;
 elsif host or p_kind not in ('OPENING_BID','STEP_BID','NUMERIC_BID') then
  return jsonb_build_object('status','ignored');
 elsif p_kind='OPENING_BID' and a.leading_bidder_id is not null then outcome:='already_opened';
 else
  amount:=case when p_kind='OPENING_BID' then a.start_price when p_kind='STEP_BID' then minimum else p_amount end;
  if amount is null or amount<minimum or amount>999999999 or amount<>round(amount,2) then outcome:='too_low';
  else
   update public.auctions set current_price=amount,leading_bidder_id=sender,
    leading_bidder_name=bidder,leading_comment_id=cid,host_count=null where id=a.id;
   outcome:='accepted';
  end if;
 end if;
 r:=coalesce(r,jsonb_build_object('status',outcome,'amount',coalesce(amount,a.current_price),
  'minimum',minimum,'name',bidder,'isOpening',p_kind='OPENING_BID'));
 insert into public.auction_bids(auction_id,event_id,comment_id,bidder_id,bidder_name,comment_text,bid_amount,is_opening,status,result)
  values(a.id,e.id,cid,sender,bidder,left(coalesce(v->>'message',''),2000),amount,p_kind='OPENING_BID',outcome,r);
 return r;
end $function$
