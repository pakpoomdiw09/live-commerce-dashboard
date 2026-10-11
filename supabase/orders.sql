-- CF orders: products with a short code ("1", "A12") that customers type in chat.
-- Run after platform.sql, then run security.sql. Safe to re-run.

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  code text not null check (length(trim(code)) between 1 and 20),
  name text not null check (length(trim(name)) > 0),
  price numeric(12,2) not null check (price > 0),
  stock integer not null default 0 check (stock >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
-- codes are matched case-insensitively ("a12" = "A12"), once per tenant
create unique index if not exists products_tenant_code on products (tenant_id, lower(code));

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  product_name text not null,                     -- snapshot: the product may be renamed or deleted later
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'paid', 'cancelled', 'shipped')),
  message_id uuid references messages(id) on delete set null,  -- the chat message that placed it
  slip_id uuid references slips(id) on delete set null,        -- the slip that paid it
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists orders_tenant on orders (tenant_id, created_at desc);
create index if not exists orders_customer_pending on orders (customer_id) where status = 'pending_payment';
-- one order per chat message, even if the same event is processed twice
create unique index if not exists orders_one_per_message on orders (message_id);

-- policies: supabase/security.sql
alter table products enable row level security;
alter table orders enable row level security;

do $$ begin alter publication supabase_realtime add table orders; exception when duplicate_object then null; end $$;

/**
 * Place an order for the product whose code the customer typed. Stock is taken in the same
 * statement as the insert, so two customers can't both buy the last item.
 * r_status: 'created' | 'sold_out' | 'no_match'
 */
create or replace function place_cf_order(p_tenant uuid, p_customer uuid, p_message uuid, p_code text)
returns table (r_status text, r_order_id uuid, r_name text, r_code text, r_amount numeric)
language plpgsql as $$
declare
  p products%rowtype;
  new_id uuid;
begin
  select * into p from products
  where tenant_id = p_tenant and lower(code) = lower(trim(p_code)) and is_active;
  if not found then
    return query select 'no_match'::text, null::uuid, null::text, null::text, null::numeric;
    return;
  end if;

  update products set stock = stock - 1 where id = p.id and stock > 0;
  if not found then
    return query select 'sold_out'::text, null::uuid, p.name, p.code, p.price;
    return;
  end if;

  insert into orders (tenant_id, customer_id, product_id, product_name, amount, message_id)
  values (p_tenant, p_customer, p.id, p.name, p.price, p_message)
  returning id into new_id;
  return query select 'created'::text, new_id, p.name, p.code, p.price;
end $$;
-- only the webhook (service role) places orders
revoke execute on function place_cf_order(uuid, uuid, uuid, text) from public, anon, authenticated;
