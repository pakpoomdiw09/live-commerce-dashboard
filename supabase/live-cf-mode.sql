-- Run AFTER comment-rules.sql, platform.sql, commerce-v2.sql and live-cf-variants.sql.
-- Uses the SAME products/commerce_variants stock as storefront checkout.
begin;

alter table public.comment_rules add column if not exists mode text not null default 'general'
  check (mode in ('general','live_cf'));
alter table public.comment_rules add column if not exists live_product_id uuid references public.products(id);
alter table public.comment_rules add column if not exists live_variant_id uuid references public.commerce_variants(id);
alter table public.comment_rules add column if not exists live_stock_limit integer
  check (live_stock_limit between 1 and 1000000);
alter table public.comment_rules add column if not exists live_post_id text;
alter table public.orders add column if not exists live_rule_id uuid
  references public.comment_rules(id) on delete set null;
create index if not exists orders_live_rule on public.orders(tenant_id,live_rule_id,status);
-- A feed and a live_comments delivery of the same comment cannot create two orders.
create unique index if not exists orders_one_facebook_comment
  on public.orders(tenant_id,source_id)
  where source in ('facebook_comment','live_comment') and source_id is not null;

create or replace function public.validate_live_cf_rule() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.products; v public.commerce_variants; normalized text[];
begin
 if tg_op='UPDATE' and new.tenant_id is distinct from old.tenant_id then
  raise exception 'ย้ายกฎไปยังร้านอื่นไม่ได้' using errcode='23514';
 end if;
 if new.mode<>'live_cf' then
  new.live_product_id:=null; new.live_variant_id:=null;
  new.live_stock_limit:=null; new.live_post_id:=null;
  return new;
 end if;
 perform 1 from public.tenants where id=new.tenant_id for update;
 if not found then raise exception 'ไม่พบร้านค้า' using errcode='23514'; end if;
 select * into p from public.products where id=new.live_product_id and tenant_id=new.tenant_id;
 if not found then raise exception 'กรุณาเลือกสินค้าของร้านนี้' using errcode='23514'; end if;
 if new.is_active and (not p.is_active or p.commerce_archived) then
  raise exception 'สินค้านี้ยังไม่เปิดขาย' using errcode='23514';
 end if;
 if new.live_variant_id is not null then
  select * into v from public.commerce_variants
   where id=new.live_variant_id and tenant_id=new.tenant_id and product_id=p.id;
  if not found or (new.is_active and not v.is_active) then
   raise exception 'ตัวเลือกสินค้าไม่ถูกต้อง' using errcode='23514';
  end if;
 elsif new.is_active and exists(select 1 from public.commerce_variants where product_id=p.id and is_active) then
  raise exception 'กรุณาเลือกสีหรือขนาดสินค้า' using errcode='23514';
 end if;
 if cardinality(new.page_ids)=0 or not exists(
  select 1 from public.tenants where id=new.tenant_id and page_id=any(new.page_ids)
 ) or exists(select 1 from unnest(new.page_ids) x where x is null or x<>(select page_id from public.tenants where id=new.tenant_id)) then
  raise exception 'กรุณาเลือกเพจของร้านนี้' using errcode='23514';
 end if;
 select array_agg(distinct lower(trim(k))) into normalized from unnest(new.keywords) k;
 if coalesce(cardinality(normalized),0)=0 or cardinality(normalized)>50 or
  exists(select 1 from unnest(normalized) k where k is null or k!~'^[a-z0-9][a-z0-9_-]{0,39}$') then
  raise exception 'รหัสไลฟ์ใช้ตัวอักษรอังกฤษ ตัวเลข ขีดกลาง หรือขีดล่าง ไม่เกิน 40 ตัว' using errcode='23514';
 end if;
 new.keywords:=normalized;
 new.live_post_id:=nullif(trim(new.live_post_id),'');
 if new.live_post_id is not null and (length(new.live_post_id)>140 or new.live_post_id!~'^[0-9]+(_[0-9]+)?$') then
  raise exception 'รหัสโพสต์หรือวิดีโอไม่ถูกต้อง' using errcode='23514';
 end if;
 if new.is_active and exists(
  select 1 from public.comment_rules r where r.id<>new.id and r.tenant_id=new.tenant_id
   and r.mode='live_cf' and r.is_active and r.page_ids && new.page_ids and r.keywords && normalized
   and (r.live_post_id is null or new.live_post_id is null or r.live_post_id=new.live_post_id
    or regexp_replace(r.live_post_id,'^.*_','')=regexp_replace(new.live_post_id,'^.*_',''))
 ) then raise exception 'รหัสไลฟ์นี้ซ้ำกับกฎที่เปิดใช้งานอยู่' using errcode='23514'; end if;
 if tg_op='UPDATE' and exists(
  select 1 from public.orders where live_rule_id=new.id and tenant_id=new.tenant_id and status<>'cancelled'
   and (product_id is distinct from new.live_product_id or variant_id is distinct from new.live_variant_id)
 ) then
  raise exception 'กฎนี้มีออเดอร์แล้ว กรุณาสร้างกฎใหม่เมื่อเปลี่ยนสินค้า' using errcode='23514';
 end if;
 return new;
end $$;
drop trigger if exists validate_live_cf_rule on public.comment_rules;
create trigger validate_live_cf_rule before insert or update on public.comment_rules
 for each row execute function public.validate_live_cf_rule();
