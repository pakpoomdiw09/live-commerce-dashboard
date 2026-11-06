-- Flexible on-demand billing. Apply after live-auction-production-readiness.sql.
begin;
alter table public.orders add column if not exists live_auction_id uuid references public.auctions(id);
create table if not exists public.auction_winner_claims (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 auction_id uuid not null references public.auctions(id),
 customer_id uuid not null references public.customers(id),
 bidder_id text not null,bidder_name text,
 highest_bid_id uuid references public.auction_bids(id),
 highest_amount numeric(12,2) not null check(highest_amount>0),
 order_id uuid unique references public.orders(id),
 revision bigint not null default 0,
 updated_at timestamptz not null default clock_timestamp(),
 unique(auction_id,bidder_id)
);
alter table public.auction_winner_claims enable row level security;
revoke all on public.auction_winner_claims from public,anon,authenticated;
grant all on public.auction_winner_claims to service_role;
alter table public.auction_deliveries add column if not exists claim_id uuid references public.auction_winner_claims(id),
 add column if not exists claim_revision bigint;
alter table public.auction_deliveries drop constraint if exists auction_deliveries_auction_id_channel_key;
alter table public.auction_deliveries drop constraint if exists auction_deliveries_status_check;
alter table public.auction_deliveries add constraint auction_deliveries_status_check
 check(status in ('awaiting_confirmation','pending','sending','sent','requires_review','superseded'));
create unique index if not exists auction_legacy_delivery_once on public.auction_deliveries(auction_id,channel) where claim_id is null;
create unique index if not exists auction_claim_delivery_once on public.auction_deliveries(claim_id,claim_revision,channel) where claim_id is not null;
create index if not exists auction_bidder_highest on public.auction_bids(auction_id,bidder_id,bid_amount desc) where bid_amount>0;

-- Serialize outbox claiming with comment processing on the round row. A confirmation
-- cannot revise a bill between the delivery eligibility check and the send claim.
create or replace function public.claim_auction_bill_delivery(p_delivery uuid,p_revision bigint)
returns boolean language plpgsql set search_path=pg_catalog,public as $$
declare d public.auction_deliveries;a public.auctions;c public.auction_winner_claims;
begin
 select * into d from public.auction_deliveries where id=p_delivery;
 if not found or d.claim_id is null then return false;end if;
 select * into a from public.auctions where id=d.auction_id for update;
 select * into c from public.auction_winner_claims where id=d.claim_id and auction_id=a.id and tenant_id=a.tenant_id for update;
 if not found or c.revision<>p_revision or d.claim_revision<>p_revision
  or a.status='cancelled' or (d.channel='public' and not a.public_reply_enabled)
  or (d.channel='private' and not a.private_reply_enabled) then return false;end if;
 update public.auction_deliveries set status='sending',started_at=clock_timestamp() where id=d.id and status='pending';
 return found;
end $$;
revoke all on function public.claim_auction_bill_delivery(uuid,bigint) from public,anon,authenticated;
grant execute on function public.claim_auction_bill_delivery(uuid,bigint) to service_role;

create or replace function public.auction_numeric_price(p_text text) returns numeric
language plpgsql immutable set search_path=pg_catalog,public as $$
declare value text:=lower(regexp_replace(normalize(trim(coalesce(p_text,'')),NFKC),'\s+',' ','g')); amount numeric;
begin
 if value !~ '^(\d{1,9}|\d{1,3}(,\d{3}){1,2})(\.\d{1,2})?(\s*บาท)?$' then return null;end if;
 amount:=regexp_replace(value,'บาท|,|\s','','g')::numeric;
 return case when amount>0 and amount<=999999999 then amount else null end;
end $$;

