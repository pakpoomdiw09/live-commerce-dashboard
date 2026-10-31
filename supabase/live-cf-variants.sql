-- Run after commerce-v2.sql, orders.sql, automation.sql and facebook-webhook-queue.sql.
-- Adds idempotent comment orders and explicit CF codes for product variants.
begin;

alter table public.commerce_variants add column if not exists variant_code text;
create unique index if not exists commerce_variant_tenant_code
  on public.commerce_variants(tenant_id, lower(variant_code))
  where variant_code is not null and length(trim(variant_code)) > 0;

alter table public.orders add column if not exists variant_id uuid
  references public.commerce_variants(id);
alter table public.orders add column if not exists variant_label text;
alter table public.orders add column if not exists source text;
alter table public.orders add column if not exists source_id text;
alter table public.orders add column if not exists source_code text;
create unique index if not exists orders_one_per_source
  on public.orders(tenant_id, source, source_id)
  where source is not null and source_id is not null;

create or replace function public.commerce_save_product(
  p_tenant uuid,p_actor uuid,p_id uuid,p_value jsonb,p_version integer default null
) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.products;l public.commerce_limits;v jsonb;vid uuid;pid uuid:=coalesce(p_id,gen_random_uuid());kept uuid[]:='{}';
begin
 perform public.commerce_access(p_tenant,p_actor);
 perform 1 from public.tenants where id=p_tenant for update;
 l:=public.commerce_plan(p_tenant);
 if p_id is not null then
  select * into r from public.products where id=p_id and tenant_id=p_tenant and not commerce_archived for update;
  if not found or r.commerce_version is distinct from p_version then raise exception 'COMMERCE_CHANGED' using errcode='40001';end if;
 elsif l.max_products is not null and (select count(*) from public.products where tenant_id=p_tenant and not commerce_archived)>=l.max_products then
  raise exception 'COMMERCE_LIMIT' using errcode='42501';
 end if;
 if p_value->>'category_id' is not null and not exists(
  select 1 from public.commerce_categories where id=(p_value->>'category_id')::uuid and tenant_id=p_tenant
 ) then raise exception 'COMMERCE_CATEGORY';end if;
 if p_id is null then
  insert into public.products(id,tenant_id,code,name,price,stock)
  values(pid,p_tenant,p_value->>'code',p_value->>'name',(p_value->>'price')::numeric,0);
 end if;
 update public.products set
  code=p_value->>'code',name=p_value->>'name',description=nullif(p_value->>'description',''),
  price=(p_value->>'price')::numeric,stock=(p_value->>'stock')::integer,
  is_active=(p_value->>'is_active')::boolean,image_url=p_value->'images'->>0,
  commerce_images=p_value->'images',commerce_category_id=(p_value->>'category_id')::uuid,
  commerce_compare_price=(p_value->>'compare_price')::numeric,
  commerce_cost=(p_value->>'cost')::numeric,commerce_featured=(p_value->>'featured')::boolean
 where id=pid;
 for v in select * from jsonb_array_elements(p_value->'variants') loop
  vid:=coalesce((v->>'id')::uuid,gen_random_uuid());
  if exists(select 1 from public.commerce_variants where id=vid and (tenant_id<>p_tenant or product_id<>pid)) then
   raise exception 'COMMERCE_FORBIDDEN';
  end if;
  insert into public.commerce_variants(id,tenant_id,product_id,label,variant_code,price,stock)
  values(vid,p_tenant,pid,v->>'label',nullif(trim(v->>'variant_code'),''),(v->>'price')::numeric,(v->>'stock')::integer)
  on conflict(id) do update set label=excluded.label,variant_code=excluded.variant_code,
   price=excluded.price,stock=excluded.stock,is_active=true;
  kept:=array_append(kept,vid);
 end loop;
 update public.commerce_variants set is_active=false where product_id=pid and not(id=any(kept));
 insert into public.commerce_audit(tenant_id,actor_id,entity_id,action)
 values(p_tenant,p_actor,pid,'product_saved');
 return pid;
end $$;

create or replace function public.on_order_status() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.status=old.status then return new;end if;
 if old.status='cancelled' then raise exception 'ออเดอร์ที่ยกเลิกแล้วเปลี่ยนสถานะไม่ได้';end if;
 if new.status='cancelled' and new.product_id is not null then
  if new.variant_id is not null then
   update public.commerce_variants set stock=stock+1 where id=new.variant_id;
  end if;
  update public.products set stock=stock+1 where id=new.product_id;
 end if;
 return new;
end $$;
drop trigger if exists orders_status_change on public.orders;
create trigger orders_status_change before update of status on public.orders
 for each row execute function public.on_order_status();

