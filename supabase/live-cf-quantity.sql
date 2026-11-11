
alter table public.comment_rules
  add column if not exists max_qty_per_comment integer not null default 5;
alter table public.comment_rules
  drop constraint if exists comment_rules_max_qty_per_comment_check;
alter table public.comment_rules
  add constraint comment_rules_max_qty_per_comment_check
  check (max_qty_per_comment between 1 and 99);

alter table public.orders
  add column if not exists quantity integer not null default 1,
  add column if not exists item_price numeric(12,2),
  add column if not exists subtotal numeric(12,2);
update public.orders
set subtotal=coalesce(subtotal,item_amount,amount),
    item_price=coalesce(item_price,item_amount,amount),
    item_amount=coalesce(item_amount,subtotal,amount);
alter table public.orders
  alter column item_price drop not null,
  alter column subtotal drop not null;
alter table public.orders
  drop constraint if exists orders_quantity_check;
alter table public.orders
  add constraint orders_quantity_check check (quantity between 1 and 99);
alter table public.orders
  drop constraint if exists orders_item_price_check;
alter table public.orders
  add constraint orders_item_price_check check ((item_price is null or item_price > 0) and (subtotal is null or subtotal > 0));

alter table public.customer_tab_items
  add column if not exists quantity integer not null default 1,
  add column if not exists item_price numeric(12,2);
update public.customer_tab_items i
set item_price=coalesce(i.item_price,o.item_price,i.amount),
    quantity=coalesce(o.quantity,1)
from public.orders o where o.id=i.order_id;
update public.customer_tab_items set item_price=amount where item_price is null;
alter table public.customer_tab_items alter column item_price drop not null;
alter table public.customer_tab_items
  drop constraint if exists customer_tab_items_quantity_check;
alter table public.customer_tab_items
  add constraint customer_tab_items_quantity_check check (quantity between 1 and 99);

create or replace function public.on_order_status() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.status=old.status then return new;end if;
 if old.status='cancelled' then raise exception 'Cancelled order status cannot be changed';end if;
 if new.status='cancelled' and new.product_id is not null and coalesce(new.live_stock_deducted,true) then
  update public.products set stock=stock+new.quantity where id=new.product_id and tenant_id=new.tenant_id;
  if new.variant_id is not null then
   update public.commerce_variants set stock=stock+new.quantity where id=new.variant_id and tenant_id=new.tenant_id;
  end if;
 end if;
 return new;
end $$;

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
  select * into a from public.auctions where id::text=new.source_id and tenant_id=new.tenant_id and page_id=page;
  if not found then raise exception 'TAB_AUCTION_SCOPE';end if;
  post:=a.live_post_id;shipping:=a.shipping_fee;bank:=a.bank_account_id;unit:=a.current_price;
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

create or replace function public.sync_customer_tab_order() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.customer_tab_id is null or current_setting('app.refreshing_customer_tab',true)='1' then return new;end if;
 if tg_op='UPDATE' and new.amount=old.amount and new.product_name=old.product_name and new.variant_label is not distinct from old.variant_label
  and new.quantity=old.quantity and new.item_price=old.item_price and (new.status='cancelled')=(old.status='cancelled') then return new;end if;
 perform 1 from public.customer_tabs where id=new.customer_tab_id for update;
 insert into public.customer_tab_items(order_id,tab_id,item_name,variant_label,amount,cancelled,closed_at,quantity,item_price)
  values(new.id,new.customer_tab_id,new.product_name,new.variant_label,new.item_amount,new.status='cancelled',new.created_at,new.quantity,new.item_price)
  on conflict(order_id) do update set item_name=excluded.item_name,variant_label=excluded.variant_label,amount=excluded.amount,
   cancelled=excluded.cancelled,quantity=excluded.quantity,item_price=excluded.item_price;
 perform public.refresh_customer_tab(new.customer_tab_id);
 return new;
end $$;

drop function if exists public.place_live_cf_order(uuid,uuid,uuid,text,text,text,text);
create or replace function public.place_live_cf_order(
 p_tenant uuid,p_customer uuid,p_rule uuid,p_code text,p_comment text,p_post text,p_page text,p_quantity integer default 1
) returns table(
 r_status text,r_order_id uuid,r_name text,r_code text,r_amount numeric,r_variant_label text,
 r_quantity integer,r_unit_price numeric,r_subtotal numeric,r_quantity_clamped boolean,r_remaining_stock integer
) language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.comment_rules;p public.products;v public.commerce_variants;o public.orders;
 requested integer;qty integer;used integer;available integer;reserved integer;unit numeric;label text;new_id uuid;sub numeric;
