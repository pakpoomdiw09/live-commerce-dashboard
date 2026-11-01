-- Customer chooses a variant on the signed Live CF payment page.
-- Prerequisites: live-cf-setup.sql, payments.sql, payment-pro.sql.
begin;
alter table public.comment_rules add column if not exists live_customer_select_variant boolean not null default false;
alter table public.orders add column if not exists live_variant_selection_required boolean not null default false;
alter table public.orders add column if not exists live_variant_confirmed_at timestamptz;

create or replace function public.validate_live_cf_setup_rule() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.products;v public.commerce_variants;b public.bank_accounts;normalized text[];
begin
 if tg_op='UPDATE' and new.tenant_id is distinct from old.tenant_id then
  raise exception 'Cannot move a Live CF rule to another tenant' using errcode='23514';
 end if;
 if new.mode<>'live_cf' then
  new.live_product_id:=null;new.live_variant_id:=null;new.live_stock_limit:=null;
  new.live_post_id:=null;new.live_bank_account_id:=null;new.live_deduct_stock:=true;new.live_customer_select_variant:=false;return new;
 end if;
 if new.live_customer_select_variant then new.live_variant_id:=null;end if;
 perform 1 from public.tenants where id=new.tenant_id for update;
 if not found then raise exception 'Live CF tenant not found' using errcode='23514';end if;
 select * into p from public.products where id=new.live_product_id and tenant_id=new.tenant_id;
 if not found or (new.is_active and (not p.is_active or p.commerce_archived)) then
  raise exception 'Live CF product is unavailable' using errcode='23514';end if;
 if new.live_variant_id is not null then
  select * into v from public.commerce_variants where id=new.live_variant_id and tenant_id=new.tenant_id and product_id=p.id;
  if not found or (new.is_active and not v.is_active) then raise exception 'Live CF variant is unavailable' using errcode='23514';end if;
 elsif new.is_active and not new.live_customer_select_variant and exists(select 1 from public.commerce_variants where product_id=p.id and is_active) then
  raise exception 'Live CF variant is required' using errcode='23514';
 end if;
 if cardinality(new.page_ids)<>1 or not exists(
  select 1 from public.tenants where id=new.tenant_id and page_id=new.page_ids[1]
 ) then raise exception 'Live CF Page does not belong to tenant' using errcode='23514';end if;
 select array_agg(distinct lower(trim(k))) into normalized from unnest(new.keywords) k;
 if coalesce(cardinality(normalized),0)=0 or cardinality(normalized)>50 or exists(
  select 1 from unnest(normalized) k where k is null or length(k)>40 or
   k!~'^[[:alnum:]][[:alnum:]_-]*$'
 ) then raise exception 'Invalid Live CF code' using errcode='23514';end if;
 new.keywords:=normalized;
 new.live_post_id:=nullif(trim(new.live_post_id),'');
 if new.live_post_id is not null and (length(new.live_post_id)>140 or new.live_post_id!~'^[0-9]+(_[0-9]+)?$') then
  raise exception 'Invalid live video ID' using errcode='23514';end if;
 if new.live_bank_account_id is not null then
  select * into b from public.bank_accounts where id=new.live_bank_account_id and tenant_id=new.tenant_id and is_active;
  if not found then raise exception 'Live CF bank account is unavailable' using errcode='23514';end if;
 end if;
 if new.is_active and exists(
  select 1 from public.comment_rules r where r.id<>new.id and r.tenant_id=new.tenant_id and r.mode='live_cf'
   and r.is_active and r.page_ids&&new.page_ids and r.keywords&&normalized
   and (r.live_post_id is null or new.live_post_id is null or r.live_post_id=new.live_post_id
    or regexp_replace(r.live_post_id,'^.*_','')=regexp_replace(new.live_post_id,'^.*_',''))
 ) then raise exception 'Active Live CF code already exists' using errcode='23514';end if;
 return new;
end $$;