drop function if exists public.place_cf_order(uuid,uuid,uuid,text);
create or replace function public.place_cf_order_core(
 p_tenant uuid,p_customer uuid,p_message uuid,p_code text,p_source text,p_source_id text
) returns table(
 r_status text,r_order_id uuid,r_name text,r_code text,r_amount numeric,r_variant_label text
) language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.products;v public.commerce_variants;o public.orders;new_id uuid;
begin
 if p_source is not null and (p_source<>'facebook_comment' or p_source_id is null or p_message is not null) then
  raise exception 'Invalid CF order source' using errcode='22023';
 end if;
 perform 1 from public.tenants where id=p_tenant for update;
 if not found then raise exception 'Tenant not found' using errcode='P0002';end if;
 if p_source is not null then
  select * into o from public.orders
   where tenant_id=p_tenant and source=p_source and source_id=p_source_id for update;
  if found then
   if o.source_code is distinct from lower(trim(p_code)) then
    raise exception 'CF comment already used' using errcode='40001';
   end if;
   return query select 'created'::text,o.id,o.product_name,o.source_code,o.amount,o.variant_label;
   return;
  end if;
 end if;
 if p_customer is null or not exists(
  select 1 from public.customers where id=p_customer and tenant_id=p_tenant and platform='facebook'
 ) then raise exception 'Customer not found' using errcode='P0002';end if;

 select cv.* into v
  from public.commerce_variants cv join public.products cp on cp.id=cv.product_id
  where cv.tenant_id=p_tenant and lower(cv.variant_code)=lower(trim(p_code))
   and cv.is_active and cp.is_active and not cp.commerce_archived;
 if found then
  select * into p from public.products where id=v.product_id and tenant_id=p_tenant for update;
  select * into v from public.commerce_variants where id=v.id and tenant_id=p_tenant and is_active for update;
  if not found or p.stock<1 or v.stock<1 then
   return query select 'sold_out'::text,null::uuid,p.name,v.variant_code,v.price,v.label;
   return;
  end if;
  update public.commerce_variants set stock=stock-1 where id=v.id;
  update public.products set stock=stock-1 where id=p.id;
  insert into public.orders(
   tenant_id,customer_id,product_id,product_name,amount,message_id,variant_id,variant_label,
   source,source_id,source_code
  ) values(
   p_tenant,p_customer,p.id,p.name,v.price,p_message,v.id,v.label,p_source,p_source_id,lower(trim(p_code))
  ) returning id into new_id;
  return query select 'created'::text,new_id,p.name,v.variant_code,v.price,v.label;
  return;
 end if;

 select * into p from public.products
  where tenant_id=p_tenant and lower(code)=lower(trim(p_code))
   and is_active and not commerce_archived for update;
 if not found then
  return query select 'no_match'::text,null::uuid,null::text,null::text,null::numeric,null::text;
  return;
 end if;
 if exists(select 1 from public.commerce_variants where tenant_id=p_tenant and product_id=p.id and is_active) then
  return query select 'require_variant'::text,null::uuid,p.name,p.code,null::numeric,null::text;
  return;
 end if;
 if p.stock<1 then
  return query select 'sold_out'::text,null::uuid,p.name,p.code,p.price,null::text;
  return;
 end if;
 update public.products set stock=stock-1 where id=p.id;
 insert into public.orders(tenant_id,customer_id,product_id,product_name,amount,message_id,source,source_id,source_code)
 values(p_tenant,p_customer,p.id,p.name,p.price,p_message,p_source,p_source_id,lower(trim(p_code))
 ) returning id into new_id;
 return query select 'created'::text,new_id,p.name,p.code,p.price,null::text;
end $$;

create or replace function public.place_cf_order(
 p_tenant uuid,p_customer uuid,p_message uuid,p_code text
) returns table(
 r_status text,r_order_id uuid,r_name text,r_code text,r_amount numeric,r_variant_label text
) language sql security definer set search_path=pg_catalog,public as $$
 select * from public.place_cf_order_core(p_tenant,p_customer,p_message,p_code,null,null)
$$;

create or replace function public.place_cf_order(
 p_tenant_id uuid,p_code text,p_customer_psid text,p_source text,p_source_id text
) returns table(
 r_status text,r_order_id uuid,r_name text,r_code text,r_amount numeric,r_variant_label text
) language plpgsql security definer set search_path=pg_catalog,public as $$
declare customer_id uuid;
begin
 if p_source<>'facebook_comment' or p_source_id is null or length(p_source_id)>512 then
  raise exception 'Invalid CF order source' using errcode='22023';
 end if;
 select id into customer_id from public.customers
  where tenant_id=p_tenant_id and platform='facebook' and platform_user_id=p_customer_psid for update;
 if not found then raise exception 'Facebook customer not found' using errcode='P0002';end if;
 return query select * from public.place_cf_order_core(
  p_tenant_id,customer_id,null,p_code,p_source,p_source_id
 );
end $$;

revoke all on function public.place_cf_order_core(uuid,uuid,uuid,text,text,text)
 from public,anon,authenticated;
revoke all on function public.place_cf_order(uuid,uuid,uuid,text)
 from public,anon,authenticated;
revoke all on function public.place_cf_order(uuid,text,text,text,text)
 from public,anon,authenticated;
grant execute on function public.place_cf_order(uuid,uuid,uuid,text)
 to service_role;
grant execute on function public.place_cf_order(uuid,text,text,text,text)
 to service_role;
notify pgrst,'reload schema';
commit;