create or replace function public.process_live_auction_highest_bid(p_auction uuid,p_tenant uuid,p_event uuid,p_kind text,p_amount numeric default null,p_control text default null)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
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
 if a.session_automation ? 'closeKeywords' then
  if host then
   if public.auction_close_keyword_matches(v->>'message',a.session_automation->'closeKeywords') then p_kind:='HOST_CONTROL';p_control:='close';
   else return jsonb_build_object('status','ignored');end if;
  elsif exists(select 1 from jsonb_array_elements_text(a.session_automation->'keywords') k where k=lower(regexp_replace(normalize(trim(coalesce(v->>'message','')),NFKC),'\s+',' ','g'))) then p_kind:='STEP_BID';
  elsif p_kind<>'NUMERIC_BID' then return jsonb_build_object('status','ignored');end if;
 end if;

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
end $$;

create or replace function public.finalize_live_auction_highest_bid(p_auction uuid,p_tenant uuid,p_event uuid default null,p_cancel boolean default false)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare a public.auctions; c public.customers; oid uuid; tab public.customer_tabs;
begin
 select * into a from public.auctions where id=p_auction and tenant_id=p_tenant for update;
 if not found then raise exception 'AUCTION_NOT_FOUND' using errcode='P0002';end if;
 if a.status<>'active' then return jsonb_build_object('status',a.status,'orderId',a.order_id);end if;
 if not p_cancel and a.leading_bidder_id is not null then
  insert into public.customers(platform,platform_user_id,tenant_id,display_name)
   values('facebook',a.leading_bidder_id,a.tenant_id,a.leading_bidder_name)
   on conflict(platform,platform_user_id) do update set tenant_id=coalesce(customers.tenant_id,excluded.tenant_id)
   returning * into c;
  if c.tenant_id is distinct from a.tenant_id then raise exception 'AUCTION_CUSTOMER_TENANT' using errcode='42501';end if;
  -- The existing order trigger attaches CF/auction items to the same tab under its row lock.
  insert into public.orders(tenant_id,customer_id,product_name,amount,source,source_id,live_bank_account_id)
   values(a.tenant_id,c.id,a.item_name,a.current_price+a.shipping_fee,'live_auction',a.id::text,a.bank_account_id)
   returning id into oid;
  select t.* into strict tab from public.customer_tabs t join public.orders o on o.customer_tab_id=t.id where o.id=oid;
  update public.customers set conversation_status='open',
    conversation_version=conversation_version+1,
    order_status=case when tab.remaining_amount>0 then 'pending_review' else 'paid' end
   where id=c.id;
  -- This is a local activity note, never an invented Messenger send or inbound message.
  -- Do not extend last_message_at/window_expires_at/inbound_seq from an auction.
  insert into public.messages(customer_id,external_id,sender,body,delivery_status)
   values(c.id,'auction-event:'||a.id::text,'bot',
    'บันทึกระบบ: ชนะประมูล '||a.item_name||' - '||case when tab.remaining_amount>0 then 'รอชำระเงิน' else 'ชำระครบแล้ว' end||
    ' • ยอดคงเหลือสุทธิ '||tab.remaining_amount::text||' บาท',null)
   on conflict(external_id) do nothing;
  if a.private_reply_enabled then
   insert into public.auction_deliveries(auction_id,channel,comment_id) values(a.id,'private',a.leading_comment_id);
   insert into public.messages(customer_id,external_id,sender,body,delivery_status)
    values(c.id,'auction-bill:'||a.id::text,'bot','รอส่งสรุปยอดประมูล '||a.item_name||' เข้า Messenger','pending')
    on conflict(external_id) do nothing;
  end if;
 end if;
 update public.auctions set status=case when p_cancel then 'cancelled' else 'closed' end,
  closed_at=clock_timestamp(),close_event_id=p_event,order_id=oid where id=a.id;
 if not p_cancel and a.public_reply_enabled and a.leading_bidder_id is not null and a.session_automation ? 'closeKeywords' then
  insert into public.auction_deliveries(auction_id,channel,comment_id) values(a.id,'public',a.leading_comment_id) on conflict(auction_id,channel) where claim_id is null do nothing;
 elsif p_event is not null and not p_cancel and a.public_reply_enabled then
  insert into public.auction_deliveries(auction_id,channel,comment_id)
   select a.id,'public',payload->'value'->>'comment_id' from public.facebook_webhook_events where id=p_event;
 end if;
 return jsonb_build_object('status',case when p_cancel then 'cancelled' else 'closed' end,'orderId',oid);
