-- Additive. Prerequisites: orders.sql, automation.sql (product description/image), billing.sql, security.sql.
-- Never run against production as a test. Disable feature flags to roll back; keep all rows.
begin;
create table if not exists commerce_limits (
 plan text primary key, max_products integer check(max_products>=0), max_pages integer not null default 1 check(max_pages>=0),
 checkout boolean not null default false, reports boolean not null default false, advanced_templates boolean not null default false
);
-- Existing product allowance was unlimited: do not silently reduce it.
insert into commerce_limits values('free',null,1,false,false,false),('starter',null,3,true,true,false),('pro',null,10,true,true,true) on conflict do nothing;
create table if not exists commerce_stores (
 tenant_id uuid primary key references tenants(id), slug text not null unique check(slug~'^[a-z0-9]+(-[a-z0-9]+)*$'),
 name text not null, description text not null default '', logo text not null default '', banner text not null default '', contact text not null default '',
 is_open boolean not null default false, updated_at timestamptz not null default now()
);
create table if not exists commerce_categories (id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),name text not null check(length(trim(name)) between 1 and 80),unique(tenant_id,name));
alter table products add column if not exists commerce_category_id uuid references commerce_categories(id);
alter table products add column if not exists commerce_images jsonb not null default '[]';
alter table products add column if not exists commerce_compare_price numeric(12,2);
alter table products add column if not exists commerce_cost numeric(12,2);
alter table products add column if not exists commerce_featured boolean not null default false;
alter table products add column if not exists commerce_archived boolean not null default false;
alter table products add column if not exists commerce_version integer not null default 0;
create table if not exists commerce_variants (id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),product_id uuid not null references products(id),label text not null,price numeric(12,2) not null check(price>0),stock integer not null check(stock>=0),is_active boolean not null default true);
create index if not exists commerce_variant_product on commerce_variants(tenant_id,product_id);
create table if not exists commerce_pages (id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),slug text not null,name text not null,draft jsonb not null,published jsonb,published_at timestamptz,version integer not null default 0,unique(tenant_id,slug));
create table if not exists commerce_customers (id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),name text not null,phone text not null,address text not null,crm_customer_id uuid references customers(id),created_at timestamptz not null default now(),unique(tenant_id,phone));
create table if not exists commerce_orders (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),customer_id uuid not null references commerce_customers(id),
 request_key uuid not null,payload jsonb not null,number text not null unique default ('SB-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,16))),
 status text not null default 'pending_payment' check(status in ('pending_payment','payment_review','paid','preparing','shipped','completed','cancelled')),
 total numeric(12,2) not null default 0,shipping jsonb not null,tracking text,created_at timestamptz not null default now(),paid_at timestamptz,unique(tenant_id,request_key)
);
create table if not exists commerce_order_items (id uuid primary key default gen_random_uuid(),order_id uuid not null references commerce_orders(id),tenant_id uuid not null references tenants(id),product_id uuid not null references products(id),variant_id uuid references commerce_variants(id),name text not null,variant_label text,qty integer not null check(qty between 1 and 99),price numeric(12,2) not null check(price>0));
create table if not exists commerce_audit (id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),actor_id uuid,entity_id uuid,action text not null,detail text not null default '',created_at timestamptz not null default now());
create table if not exists commerce_rate (bucket text not null,period bigint not null,hits integer not null default 1,primary key(bucket,period));
create index if not exists commerce_orders_recent on commerce_orders(tenant_id,created_at desc);
create index if not exists commerce_orders_customer on commerce_orders(tenant_id,customer_id);
create index if not exists commerce_items_order on commerce_order_items(order_id,product_id,variant_id);
create index if not exists commerce_audit_recent on commerce_audit(tenant_id,created_at desc);
create index if not exists commerce_rate_expiry on commerce_rate(period);
create index if not exists commerce_products_category on products(tenant_id,commerce_category_id) where not commerce_archived;
do $$declare t text;begin foreach t in array array['commerce_limits','commerce_stores','commerce_categories','commerce_variants','commerce_pages','commerce_customers','commerce_orders','commerce_order_items','commerce_audit','commerce_rate'] loop
 execute format('alter table %I enable row level security',t);execute format('revoke all on %I from public,anon,authenticated',t);execute format('grant all on %I to service_role',t);end loop;end$$;