create or replace function public.place_cf_order(
 p_tenant uuid,p_customer uuid,p_rule uuid,p_code text,p_comment text,p_post text,p_page text
) returns table(
 r_status text,r_order_id uuid,r_name text,r_code text,r_amount numeric,r_variant_label text
) language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.comment_rules;p public.products;v public.commerce_variants;o public.orders;
 price numeric;label text;new_id uuid;used integer;
begin
 if p_comment is null or length(p_comment) not between 1 and 512 or p_code is null then raise exception 'Invalid live comment' using errcode='22023';end if;
 perform 1 from public.tenants where id=p_tenant and is_active and page_id=p_page for update;
 if not found then raise exception 'Live CF Page not found' using errcode='42501';end if;
 if not exists(select 1 from public.customers where id=p_customer and tenant_id=p_tenant and platform='facebook') then raise exception 'Live CF customer not found' using errcode='42501';end if;
 select * into o from public.orders where tenant_id=p_tenant and source_id=p_comment and source in ('live_comment','facebook_comment') for update;
 if found then
  if o.source='facebook_comment' or o.status='cancelled' then return query select 'no_match'::text,null::uuid,null::text,null::text,null::numeric,null::text;return;end if;
  if o.customer_id is distinct from p_customer or o.live_rule_id is distinct from p_rule or o.source_code is distinct from lower(trim(p_code)) then raise exception 'Live CF comment already used' using errcode='40001';end if;
  return query select 'created'::text,o.id,o.product_name,o.source_code,o.amount,o.variant_label;return;
 end if;
 select * into r from public.comment_rules where id=p_rule and tenant_id=p_tenant and mode='live_cf' and is_active and p_page=any(page_ids) for update;
 if not found or not(lower(trim(p_code))=any(r.keywords)) or (r.live_post_id is not null and regexp_replace(r.live_post_id,'^.*_','')<>regexp_replace(coalesce(p_post,''),'^.*_','')) then
  return query select 'no_match'::text,null::uuid,null::text,null::text,null::numeric,null::text;return;
 end if;
 insert into public.live_cf_webhook_receipts(tenant_id,page_id,comment_id,live_rule_id)
 values(p_tenant,p_page,p_comment,p_rule) on conflict(tenant_id,page_id,comment_id) do nothing;
 select * into p from public.products where id=r.live_product_id and tenant_id=p_tenant and is_active and not commerce_archived for update;
 if not found then return query select 'no_match'::text,null::uuid,null::text,null::text,null::numeric,null::text;return;end if;
 price:=p.price;label:=null;
 if r.live_variant_id is not null then
  select * into v from public.commerce_variants where id=r.live_variant_id and product_id=p.id and tenant_id=p_tenant and is_active for update;
  if not found then return query select 'no_match'::text,null::uuid,null::text,null::text,null::numeric,null::text;return;end if;
  price:=v.price;label:=v.label;
 elsif not r.live_customer_select_variant and exists(select 1 from public.commerce_variants where product_id=p.id and tenant_id=p_tenant and is_active) then
  return query select 'require_variant'::text,null::uuid,p.name,p_code,null::numeric,null::text;return;
 end if;
 select count(*) into used from public.orders where tenant_id=p_tenant and live_rule_id=r.id and status<>'cancelled';
 if p.stock<1 or (r.live_variant_id is not null and v.stock<1) or (r.live_stock_limit is not null and used>=r.live_stock_limit) then
  return query select 'sold_out'::text,null::uuid,p.name,p_code,price,label;return;
 end if;
 if r.live_deduct_stock then
  update public.products set stock=stock-1 where id=p.id and stock>0;
  if not found then return query select 'sold_out'::text,null::uuid,p.name,p_code,price,label;return;end if;
  if r.live_variant_id is not null then
   update public.commerce_variants set stock=stock-1 where id=v.id and stock>0;
   if not found then raise exception 'Live CF variant stock changed' using errcode='40001';end if;
  end if;
 end if;
 insert into public.orders(tenant_id,customer_id,product_id,product_name,amount,variant_id,variant_label,source,source_id,source_code,live_rule_id,live_bank_account_id,live_stock_deducted,live_variant_selection_required)
 values(p_tenant,p_customer,p.id,p.name,price,r.live_variant_id,label,'live_comment',p_comment,lower(trim(p_code)),r.id,r.live_bank_account_id,r.live_deduct_stock,r.live_customer_select_variant and exists(select 1 from public.commerce_variants where product_id=p.id and tenant_id=p_tenant and is_active)) returning id into new_id;
 insert into public.commerce_audit(tenant_id,entity_id,action,detail) values(p_tenant,new_id,'live_cf_order',r.id::text);
 return query select 'created'::text,new_id,p.name,p_code,price,label;