end $$;

create or replace function public.finalize_live_auction(p_auction uuid,p_tenant uuid,p_event uuid default null,p_cancel boolean default false)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare a public.auctions;
begin
 select * into a from public.auctions where id=p_auction and tenant_id=p_tenant for update;
 if not found then raise exception 'AUCTION_NOT_FOUND' using errcode='P0002';end if;
 if coalesce(a.session_automation->>'winnerFlow','highest_bid')<>'on_demand' then
  return public.finalize_live_auction_highest_bid(p_auction,p_tenant,p_event,p_cancel);
 end if;
 if a.status='active' then
  update public.auctions set status=case when p_cancel then 'cancelled' else 'closed' end,
   closed_at=clock_timestamp(),close_event_id=p_event where id=a.id returning * into a;
 end if;
 return jsonb_build_object('status',a.status,'orderId',null);
end $$;

create or replace function public.normalize_auction_thai_settings(settings jsonb) returns jsonb
language sql immutable returns null on null input set search_path=pg_catalog,public as $$
 select case when coalesce(settings->>'winnerFlow','on_demand') in ('on_demand','highest_bid') then settings||jsonb_build_object(
  'winnerFlow',coalesce(settings->>'winnerFlow','on_demand'),
  'keywords',coalesce(settings->'keywords','[]'::jsonb),
  'closeKeywords',coalesce(settings->'closeKeywords','[]'::jsonb),
  'closeKeywordPresetsVersion',1,'countEnabled',false,'heartCloses',false,'closeEnabled',true,
  'bidText',case when settings ? 'closeKeywords' then settings->>'bidText' else coalesce(settings->>'closeText','ยินดีด้วยครับ คุณ {bidder_name} ชนะประมูล {product_name} ราคา {price} บาท') end,
  'closeText',case when settings ? 'closeKeywords' then settings->>'bidText' else coalesce(settings->>'closeText','ยินดีด้วยครับ คุณ {bidder_name} ชนะประมูล {product_name} ราคา {price} บาท') end) else null end
$$;

create or replace function public.attach_customer_tab_order() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
declare c public.customers; a public.auctions; r public.comment_rules; sess uuid; bill public.customer_tabs;
 page text; post text; shipping numeric:=0; bank uuid; unit numeric;