revoke all on function public.validate_live_cf_rule() from public,anon,authenticated;

-- Use the same product -> variant lock order as checkout/live CF when cancelling.
create or replace function public.on_order_status() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.status=old.status then return new;end if;
 if old.status='cancelled' then raise exception 'ออเดอร์ที่ยกเลิกแล้วเปลี่ยนสถานะไม่ได้';end if;
 if new.status='cancelled' and new.product_id is not null then
  update public.products set stock=stock+1 where id=new.product_id and tenant_id=new.tenant_id;
  if new.variant_id is not null then
   update public.commerce_variants set stock=stock+1 where id=new.variant_id and tenant_id=new.tenant_id;
  end if;
 end if;
 return new;
end $$;

create or replace function public.place_live_cf_order(
 p_tenant uuid,p_customer uuid,p_rule uuid,p_code text,p_comment text,p_post text,p_page text
) returns table(
 r_status text,r_order_id uuid,r_name text,r_code text,r_amount numeric,r_variant_label text
) language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.comment_rules;p public.products;v public.commerce_variants;o public.orders;
 price numeric;label text;new_id uuid;used integer;
begin
 if p_comment is null or length(p_comment) not between 1 and 512 or p_code is null then
  raise exception 'Invalid live comment' using errcode='22023';
 end if;
 -- Serialize this shop's live quotas as well as simultaneous comments. Row locks below
 -- also serialize stock with storefront checkout, which updates the same product rows.
 perform 1 from public.tenants where id=p_tenant and is_active and page_id=p_page for update;
 if not found then raise exception 'Live CF Page not found' using errcode='42501';end if;
 if not exists(select 1 from public.customers where id=p_customer and tenant_id=p_tenant and platform='facebook') then
  raise exception 'Live CF customer not found' using errcode='42501';end if;
 select * into o from public.orders where tenant_id=p_tenant and source_id=p_comment
  and source in ('live_comment','facebook_comment') for update;
 if found then
  if o.source='facebook_comment' or o.status='cancelled' then
   return query select 'no_match'::text,null::uuid,null::text,null::text,null::numeric,null::text;return;
  end if;
  if o.customer_id is distinct from p_customer or o.live_rule_id is distinct from p_rule or o.source_code is distinct from lower(trim(p_code)) then
   raise exception 'Live CF comment already used' using errcode='40001';end if;
  return query select 'created'::text,o.id,o.product_name,o.source_code,o.amount,o.variant_label;return;
 end if;
 select * into r from public.comment_rules where id=p_rule and tenant_id=p_tenant
  and mode='live_cf' and is_active and p_page=any(page_ids);
 if not found or not(lower(trim(p_code))=any(r.keywords)) or
  (r.live_post_id is not null and regexp_replace(r.live_post_id,'^.*_','')<>regexp_replace(coalesce(p_post,''),'^.*_','')) then
  return query select 'no_match'::text,null::uuid,null::text,null::text,null::numeric,null::text;return;
 end if;
 select * into p from public.products where id=r.live_product_id and tenant_id=p_tenant and is_active and not commerce_archived for update;
 if not found then
  return query select 'no_match'::text,null::uuid,null::text,null::text,null::numeric,null::text;return;
 end if;
 price:=p.price; label:=null;
 if r.live_variant_id is not null then
  select * into v from public.commerce_variants where id=r.live_variant_id and product_id=p.id and tenant_id=p_tenant and is_active for update;
  if not found then
   return query select 'no_match'::text,null::uuid,null::text,null::text,null::numeric,null::text;return;
  end if;
  price:=v.price;label:=v.label;
 elsif exists(select 1 from public.commerce_variants where product_id=p.id and tenant_id=p_tenant and is_active) then
  return query select 'require_variant'::text,null::uuid,p.name,p_code,null::numeric,null::text;return;
 end if;
 select count(*) into used from public.orders where tenant_id=p_tenant and live_rule_id=r.id and status<>'cancelled';
 if p.stock<1 or (r.live_variant_id is not null and v.stock<1) or
  (r.live_stock_limit is not null and used>=r.live_stock_limit) then
  return query select 'sold_out'::text,null::uuid,p.name,p_code,price,label;return;
 end if;
 update public.products set stock=stock-1 where id=p.id;
 if r.live_variant_id is not null then update public.commerce_variants set stock=stock-1 where id=v.id;end if;
 insert into public.orders(tenant_id,customer_id,product_id,product_name,amount,variant_id,variant_label,source,source_id,source_code,live_rule_id)
 values(p_tenant,p_customer,p.id,p.name,price,r.live_variant_id,label,'live_comment',p_comment,lower(trim(p_code)),r.id)
 returning id into new_id;
 insert into public.commerce_audit(tenant_id,entity_id,action,detail) values(p_tenant,new_id,'live_cf_order',r.id::text);
 return query select 'created'::text,new_id,p.name,p_code,price,label;
end $$;
revoke all on function public.place_live_cf_order(uuid,uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.place_live_cf_order(uuid,uuid,uuid,text,text,text,text) to service_role;
-- Supabase Realtime remains RLS-scoped. Only stock-bearing tables are needed here.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='products') then
   alter publication supabase_realtime add table public.products;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='commerce_variants') then
   alter publication supabase_realtime add table public.commerce_variants;
  end if;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