begin
 if p_comment is null or length(p_comment) not between 1 and 512 or p_code is null then raise exception 'Invalid live comment' using errcode='22023';end if;
 requested:=greatest(1,least(99,coalesce(p_quantity,1)));
 perform 1 from public.tenants where id=p_tenant and is_active and page_id=p_page for update;
 if not found then raise exception 'Live CF Page not found' using errcode='42501';end if;
 if not exists(select 1 from public.customers where id=p_customer and tenant_id=p_tenant and platform='facebook') then raise exception 'Live CF customer not found' using errcode='42501';end if;
 select * into o from public.orders where tenant_id=p_tenant and source_id=p_comment and source='live_comment' for update;
 if found then
  if o.customer_id is distinct from p_customer or o.live_rule_id is distinct from p_rule or o.source_code is distinct from lower(trim(p_code)) then raise exception 'Live CF comment already used' using errcode='40001';end if;
  return query select 'created'::text,o.id,o.product_name,o.source_code,o.subtotal,o.variant_label,o.quantity,o.item_price,o.subtotal,(o.quantity<requested),null::integer;return;
 end if;
 select * into r from public.comment_rules where id=p_rule and tenant_id=p_tenant and mode='live_cf' and is_active and p_page=any(page_ids) for update;
 if not found or not(lower(trim(p_code))=any(r.keywords)) or (r.live_post_id is not null and regexp_replace(r.live_post_id,'^.*_','')<>regexp_replace(coalesce(p_post,''),'^.*_','')) then
  return query select 'no_match'::text,null::uuid,null::text,null::text,null::numeric,null::text,null::integer,null::numeric,null::numeric,false,null::integer;return;
 end if;
 qty:=least(requested,greatest(1,least(99,coalesce(r.max_qty_per_comment,5))));
 select * into p from public.products where id=r.live_product_id and tenant_id=p_tenant and is_active and not commerce_archived for update;
 if not found then return query select 'no_match'::text,null::uuid,null::text,null::text,null::numeric,null::text,null::integer,null::numeric,null::numeric,false,null::integer;return;end if;
 unit:=p.price;label:=null;available:=p.stock;
 if r.live_variant_id is not null then
  select * into v from public.commerce_variants where id=r.live_variant_id and product_id=p.id and tenant_id=p_tenant and is_active for update;
  if not found then return query select 'no_match'::text,null::uuid,null::text,null::text,null::numeric,null::text,null::integer,null::numeric,null::numeric,false,null::integer;return;end if;
  unit:=v.price;label:=v.label;available:=least(available,v.stock);
 elsif not r.live_customer_select_variant and exists(select 1 from public.commerce_variants where product_id=p.id and tenant_id=p_tenant and is_active) then
  return query select 'require_variant'::text,null::uuid,p.name,p_code,null::numeric,null::text,null::integer,unit,null::numeric,false,available;return;
 end if;
 select coalesce(sum(quantity),0)::integer into used from public.orders where tenant_id=p_tenant and live_rule_id=r.id and status<>'cancelled';
 if r.live_stock_limit is not null then available:=least(available,greatest(0,r.live_stock_limit-used));end if;
 if not r.live_deduct_stock then
  select coalesce(sum(quantity),0)::integer into reserved from public.orders where tenant_id=p_tenant and product_id=p.id and status='pending_payment'
   and not coalesce(live_stock_deducted,true) and (r.live_variant_id is null or variant_id=r.live_variant_id);
  available:=greatest(0,available-reserved);
 end if;
 if available<qty then
  return query select 'insufficient_stock'::text,null::uuid,p.name,p_code,null::numeric,label,qty,unit,null::numeric,(qty<requested),available;return;
 end if;
 sub:=unit*qty;
 if r.live_deduct_stock then
  update public.products set stock=stock-qty where id=p.id and tenant_id=p_tenant and stock>=qty;
  if not found then return query select 'insufficient_stock'::text,null::uuid,p.name,p_code,null::numeric,label,qty,unit,null::numeric,(qty<requested),greatest(0,p.stock);return;end if;
  if r.live_variant_id is not null then
   update public.commerce_variants set stock=stock-qty where id=v.id and tenant_id=p_tenant and stock>=qty;
   if not found then raise exception 'Live CF variant stock changed' using errcode='40001';end if;
  end if;
 end if;
 insert into public.orders(tenant_id,customer_id,product_id,product_name,amount,item_amount,item_price,subtotal,quantity,variant_id,variant_label,source,source_id,source_code,live_rule_id,live_bank_account_id,live_stock_deducted,live_variant_selection_required,live_post_id)
  values(p_tenant,p_customer,p.id,p.name,sub,sub,unit,sub,qty,r.live_variant_id,label,'live_comment',p_comment,lower(trim(p_code)),r.id,r.live_bank_account_id,r.live_deduct_stock,r.live_customer_select_variant and exists(select 1 from public.commerce_variants where product_id=p.id and tenant_id=p_tenant and is_active),p_post)
  returning id into new_id;
 return query select 'created'::text,new_id,p.name,p_code,sub,label,qty,unit,sub,(qty<requested),available-qty;
end $$;

revoke all on function public.place_live_cf_order(uuid,uuid,uuid,text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.place_live_cf_order(uuid,uuid,uuid,text,text,text,text,integer) to service_role;
notify pgrst,'reload schema';
