-- Auction setup parity and an immediate, transactional Smart Inbox event.
begin;
alter table public.auctions
 add column if not exists private_reply_enabled boolean not null default true,
 add column if not exists public_reply_enabled boolean not null default true,
 add column if not exists private_reply_template text not null default 'ยินดีด้วยครับ! คุณชนะประมูล {product_name} ราคา {price} บาท ยอดค้างชำระสุทธิ {total} บาท',
 add column if not exists bid_reply_template text not null default '✅ ยืนยันคุณ {bidder_name} ขึ้นนำ {product_name} ที่ {price} บาท เคาะขั้นต่ำ +{min_step} บาท',
 add column if not exists close_reply_template text not null default '❌ ปิดประมูล {product_name} ผู้ชนะ: {bidder_name} ราคา {price} บาท';

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
 if p_event is not null and not p_cancel and a.public_reply_enabled then
  insert into public.auction_deliveries(auction_id,channel,comment_id)
   select a.id,'public',payload->'value'->>'comment_id' from public.facebook_webhook_events where id=p_event;
 end if;
 return jsonb_build_object('status',case when p_cancel then 'cancelled' else 'closed' end,'orderId',oid);
end $$;

create or replace function public.auction_inbox_status(p_tenant uuid,p_customers uuid[])
returns table(customer_id uuid,item_name text,remaining_amount numeric) language sql stable
set search_path=pg_catalog,public as $$
 select distinct on (o.customer_id) o.customer_id,a.item_name,
   coalesce(t.remaining_amount,case when o.status='pending_payment' then o.amount else 0 end)
 from public.auctions a
 join public.orders o on o.id=a.order_id and o.tenant_id=a.tenant_id
 join public.customers c on c.id=o.customer_id and c.tenant_id=p_tenant
 left join public.customer_tabs t on t.id=o.customer_tab_id and t.tenant_id=p_tenant
 where a.tenant_id=p_tenant and o.customer_id=any(p_customers) and a.status='closed'
 order by o.customer_id,a.closed_at desc,a.id desc
$$;
revoke all on function public.finalize_live_auction(uuid,uuid,uuid,boolean),public.auction_inbox_status(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.finalize_live_auction(uuid,uuid,uuid,boolean),public.auction_inbox_status(uuid,uuid[]) to service_role;
commit;