begin
 if current_setting('app.refreshing_customer_tab',true)='1' then return new;end if;
 if tg_op='UPDATE' then
  if old.customer_tab_id is null then return new;end if;
  if new.customer_tab_id is distinct from old.customer_tab_id or new.tenant_id<>old.tenant_id or new.customer_id<>old.customer_id
   or new.live_session_id is distinct from old.live_session_id then raise exception 'TAB_ORDER_SCOPE_IMMUTABLE';end if;
  if new.status='cancelled' and old.paid_amount>0 then raise exception 'TAB_REFUND_REQUIRES_REVIEW';end if;
  if new.status in ('paid','shipped') and new.paid_amount<new.amount then raise exception 'TAB_PAYMENT_NOT_COVERED';end if;
  if new.paid_amount<>old.paid_amount then raise exception 'TAB_PAYMENT_LEDGER_REQUIRED';end if;
  if new.amount<>old.amount then
   if new.variant_id is distinct from old.variant_id then new.item_amount:=new.amount;new.amount:=new.item_amount+(old.amount-old.item_amount);
   else new.item_amount:=old.item_amount+(new.amount-old.amount);end if;
  end if;
  return new;
 end if;
 if coalesce(new.source,'') not in ('live_auction','live_comment') or new.status<>'pending_payment' then return new;end if;
 select * into c from public.customers where id=new.customer_id and tenant_id=new.tenant_id and platform='facebook';
 if not found then raise exception 'TAB_CUSTOMER_SCOPE';end if;
 select page_id into page from public.tenants where id=new.tenant_id and is_active;
 if page is null then raise exception 'TAB_PAGE_SCOPE';end if;
 if new.source='live_auction' then
  select * into a from public.auctions where (id=new.live_auction_id or (new.live_auction_id is null and id::text=new.source_id)) and tenant_id=new.tenant_id and page_id=page;
  if not found then raise exception 'TAB_AUCTION_SCOPE';end if;
  post:=a.live_post_id;shipping:=a.shipping_fee;bank:=a.bank_account_id;unit:=case when new.live_auction_id is not null and a.session_automation->>'winnerFlow'='on_demand' then new.item_amount else a.current_price end;
 else
  select * into r from public.comment_rules where id=new.live_rule_id and tenant_id=new.tenant_id and page=any(page_ids);
  if not found then raise exception 'TAB_CF_SCOPE';end if;
  post:=coalesce(new.live_post_id,r.live_post_id);bank:=r.live_bank_account_id;unit:=new.amount;
  if post is null then return new;end if;
  select live_post_id into post from public.auctions where tenant_id=new.tenant_id and page_id=page
   and (live_post_id=regexp_replace(coalesce(new.live_post_id,r.live_post_id),'^.*_','')
    or coalesce(new.live_post_id,r.live_post_id)=any(live_post_aliases)) order by created_at desc limit 1;
  post:=coalesce(post,new.live_post_id,r.live_post_id);
 end if;
 post:=regexp_replace(post,'^.*_','');
 insert into public.live_sessions(tenant_id,page_id,live_post_id) values(new.tenant_id,page,post)
  on conflict(tenant_id,page_id,live_post_id) do update set live_post_id=excluded.live_post_id returning id into sess;
 if not (new.live_auction_id is not null and a.session_automation->>'winnerFlow'='on_demand') and exists(select 1 from public.live_sessions where id=sess and ended_at is not null) then raise exception 'LIVE_SESSION_ENDED';end if;
 insert into public.customer_tabs(tenant_id,customer_id,customer_fb_id,page_id,live_session_id,bank_account_id,shipping_fee)
  values(new.tenant_id,c.id,c.platform_user_id,page,sess,bank,shipping)
  on conflict(live_session_id,customer_id) do update set bank_account_id=coalesce(customer_tabs.bank_account_id,excluded.bank_account_id),
   shipping_fee=case when not customer_tabs.shipping_override and customer_tabs.shipping_fee=0 then excluded.shipping_fee else customer_tabs.shipping_fee end returning * into bill;
 new.customer_tab_id:=bill.id;new.live_session_id:=sess;new.live_post_id:=post;new.item_amount:=unit;
 new.amount:=unit+case when not exists(select 1 from public.customer_tab_items where tab_id=bill.id and not cancelled) then bill.shipping_fee else 0 end;
 return new;
end $$;

create or replace function public.stamp_customer_tab_proof() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.auction_id is null then
  select a.id,b.id into new.auction_id,new.winning_bid_id from public.orders o join public.auctions a on (a.id=o.live_auction_id or (o.live_auction_id is null and a.id::text=o.source_id)) and a.tenant_id=o.tenant_id
   left join public.auction_bids b on b.auction_id=a.id and b.comment_id=a.leading_comment_id where o.id=new.order_id and o.source='live_auction';
 end if;
 return new;
end $$;

