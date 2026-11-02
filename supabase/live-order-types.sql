-- Apply after live-session-dashboard.sql. Preserve source IDs, ledger totals and one shipping fee.
begin;
alter table public.orders add column if not exists order_type text generated always as (
 case when source='live_auction' then 'auction'
 when source in ('live_comment','facebook_comment') or source_code is not null then 'cf' else null end
) stored;
alter table public.customer_tab_items add column if not exists order_type text check(order_type in ('auction','cf')),
 add column if not exists source_code text;
create or replace function public.stamp_live_item_type() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 select o.order_type,o.source_code into new.order_type,new.source_code from public.orders o
  join public.customer_tabs t on t.id=new.tab_id and t.tenant_id=o.tenant_id and t.customer_id=o.customer_id
  where o.id=new.order_id and o.customer_tab_id=t.id;
 if not found then raise exception 'TAB_ITEM_SCOPE' using errcode='42501';end if;
 return new;
end $$;
drop trigger if exists customer_tab_item_type on public.customer_tab_items;
create trigger customer_tab_item_type before insert or update on public.customer_tab_items for each row execute function public.stamp_live_item_type();
update public.customer_tab_items i set order_type=o.order_type,source_code=o.source_code from public.orders o
 where o.id=i.order_id and (i.order_type,i.source_code) is distinct from (o.order_type,o.source_code);
revoke all on function public.stamp_live_item_type() from public,anon,authenticated;
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
   'items',coalesce((select jsonb_agg(jsonb_build_object('orderId',i.order_id,'name',case when i.order_type='auction' then '[ประมูล] '||i.item_name when i.order_type='cf' then '[CF'||case when i.source_code is not null then '-'||upper(i.source_code) else '' end||'] '||i.item_name else i.item_name end,'amount',i.amount) order by i.closed_at,i.order_id)
      from public.customer_tab_items i where i.tab_id=t.id and not i.cancelled),'[]'),
   'lastReminder',(select jsonb_build_object('status',j.status,'at',j.completed_at,'code',j.error_code) from public.customer_tab_reminders j where j.tab_id=t.id order by j.created_at desc,j.id desc limit 1),
   'canMessage',c.bot_enabled and not coalesce(c.agent_opted_out,false) and c.window_expires_at>clock_timestamp()) row
  from public.customer_tabs t join public.customers c on c.id=t.customer_id and c.tenant_id=p_tenant where t.live_session_id=s.id
 ) rows;
 return jsonb_build_object('session',to_jsonb(s),'metrics',metrics,'rounds',rounds,'tabs',bills);
end $$;


commit;
