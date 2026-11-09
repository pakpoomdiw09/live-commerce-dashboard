-- Forward-only successor to live-auction-manual-host-close.sql. No event replay or sends.
begin;
alter table public.live_sessions add column if not exists auction_round_template jsonb;
alter table public.auctions add column if not exists previous_auction_id uuid references public.auctions(id);
create unique index if not exists auctions_one_successor on public.auctions(previous_auction_id) where previous_auction_id is not null;
create index if not exists auction_bids_comment_lookup on public.auction_bids(comment_id);

create or replace function public.normalize_auction_settings_before_split(settings jsonb) returns jsonb
language sql immutable returns null on null input set search_path=pg_catalog,public as $$
 select case when coalesce(settings->>'winnerFlow','on_demand') in ('on_demand','highest_bid') then settings||jsonb_build_object(
  'winnerFlow',coalesce(settings->>'winnerFlow','on_demand'),
  'keywords',coalesce(settings->'keywords','[]'::jsonb),
  'closeKeywords',coalesce(settings->'closeKeywords','[]'::jsonb),
  'closeKeywordPresetsVersion',1,'countEnabled',coalesce((settings->>'countEnabled')::boolean,false),'heartCloses',false,'closeEnabled',coalesce((settings->>'closeEnabled')::boolean,true),
  'bidText',case when settings ? 'closeKeywords' then settings->>'bidText' else coalesce(settings->>'closeText','ยินดีด้วยครับ คุณ {bidder_name} ชนะประมูล {product_name} ราคา {price} บาท') end,
  'closeText',case when settings ? 'closeKeywords' then settings->>'bidText' else coalesce(settings->>'closeText','ยินดีด้วยครับ คุณ {bidder_name} ชนะประมูล {product_name} ราคา {price} บาท') end) else null end
$$;