create or replace function public.complete_auction_customer_tab_slip(
 p_slip uuid,p_tenant uuid,p_customer uuid,p_sender text,p_amount numeric,
 p_ref text,p_paid_at timestamptz,p_raw jsonb,p_note text
)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare s public.slips; t public.customer_tabs;
begin
 select * into s from public.slips
  where id=p_slip and tenant_id=p_tenant and customer_id=p_customer for update;
 if not found or s.status<>'pending' or s.customer_tab_id is null then
  raise exception 'AUCTION_TAB_SLIP_SCOPE' using errcode='42501';
 end if;
 select * into t from public.customer_tabs
  where id=s.customer_tab_id and tenant_id=p_tenant and customer_id=p_customer for update;
 if not found or t.remaining_amount<=0 or s.expected_amount is distinct from t.remaining_amount
  or p_amount is distinct from t.remaining_amount then
  raise exception 'AUCTION_TAB_AMOUNT_MISMATCH' using errcode='23514';
 end if;
 if not exists(select 1 from public.customers c where c.id=p_customer and c.tenant_id=p_tenant
  and c.platform='facebook' and c.platform_user_id=p_sender) then
  raise exception 'AUCTION_WINNER_MISMATCH' using errcode='42501';
 end if;
 if not exists(
  select 1 from public.orders o join public.auctions a on a.order_id=o.id
  where o.customer_tab_id=t.id and o.tenant_id=p_tenant and o.customer_id=p_customer
   and o.source='live_auction' and o.status='pending_payment'
   and a.tenant_id=p_tenant and a.status='closed' and a.leading_bidder_id=p_sender
 ) and not exists(
  select 1 from public.orders o join public.auction_winner_claims c on c.order_id=o.id and c.customer_id=o.customer_id
  join public.auctions a on a.id=c.auction_id and a.id=o.live_auction_id and a.tenant_id=c.tenant_id
  where o.customer_tab_id=t.id and o.tenant_id=p_tenant and o.customer_id=p_customer
   and o.source='live_auction' and o.status='pending_payment' and c.tenant_id=p_tenant and c.bidder_id=p_sender
   and a.status in ('active','closed') and a.page_id=t.page_id
 ) then
  raise exception 'AUCTION_WINNER_MISMATCH' using errcode='42501';
 end if;
 return public.complete_customer_tab_slip(
  p_slip,p_tenant,p_customer,'valid',p_amount,p_ref,p_paid_at,p_raw,p_note
 );
end $$;

