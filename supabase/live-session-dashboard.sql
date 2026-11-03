-- Apply after auction-experience.sql. All monetary calculations stay in PostgreSQL NUMERIC.
begin;
alter table public.live_sessions
 add column if not exists cost_amount numeric(14,2) not null default 0 check(cost_amount>=0),
 add column if not exists ad_spent numeric(14,2) not null default 0 check(ad_spent>=0),
 add column if not exists shipping_cost numeric(14,2) not null default 0 check(shipping_cost>=0),
 add column if not exists other_fees numeric(14,2) not null default 0 check(other_fees>=0),
 add column if not exists financial_revision bigint not null default 0;
alter table public.customer_tab_reminders
 add column if not exists message_template text,
 add column if not exists requested_by uuid references auth.users(id),
 add column if not exists send_after timestamptz;
alter table public.customer_tabs add column if not exists shipping_override boolean not null default false;
create table if not exists public.live_session_changes (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 session_id uuid not null references public.live_sessions(id),actor_id uuid not null references auth.users(id),
 request_id uuid not null,payload jsonb not null,result jsonb not null,created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,request_id)
);
create table if not exists public.live_reminder_dispatch_slots (
 page_id text primary key,next_allowed_at timestamptz not null default '-infinity'
);
alter table public.live_session_changes enable row level security;
alter table public.live_reminder_dispatch_slots enable row level security;
revoke all on public.live_session_changes,public.live_reminder_dispatch_slots from public,anon,authenticated;
grant all on public.live_session_changes,public.live_reminder_dispatch_slots to service_role;
create index if not exists live_session_changes_history on public.live_session_changes(session_id,created_at desc);
create index if not exists auctions_session_history on public.auctions(tenant_id,page_id,live_post_id,closed_at desc);
create index if not exists facebook_live_session_comments on public.facebook_webhook_events(page_id,(regexp_replace(payload->'value'->>'post_id','^.*_','')))
 where kind='change' and payload->'value'->>'verb'='add';
insert into public.live_sessions(tenant_id,page_id,live_post_id,created_at)
 select tenant_id,page_id,live_post_id,min(created_at) from public.auctions group by tenant_id,page_id,live_post_id on conflict do nothing;
create or replace function public.ensure_auction_live_session() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
declare ended timestamptz;
begin
 insert into public.live_sessions(tenant_id,page_id,live_post_id) values(new.tenant_id,new.page_id,new.live_post_id) on conflict do nothing;
 select ended_at into ended from public.live_sessions where tenant_id=new.tenant_id and page_id=new.page_id and live_post_id=new.live_post_id for update;
 if ended is not null then raise exception 'LIVE_SESSION_ENDED';end if;
 return new;
end $$;
drop trigger if exists auction_live_session on public.auctions;
create trigger auction_live_session before insert on public.auctions for each row execute function public.ensure_auction_live_session();
alter table public.customer_tab_items add column if not exists auction_id uuid references public.auctions(id),
 add column if not exists winning_bid_id uuid references public.auction_bids(id);
update public.customer_tab_items i set auction_id=a.id,winning_bid_id=b.id from public.auctions a
 left join public.auction_bids b on b.auction_id=a.id and b.comment_id=a.leading_comment_id where i.order_id=a.order_id and i.auction_id is null;
create or replace function public.stamp_customer_tab_proof() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.auction_id is null then
  select a.id,b.id into new.auction_id,new.winning_bid_id from public.orders o join public.auctions a on a.id::text=o.source_id and a.tenant_id=o.tenant_id
   left join public.auction_bids b on b.auction_id=a.id and b.comment_id=a.leading_comment_id where o.id=new.order_id and o.source='live_auction';
 end if;
 return new;
end $$;
drop trigger if exists customer_tab_proof on public.customer_tab_items;
create trigger customer_tab_proof before insert on public.customer_tab_items for each row execute function public.stamp_customer_tab_proof();

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
  select * into a from public.auctions where id::text=new.source_id and tenant_id=new.tenant_id and page_id=page;
  if not found then raise exception 'TAB_AUCTION_SCOPE';end if;
  post:=a.live_post_id;shipping:=a.shipping_fee;bank:=a.bank_account_id;unit:=a.current_price;
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
 if exists(select 1 from public.live_sessions where id=sess and ended_at is not null) then raise exception 'LIVE_SESSION_ENDED';end if;
 insert into public.customer_tabs(tenant_id,customer_id,customer_fb_id,page_id,live_session_id,bank_account_id,shipping_fee)
  values(new.tenant_id,c.id,c.platform_user_id,page,sess,bank,shipping)
  on conflict(live_session_id,customer_id) do update set bank_account_id=coalesce(customer_tabs.bank_account_id,excluded.bank_account_id),
   shipping_fee=case when not customer_tabs.shipping_override and customer_tabs.shipping_fee=0 then excluded.shipping_fee else customer_tabs.shipping_fee end returning * into bill;
 new.customer_tab_id:=bill.id;new.live_session_id:=sess;new.live_post_id:=post;new.item_amount:=unit;
 new.amount:=unit+case when not exists(select 1 from public.customer_tab_items where tab_id=bill.id and not cancelled) then bill.shipping_fee else 0 end;
 return new;
