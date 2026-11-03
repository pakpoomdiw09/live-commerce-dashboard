-- Apply after live-auction-customer-workspace.sql. Four-section Thai seller workflow.
begin;
create or replace function public.normalize_auction_thai_settings(settings jsonb) returns jsonb
language sql immutable returns null on null input set search_path=pg_catalog,public as $$
 select settings||jsonb_build_object(
  'keywords',case when settings->'keywords'='["1","11","111","11111","+1","+10"]'::jsonb then '["1"]'::jsonb else settings->'keywords' end,
  'closeKeywords',coalesce(settings->'closeKeywords','["ปิด","x"]'::jsonb),
  'countEnabled',false,'heartCloses',false,'closeEnabled',true,
  'bidText',case when settings ? 'closeKeywords' then settings->>'bidText' else coalesce(settings->>'closeText','ยินดีด้วยครับ คุณ {bidder_name} ชนะประมูล {product_name} ราคา {price} บาท') end,
  'closeText',case when settings ? 'closeKeywords' then settings->>'bidText' else coalesce(settings->>'closeText','ยินดีด้วยครับ คุณ {bidder_name} ชนะประมูล {product_name} ราคา {price} บาท') end)
$$;
update public.live_sessions set auction_settings=public.normalize_auction_thai_settings(auction_settings),automation_revision=automation_revision+1
 where auction_settings is not null and auction_settings is distinct from public.normalize_auction_thai_settings(auction_settings);
update public.auctions set session_automation=public.normalize_auction_thai_settings(session_automation),
 bid_reply_template=public.normalize_auction_thai_settings(session_automation)->>'bidText',close_reply_template=public.normalize_auction_thai_settings(session_automation)->>'closeText'
 where status='active' and session_automation is not null and session_automation is distinct from public.normalize_auction_thai_settings(session_automation);

create or replace function public.inherit_auction_session_settings() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
declare settings jsonb;
begin
 select public.normalize_auction_thai_settings(auction_settings) into settings from public.live_sessions where tenant_id=new.tenant_id and page_id=new.page_id and live_post_id=new.live_post_id;
 if settings is not null then
  -- The chosen bank is validated by the auction API; each round may choose its own bank.
  new.session_automation:=settings||jsonb_build_object('bankAccountId',new.bank_account_id);
  new.private_reply_enabled:=(settings->>'privateReply')::boolean;new.public_reply_enabled:=(settings->>'publicReply')::boolean;
  new.private_reply_template:=settings->>'privateText';new.bid_reply_template:=settings->>'bidText';new.close_reply_template:=settings->>'closeText';
 end if;
 return new;
end $$;

create or replace function public.live_auction_thai_dashboard(p_tenant uuid,p_session uuid) returns jsonb
language plpgsql stable set search_path=pg_catalog,public as $$
declare result jsonb; active jsonb;
begin
 result:=public.live_auction_customer_dashboard(p_tenant,p_session);
 select jsonb_build_object('id',a.id,'itemName',a.item_name) into active from public.auctions a
 join public.live_sessions s on s.id=p_session and s.tenant_id=p_tenant and s.page_id=a.page_id and s.live_post_id=a.live_post_id
 where a.tenant_id=p_tenant and a.status='active' order by a.created_at desc limit 1;
 return result||jsonb_build_object('activeAuction',active);