revoke all on function public.process_live_auction_highest_bid(uuid,uuid,uuid,text,numeric,text),public.finalize_live_auction_highest_bid(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.process_live_auction_highest_bid(uuid,uuid,uuid,text,numeric,text),public.finalize_live_auction_highest_bid(uuid,uuid,uuid,boolean) to service_role;

create or replace function public.process_live_auction_comment(p_auction uuid,p_tenant uuid,p_event uuid,p_kind text,p_amount numeric default null,p_control text default null)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare a public.auctions;e public.facebook_webhook_events;v jsonb;prior jsonb;r jsonb;
 sender text;cid text;bidder text;amount numeric;minimum numeric;outcome text;
 b public.auction_bids;c public.customers;claim public.auction_winner_claims;o public.orders;
 oid uuid;confirming boolean;host boolean;
begin
 select * into a from public.auctions where id=p_auction and tenant_id=p_tenant for update;
 if not found then raise exception 'AUCTION_NOT_FOUND' using errcode='P0002';end if;
 if coalesce(a.session_automation->>'winnerFlow','highest_bid')<>'on_demand' then
  return public.process_live_auction_highest_bid(p_auction,p_tenant,p_event,p_kind,p_amount,p_control);
 end if;
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
 confirming:=not host and exists(select 1 from jsonb_array_elements_text(a.session_automation->'keywords') k
  where lower(regexp_replace(normalize(trim(k),NFKC),'\s+',' ','g'))=lower(regexp_replace(normalize(trim(coalesce(v->>'message','')),NFKC),'\s+',' ','g')));
 outcome:='ignored';
 if a.status='cancelled' then r:=jsonb_build_object('status','ignored','reason','ROUND_CANCELLED');
 elsif host then
  if coalesce((a.session_automation->>'closeEnabled')::boolean,true)
   and public.auction_close_keyword_matches(v->>'message',a.session_automation->'closeKeywords') then
   r:=public.finalize_live_auction(a.id,a.tenant_id,e.id);outcome:='closed';
  end if;
 elsif confirming then
  -- Use only actual numeric prices entered by THIS sender in THIS round, including lower/late bids.
  -- Step shortcuts and the confirmation comment itself cannot invent a price.
  select * into b from public.auction_bids where auction_id=a.id and bidder_id=sender and bid_amount>0
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
    if a.private_reply_enabled then
     insert into public.auction_deliveries(auction_id,channel,comment_id,claim_id,claim_revision)
      values(a.id,'private',cid,claim.id,claim.revision);
     insert into public.messages(customer_id,external_id,sender,body,delivery_status)
      values(c.id,'auction-claim:'||claim.id::text||':'||claim.revision::text,'bot','รอส่งสรุปบิลจากยอดเคาะของลูกค้า','pending');
    end if;
    if a.public_reply_enabled then
     insert into public.auction_deliveries(auction_id,channel,comment_id,claim_id,claim_revision)
      values(a.id,'public',cid,claim.id,claim.revision);
    end if;
    outcome:='claimed';
    r:=jsonb_build_object('status','claimed','amount',b.bid_amount,'name',claim.bidder_name,'claimId',claim.id,'orderId',oid);
   end if;
  end if;
 else
  amount:=public.auction_numeric_price(v->>'message');
  if amount is not null then
   minimum:=case when a.leading_bidder_id is null then a.start_price else a.current_price+a.min_step end;
   outcome:=case when amount>=minimum then 'accepted' else 'too_low' end;
   if amount>=minimum then
    update public.auctions set current_price=amount,leading_bidder_id=sender,leading_bidder_name=bidder,leading_comment_id=cid where id=a.id;
   end if;
   r:=jsonb_build_object('status',outcome,'amount',amount,'minimum',minimum,'name',bidder);
  end if;
 end if;
 r:=coalesce(r,jsonb_build_object('status',outcome));
 insert into public.auction_bids(auction_id,event_id,comment_id,bidder_id,bidder_name,comment_text,bid_amount,is_opening,status,result)
  values(a.id,e.id,cid,sender,bidder,left(coalesce(v->>'message',''),2000),case when confirming or host then null else amount end,false,outcome,r);
 return r;
end $$;

create or replace function public.live_session_dashboard(p_tenant uuid,p_session uuid)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare s public.live_sessions; metrics jsonb; rounds jsonb; bills jsonb;
begin
 select * into s from public.live_sessions where id=p_session and tenant_id=p_tenant;
 if not found then raise exception 'SESSION_NOT_FOUND' using errcode='P0002';end if;
 with comments as (
  select e.payload->'value' v from public.facebook_webhook_events e
  where e.page_id=s.page_id and e.kind='change' and e.payload->'value'->>'verb'='add'
   and e.payload->'value'->>'item' in ('comment','live_comment') and (
    regexp_replace(e.payload->'value'->>'post_id','^.*_','')=s.live_post_id
    or e.payload->'value'->>'video_id'=s.live_post_id or e.payload->'value'->>'live_video_id'=s.live_post_id
    or exists(select 1 from public.auctions a where a.tenant_id=p_tenant and a.page_id=s.page_id and a.live_post_id=s.live_post_id
     and e.payload->'value'->>'post_id'=any(a.live_post_aliases)))
 ), matched as (
  select b.comment_id from public.auction_bids b join public.auctions a on a.id=b.auction_id
   where a.tenant_id=p_tenant and a.page_id=s.page_id and a.live_post_id=s.live_post_id and b.status in ('accepted','too_low','already_opened')
  union select r.comment_id from public.live_cf_webhook_receipts r join comments c on c.v->>'comment_id'=r.comment_id
   where r.tenant_id=p_tenant and r.page_id=s.page_id
 )
 select jsonb_build_object('comments',(select count(*) from comments),
  'matched',(select count(*) from matched),'commenters',(select count(distinct v->'from'->>'id') from comments where v->'from'->>'id'<>s.page_id),
  'slips',count(p.id),'paid',coalesce(sum(p.amount),0),
  'remaining',(select coalesce(sum(remaining_amount),0) from public.customer_tabs where live_session_id=s.id),
  'unpaidPeople',(select count(*) from public.customer_tabs where live_session_id=s.id and remaining_amount>0 and paid_amount=0),
  'partialPeople',(select count(*) from public.customer_tabs where live_session_id=s.id and remaining_amount>0 and paid_amount>0),
  'auctionSales',(select coalesce(sum(o.item_amount),0) from public.orders o where o.live_session_id=s.id and o.tenant_id=p_tenant and o.source='live_auction' and o.status<>'cancelled'),
  'profit',coalesce(sum(p.amount),0)-s.cost_amount-s.ad_spent-s.shipping_cost-s.other_fees) into metrics
 from public.customer_tab_payments p join public.customer_tabs t on t.id=p.tab_id where t.live_session_id=s.id;
 select coalesce(jsonb_agg(row order by row->>'closedAt' desc,row->>'id' desc),'[]') into rounds from (
  select jsonb_build_object('id',a.id,'itemName',a.item_name,'price',a.current_price,'winner',a.leading_bidder_name,
   'winnerId',a.leading_bidder_id,'orderId',a.order_id,'closedAt',a.closed_at,'status',a.status,
   'orderStatus',o.status,'tabId',o.customer_tab_id,'tabRevision',t.revision) row
  from public.auctions a left join public.orders o on o.id=a.order_id left join public.customer_tabs t on t.id=o.customer_tab_id
  where a.tenant_id=p_tenant and a.page_id=s.page_id and a.live_post_id=s.live_post_id and a.status<>'active'
 ) rows;
 select coalesce(jsonb_agg(row order by row->>'name',row->>'id'),'[]') into bills from (
  select jsonb_build_object('id',t.id,'customerId',t.customer_id,'name',coalesce(c.display_name,c.platform_user_id),
   'total',t.total_amount,'paid',t.paid_amount,'remaining',t.remaining_amount,'credit',t.credit_amount,
   'shipping',t.shipping_fee,'revision',t.revision,
   'account',(select bank_code||' • '||account_number from public.bank_accounts where id=t.bank_account_id and tenant_id=p_tenant and is_active),
   'slips',(select count(*) from public.customer_tab_payments where tab_id=t.id),
   'items',coalesce((select jsonb_agg(jsonb_build_object('orderId',i.order_id,'name',i.item_name,'amount',i.amount) order by i.closed_at,i.order_id)
      from public.customer_tab_items i where i.tab_id=t.id and not i.cancelled),'[]'),
   'lastReminder',(select jsonb_build_object('status',j.status,'at',j.completed_at,'code',j.error_code) from public.customer_tab_reminders j where j.tab_id=t.id order by j.created_at desc,j.id desc limit 1),
   'canMessage',c.bot_enabled and not coalesce(c.agent_opted_out,false) and c.window_expires_at>clock_timestamp()) row
  from public.customer_tabs t join public.customers c on c.id=t.customer_id and c.tenant_id=p_tenant where t.live_session_id=s.id
 ) rows;
 return jsonb_build_object('session',to_jsonb(s),'metrics',metrics,'rounds',rounds,'tabs',bills);
end $$;

-- Migrate live settings to the requested flow; explicit legacy-mode choices remain supported.
update public.live_sessions set auction_settings=auction_settings||jsonb_build_object('winnerFlow','on_demand')
 where auction_settings is not null and not (auction_settings ? 'winnerFlow');
update public.auctions set session_automation=session_automation||jsonb_build_object('winnerFlow','on_demand')
 where session_automation is not null and session_automation ? 'closeKeywords' and not (session_automation ? 'winnerFlow');
-- Adopt old billed orders without deleting payments or duplicating their existing tab items.
insert into public.auction_winner_claims(tenant_id,auction_id,customer_id,bidder_id,bidder_name,highest_amount,order_id)
 select a.tenant_id,a.id,o.customer_id,a.leading_bidder_id,a.leading_bidder_name,coalesce(o.item_amount,a.current_price),o.id
 from public.auctions a join public.orders o on o.id=a.order_id
 where a.session_automation->>'winnerFlow'='on_demand' and a.leading_bidder_id is not null
 on conflict(auction_id,bidder_id) do nothing;
update public.orders o set live_auction_id=c.auction_id from public.auction_winner_claims c
 where c.order_id=o.id and c.tenant_id=o.tenant_id and o.live_auction_id is null;
update public.auction_deliveries d set status='superseded' from public.auctions a
 where a.id=d.auction_id and a.session_automation->>'winnerFlow'='on_demand' and d.claim_id is null and d.status in ('pending','awaiting_confirmation');
revoke all on function public.auction_numeric_price(text),public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text) from public,anon,authenticated;
grant execute on function public.auction_numeric_price(text),public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text) to service_role;
commit;