end $$;

create or replace function public.live_comment_time(p_value jsonb,p_fallback timestamptz)
returns timestamptz language sql immutable set search_path=pg_catalog,public as $$
 select case when p_value->>'created_time' ~ '^[0-9]{10}$'
 then to_timestamp((p_value->>'created_time')::double precision) else p_fallback end
$$;

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
  'profit',coalesce(sum(p.amount),0)-s.cost_amount-s.ad_spent-s.shipping_cost) into metrics
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

create or replace function public.live_session_tab_proof(p_tenant uuid,p_session uuid,p_tab uuid)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare t public.customer_tabs; items jsonb; payments jsonb;
begin
 select * into t from public.customer_tabs where id=p_tab and tenant_id=p_tenant and live_session_id=p_session;
 if not found then raise exception 'SESSION_TAB_NOT_FOUND' using errcode='P0002';end if;
 select coalesce(jsonb_agg(jsonb_build_object('orderId',i.order_id,'name',i.item_name,'amount',i.amount,'cancelled',i.cancelled,
  'source',o.source,'orderStatus',o.status,'bidAmount',b.bid_amount,'commentText',b.comment_text,
  'commentId',b.comment_id,'bidAt',public.live_comment_time(be.payload->'value',b.created_at),
  'closeAt',public.live_comment_time(ce.payload->'value',coalesce(a.closed_at,i.closed_at)),
  'originalTime',be.payload->'value'->>'created_time' ~ '^[0-9]{10}$') order by i.closed_at,i.order_id),'[]') into items
 from public.customer_tab_items i join public.orders o on o.id=i.order_id
 left join public.auctions a on a.id=i.auction_id
 left join public.auction_bids b on b.id=i.winning_bid_id
 left join public.facebook_webhook_events be on be.id=b.event_id
 left join public.facebook_webhook_events ce on ce.id=a.close_event_id where i.tab_id=t.id;
 select coalesce(jsonb_agg(jsonb_build_object('slipId',slip_id,'amount',amount,'at',transferred_at) order by transferred_at),'[]') into payments
  from public.customer_tab_payments where tab_id=t.id;
 return jsonb_build_object('tab',to_jsonb(t),'items',items,'payments',payments);
end $$;

