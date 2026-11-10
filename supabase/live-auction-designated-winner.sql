alter table public.auctions add column if not exists winner_designated_bidder_id text, add column if not exists winner_designated_at timestamptz;

create or replace function public.designate_live_auction_winner(p_auction uuid,p_tenant uuid,p_bidder text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.auctions;winner_amount numeric;
begin
 select * into a from public.auctions where id=p_auction and tenant_id=p_tenant for update;
 if not found then raise exception 'AUCTION_NOT_FOUND' using errcode='P0002';end if;
 if a.status<>'closed' or a.winner_confirmation_comment_id is not null or a.closed_at<=clock_timestamp()-interval '5 minutes' then
  raise exception 'AUCTION_WINNER_DESIGNATION_CLOSED' using errcode='55000';
 end if;
 if a.winner_designated_bidder_id is not null then
  if a.winner_designated_bidder_id<>p_bidder then raise exception 'AUCTION_WINNER_ALREADY_DESIGNATED' using errcode='55000';end if;
  select max(bid_amount) into winner_amount from public.auction_bids where auction_id=a.id and bidder_id=p_bidder and status='accepted' and bid_amount>0 and not is_opening and bid_amount=public.auction_numeric_price(comment_text);
  return jsonb_build_object('status','designated','bidderId',p_bidder,'amount',winner_amount);
 end if;
 select max(bid_amount) into winner_amount from public.auction_bids where auction_id=a.id and bidder_id=p_bidder and status='accepted' and bid_amount>0 and not is_opening and bid_amount=public.auction_numeric_price(comment_text);
 if winner_amount is null then raise exception 'AUCTION_WINNER_HAS_NO_VALID_BID' using errcode='22023';end if;
 update public.auctions set winner_designated_bidder_id=p_bidder,winner_designated_at=clock_timestamp() where id=a.id;
 return jsonb_build_object('status','designated','bidderId',p_bidder,'amount',winner_amount);
end $$;

revoke all on function public.designate_live_auction_winner(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.designate_live_auction_winner(uuid,uuid,text) to service_role;

create or replace function public.process_live_auction_comment(p_auction uuid,p_tenant uuid,p_event uuid,p_kind text,p_amount numeric default null,p_control text default null)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare a public.auctions;e public.facebook_webhook_events;v jsonb;prior jsonb;r jsonb;
 sender text;cid text;bidder text;amount numeric;minimum numeric;outcome text;
 b public.auction_bids;c public.customers;claim public.auction_winner_claims;o public.orders;
 oid uuid;confirming boolean;host boolean;
begin
 select * into a from public.auctions where id=p_auction and tenant_id=p_tenant for update;
 if not found then raise exception 'AUCTION_NOT_FOUND' using errcode='P0002';end if;
 select * into e from public.facebook_webhook_events where id=p_event and page_id=a.page_id;
 if not found or e.kind<>'change' then raise exception 'AUCTION_EVENT_INVALID' using errcode='42501';end if;
 v:=e.payload->'value';sender:=v->'from'->>'id';cid:=v->>'comment_id';bidder:=nullif(left(trim(v->'from'->>'name'),200),'');
 if sender is null or cid is null or v->>'verb' is distinct from 'add' or coalesce(v->>'item','') not in ('comment','live_comment') then
  return jsonb_build_object('status','ignored');
 end if;
 if not coalesce((a.live_post_id=regexp_replace(v->>'post_id','^.*_','') or a.live_post_id=v->>'video_id'
  or a.live_post_id=v->>'live_video_id' or v->>'post_id'=any(a.live_post_aliases)),false) then
  raise exception 'AUCTION_POST_MISMATCH' using errcode='42501';
 end if;
 select result into prior from public.auction_bids where auction_id=a.id and comment_id=cid;
 if found then return prior;end if;
 -- Ordering is a receipt/lease invariant, never a close-time or winner eligibility cutoff.
 if exists(select 1 from public.auction_bids receipt_bid join public.auctions processed on processed.id=receipt_bid.auction_id
  where processed.tenant_id=p_tenant and processed.page_id=a.page_id and processed.live_post_id=a.live_post_id
   and (receipt_bid.event_id=e.id or receipt_bid.comment_id=cid)) then
  return jsonb_build_object('status','ignored','reason','COMMENT_ALREADY_PROCESSED');
 end if;
 if exists(select 1 from public.facebook_webhook_events older where older.page_id=e.page_id
  and older.ordering_key=e.ordering_key and older.sequence<e.sequence and older.status in ('pending','processing')) then
  raise exception 'AUCTION_EVENT_OUT_OF_ORDER' using errcode='40001';
 end if;
 host:=sender=a.page_id or sender=any(a.host_ids);
 confirming:=not host and a.status='closed' and a.winner_locked_at is not null and a.winner_confirmation_comment_id is null
  and not exists(select 1 from public.auctions newer where newer.tenant_id=a.tenant_id and newer.page_id=a.page_id
   and newer.live_post_id=a.live_post_id and newer.status='active' and newer.created_at>a.closed_at)
  and a.winner_designated_bidder_id=sender
   and public.normalize_auction_tag(v->>'message')=any(public.auction_comment_tags(coalesce(a.session_automation,'{}'::jsonb),'keywords','1'));
 outcome:='ignored';
 if a.status='closed' and a.closed_at is not null and clock_timestamp()>=a.closed_at+interval '5 minutes' and a.winner_confirmation_comment_id is null then
  update public.auctions set status='expired' where id=a.id;
  a.status:='expired';r:=jsonb_build_object('status','expired','reason','CONFIRMATION_WINDOW_EXPIRED');outcome:='expired';
 end if;
 if a.status='cancelled' then r:=jsonb_build_object('status','ignored','reason','ROUND_CANCELLED');
 elsif host then
  if a.status='active' and coalesce((a.session_automation->>'closeEnabled')::boolean,true)
   and public.auction_close_keyword_matches(v->>'message',a.session_automation->'closeKeywords') then
   update public.auctions set status='closed',closed_at=clock_timestamp(),close_event_id=e.id,winner_locked_at=clock_timestamp(),
    winner_confirmation_comment_id=null,winner_confirmation_event_id=null,winner_confirmed_at=null
    where id=a.id returning * into a;
   outcome:='closed';r:=jsonb_build_object('status','awaiting_confirmation','auctionId',a.id,'closedAt',a.closed_at);
  end if;
 elsif confirming and a.status='closed' and a.winner_confirmation_comment_id is null then
  if clock_timestamp()>=a.closed_at+interval '5 minutes' then
   update public.auctions set status='expired' where id=a.id and status='closed' and winner_confirmation_comment_id is null;
   r:=jsonb_build_object('status','expired','reason','CONFIRMATION_WINDOW_EXPIRED');outcome:='expired';
  else
  -- Use only successful numeric bids made by THIS sender in THIS round.
  select * into b from public.auction_bids where auction_id=a.id and bidder_id=sender and bid_amount>0 and status='accepted'
   and not is_opening and bid_amount=public.auction_numeric_price(comment_text)
   order by bid_amount desc,id limit 1;
  if not found then r:=jsonb_build_object('status','ignored','reason','NO_BID_HISTORY');
  else
   select * into claim from public.auction_winner_claims where auction_id=a.id and bidder_id=sender for update;
   if found and exists(select 1 from public.auction_deliveries where claim_id=claim.id and status in ('sending','requires_review')) then
    raise exception 'AUCTION_CLAIM_DELIVERY_BUSY' using errcode='40001';
   end if;
   if claim.id is not null then
    select * into o from public.orders where id=claim.order_id and tenant_id=p_tenant and customer_id=claim.customer_id for update;
    if o.status='cancelled' or (b.bid_amount<>claim.highest_amount and (o.status in ('paid','shipped') or o.paid_amount>0)) then
     r:=jsonb_build_object('status','settled','reason','BILL_REQUIRES_REVIEW');
    end if;
   end if;
   if r is null then
    insert into public.customers(platform,platform_user_id,tenant_id,display_name)
     values('facebook',sender,a.tenant_id,coalesce(bidder,b.bidder_name,sender))
     on conflict(platform,platform_user_id) do update set tenant_id=coalesce(customers.tenant_id,excluded.tenant_id)
     returning * into c;
    if c.tenant_id is distinct from a.tenant_id then raise exception 'AUCTION_CUSTOMER_TENANT' using errcode='42501';end if;
    if claim.id is null then
     insert into public.auction_winner_claims(tenant_id,auction_id,customer_id,bidder_id,bidder_name,highest_bid_id,highest_amount)
      values(p_tenant,a.id,c.id,sender,coalesce(bidder,c.display_name),b.id,b.bid_amount) returning * into claim;
     insert into public.orders(tenant_id,customer_id,product_name,amount,item_amount,source,source_id,live_bank_account_id,live_auction_id)
      values(p_tenant,c.id,a.item_name,b.bid_amount+a.shipping_fee,b.bid_amount,'live_auction',a.id::text||':claim:'||sender,a.bank_account_id,a.id)
      returning id into oid;
    else
     oid:=claim.order_id;
     if b.bid_amount<>claim.highest_amount then
      update public.orders as target set amount=target.amount+b.bid_amount-target.item_amount,item_amount=b.bid_amount where target.id=oid;
     end if;
    end if;
    update public.customer_tab_items set auction_id=a.id,winning_bid_id=b.id where order_id=oid;
    update public.messages set delivery_status='failed' where delivery_status='pending'
     and external_id in (select 'auction-claim:'||claim.id::text||':'||d.claim_revision::text
      from public.auction_deliveries d where d.claim_id=claim.id and d.channel='private' and d.status='pending');
    update public.auction_winner_claims set order_id=oid,highest_bid_id=b.id,highest_amount=b.bid_amount,
     bidder_name=coalesce(bidder,c.display_name),revision=revision+1,updated_at=clock_timestamp() where id=claim.id returning * into claim;
    -- Supersede only unsent older summaries; delivered or ambiguous sends are never blindly replayed.
    update public.auction_deliveries set status='superseded' where claim_id=claim.id and status='pending';
     insert into public.auction_deliveries(auction_id,channel,comment_id,claim_id,claim_revision)
      values(a.id,'private',cid,claim.id,claim.revision);
     insert into public.messages(customer_id,external_id,sender,body,delivery_status)
      values(c.id,'auction-claim:'||claim.id::text||':'||claim.revision::text,'bot','รอส่งสรุปบิลจากยอดเคาะของลูกค้า','pending');

    if a.public_reply_enabled then
     insert into public.auction_deliveries(auction_id,channel,comment_id,claim_id,claim_revision)
      values(a.id,'public',cid,claim.id,claim.revision);
    end if;
    update public.auctions set leading_bidder_id=sender,leading_bidder_name=claim.bidder_name,leading_comment_id=b.comment_id,
     winner_confirmation_comment_id=cid,winner_confirmation_event_id=e.id,winner_confirmed_at=clock_timestamp(),order_id=oid,current_price=b.bid_amount
     where id=a.id and status='closed' and winner_confirmation_comment_id is null
      and closed_at>=clock_timestamp()-interval '5 minutes';
    if not found then raise exception 'AUCTION_CONFIRMATION_CLOSED' using errcode='40001';end if;
    outcome:='claimed';
    r:=jsonb_build_object('status','confirmed','amount',b.bid_amount,'name',claim.bidder_name,'claimId',claim.id,'orderId',oid,'auctionId',a.id);
   end if;
  end if;
  end if;
 elsif a.status='active' and not host and p_kind in ('NUMERIC_BID','OPENING_BID','STEP_BID') then
  minimum:=case when a.leading_bidder_id is null then a.start_price else a.current_price+a.min_step end;
  if p_kind='OPENING_BID' and a.leading_bidder_id is not null then
   outcome:='already_opened';amount:=a.current_price;
  else
   amount:=case when p_kind='OPENING_BID' then a.start_price when p_kind='STEP_BID' then minimum else public.auction_numeric_price(v->>'message') end;
   outcome:=case when amount is not null and amount>=minimum and amount<=999999999 and amount=round(amount,2) then 'accepted' else 'too_low' end;
   if outcome='accepted' then
    update public.auctions set current_price=amount,leading_bidder_id=sender,leading_bidder_name=bidder,leading_comment_id=cid where id=a.id;
   end if;
  end if;
  r:=jsonb_build_object('status',outcome,'amount',coalesce(amount,a.current_price),'minimum',minimum,'name',bidder,'isOpening',p_kind='OPENING_BID');
 end if;
 r:=coalesce(r,jsonb_build_object('status',outcome));
 insert into public.auction_bids(auction_id,event_id,comment_id,bidder_id,bidder_name,comment_text,bid_amount,is_opening,status,result)
  values(a.id,e.id,cid,sender,bidder,left(coalesce(v->>'message',''),2000),case when confirming or host then null else amount end,false,outcome,r);
 return r;
end $$;
revoke all on function public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text) from public,anon,authenticated;
grant execute on function public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text) to service_role;
notify pgrst,'reload schema';
