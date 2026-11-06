-- Apply after live-auction-empty-keyword-defaults.sql and shipping-integrations.sql.
-- Forward migration: expense normalization, fees, immediate winners, Bee Move and tracking outbox.
begin;

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

create or replace function public.manage_live_session(p_tenant uuid,p_session uuid,p_actor uuid,p_request uuid,p_input jsonb)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare s public.live_sessions; prior public.live_session_changes; t public.customer_tabs; target public.customer_tabs;
 a public.auctions; o public.orders; b public.auction_bids; c public.customers;
 operation text:=p_input->>'action'; result jsonb; v jsonb; oid uuid; old_flag text; new_amount numeric; shipping numeric;
begin
 if p_request is null or p_actor is null or jsonb_typeof(p_input)<>'object' then raise exception 'SESSION_INPUT_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('session-edit:'||p_tenant::text,0));
 select * into prior from public.live_session_changes where tenant_id=p_tenant and request_id=p_request;
 if found then
  if prior.session_id<>p_session or prior.actor_id<>p_actor or prior.payload<>p_input then raise exception 'SESSION_REQUEST_REUSED' using errcode='40001';end if;
  return prior.result;
 end if;
 select * into s from public.live_sessions where id=p_session and tenant_id=p_tenant;
 if not found then raise exception 'SESSION_NOT_FOUND' using errcode='P0002';end if;
 -- CF placement/variant selection also lock the tenant first. Serialize corrections
 -- with those writers before taking tab/product locks during stock restoration.
 perform 1 from public.tenants where id=p_tenant for update;
 if operation='costs' then
  select * into s from public.live_sessions where id=s.id for update;
  if s.financial_revision is distinct from (p_input->>'revision')::bigint then raise exception 'SESSION_CHANGED' using errcode='40001';end if;
  for v in select value from jsonb_array_elements(jsonb_build_array(p_input->'cost',p_input->'ads',p_input->'shipping',case when p_input ? 'fees' then p_input->'fees' else to_jsonb(s.other_fees) end)) loop
   if coalesce(v#>>'{}','') !~ '^[0-9]+(\.[0-9]{1,2})?$' or (v#>>'{}')::numeric>999999999999.99 then raise exception 'SESSION_INPUT_INVALID';end if;
  end loop;
  if (p_input->>'cost')::numeric<0 or (p_input->>'ads')::numeric<0 or (p_input->>'shipping')::numeric<0
    or p_input->>'cost' is null or p_input->>'ads' is null or p_input->>'shipping' is null then raise exception 'SESSION_INPUT_INVALID';end if;
  update public.live_sessions set cost_amount=(p_input->>'cost')::numeric,ad_spent=(p_input->>'ads')::numeric,
   shipping_cost=(p_input->>'shipping')::numeric,
   other_fees=case when p_input ? 'fees' then (p_input->>'fees')::numeric else other_fees end,financial_revision=financial_revision+1 where id=s.id;
 elsif operation='winner' then
  select * into a from public.auctions where id=(p_input->>'roundId')::uuid and tenant_id=p_tenant
   and page_id=s.page_id and live_post_id=s.live_post_id for update;
  if not found or a.status<>'closed' or a.order_id is null then raise exception 'SESSION_ROUND_NOT_EDITABLE';end if;
  if a.order_id is distinct from (p_input->>'orderId')::uuid then raise exception 'SESSION_CHANGED' using errcode='40001';end if;
  select * into b from public.auction_bids where id=(p_input->>'bidId')::uuid and auction_id=a.id and status='accepted' and bid_amount>0;
  if not found then raise exception 'SESSION_BID_NOT_FOUND';end if;
  if a.leading_comment_id=b.comment_id then raise exception 'SESSION_WINNER_UNCHANGED';end if;
  select * into o from public.orders where id=a.order_id and tenant_id=p_tenant;
  if o.status in ('shipped','cancelled') then raise exception 'SESSION_ORDER_NOT_EDITABLE';end if;
  insert into public.customers(tenant_id,platform,platform_user_id,display_name)
   values(p_tenant,'facebook',b.bidder_id,b.bidder_name) on conflict(platform,platform_user_id) do nothing;
  select * into c from public.customers where tenant_id=p_tenant and platform='facebook' and platform_user_id=b.bidder_id;
  if not found then raise exception 'SESSION_CUSTOMER_SCOPE' using errcode='42501';end if;
  perform 1 from public.customers where id in(o.customer_id,c.id) order by id for update;
  perform 1 from public.live_sessions where id=s.id for update;
  insert into public.customer_tabs(tenant_id,customer_id,customer_fb_id,page_id,live_session_id,bank_account_id,shipping_fee)
   values(p_tenant,c.id,c.platform_user_id,s.page_id,s.id,a.bank_account_id,a.shipping_fee)
   on conflict(live_session_id,customer_id) do update set bank_account_id=coalesce(customer_tabs.bank_account_id,excluded.bank_account_id),
    shipping_fee=case when not customer_tabs.shipping_override and customer_tabs.shipping_fee=0 then excluded.shipping_fee else customer_tabs.shipping_fee end;
  select * into target from public.customer_tabs where live_session_id=s.id and customer_id=c.id;
  perform 1 from public.customer_tabs where id in(o.customer_tab_id,target.id) order by id for update;
  select * into t from public.customer_tabs where id=o.customer_tab_id;
  if t.revision is distinct from (p_input->>'revision')::bigint then raise exception 'SESSION_CHANGED' using errcode='40001';end if;
  if exists(select 1 from public.auction_deliveries where auction_id=a.id and (status='sending' or status='requires_review' and error_code is distinct from 'WINNER_CORRECTED'))
   or exists(select 1 from public.customer_tab_reminders where tab_id in(t.id,target.id) and status='processing')
   or exists(select 1 from public.slips where customer_tab_id in(t.id,target.id) and status='pending') then
   raise exception 'SESSION_OPERATION_IN_PROGRESS' using errcode='40001';end if;
  old_flag:=current_setting('app.refreshing_customer_tab',true);perform set_config('app.refreshing_customer_tab','1',true);
  -- The original order and signed link stay with the original payer; only the receivable moves.
  update public.orders set status='cancelled',paid_amount=0,paid_at=null,source_id=a.id::text||':replaced:'||p_request::text where id=o.id;
  update public.customer_tab_items set cancelled=true where order_id=o.id;
  insert into public.orders(tenant_id,customer_id,product_name,amount,item_amount,source,source_id,live_bank_account_id,customer_tab_id,live_session_id,live_post_id)
   values(p_tenant,c.id,a.item_name,b.bid_amount,b.bid_amount,'live_auction',a.id::text,a.bank_account_id,target.id,s.id,s.live_post_id) returning id into oid;
  insert into public.customer_tab_items(order_id,tab_id,item_name,amount,closed_at,auction_id,winning_bid_id) values(oid,target.id,a.item_name,b.bid_amount,a.closed_at,a.id,b.id);
  update public.auctions set order_id=oid,current_price=b.bid_amount,leading_bidder_id=b.bidder_id,leading_bidder_name=b.bidder_name,leading_comment_id=b.comment_id where id=a.id;
  perform set_config('app.refreshing_customer_tab',coalesce(old_flag,''),true);
  perform public.refresh_customer_tab(t.id);if target.id<>t.id then perform public.refresh_customer_tab(target.id);end if;
  update public.customers set conversation_status='open',conversation_version=conversation_version+1,
   order_status=case when (select remaining_amount from public.customer_tabs where id=target.id)>0 then 'pending_review' else 'paid' end where id=c.id;
  if o.customer_id<>c.id then update public.customers set order_status=case when (select remaining_amount from public.customer_tabs where id=t.id)>0 then 'pending_review' else 'paid' end where id=o.customer_id;end if;
  -- Do not replay old private replies, even when a correction selected a new comment.
  update public.auction_deliveries set status='requires_review',error_code='WINNER_CORRECTED' where auction_id=a.id and status='pending';
  update public.messages set delivery_status='failed',body='ยกเลิกข้อความเดิม: มีการแก้ไขผู้ชนะจากแดชบอร์ด' where external_id='auction-bill:'||a.id::text and delivery_status='pending';
  insert into public.messages(customer_id,sender,body,external_id) values
   (o.customer_id,'bot','บันทึกระบบ: ย้ายรายการ '||a.item_name||' ออกจากบิล เงินที่ตรวจผ่านยังเป็นของลูกค้าคนเดิม','session-change-old:'||p_request::text),
   (c.id,'bot','บันทึกระบบ: กำหนดให้ชนะประมูล '||a.item_name||' ราคา '||b.bid_amount::text||' บาท','session-change-new:'||p_request::text);
 elsif operation='adjust' then
  select * into t from public.customer_tabs where id=(p_input->>'tabId')::uuid and tenant_id=p_tenant and live_session_id=s.id for update;
  if not found then raise exception 'SESSION_TAB_NOT_FOUND';end if;
  if t.revision is distinct from (p_input->>'revision')::bigint then raise exception 'SESSION_CHANGED' using errcode='40001';end if;
  if length(trim(coalesce(p_input->>'reason','')))<3 then raise exception 'SESSION_REASON_REQUIRED';end if;
  if exists(select 1 from public.orders where customer_tab_id=t.id and status='shipped') then raise exception 'SESSION_ORDER_SHIPPED';end if;
  if exists(select 1 from public.customer_tab_reminders where tab_id=t.id and status='processing')
   or exists(select 1 from public.slips where customer_tab_id=t.id and status='pending') then raise exception 'SESSION_OPERATION_IN_PROGRESS' using errcode='40001';end if;
  if jsonb_typeof(p_input->'items') is distinct from 'array'
   or jsonb_array_length(p_input->'items')<>(select count(*) from public.customer_tab_items where tab_id=t.id)
   or (select count(distinct value->>'orderId') from jsonb_array_elements(p_input->'items'))<>jsonb_array_length(p_input->'items') then raise exception 'SESSION_ITEMS_CHANGED';end if;
  shipping:=(p_input->>'shipping')::numeric;
  if shipping is null or shipping<0 or shipping>999999 or shipping<>round(shipping,2) then raise exception 'SESSION_INPUT_INVALID';end if;
  old_flag:=current_setting('app.refreshing_customer_tab',true);perform set_config('app.refreshing_customer_tab','1',true);
  for v in select value from jsonb_array_elements(p_input->'items') loop
   select * into o from public.orders where id=(v->>'orderId')::uuid and customer_tab_id=t.id for update;
   if not found then raise exception 'SESSION_ITEM_SCOPE' using errcode='42501';end if;
   new_amount:=(v->>'amount')::numeric;
   if new_amount is null or new_amount<=0 or new_amount>999999999 or new_amount<>round(new_amount,2) or jsonb_typeof(v->'cancelled') is distinct from 'boolean' then raise exception 'SESSION_INPUT_INVALID';end if;
   if o.status='shipped' and (o.item_amount<>new_amount or (v->>'cancelled')::boolean) then raise exception 'SESSION_ORDER_SHIPPED';end if;
   if o.status='cancelled' and (not (v->>'cancelled')::boolean or o.item_amount<>new_amount) then raise exception 'SESSION_CANCELLED_LOCKED';end if;
   if o.live_variant_selection_required and o.live_variant_confirmed_at is null and o.item_amount<>new_amount then raise exception 'LIVE_CF_VARIANT_REQUIRED';end if;
   update public.orders set item_amount=new_amount,
    status=case when (v->>'cancelled')::boolean then 'cancelled' else status end,
    paid_amount=case when (v->>'cancelled')::boolean then 0 else paid_amount end where id=o.id;
   update public.customer_tab_items set amount=new_amount,cancelled=(v->>'cancelled')::boolean where order_id=o.id;
  end loop;
  update public.customer_tabs set shipping_fee=shipping,shipping_override=true where id=t.id;
  perform set_config('app.refreshing_customer_tab',coalesce(old_flag,''),true);
  perform public.refresh_customer_tab(t.id);
  insert into public.messages(customer_id,sender,body,external_id) values(t.customer_id,'bot','บันทึกระบบ: แอดมินปรับยอดบิลสะสม กรุณาตรวจยอดล่าสุดในบิล','session-adjust:'||p_request::text);
 else raise exception 'SESSION_ACTION_INVALID';end if;
 result:=jsonb_build_object('ok',true,'orderId',oid);
 insert into public.live_session_changes(tenant_id,session_id,actor_id,request_id,payload,result) values(p_tenant,s.id,p_actor,p_request,p_input,result);
 return result;
end $$;

create or replace function public.save_auction_workspace(p_tenant uuid,p_actor uuid,p_request uuid,p_input jsonb)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare prior public.auction_workspace_requests; s public.live_sessions; a public.auctions;
 settings jsonb; result jsonb; page text; round_id uuid;
begin
 if p_request is null or p_actor is null then raise exception 'INVALID_REQUEST';end if;
 if jsonb_typeof(p_input->'finance') is distinct from 'object'
  or not ((p_input->'finance') ?& array['cost','ads','shipping','fees']) then raise exception 'INVALID_FINANCE';end if;
 p_input:=jsonb_set(p_input,'{finance}',(p_input->'finance')||jsonb_build_object(
  'cost',coalesce(nullif(p_input->'finance'->>'cost',''),'0')::numeric,
  'ads',coalesce(nullif(p_input->'finance'->>'ads',''),'0')::numeric,
  'shipping',coalesce(nullif(p_input->'finance'->>'shipping',''),'0')::numeric,
  'fees',coalesce(nullif(p_input->'finance'->>'fees',''),'0')::numeric));
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':auction-workspace',0));
 select * into prior from public.auction_workspace_requests where tenant_id=p_tenant and request_id=p_request;
 if found then
  if prior.actor_id<>p_actor or prior.input<>p_input then raise exception 'REQUEST_REUSED' using errcode='40001';end if;
  return prior.result;
 end if;
 select page_id into page from public.tenants where id=p_tenant and is_active;
 if page is null or p_input->>'pageId' is distinct from page or coalesce(p_input->>'livePostId','') !~ '^[0-9]{1,64}$'
  then raise exception 'PAGE_SCOPE' using errcode='42501';end if;
 if length(trim(coalesce(p_input->>'itemName',''))) not between 1 and 200
  or (p_input->>'startPrice')::numeric not between 0.01 and 999999999
  or (p_input->>'minStep')::numeric not between 0.01 and 999999999
  or (p_input->>'shippingFee')::numeric not between 0 and 999999 then raise exception 'INVALID_ROUND';end if;
 -- Match finalization lock order: auction before session.
 select * into a from public.auctions where tenant_id=p_tenant and page_id=page
  and live_post_id=p_input->>'livePostId' and status='active' for update;
 if a.id is not null and a.id is distinct from (p_input->>'roundId')::uuid then
  raise exception 'ACTIVE_ROUND_CHANGED' using errcode='40001';end if;
 if a.id is null and p_input->>'roundId' is not null then raise exception 'ROUND_CLOSED' using errcode='40001';end if;
 select * into s from public.live_sessions where tenant_id=p_tenant and page_id=page
  and live_post_id=p_input->>'livePostId' for update;
 if s.id is not null then
  if s.id is distinct from (p_input->>'sessionId')::uuid or s.ended_at is not null
   or s.automation_revision<>(p_input->>'revision')::bigint
   or s.financial_revision<>(p_input->>'financialRevision')::bigint then
   raise exception 'SESSION_CHANGED' using errcode='40001';end if;
  perform public.configure_auction_session(p_tenant,p_actor,gen_random_uuid(),jsonb_build_object(
   'action','settings','sessionId',s.id,'revision',s.automation_revision,'settings',p_input->'settings'));
 else
  if p_input->>'sessionId' is not null then raise exception 'SESSION_SCOPE' using errcode='42501';end if;
  perform public.configure_auction_session(p_tenant,p_actor,gen_random_uuid(),jsonb_build_object(
   'action','start','pageId',page,'livePostId',p_input->>'livePostId','settings',p_input->'settings'));
 end if;
 select * into strict s from public.live_sessions where tenant_id=p_tenant and page_id=page and live_post_id=p_input->>'livePostId' for update;
 settings:=s.auction_settings;
 if exists(select 1 from jsonb_each(p_input->'finance') v where (v.value#>>'{}')::numeric<0
  or (v.value#>>'{}')::numeric>999999999999.99 or (v.value#>>'{}')::numeric<>round((v.value#>>'{}')::numeric,2)) then
  raise exception 'INVALID_FINANCE';end if;
 update public.live_sessions set cost_amount=(p_input->'finance'->>'cost')::numeric,
  ad_spent=(p_input->'finance'->>'ads')::numeric,shipping_cost=(p_input->'finance'->>'shipping')::numeric,
  other_fees=(p_input->'finance'->>'fees')::numeric,
  financial_revision=financial_revision+1 where id=s.id returning * into s;
 insert into public.live_session_changes(tenant_id,session_id,actor_id,request_id,payload,result)
  values(p_tenant,s.id,p_actor,p_request,
   p_input->'finance'||jsonb_build_object('action','costs','revision',s.financial_revision-1),
   jsonb_build_object('sessionId',s.id,'revision',s.financial_revision));
 if a.id is null then
  insert into public.auctions(tenant_id,page_id,live_post_id,item_name,start_price,min_step,shipping_fee,bank_account_id,host_ids)
   values(p_tenant,page,p_input->>'livePostId',trim(p_input->>'itemName'),(p_input->>'startPrice')::numeric,
    (p_input->>'minStep')::numeric,(p_input->>'shippingFee')::numeric,(settings->>'bankAccountId')::uuid,
    array(select jsonb_array_elements_text(p_input->'hostIds'))) returning id into round_id;
 else
  if a.leading_bidder_id is not null and (a.item_name is distinct from trim(p_input->>'itemName')
   or a.start_price<>(p_input->>'startPrice')::numeric or a.min_step<>(p_input->>'minStep')::numeric
   or a.shipping_fee<>(p_input->>'shippingFee')::numeric or a.bank_account_id<>(settings->>'bankAccountId')::uuid) then
   raise exception 'BIDS_ALREADY_ACCEPTED';end if;
  update public.auctions set item_name=trim(p_input->>'itemName'),start_price=(p_input->>'startPrice')::numeric,
   min_step=(p_input->>'minStep')::numeric,shipping_fee=(p_input->>'shippingFee')::numeric,
   bank_account_id=(settings->>'bankAccountId')::uuid,
   session_automation=settings,private_reply_enabled=(settings->>'privateReply')::boolean,
   public_reply_enabled=(settings->>'publicReply')::boolean,private_reply_template=settings->>'privateText',
   bid_reply_template=settings->>'bidText',close_reply_template=settings->>'closeText',
   host_ids=array(select distinct unnest(a.host_ids||array(select jsonb_array_elements_text(p_input->'hostIds'))))
   where id=a.id;
  round_id:=a.id;
 end if;
 result:=jsonb_build_object('sessionId',s.id,'auctionId',round_id,'revision',s.automation_revision,'financialRevision',s.financial_revision);
 insert into public.auction_workspace_requests(tenant_id,request_id,actor_id,input,result) values(p_tenant,p_request,p_actor,p_input,result);
 return result;
end $$;

-- Retain legacy confirmation metadata/RPC for compatibility, but never hold or retarget sends.
drop trigger if exists auction_winner_confirmation_gate on public.auction_deliveries;
drop function if exists public.hold_auction_winner_notifications();
create or replace function public.confirm_live_auction_winner(p_auction uuid,p_tenant uuid,p_event uuid)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
begin
 if not exists(select 1 from public.auctions where id=p_auction and tenant_id=p_tenant) then
  raise exception 'AUCTION_NOT_FOUND' using errcode='P0002';
 end if;
 return jsonb_build_object('status','not_required');
end $$;
-- Release only held, unsent deliveries. Sent/sending/ambiguous records remain untouched.
update public.auction_deliveries d set status='pending',comment_id=a.leading_comment_id
 from public.auctions a where a.id=d.auction_id and d.status='awaiting_confirmation'
 and a.status='closed' and a.order_id is not null and a.leading_comment_id is not null;
alter table public.shipping_integrations drop constraint if exists shipping_integrations_provider_check;
alter table public.shipping_integrations add constraint shipping_integrations_provider_check
 check(provider in ('beemove','dmove','flash_express','jnt','thailand_post'));
alter table public.shipping_provider_jobs drop constraint if exists shipping_provider_jobs_provider_check;
alter table public.shipping_provider_jobs add constraint shipping_provider_jobs_provider_check
 check(provider in ('beemove','dmove','flash_express','jnt','thailand_post'));

create or replace function public.save_shipping_integration(
 p_tenant uuid,p_provider text,p_endpoint text,p_credentials text,p_sender jsonb,
 p_tracking_template text,p_weight numeric,p_active boolean,p_default boolean
) returns void language plpgsql set search_path=pg_catalog,public as $$
begin
 if p_provider not in ('beemove','dmove','flash_express','jnt','thailand_post')
  or p_endpoint !~ '^https://[^[:space:]]+$'
  or (p_provider='beemove' and rtrim(p_endpoint,'/')<>'https://client.beemove.co.th')
  or length(p_endpoint)>500
  or jsonb_typeof(p_sender) is distinct from 'object'
  or length(trim(coalesce(p_sender->>'name',''))) not between 2 and 200
  or coalesce(p_sender->>'phone','') !~ '^0[1-9][0-9]{7,8}$'
  or length(trim(coalesce(p_sender->>'address',''))) not between 10 and 1200
  or p_tracking_template !~ '^https://[^[:space:]]*\{tracking_number\}[^[:space:]]*$'
  or length(p_tracking_template)>1000
  or p_weight is null or p_weight<=0 or p_weight>100
  or p_default and not p_active then
  raise exception 'SHIPPING_INTEGRATION_INVALID';
 end if;
 perform 1 from public.tenants where id=p_tenant for update;
 if not found then raise exception 'SHIPPING_TENANT_NOT_FOUND' using errcode='P0002';end if;
 if p_default then
  update public.shipping_integrations set is_default=false,updated_at=clock_timestamp()
   where tenant_id=p_tenant and is_default and provider<>p_provider;
 end if;
 insert into public.shipping_integrations(
  tenant_id,provider,api_endpoint,credentials_ciphertext,sender_info,tracking_url_template,weight_kg,is_active,is_default
 ) values(p_tenant,p_provider,p_endpoint,p_credentials,p_sender,p_tracking_template,p_weight,p_active,p_default)
 on conflict(tenant_id,provider) do update set api_endpoint=excluded.api_endpoint,
  credentials_ciphertext=excluded.credentials_ciphertext,sender_info=excluded.sender_info,
  tracking_url_template=excluded.tracking_url_template,weight_kg=excluded.weight_kg,is_active=excluded.is_active,
  is_default=excluded.is_default,updated_at=clock_timestamp();
 if not p_active then
  update public.shipping_integrations set is_default=false,updated_at=clock_timestamp()
   where tenant_id=p_tenant and provider=p_provider;
 end if;
end $$;

create or replace function public.begin_shipping_provider_job(
 p_tenant uuid,p_actor uuid,p_request uuid,p_shipment uuid,p_provider text
) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare s public.shipping_shipments;j public.shipping_provider_jobs;
begin
 if p_tenant is null or p_actor is null or p_request is null or p_shipment is null
  or p_provider not in ('beemove','dmove','flash_express','jnt','thailand_post') then
  raise exception 'SHIPPING_PROVIDER_INPUT_INVALID';
 end if;
 perform 1 from public.tenants where id=p_tenant for update;
 if not found then raise exception 'SHIPPING_TENANT_NOT_FOUND' using errcode='P0002';end if;
 select * into s from public.shipping_shipments where id=p_shipment and tenant_id=p_tenant for update;
 if not found then raise exception 'SHIPPING_SCOPE' using errcode='42501';end if;
 select * into j from public.shipping_provider_jobs
  where tenant_id=p_tenant and request_id=p_request and shipment_id=p_shipment for update;
 if found then
  return jsonb_build_object('jobId',j.id,'status',j.status,'idempotencyKey',j.idempotency_key,
   'trackingNumber',j.tracking_number,'trackingUrl',j.tracking_url,'labelPdfUrl',j.label_pdf_url,
   'courierName',j.courier_name,'notificationStatus',j.notification_status,'claimed',false);
 end if;
 select * into j from public.shipping_provider_jobs
  where tenant_id=p_tenant and shipment_id=p_shipment and status in ('creating','created','uncertain')
  order by created_at desc limit 1 for update;
 if found then
  return jsonb_build_object('jobId',j.id,'status',j.status,'idempotencyKey',j.idempotency_key,
   'trackingNumber',j.tracking_number,'trackingUrl',j.tracking_url,'labelPdfUrl',j.label_pdf_url,
   'courierName',j.courier_name,'notificationStatus',j.notification_status,'claimed',false);
 end if;
 if s.fulfillment_status<>'ready_to_ship' or not public.shipping_payment_ready(s.id)
  or s.address_confirmed_at is null or not public.shipping_address_valid(to_jsonb(s)) then
  raise exception 'SHIPPING_NOT_READY';
 end if;
 if not exists(select 1 from public.shipping_integrations i where i.tenant_id=p_tenant
  and i.provider=p_provider and i.is_active) then
  raise exception 'SHIPPING_PROVIDER_NOT_ACTIVE';
 end if;
 insert into public.shipping_provider_jobs(tenant_id,shipment_id,actor_id,request_id,provider)
  values(p_tenant,p_shipment,p_actor,p_request,p_provider) returning * into j;
 return jsonb_build_object('jobId',j.id,'status',j.status,'idempotencyKey',j.idempotency_key,'claimed',true);
end $$;

create table if not exists public.shipping_tracking_deliveries (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 shipment_id uuid not null references public.shipping_shipments(id),
 tracking_number text not null,
 tracking_url text not null default '',
 courier_name text not null,
 status text not null default 'pending' check(status in ('pending','sending','sent','requires_review','cancelled')),
 started_at timestamptz,completed_at timestamptz,error_code text,
 next_attempt_at timestamptz not null default clock_timestamp(),
 created_at timestamptz not null default clock_timestamp(),
 unique(shipment_id,tracking_number)
);
create index if not exists shipping_tracking_deliveries_pending on public.shipping_tracking_deliveries(status,next_attempt_at,created_at);
alter table public.shipping_tracking_deliveries enable row level security;
revoke all on public.shipping_tracking_deliveries from public,anon,authenticated;
grant all on public.shipping_tracking_deliveries to service_role;
create or replace function public.queue_shipping_tracking_delivery() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.fulfillment_status='shipped' and nullif(trim(new.tracking_number),'') is not null then
  insert into public.shipping_tracking_deliveries(tenant_id,shipment_id,tracking_number,tracking_url,courier_name)
   values(new.tenant_id,new.id,new.tracking_number,coalesce(new.tracking_url,''),new.courier_name)
   on conflict(shipment_id,tracking_number) do update set tracking_url=excluded.tracking_url,courier_name=excluded.courier_name
    where shipping_tracking_deliveries.status='pending';
 end if;
 return new;
end $$;
drop trigger if exists shipping_tracking_outbox on public.shipping_shipments;
create trigger shipping_tracking_outbox after insert or update of fulfillment_status,tracking_number,tracking_url
 on public.shipping_shipments for each row execute function public.queue_shipping_tracking_delivery();
revoke all on function public.queue_shipping_tracking_delivery() from public,anon,authenticated;
grant execute on function public.queue_shipping_tracking_delivery() to service_role;
-- Do not backfill historical shipped parcels: installing this migration must not notify old customers.
commit;
