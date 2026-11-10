-- Forward-only removal of host countdown handling. Historical setup migrations remain immutable.
begin;

alter table public.auctions drop column if exists host_count;
alter table public.auctions drop constraint if exists auctions_status_check;
alter table public.auctions add constraint auctions_status_check check(status in ('active','closed','cancelled','expired'));
update public.auctions set session_automation=(coalesce(session_automation,'{}'::jsonb)-'countEnabled'-'counting_tags')||jsonb_build_object('winnerFlow','on_demand');
update public.live_sessions set
 auction_settings=(coalesce(auction_settings,'{}'::jsonb)-'countEnabled'-'counting_tags')||jsonb_build_object('winnerFlow','on_demand'),
 comment_settings=coalesce(comment_settings,'{}'::jsonb)-'countEnabled'-'counting_tags';

create or replace function public.finalize_live_auction(p_auction uuid,p_tenant uuid,p_event uuid default null,p_cancel boolean default false)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare a public.auctions;locked_at timestamptz;
begin
 select * into a from public.auctions where id=p_auction and tenant_id=p_tenant for update;
 if not found then raise exception 'AUCTION_NOT_FOUND' using errcode='P0002';end if;
 if a.status in ('closed','expired','cancelled') then
  return jsonb_build_object('status',a.status,'orderId',a.order_id,'winnerId',a.leading_bidder_id);
 end if;
 if p_cancel then
  update public.auctions set status='cancelled',closed_at=coalesce(closed_at,clock_timestamp()),close_event_id=coalesce(close_event_id,p_event)
   where id=a.id;
  return jsonb_build_object('status','cancelled','orderId',null);
 end if;
 locked_at:=clock_timestamp();
 update public.auctions set status='closed',closed_at=locked_at,close_event_id=coalesce(p_event,close_event_id),
  winner_locked_at=locked_at,winner_confirmation_comment_id=null,winner_confirmation_event_id=null,winner_confirmed_at=null
  where id=a.id;
 return jsonb_build_object('status','awaiting_confirmation','orderId',null,'winnerId',a.leading_bidder_id,'closedAt',locked_at);
end $$;

create or replace function public.close_due_live_auction(p_auction uuid,p_tenant uuid,p_due_only boolean default true,p_cancel boolean default false)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare a public.auctions;
begin
 select * into a from public.auctions where id=p_auction and tenant_id=p_tenant for update;
 if not found then raise exception 'AUCTION_NOT_FOUND' using errcode='P0002';end if;
 if a.status<>'active' then return jsonb_build_object('status',a.status,'orderId',a.order_id);end if;
 if p_due_only and (a.ends_at is null or a.ends_at>clock_timestamp()) then return jsonb_build_object('status','not_due');end if;
 if p_cancel then return public.finalize_live_auction(a.id,a.tenant_id,null,true);end if;
 return public.finalize_live_auction(a.id,a.tenant_id,null,false);
end $$;