-- One service-only mutation entry point: request receipts, optimistic revisions and an audit trail.
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
  for v in select value from jsonb_array_elements(jsonb_build_array(p_input->'cost',p_input->'ads',p_input->'shipping')) loop
   if coalesce(v#>>'{}','') !~ '^[0-9]+(\.[0-9]{1,2})?$' or (v#>>'{}')::numeric>999999999999.99 then raise exception 'SESSION_INPUT_INVALID';end if;
  end loop;
  if (p_input->>'cost')::numeric<0 or (p_input->>'ads')::numeric<0 or (p_input->>'shipping')::numeric<0
    or p_input->>'cost' is null or p_input->>'ads' is null or p_input->>'shipping' is null then raise exception 'SESSION_INPUT_INVALID';end if;
  update public.live_sessions set cost_amount=(p_input->>'cost')::numeric,ad_spent=(p_input->>'ads')::numeric,
   shipping_cost=(p_input->>'shipping')::numeric,financial_revision=financial_revision+1 where id=s.id;
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

create or replace function public.queue_live_session_reminders(p_tenant uuid,p_session uuid,p_actor uuid,p_request uuid,p_tabs uuid[],p_template text)
returns integer language plpgsql set search_path=pg_catalog,public as $$
declare prior public.live_session_changes; payload jsonb; n integer;
begin
 if p_request is null or p_actor is null or length(trim(p_template)) not between 1 and 1500 then raise exception 'SESSION_INPUT_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('session-edit:'||p_tenant::text,0));
 if not exists(select 1 from public.live_sessions where id=p_session and tenant_id=p_tenant) then raise exception 'SESSION_NOT_FOUND';end if;
 payload:=jsonb_build_object('action','remind','tabs',p_tabs,'template',p_template);
 select * into prior from public.live_session_changes where tenant_id=p_tenant and request_id=p_request;
 if found then
  if prior.session_id<>p_session or prior.actor_id<>p_actor or prior.payload<>payload then raise exception 'SESSION_REQUEST_REUSED' using errcode='40001';end if;
  return (prior.result->>'queued')::integer;
 end if;
 if p_tabs is not null and (cardinality(p_tabs)=0 or exists(select 1 from unnest(p_tabs) as requested(tab_id) where not exists(select 1 from public.customer_tabs t where t.id=requested.tab_id and t.live_session_id=p_session and t.tenant_id=p_tenant))) then raise exception 'SESSION_TAB_SCOPE' using errcode='42501';end if;
 with eligible as (
  select t.id from public.customer_tabs t where t.live_session_id=p_session and t.tenant_id=p_tenant and t.remaining_amount>0
   and (p_tabs is null or t.id=any(p_tabs)) and not exists(select 1 from public.customer_tab_reminders j where j.tab_id=t.id and
    (j.status in ('processing','requires_review') or j.status='pending' and j.run_at<=clock_timestamp()))
   order by t.id for update of t
 )
 insert into public.customer_tab_reminders(tab_id,stage,run_at,message_template,requested_by)
  select id,'session:'||p_request::text,clock_timestamp(),p_template,p_actor from eligible
  on conflict(tab_id,stage) do nothing;
 get diagnostics n=row_count;
 insert into public.live_session_changes(tenant_id,session_id,actor_id,request_id,payload,result) values(p_tenant,p_session,p_actor,p_request,payload,jsonb_build_object('queued',n));
 return n;
end $$;

-- A shared Page dispatch slot limits all tab reminder workers to 12 recipients/minute.
create or replace function public.claim_customer_tab_reminder() returns setof public.customer_tab_reminders
language plpgsql set search_path=pg_catalog,public as $$
declare job public.customer_tab_reminders; page text; slot timestamptz;
begin
 update public.customer_tab_reminders set status='requires_review',error_code='LEASE_EXPIRED' where status='processing' and started_at<clock_timestamp()-interval '5 minutes';
 select j.* into job from public.customer_tab_reminders j join public.customer_tabs t on t.id=j.tab_id
  left join public.live_reminder_dispatch_slots d on d.page_id=t.page_id
  where j.status='pending' and j.run_at<=clock_timestamp() and t.remaining_amount>0
   and coalesce(d.next_allowed_at,'-infinity'::timestamptz)<=clock_timestamp()+interval '5 seconds'
   and not exists(select 1 from public.customer_tab_reminders running join public.customer_tabs rt on rt.id=running.tab_id where rt.page_id=t.page_id and running.status='processing')
  order by j.run_at,j.id for update of j skip locked limit 1;
 if not found then return;end if;
 select page_id into page from public.customer_tabs where id=job.tab_id;
 insert into public.live_reminder_dispatch_slots(page_id) values(page) on conflict do nothing;
 select next_allowed_at into slot from public.live_reminder_dispatch_slots where page_id=page for update;
 if slot>clock_timestamp()+interval '5 seconds' or exists(select 1 from public.customer_tab_reminders running join public.customer_tabs rt on rt.id=running.tab_id where rt.page_id=page and running.status='processing') then return;end if;
 slot:=greatest(slot,clock_timestamp());
 update public.live_reminder_dispatch_slots set next_allowed_at=slot+interval '5 seconds' where page_id=page;
 return query update public.customer_tab_reminders set status='processing',claim_token=gen_random_uuid(),started_at=clock_timestamp(),send_after=slot where id=job.id returning *;
end $$;

create or replace function public.finish_live_reminder_slot() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if old.status='processing' and new.status<>'processing' and old.send_after is not null then
  update public.live_reminder_dispatch_slots set next_allowed_at=greatest(next_allowed_at,clock_timestamp()+interval '5 seconds')
   where page_id=(select page_id from public.customer_tabs where id=new.tab_id);
 end if;
 return new;
end $$;
drop trigger if exists live_reminder_slot_finished on public.customer_tab_reminders;
create trigger live_reminder_slot_finished after update on public.customer_tab_reminders for each row execute function public.finish_live_reminder_slot();

revoke all on function public.finish_live_reminder_slot(),public.ensure_auction_live_session(),public.stamp_customer_tab_proof(),public.live_comment_time(jsonb,timestamptz),public.live_session_dashboard(uuid,uuid),public.live_session_tab_proof(uuid,uuid,uuid),public.manage_live_session(uuid,uuid,uuid,uuid,jsonb),public.queue_live_session_reminders(uuid,uuid,uuid,uuid,uuid[],text),public.claim_customer_tab_reminder() from public,anon,authenticated;
grant execute on function public.live_comment_time(jsonb,timestamptz),public.live_session_dashboard(uuid,uuid),public.live_session_tab_proof(uuid,uuid,uuid),public.manage_live_session(uuid,uuid,uuid,uuid,jsonb),public.queue_live_session_reminders(uuid,uuid,uuid,uuid,uuid[],text),public.claim_customer_tab_reminder() to service_role;
commit;