end $$;
revoke all on function public.normalize_auction_thai_settings(jsonb),public.live_auction_thai_dashboard(uuid,uuid) from public,anon,authenticated;
grant execute on function public.normalize_auction_thai_settings(jsonb),public.live_auction_thai_dashboard(uuid,uuid) to service_role;
create or replace function public.configure_auction_session(p_tenant uuid,p_actor uuid,p_request uuid,p_input jsonb)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare s public.live_sessions; prior public.auction_session_requests; settings jsonb:=public.normalize_auction_thai_settings(p_input->'settings'); result jsonb; page text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||p_request::text,0));
 select * into prior from public.auction_session_requests where tenant_id=p_tenant and request_id=p_request;
 if found then
  if prior.actor_id<>p_actor or prior.input<>p_input then raise exception 'REQUEST_REUSED' using errcode='40001';end if;
  return prior.result;
 end if;
 if settings is null then raise exception 'INVALID_SETTINGS';end if;
 if p_input->>'action' not in ('start','settings') or p_actor is null or p_request is null then raise exception 'INVALID_ACTION';end if;
 if jsonb_typeof(settings)<>'object' or jsonb_typeof(settings->'keywords')<>'array' then raise exception 'INVALID_SETTINGS';end if;
 if jsonb_typeof(settings->'closeKeywords') is distinct from 'array' then raise exception 'INVALID_CLOSE_KEYWORDS';end if;
 if exists(select 1 from jsonb_array_elements(settings->'closeKeywords') k where jsonb_typeof(k)<>'string' or length(trim(k#>>'{}')) not between 1 and 40) then raise exception 'INVALID_CLOSE_KEYWORDS';end if;
 if exists(select 1 from jsonb_array_elements(settings->'keywords') k where jsonb_typeof(k)<>'string' or length(trim(k#>>'{}')) not between 1 and 40)
  or exists(select 1 from unnest(array['publicReply','privateReply','countEnabled','closeEnabled','heartCloses']) k where jsonb_typeof(settings->k) is distinct from 'boolean')
  or exists(select 1 from unnest(array['bidText','privateText','closeText']) k where jsonb_typeof(settings->k) is distinct from 'string' or length(settings->>k) not between 0 and 2000)
  then raise exception 'INVALID_SETTINGS';end if;
 if not exists(select 1 from public.bank_accounts where id=(settings->>'bankAccountId')::uuid and tenant_id=p_tenant and is_active)
  then raise exception 'BANK_SCOPE' using errcode='42501';end if;
 select page_id into page from public.tenants where id=p_tenant and is_active;
 if page is null then raise exception 'PAGE_SCOPE' using errcode='42501';end if;
 if p_input->>'action'='start' then
  if p_input->>'pageId' is distinct from page or coalesce(p_input->>'livePostId','') !~ '^[0-9]{1,64}$' then raise exception 'PAGE_SCOPE' using errcode='42501';end if;
  insert into public.live_sessions(tenant_id,page_id,live_post_id,auction_settings)
   values(p_tenant,page,p_input->>'livePostId',settings)
   on conflict(tenant_id,page_id,live_post_id) do nothing;
  perform 1 from public.auctions where tenant_id=p_tenant and page_id=page and live_post_id=p_input->>'livePostId' and status='active' order by id for update;
  select * into s from public.live_sessions where tenant_id=p_tenant and page_id=page and live_post_id=p_input->>'livePostId' for update;
  if s.ended_at is not null then raise exception 'SESSION_ENDED' using errcode='40001';end if;
  -- Starting an existing Session must not reset its saved automation or ledger.
  if s.auction_settings is null then
   update public.live_sessions set auction_settings=settings,automation_revision=automation_revision+1 where id=s.id returning * into s;
  end if;
 else
  select * into s from public.live_sessions where id=(p_input->>'sessionId')::uuid and tenant_id=p_tenant;
  if not found then raise exception 'SESSION_NOT_FOUND' using errcode='P0002';end if;
  -- Use auction -> session lock order, matching finalization and tab attachment.
  perform 1 from public.auctions where tenant_id=p_tenant and page_id=s.page_id and live_post_id=s.live_post_id and status='active' order by id for update;
  select * into s from public.live_sessions where id=s.id for update;
  if s.ended_at is not null then raise exception 'SESSION_ENDED' using errcode='40001';end if;
  if s.automation_revision<>(p_input->>'revision')::integer then raise exception 'SETTINGS_CHANGED' using errcode='40001';end if;
  update public.live_sessions set auction_settings=settings,automation_revision=automation_revision+1 where id=s.id returning * into s;
 end if;
 update public.auctions set session_automation=s.auction_settings||jsonb_build_object('bankAccountId',bank_account_id),
  private_reply_enabled=(s.auction_settings->>'privateReply')::boolean,public_reply_enabled=(s.auction_settings->>'publicReply')::boolean,
  private_reply_template=s.auction_settings->>'privateText',bid_reply_template=s.auction_settings->>'bidText',close_reply_template=s.auction_settings->>'closeText'
 where tenant_id=p_tenant and page_id=s.page_id and live_post_id=s.live_post_id and status='active';
 result:=jsonb_build_object('id',s.id,'revision',s.automation_revision);
 insert into public.auction_session_requests(tenant_id,request_id,actor_id,input,result) values(p_tenant,p_request,p_actor,p_input,result);
 return result;
end $$;


create or replace function public.finalize_live_auction(p_auction uuid,p_tenant uuid,p_event uuid default null,p_cancel boolean default false)
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
  insert into public.auction_deliveries(auction_id,channel,comment_id) values(a.id,'public',a.leading_comment_id) on conflict(auction_id,channel) do nothing;
 elsif p_event is not null and not p_cancel and a.public_reply_enabled then
  insert into public.auction_deliveries(auction_id,channel,comment_id)
   select a.id,'public',payload->'value'->>'comment_id' from public.facebook_webhook_events where id=p_event;
 end if;
 return jsonb_build_object('status',case when p_cancel then 'cancelled' else 'closed' end,'orderId',oid);
end $$;


create or replace function public.collect_auction_session_customers(p_tenant uuid,p_session uuid,p_fb_ids text[])
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare snapshot jsonb; person jsonb; fb text; name text; cid uuid;
begin
 if coalesce(cardinality(p_fb_ids),0) not between 1 and 500 or exists(select 1 from unnest(p_fb_ids) id where id is null or id !~ '^[0-9]{1,64}$') then raise exception 'INVALID_CUSTOMERS';end if;
 snapshot:=public.live_auction_customer_dashboard(p_tenant,p_session);
 foreach fb in array p_fb_ids loop
  select x into person from jsonb_array_elements(snapshot->'commenters') x where x->>'fbId'=fb;
  if person is null then select x into person from jsonb_array_elements(snapshot->'tabs') x where x->>'fbId'=fb;end if;
  if person is null then raise exception 'SESSION_CUSTOMER_SCOPE' using errcode='42501';end if;
  name:=person->>'name';
  insert into public.customers(tenant_id,platform,platform_user_id,display_name) values(p_tenant,'facebook',fb,left(name,255))
   on conflict(platform,platform_user_id) do update set tenant_id=coalesce(customers.tenant_id,excluded.tenant_id),display_name=coalesce(customers.display_name,excluded.display_name)
   where customers.tenant_id is null or customers.tenant_id=p_tenant returning id into cid;
  if not found then raise exception 'CUSTOMER_TENANT_SCOPE' using errcode='42501';end if;
 end loop;
 -- Importing commenters must not manufacture a Messenger inbound window or a payment.
 return public.live_auction_thai_dashboard(p_tenant,p_session);
end $$;

create or replace function public.process_live_auction_comment(p_auction uuid,p_tenant uuid,p_event uuid,p_kind text,p_amount numeric default null,p_control text default null)
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
   if exists(select 1 from jsonb_array_elements_text(a.session_automation->'closeKeywords') k where k=lower(regexp_replace(normalize(trim(coalesce(v->>'message','')),NFKC),'\s+',' ','g'))) then p_kind:='HOST_CONTROL';p_control:='close';
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

commit;