create or replace function commerce_access(p_tenant uuid,p_actor uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$begin
 if not exists(select 1 from tenants where id=p_tenant and is_active) or not (exists(select 1 from tenant_members where tenant_id=p_tenant and user_id=p_actor and role in ('owner','admin')) or exists(select 1 from platform_admins where user_id=p_actor)) then raise exception 'COMMERCE_FORBIDDEN' using errcode='42501';end if;
end$$;
create or replace function commerce_plan(p_tenant uuid) returns commerce_limits language sql stable security definer set search_path=pg_catalog,public as $$
 select l.* from tenants t join commerce_limits l on l.plan=case when t.plan in ('starter','pro') and t.plan_expires_at>now() then t.plan else 'free' end where t.id=p_tenant and t.is_active
$$;
create or replace function commerce_rate_limit(p_bucket text,p_max integer) returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$declare n integer;window_period bigint:=floor(extract(epoch from clock_timestamp())/60);begin
 delete from commerce_rate where commerce_rate.period<window_period-10;
 insert into commerce_rate(bucket,period) values(p_bucket,window_period) on conflict(bucket,period) do update set hits=commerce_rate.hits+1 returning hits into n;return n<=p_max;
end$$;
create or replace function commerce_product_version() returns trigger language plpgsql set search_path=pg_catalog,public as $$begin new.commerce_version:=old.commerce_version+1;return new;end$$;
drop trigger if exists commerce_product_version on products;
create trigger commerce_product_version before update on products for each row execute function commerce_product_version();
-- The same configured quota also applies to legacy browser inserts, not only the new API.
create or replace function commerce_product_quota() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$declare l commerce_limits;begin
 perform 1 from tenants where id=new.tenant_id for update;l:=commerce_plan(new.tenant_id);
 if l.max_products is not null and (select count(*) from products where tenant_id=new.tenant_id and not commerce_archived)>=l.max_products then raise exception 'COMMERCE_LIMIT' using errcode='42501';end if;return new;
end$$;
drop trigger if exists commerce_product_quota on products;
create trigger commerce_product_quota before insert on products for each row execute function commerce_product_quota();

create or replace function commerce_save_product(p_tenant uuid,p_actor uuid,p_id uuid,p_value jsonb,p_version integer default null) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r products;l commerce_limits;v jsonb;vid uuid;pid uuid:=coalesce(p_id,gen_random_uuid());kept uuid[]:='{}';begin
 perform commerce_access(p_tenant,p_actor);perform 1 from tenants where id=p_tenant for update;l:=commerce_plan(p_tenant);
 if p_id is not null then select * into r from products where id=p_id and tenant_id=p_tenant and not commerce_archived for update;
  if not found or r.commerce_version is distinct from p_version then raise exception 'COMMERCE_CHANGED' using errcode='40001';end if;
 elsif l.max_products is not null and (select count(*) from products where tenant_id=p_tenant and not commerce_archived)>=l.max_products then raise exception 'COMMERCE_LIMIT' using errcode='42501';end if;
 if p_value->>'category_id' is not null and not exists(select 1 from commerce_categories where id=(p_value->>'category_id')::uuid and tenant_id=p_tenant) then raise exception 'COMMERCE_CATEGORY';end if;
 if p_id is null then insert into products(id,tenant_id,code,name,price,stock) values(pid,p_tenant,p_value->>'code',p_value->>'name',(p_value->>'price')::numeric,0);end if;
 update products set code=p_value->>'code',name=p_value->>'name',description=nullif(p_value->>'description',''),price=(p_value->>'price')::numeric,stock=(p_value->>'stock')::integer,is_active=(p_value->>'is_active')::boolean,
 image_url=p_value->'images'->>0,commerce_images=p_value->'images',commerce_category_id=(p_value->>'category_id')::uuid,commerce_compare_price=(p_value->>'compare_price')::numeric,commerce_cost=(p_value->>'cost')::numeric,commerce_featured=(p_value->>'featured')::boolean where id=pid;
 for v in select * from jsonb_array_elements(p_value->'variants') loop
  vid:=coalesce((v->>'id')::uuid,gen_random_uuid());
  if exists(select 1 from commerce_variants where id=vid and (tenant_id<>p_tenant or product_id<>pid)) then raise exception 'COMMERCE_FORBIDDEN';end if;
  insert into commerce_variants(id,tenant_id,product_id,label,price,stock) values(vid,p_tenant,pid,v->>'label',(v->>'price')::numeric,(v->>'stock')::integer)
   on conflict(id) do update set label=excluded.label,price=excluded.price,stock=excluded.stock,is_active=true;kept:=array_append(kept,vid);
 end loop;
 update commerce_variants set is_active=false where product_id=pid and not(id=any(kept));
 insert into commerce_audit(tenant_id,actor_id,entity_id,action) values(p_tenant,p_actor,pid,'product_saved');return pid;
end$$;

create or replace function commerce_checkout(p_slug text,p_value jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s commerce_stores;l commerce_limits;o commerce_orders;c uuid;item jsonb;p products;v commerce_variants;price numeric;order_total numeric:=0;oid uuid;qty integer;label text;begin
 select * into s from commerce_stores where slug=p_slug; if not found then raise exception 'COMMERCE_CLOSED';end if;
 -- Shared tenant lock serializes with plan/store/product management and checkout.
 perform 1 from tenants where id=s.tenant_id for update;l:=commerce_plan(s.tenant_id);
 select * into s from commerce_stores where tenant_id=s.tenant_id;
 select * into o from commerce_orders where tenant_id=s.tenant_id and request_key=(p_value->>'key')::uuid;
 if found then if o.payload is distinct from p_value then raise exception 'COMMERCE_IDEMPOTENCY' using errcode='40001';end if;return jsonb_build_object('number',o.number,'total',o.total,'status',o.status);end if;
 if not s.is_open or l.checkout is distinct from true then raise exception 'COMMERCE_CLOSED';end if;
 if jsonb_array_length(p_value->'items') not between 1 and 30 then raise exception 'COMMERCE_CART';end if;
 insert into commerce_customers(tenant_id,name,phone,address) values(s.tenant_id,p_value->>'name',p_value->>'phone',p_value->>'address') on conflict(tenant_id,phone) do update set name=excluded.name,address=excluded.address returning id into c;
 insert into commerce_orders(tenant_id,customer_id,request_key,payload,shipping) values(s.tenant_id,c,(p_value->>'key')::uuid,p_value,p_value-'items'-'key') returning id into oid;
 for item in select * from jsonb_array_elements(p_value->'items') order by value->>'product_id',value->>'variant_id' loop
  qty:=(item->>'qty')::integer;if qty not between 1 and 99 then raise exception 'COMMERCE_CART';end if;
  select * into p from products where id=(item->>'product_id')::uuid and tenant_id=s.tenant_id and is_active and not commerce_archived for update;
  if not found or p.stock<qty then raise exception 'COMMERCE_STOCK';end if;price:=p.price;label:=null;v:=null;
  if item->>'variant_id' is not null then
   select * into v from commerce_variants where id=(item->>'variant_id')::uuid and product_id=p.id and tenant_id=s.tenant_id and is_active for update;
   if not found or v.stock<qty then raise exception 'COMMERCE_STOCK';end if;price:=v.price;label:=v.label;
   update commerce_variants set stock=stock-qty where id=v.id;
  elsif exists(select 1 from commerce_variants where product_id=p.id and is_active) then raise exception 'COMMERCE_VARIANT_REQUIRED';end if;
  update products set stock=stock-qty where id=p.id;
  insert into commerce_order_items(order_id,tenant_id,product_id,variant_id,name,variant_label,qty,price) values(oid,s.tenant_id,p.id,v.id,p.name,label,qty,price);order_total:=order_total+price*qty;
 end loop;
 update commerce_orders set total=order_total where id=oid returning * into o;
 insert into commerce_audit(tenant_id,entity_id,action) values(s.tenant_id,oid,'order_created');
 return jsonb_build_object('number',o.number,'total',o.total,'status',o.status);
end$$;

create or replace function commerce_move_order(p_tenant uuid,p_actor uuid,p_id uuid,p_status text,p_note text) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare o commerce_orders;i commerce_order_items;l commerce_limits;begin
 perform commerce_access(p_tenant,p_actor);perform 1 from tenants where id=p_tenant for update;l:=commerce_plan(p_tenant);if l.checkout is distinct from true then raise exception 'COMMERCE_PLAN';end if;
 select * into o from commerce_orders where id=p_id and tenant_id=p_tenant for update;if not found then raise exception 'COMMERCE_NOT_FOUND';end if;
 if o.status=p_status then return;end if;
 if not ((o.status='pending_payment' and p_status in ('payment_review','cancelled')) or (o.status='payment_review' and p_status in ('pending_payment','paid','cancelled')) or (o.status='paid' and p_status in ('preparing','cancelled')) or (o.status='preparing' and p_status in ('shipped','cancelled')) or (o.status='shipped' and p_status='completed')) then raise exception 'COMMERCE_TRANSITION';end if;
 if length(trim(p_note))<5 then raise exception 'COMMERCE_EVIDENCE_REQUIRED';end if;
 if p_status='cancelled' then
  for i in select * from commerce_order_items where order_id=o.id order by product_id,variant_id loop update products set stock=stock+i.qty where id=i.product_id;if i.variant_id is not null then update commerce_variants set stock=stock+i.qty where id=i.variant_id;end if;end loop;
 end if;
 update commerce_orders set status=p_status,paid_at=case when p_status='paid' then clock_timestamp() else paid_at end,tracking=case when p_status='shipped' then p_note else tracking end where id=o.id;
 insert into commerce_audit(tenant_id,actor_id,entity_id,action,detail) values(p_tenant,p_actor,o.id,'order_'||p_status,p_note);
end$$;

-- Atomic dashboard mutations, scoped and audited. Validated payloads enter only via server routes.
create or replace function commerce_manage(p_tenant uuid,p_actor uuid,p_action text,p_value jsonb) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare entity uuid;l commerce_limits;pg commerce_pages;begin
 perform commerce_access(p_tenant,p_actor);perform 1 from tenants where id=p_tenant for update;l:=commerce_plan(p_tenant);
 if p_action='store' then
  insert into commerce_stores(tenant_id,slug,name,description,logo,banner,contact,is_open) values(p_tenant,p_value->>'slug',p_value->>'name',p_value->>'description',p_value->>'logo',p_value->>'banner',p_value->>'contact',(p_value->>'is_open')::boolean)
  on conflict(tenant_id) do update set slug=excluded.slug,name=excluded.name,description=excluded.description,logo=excluded.logo,banner=excluded.banner,contact=excluded.contact,is_open=excluded.is_open,updated_at=now();entity:=p_tenant;
 elsif p_action='category' then
  entity:=coalesce((p_value->>'id')::uuid,gen_random_uuid());if p_value->>'id' is not null and not exists(select 1 from commerce_categories where id=entity and tenant_id=p_tenant) then raise exception 'COMMERCE_NOT_FOUND';end if;
  insert into commerce_categories(id,tenant_id,name) values(entity,p_tenant,p_value->>'name') on conflict(id) do update set name=excluded.name;
 elsif p_action='category_delete' then
  entity:=(p_value->>'id')::uuid;update products set commerce_category_id=null where tenant_id=p_tenant and commerce_category_id=entity;delete from commerce_categories where id=entity and tenant_id=p_tenant;
 elsif p_action='archive' then
  entity:=(p_value->>'id')::uuid;update products set commerce_archived=true,is_active=false where id=entity and tenant_id=p_tenant;if not found then raise exception 'COMMERCE_NOT_FOUND';end if;
 elsif p_action in ('page','publish','unpublish') then
  entity:=coalesce((p_value->>'id')::uuid,gen_random_uuid());
  select * into pg from commerce_pages where id=entity and tenant_id=p_tenant for update;
  if p_value->>'id' is not null and (not found or pg.version is distinct from (p_value->>'version')::integer) then raise exception 'COMMERCE_CHANGED' using errcode='40001';end if;
  if p_action='page' then
   if pg.id is null and (select count(*) from commerce_pages where tenant_id=p_tenant)>=l.max_pages then raise exception 'COMMERCE_LIMIT';end if;
   insert into commerce_pages(id,tenant_id,slug,name,draft) values(entity,p_tenant,p_value->>'slug',p_value->>'name',p_value->'design') on conflict(id) do update set slug=excluded.slug,name=excluded.name,draft=excluded.draft,version=commerce_pages.version+1;
  elsif p_action='publish' then
   if l.max_pages<1 or (select count(*) from commerce_pages where tenant_id=p_tenant and published is not null and id<>entity)>=l.max_pages then raise exception 'COMMERCE_LIMIT';end if;
   update commerce_pages set published=draft,published_at=clock_timestamp(),version=version+1 where id=entity and tenant_id=p_tenant;
  else update commerce_pages set published=null,published_at=null,version=version+1 where id=entity and tenant_id=p_tenant;end if;
 else raise exception 'COMMERCE_ACTION';end if;
 insert into commerce_audit(tenant_id,actor_id,entity_id,action) values(p_tenant,p_actor,entity,p_action);return entity;
end$$;
-- CF cannot choose a color/size. Keep the old result contract, but don't sell an
-- unspecified variant at the parent's price. Non-variant CF products are unchanged.
create or replace function place_cf_order(p_tenant uuid,p_customer uuid,p_message uuid,p_code text)
returns table(r_status text,r_order_id uuid,r_name text,r_code text,r_amount numeric)
language plpgsql set search_path=pg_catalog,public as $$declare p products;new_id uuid;begin
 select * into p from products where tenant_id=p_tenant and lower(code)=lower(trim(p_code)) and is_active for update;
 if not found or exists(select 1 from commerce_variants where product_id=p.id and is_active) then
  return query select 'no_match'::text,null::uuid,null::text,null::text,null::numeric;return;end if;
 update products set stock=stock-1 where id=p.id and stock>0;
 if not found then return query select 'sold_out'::text,null::uuid,p.name,p.code,p.price;return;end if;
 insert into orders(tenant_id,customer_id,product_id,product_name,amount,message_id) values(p_tenant,p_customer,p.id,p.name,p.price,p_message) returning id into new_id;
 return query select 'created'::text,new_id,p.name,p.code,p.price;
end$$;
revoke execute on function place_cf_order(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function place_cf_order(uuid,uuid,uuid,text) to service_role;
do $$declare r record;begin for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('commerce_access','commerce_plan','commerce_rate_limit','commerce_save_product','commerce_checkout','commerce_move_order','commerce_manage') loop
 execute format('revoke all on function %s from public,anon,authenticated',r.signature);execute format('grant execute on function %s to service_role',r.signature);end loop;end$$;
commit;