revoke execute on function public.finalize_live_auction(uuid,uuid,uuid,boolean),public.close_due_live_auction(uuid,uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.finalize_live_auction(uuid,uuid,uuid,boolean),public.close_due_live_auction(uuid,uuid,boolean,boolean) to service_role;

create or replace function public.auction_host_command(message text,settings jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog,public as $$
declare line text;closing text[];
begin
 closing:=public.auction_comment_tags(settings,'closeKeywords','');
 for line in select public.normalize_auction_tag(v) from regexp_split_to_table(coalesce(message,''),E'[\r\n]+') v loop
  continue when line='';
  if coalesce((settings->>'closeEnabled')::boolean,true) and line=any(closing) then
   return jsonb_build_object('action','close');
  end if;
  return jsonb_build_object('action','ignore');
 end loop;
 return jsonb_build_object('action','ignore');
end $$;

create or replace function public.save_auction_workspace(p_tenant uuid,p_actor uuid,p_request uuid,p_input jsonb)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare result jsonb;duration integer;prior public.auction_workspace_requests;a public.auctions;effective jsonb;cycling boolean;
begin
 if p_request is null or p_actor is null then raise exception 'INVALID_REQUEST';end if;
 p_input:=p_input||jsonb_build_object('settings',coalesce(p_input->'settings','{}'::jsonb)-'countEnabled'-'counting_tags');
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':auction-workspace',0));
 select * into prior from public.auction_workspace_requests where tenant_id=p_tenant and request_id=p_request;
 if found then
  if prior.actor_id<>p_actor or prior.input<>p_input then raise exception 'REQUEST_REUSED' using errcode='40001';end if;
  return prior.result;
 end if;
 update public.auctions set status='expired' where tenant_id=p_tenant and page_id=p_input->>'pageId'
  and live_post_id=p_input->>'livePostId' and status='closed' and winner_confirmation_comment_id is null
  and closed_at<=clock_timestamp()-interval '5 minutes';
 if p_input->>'roundId' is null and exists(select 1 from public.auctions where tenant_id=p_tenant
  and page_id=p_input->>'pageId' and live_post_id=p_input->>'livePostId' and status='closed'
  and winner_confirmation_comment_id is null and closed_at>clock_timestamp()-interval '5 minutes') then
  raise exception 'AUCTION_CONFIRMATION_WINDOW_ACTIVE' using errcode='55000';
 end if;
 if jsonb_typeof(p_input->'settings'->'autoCycleRounds') is not null and jsonb_typeof(p_input->'settings'->'autoCycleRounds')<>'boolean' then raise exception 'INVALID_SETTINGS';end if;
 cycling:=coalesce((p_input->'settings'->>'autoCycleRounds')::boolean,false);
 effective:=p_input||jsonb_build_object('settings',coalesce(p_input->'settings','{}'::jsonb)||jsonb_build_object('winnerFlow','on_demand'));
 if cycling then
  if coalesce(length(btrim(p_input->>'itemName')),0) not between 1 and 200
   or coalesce((p_input->>'startPrice')::numeric,0) not between 0.01 and 999999999
   or coalesce((p_input->>'minStep')::numeric,0) not between 0.01 and 999999999
   or coalesce((p_input->>'shippingFee')::numeric,-1) not between 0 and 999999 then raise exception 'INVALID_ROUND';end if;
  select * into a from public.auctions where tenant_id=p_tenant and page_id=p_input->>'pageId' and live_post_id=p_input->>'livePostId' and status='active' for update;
  if a.leading_bidder_id is not null then
   if a.bank_account_id is distinct from (p_input->'settings'->>'bankAccountId')::uuid then raise exception 'BIDS_ALREADY_ACCEPTED';end if;
   effective:=p_input||jsonb_build_object('itemName',a.item_name,'startPrice',a.start_price,'minStep',a.min_step,'shippingFee',a.shipping_fee);
  end if;
 end if;
 if cycling or (p_input ? 'durationSeconds' and p_input->'durationSeconds'='null'::jsonb) then duration:=null;
 else
  duration:=coalesce((p_input->>'durationSeconds')::integer,300);
  if duration not between 30 and 86400 then raise exception 'AUCTION_DURATION_INVALID' using errcode='23514';end if;
 end if;
 result:=public.save_auction_workspace_without_deadline(p_tenant,p_actor,p_request,effective);
 if duration is null then
  update public.auctions set duration_seconds=null,timer_started_at=null,ends_at=null where id=(result->>'auctionId')::uuid and tenant_id=p_tenant and status='active';
 else
  update public.auctions set duration_seconds=duration,timer_started_at=coalesce(timer_started_at,clock_timestamp()),
   ends_at=coalesce(timer_started_at,clock_timestamp())+make_interval(secs=>duration)
   where id=(result->>'auctionId')::uuid and tenant_id=p_tenant and status='active' and (duration_seconds is distinct from duration or ends_at is null);
 end if;
 update public.live_sessions set comment_settings=coalesce(comment_settings,'{}')||(p_input->'settings')||
  jsonb_build_object('public_reply_template',p_input->'settings'->>'bidText','private_reply_template',p_input->'settings'->>'privateText'),
  auction_round_template=jsonb_build_object('itemName',btrim(p_input->>'itemName'),
  'startPrice',(p_input->>'startPrice')::numeric,'minStep',(p_input->>'minStep')::numeric,'shippingFee',(p_input->>'shippingFee')::numeric)
  where id=(result->>'sessionId')::uuid and tenant_id=p_tenant;
 -- Preserve original request identity when the active round's bid prices were protected.
 update public.auction_workspace_requests set input=p_input where tenant_id=p_tenant and request_id=p_request;
 update public.live_sessions set auction_settings=coalesce(auction_settings,'{}'::jsonb)-'countEnabled'-'counting_tags',
  comment_settings=coalesce(comment_settings,'{}'::jsonb)-'countEnabled'-'counting_tags'
  where id=(result->>'sessionId')::uuid and tenant_id=p_tenant;
 update public.auctions set session_automation=coalesce(session_automation,'{}'::jsonb)-'countEnabled'-'counting_tags'
  where id=(result->>'auctionId')::uuid and tenant_id=p_tenant;
 return result;
end $$;

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
     winner_confirmation_comment_id=cid,winner_confirmation_event_id=e.id,winner_confirmed_at=clock_timestamp(),order_id=oid
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

create or replace function public.expire_live_auctions(p_tenant uuid default null)
returns integer language plpgsql set search_path=pg_catalog,public as $$
declare a record;result jsonb;expired_count integer:=0;
begin
 for a in select id,tenant_id,status from public.auctions
  where (p_tenant is null or tenant_id=p_tenant) and (
   (status='active' and ends_at is not null and ends_at<=clock_timestamp()) or
   (status='closed' and winner_confirmation_comment_id is null and closed_at<=clock_timestamp()-interval '5 minutes'))
  order by coalesce(ends_at,closed_at) limit 100 for update skip locked
 loop
  begin
   if a.status='closed' then
    update public.auctions set status='expired' where id=a.id and status='closed' and winner_confirmation_comment_id is null;
    if found then expired_count:=expired_count+1;end if;
   else
    result:=public.close_due_live_auction(a.id,a.tenant_id);
    if result->>'status'='closed' then expired_count:=expired_count+1;end if;
   end if;
  exception when others then
   raise warning 'Auction % expiry failed [%]: %',a.id,sqlstate,sqlerrm;
  end;
 end loop;
 return expired_count;
end $$;

revoke all on function public.expire_live_auctions(uuid) from public,anon,authenticated;
grant execute on function public.expire_live_auctions(uuid) to service_role;

notify pgrst,'reload schema';
commit;
