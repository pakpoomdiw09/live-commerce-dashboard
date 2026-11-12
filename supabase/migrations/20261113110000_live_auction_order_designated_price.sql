-- Preserve the winning bidder amount when attaching the tab/order trigger.
begin;

create or replace function public.attach_customer_tab_order() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.customers; a public.auctions; r public.comment_rules; sess uuid; bill public.customer_tabs;
 page text; post text; shipping numeric:=0; bank uuid; unit numeric; subtotal_value numeric;
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
   if new.variant_id is distinct from old.variant_id then
    new.subtotal:=new.amount;new.item_amount:=new.subtotal;
    new.item_price:=round(new.subtotal/new.quantity,2);
    new.amount:=new.subtotal+(old.amount-old.item_amount);
   else
    new.subtotal:=old.subtotal+(new.amount-old.amount);
    new.item_amount:=new.subtotal;
    new.item_price:=round(new.subtotal/new.quantity,2);
   end if;
  elsif new.quantity is distinct from old.quantity or new.item_price is distinct from old.item_price then
   new.subtotal:=new.quantity*new.item_price;new.item_amount:=new.subtotal;
   new.amount:=new.subtotal+(old.amount-old.item_amount);
  end if;
  return new;
 end if;
 if coalesce(new.source,'') not in ('live_auction','live_comment') or new.status<>'pending_payment' then return new;end if;
 if new.source='live_comment' then
  new.quantity:=greatest(1,least(99,coalesce(new.quantity,1)));
  unit:=coalesce(new.item_price,round(coalesce(new.subtotal,new.amount)/new.quantity,2));
  subtotal_value:=unit*new.quantity;
  new.item_price:=unit;new.subtotal:=subtotal_value;new.item_amount:=subtotal_value;
 end if;
 select * into c from public.customers where id=new.customer_id and tenant_id=new.tenant_id and platform='facebook';
 if not found then raise exception 'TAB_CUSTOMER_SCOPE';end if;
 select page_id into page from public.tenants where id=new.tenant_id and is_active;
 if page is null then raise exception 'TAB_PAGE_SCOPE';end if;
 if new.source='live_auction' then
  select * into a from public.auctions
   where (id=new.live_auction_id or (new.live_auction_id is null and id::text=new.source_id))
    and tenant_id=new.tenant_id and page_id=page;
  if not found then raise exception 'TAB_AUCTION_SCOPE';end if;
  post:=a.live_post_id;shipping:=a.shipping_fee;bank:=a.bank_account_id;unit:=coalesce(nullif(new.item_amount,0),a.current_price);
  new.quantity:=greatest(1,coalesce(new.quantity,1));new.item_price:=unit;new.subtotal:=unit*new.quantity;
 else
  select * into r from public.comment_rules where id=new.live_rule_id and tenant_id=new.tenant_id and page=any(page_ids);
  if not found then raise exception 'TAB_CF_SCOPE';end if;
  post:=coalesce(new.live_post_id,r.live_post_id);bank:=r.live_bank_account_id;unit:=new.item_price;
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
   shipping_fee=case when customer_tabs.shipping_fee=0 then excluded.shipping_fee else customer_tabs.shipping_fee end returning * into bill;
 new.customer_tab_id:=bill.id;new.live_session_id:=sess;new.live_post_id:=post;
 if new.source='live_comment' then
  new.amount:=new.subtotal+case when not exists(select 1 from public.customer_tab_items where tab_id=bill.id and not cancelled) then bill.shipping_fee else 0 end;
  new.item_amount:=new.subtotal;
 else
  new.item_amount:=new.subtotal;
  new.amount:=new.subtotal+case when not exists(select 1 from public.customer_tab_items where tab_id=bill.id and not cancelled) then bill.shipping_fee else 0 end;
 end if;
 return new;
end $$;

commit;