create or replace function public.auction_host_command(message text,settings jsonb)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare line text;count_value text;last_count text;closing text[];
begin
 closing:=public.auction_comment_tags(settings,'closeKeywords','ปิด');
 for line in select public.normalize_auction_tag(v) from regexp_split_to_table(coalesce(message,''),E'[\r\n]+') v loop
  continue when line='';
  if coalesce((settings->>'closeEnabled')::boolean,true) and line=any(closing) then
   return jsonb_build_object('action','close');
  end if;
  count_value:=null;
  if coalesce((settings->>'countEnabled')::boolean,false) and jsonb_typeof(settings->'counting_tags')='object' then
   select btrim(value#>>'{}') into count_value from jsonb_each(settings->'counting_tags')
    where public.normalize_auction_tag(key)=line and jsonb_typeof(value)='string' limit 1;
  end if;
  if coalesce(count_value,'')='' or length(count_value)>40 then return jsonb_build_object('action','ignore');end if;
  last_count:=count_value;
 end loop;
 return case when last_count is null then jsonb_build_object('action','ignore') else jsonb_build_object('action','count','count',last_count) end;
end $$;

create or replace function public.advance_live_auction(p_auction uuid,p_tenant uuid,p_event uuid)
returns uuid language plpgsql set search_path=pg_catalog,public as $$
declare a public.auctions;s public.live_sessions;e public.facebook_webhook_events;t jsonb;settings jsonb;next_id uuid;started timestamptz;bank uuid;
begin
 select * into a from public.auctions where id=p_auction and tenant_id=p_tenant for update;
 if not found then raise exception 'AUCTION_NOT_FOUND' using errcode='P0002';end if;
 select id into next_id from public.auctions where previous_auction_id=a.id and tenant_id=p_tenant;
 if found then return next_id;end if;
 if a.status<>'closed' or a.close_event_id is distinct from p_event or p_event is null then return null;end if;
 select * into e from public.facebook_webhook_events where id=p_event and page_id=a.page_id and kind='change';
 if not found or not coalesce(e.payload->'value'->'from'->>'id'=a.page_id or e.payload->'value'->'from'->>'id'=any(a.host_ids),false) then
  raise exception 'AUCTION_HOST_REQUIRED' using errcode='42501';end if;
 select * into s from public.live_sessions where tenant_id=a.tenant_id and page_id=a.page_id and live_post_id=a.live_post_id and ended_at is null for update;
 if not found or s.auction_round_template is null or not coalesce((s.auction_settings->>'autoCycleRounds')::boolean,false) then return null;end if;
 settings:=public.resolve_facebook_comment_settings(to_jsonb(s),a.session_automation);
 if (public.facebook_comment_context(p_tenant,a.page_id,array[a.live_post_id]))->>'mode' is distinct from 'auction' then return null;end if;
 t:=s.auction_round_template;bank:=(settings->>'bankAccountId')::uuid;
 if not exists(select 1 from public.bank_accounts where id=bank and tenant_id=a.tenant_id and is_active) then raise exception 'BANK_SCOPE' using errcode='42501';end if;
 -- Source-time floor preserves comments already queued after the close in the same poll cycle.
 started:=least(e.created_at,coalesce(public.auction_comment_timestamp(e.payload->'value'->>'created_time'),e.created_at));
 insert into public.auctions(tenant_id,page_id,live_post_id,live_post_aliases,item_name,start_price,min_step,shipping_fee,
  bank_account_id,host_ids,session_automation,private_reply_enabled,public_reply_enabled,
  private_reply_template,bid_reply_template,close_reply_template,previous_auction_id,created_at)
 values(a.tenant_id,a.page_id,a.live_post_id,a.live_post_aliases,t->>'itemName',(t->>'startPrice')::numeric,
  (t->>'minStep')::numeric,(t->>'shippingFee')::numeric,bank,a.host_ids,settings,
  coalesce((settings->>'privateReply')::boolean,false),coalesce((settings->>'publicReply')::boolean,false),
  coalesce(settings->>'private_reply_template',settings->>'privateText',a.private_reply_template),
  coalesce(settings->>'public_reply_template',settings->>'bidText',a.bid_reply_template),
  coalesce(settings->>'closeText',a.close_reply_template),a.id,started) returning id into next_id;
 update public.auctions set duration_seconds=null,timer_started_at=null,ends_at=null where id=next_id;
 return next_id;
end $$;

create or replace function public.save_auction_workspace(p_tenant uuid,p_actor uuid,p_request uuid,p_input jsonb)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare result jsonb;duration integer;prior public.auction_workspace_requests;a public.auctions;effective jsonb;cycling boolean;
begin
 if p_request is null or p_actor is null then raise exception 'INVALID_REQUEST';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':auction-workspace',0));
 select * into prior from public.auction_workspace_requests where tenant_id=p_tenant and request_id=p_request;
 if found then
  if prior.actor_id<>p_actor or prior.input<>p_input then raise exception 'REQUEST_REUSED' using errcode='40001';end if;
  return prior.result;
 end if;
 if jsonb_typeof(p_input->'settings'->'autoCycleRounds') is not null and jsonb_typeof(p_input->'settings'->'autoCycleRounds')<>'boolean' then raise exception 'INVALID_SETTINGS';end if;
 if p_input->'settings' ? 'counting_tags' then
  if jsonb_typeof(p_input->'settings'->'counting_tags')<>'object' then raise exception 'INVALID_SETTINGS';end if;
  if exists(select 1 from jsonb_each(p_input->'settings'->'counting_tags') where length(key)>40 or public.normalize_auction_tag(key)='' or key~E'[\r\n{}]'
   or jsonb_typeof(value)<>'string' or length(btrim(value#>>'{}')) not between 1 and 40 or (value#>>'{}')~E'[\r\n{}]') then raise exception 'INVALID_SETTINGS';end if;
 end if;
 cycling:=coalesce((p_input->'settings'->>'autoCycleRounds')::boolean,false);
 effective:=p_input;
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
 return result;
end $$;


-- Public comment RPC with dynamic host commands and atomic cycling.
create or replace function public.process_live_auction_comment(
 p_auction uuid,p_tenant uuid,p_event uuid,p_kind text,p_amount numeric default null,p_control text default null
) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare a public.auctions;e public.facebook_webhook_events;v jsonb;prior jsonb;r jsonb;
 sender text;cid text;message text;keywords text[];close_keywords text[];settings jsonb;host boolean;confirming boolean;counting boolean:=false;numeric_price numeric;source_at timestamptz;confirmation_floor timestamptz;close_event public.facebook_webhook_events;command jsonb;
begin
 select * into a from public.auctions where id=p_auction and tenant_id=p_tenant for update;
 if not found then raise exception 'AUCTION_NOT_FOUND' using errcode='P0002';end if;
 if not exists(select 1 from public.tenants where id=p_tenant and page_id=a.page_id and is_active) then raise exception 'AUCTION_TENANT_INVALID' using errcode='42501';end if;
 select * into e from public.facebook_webhook_events where id=p_event and page_id=a.page_id;
 if not found or e.kind<>'change' then raise exception 'AUCTION_EVENT_INVALID' using errcode='42501';end if;
 v:=e.payload->'value';sender:=v->'from'->>'id';cid:=v->>'comment_id';
 if sender is null or sender !~ '^[0-9]{1,64}$' or nullif(btrim(cid),'') is null or v->>'verb' is distinct from 'add' or coalesce(v->>'item','') not in ('comment','live_comment') then return jsonb_build_object('status','ignored');end if;
 if not coalesce((a.live_post_id=regexp_replace(v->>'post_id','^.*_','') or a.live_post_id=v->>'video_id' or a.live_post_id=v->>'live_video_id' or v->>'post_id'=any(a.live_post_aliases)),false) then raise exception 'AUCTION_POST_MISMATCH' using errcode='42501';end if;
 select b.result into prior from public.auction_bids b join public.auctions old on old.id=b.auction_id
  where old.tenant_id=a.tenant_id and old.page_id=a.page_id and old.live_post_id=a.live_post_id
   and (b.event_id=e.id or b.comment_id=cid) limit 1;
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
  p_kind:='IGNORE';p_control:=null;
  command:=public.auction_host_command(v->>'message',settings);
  if command->>'action'='close' then p_kind:='HOST_CONTROL';p_control:='close';
  elsif command->>'action'='count' then p_kind:='HOST_CONTROL';p_control:=command->>'count';counting:=true;
  end if;
 end if;
 if confirming and a.status='active' and coalesce((settings->>'autoCycleRounds')::boolean,false) then
  r:=jsonb_build_object('status','awaiting_host_close','auctionId',a.id);
  insert into public.auction_bids(auction_id,event_id,comment_id,bidder_id,bidder_name,comment_text,bid_amount,is_opening,status,result)
   values(a.id,e.id,cid,sender,left(v->'from'->>'name',200),left(coalesce(v->>'message',''),2000),null,false,'awaiting_host_close',r);
  return r;
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
  r:=r||jsonb_build_object('nextAuctionId',public.advance_live_auction(a.id,a.tenant_id,e.id));
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
 r:=r||jsonb_build_object('auctionId',a.id);
 insert into public.auction_bids(auction_id,event_id,comment_id,bidder_id,bidder_name,comment_text,bid_amount,is_opening,status,result) values(a.id,e.id,cid,sender,left(v->'from'->>'name',200),left(coalesce(v->>'message',''),2000),null,false,r->>'status',r);
 return r;
end $$;

revoke all on function public.auction_host_command(text,jsonb),public.advance_live_auction(uuid,uuid,uuid),
 public.save_auction_workspace(uuid,uuid,uuid,jsonb),public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text) from public,anon,authenticated;
grant execute on function public.auction_host_command(text,jsonb),public.advance_live_auction(uuid,uuid,uuid),
 public.save_auction_workspace(uuid,uuid,uuid,jsonb),public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text) to service_role;
notify pgrst,'reload schema';
commit;