end $$;


create or replace function public.confirm_live_cf_variant(p_order uuid,p_variant uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.orders;p public.products;v public.commerce_variants;t uuid;
begin
 select tenant_id into t from public.orders where id=p_order;
 if not found then raise exception 'LIVE_CF_ORDER_NOT_FOUND';end if;
 perform 1 from public.tenants where id=t and is_active for update;
 if not found then raise exception 'LIVE_CF_ORDER_NOT_FOUND';end if;
 select * into o from public.orders where id=p_order and tenant_id=t for update;
 if not found or o.source is distinct from 'live_comment' or not o.live_variant_selection_required then
  raise exception 'LIVE_CF_SELECTION_UNAVAILABLE';end if;
 if o.status<>'pending_payment' or o.slip_id is not null then raise exception 'LIVE_CF_SELECTION_LOCKED';end if;
 if o.live_variant_confirmed_at is not null then
  if o.variant_id is distinct from p_variant then raise exception 'LIVE_CF_SELECTION_LOCKED';end if;
  return jsonb_build_object('variant_id',o.variant_id,'variant_label',o.variant_label,'amount',o.amount,'confirmed_at',o.live_variant_confirmed_at,
   'payment_total',(select coalesce(sum(amount),0) from public.orders where tenant_id=t and customer_id=o.customer_id and status='pending_payment'),
   'remaining_selections',(select count(*) from public.orders where tenant_id=t and customer_id=o.customer_id and status='pending_payment' and live_variant_selection_required and live_variant_confirmed_at is null));
 end if;
 if exists(select 1 from public.slips where tenant_id=t and customer_id=o.customer_id
  and created_at>=o.created_at and status in ('pending','valid')) then
  raise exception 'LIVE_CF_PAYMENT_IN_PROGRESS';end if;
 select * into p from public.products where id=o.product_id and tenant_id=t and is_active and not commerce_archived for update;
 if not found then raise exception 'LIVE_CF_SELECTION_UNAVAILABLE';end if;
 select * into v from public.commerce_variants where id=p_variant and product_id=p.id and tenant_id=t and is_active for update;
 if not found then raise exception 'LIVE_CF_VARIANT_INVALID';end if;
 if v.stock<1 then raise exception 'LIVE_CF_VARIANT_SOLD_OUT';end if;
 if o.live_stock_deducted then
  update public.commerce_variants set stock=stock-1 where id=v.id and tenant_id=t and stock>0;
  if not found then raise exception 'LIVE_CF_VARIANT_SOLD_OUT';end if;
 end if;
 update public.orders set variant_id=v.id,variant_label=v.label,amount=v.price,live_variant_confirmed_at=clock_timestamp()
  where id=o.id returning * into o;
 insert into public.commerce_audit(tenant_id,entity_id,action,detail) values(t,o.id,'live_cf_variant_selected',v.id::text);
 return jsonb_build_object('variant_id',o.variant_id,'variant_label',o.variant_label,'amount',o.amount,'confirmed_at',o.live_variant_confirmed_at,
  'payment_total',(select coalesce(sum(amount),0) from public.orders where tenant_id=t and customer_id=o.customer_id and status='pending_payment'),
  'remaining_selections',(select count(*) from public.orders where tenant_id=t and customer_id=o.customer_id and status='pending_payment' and live_variant_selection_required and live_variant_confirmed_at is null));
end $$;
revoke all on function public.confirm_live_cf_variant(uuid,uuid) from public,anon,authenticated;
grant execute on function public.confirm_live_cf_variant(uuid,uuid) to service_role;

-- A quote can change only before confirmation. Never let an old slip pay a newer price.
create or replace function public.guard_live_cf_variant_payment() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare s record;total numeric;
begin
 if old.live_variant_selection_required and not new.live_variant_selection_required then
  raise exception 'LIVE_CF_SELECTION_LOCKED';end if;
 if not new.live_variant_selection_required then return new;end if;
 if old.live_variant_confirmed_at is not null and (new.variant_id is distinct from old.variant_id
  or new.amount is distinct from old.amount or new.live_variant_confirmed_at is distinct from old.live_variant_confirmed_at) then
  raise exception 'LIVE_CF_SELECTION_LOCKED';end if;
 if new.status='paid' and old.status is distinct from 'paid' then
  if old.status<>'pending_payment' then raise exception 'LIVE_CF_SELECTION_LOCKED';end if;
  if new.live_variant_confirmed_at is null or new.variant_id is null then raise exception 'LIVE_CF_VARIANT_REQUIRED';end if;
  select status,amount into s from public.slips where id=new.slip_id and tenant_id=new.tenant_id and customer_id=new.customer_id;
  if not found or s.status<>'valid' then raise exception 'LIVE_CF_PAYMENT_EVIDENCE_REQUIRED';end if;
  select sum(amount) into total from public.orders where tenant_id=new.tenant_id and customer_id=new.customer_id
   and (status='pending_payment' or status='paid' and slip_id=new.slip_id);
  if total is null or s.amount is null or round(s.amount*100)<>round(total*100) then raise exception 'LIVE_CF_PAYMENT_AMOUNT_CHANGED';end if;
 end if;
 return new;
end $$;
drop trigger if exists orders_live_cf_variant_guard on public.orders;
create trigger orders_live_cf_variant_guard before update on public.orders
 for each row execute function public.guard_live_cf_variant_payment();
revoke all on function public.guard_live_cf_variant_payment() from public,anon,authenticated;

-- Check the final quote BEFORE accepting a legacy provider result or updating CRM state.
create or replace function public.guard_live_cf_variant_slip() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare total numeric;
begin
 if new.status<>'valid' or new.tenant_id is null or new.customer_id is null then return new;end if;
 if tg_op='UPDATE' and old.status='valid' then return new;end if;
 if not exists(select 1 from public.orders where tenant_id=new.tenant_id and customer_id=new.customer_id
  and status='pending_payment' and live_variant_selection_required) then return new;end if;
 perform 1 from public.tenants where id=new.tenant_id for update;
 perform 1 from public.orders where tenant_id=new.tenant_id and customer_id=new.customer_id and status='pending_payment' order by id for update;
 if exists(select 1 from public.orders where tenant_id=new.tenant_id and customer_id=new.customer_id
  and status='pending_payment' and live_variant_selection_required and live_variant_confirmed_at is null) then
  raise exception 'LIVE_CF_VARIANT_REQUIRED';end if;
 select sum(amount) into total from public.orders where tenant_id=new.tenant_id and customer_id=new.customer_id and status='pending_payment';
 if total is null or new.amount is null or round(new.amount*100)<>round(total*100) then raise exception 'LIVE_CF_PAYMENT_AMOUNT_CHANGED';end if;
 return new;
end $$;
drop trigger if exists slips_live_cf_selection_guard on public.slips;
create trigger slips_live_cf_selection_guard before insert or update on public.slips
 for each row execute function public.guard_live_cf_variant_slip();
revoke all on function public.guard_live_cf_variant_slip() from public,anon,authenticated;
commit;
