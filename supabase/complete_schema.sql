-- GENERATED: node scripts/build-full-database-setup.cjs

-- COMPLETE SCHEMA: run this entire file once in Supabase SQL Editor as postgres.

-- Atomic install/upgrade. Re-running an unchanged bundle skips applied migrations.

-- Every real migration is ordered by the shared registry; diagnostics/reset/rollback/QA are excluded.

-- Preserves application rows, custom settings, credits and proof ledgers; does not send messages.

-- Historical job/config backfills are omitted. Proof-ledger integrity backfills are retained.

-- Supabase-managed auth/storage/roles/Realtime must already exist.

begin;

set local lock_timeout='5s';

set local statement_timeout='120s';

set local search_path=public,extensions;

select pg_advisory_xact_lock(1397637456,1);

do $platform_prerequisites$ begin
  if to_regclass('auth.users') is null or to_regclass('storage.buckets') is null
    or to_regclass('storage.objects') is null
    or not exists(select 1 from pg_publication where pubname='supabase_realtime')
    or (select count(*) from pg_roles where rolname in ('anon','authenticated','service_role')) <> 3 then
    raise exception 'Supabase platform prerequisites missing (auth/storage/roles/Realtime). No application DDL has run';
  end if;
end $platform_prerequisites$;

create table if not exists public.snapbot_schema_migrations(
  name text primary key, checksum text not null check(checksum~'^[0-9a-f]{64}$'),
  source_sha256 text not null check(source_sha256~'^[0-9a-f]{64}$'),
  applied_at timestamptz not null default clock_timestamp()
);

alter table public.snapbot_schema_migrations enable row level security;

revoke all on public.snapbot_schema_migrations from public,anon,authenticated,service_role;

grant select on public.snapbot_schema_migrations to service_role;

-- 01. schema.sql
do $migration_0$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='schema.sql';
  if found then
    if installed <> 'ba8bdecf1e924d7a19c2c8722310f59b209bcd615bb57922ff84edfc4ad711c0' then
      raise exception 'Applied migration changed: schema.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- schema.sql: source statement 1
execute $sql_0_1$create extension if not exists pgcrypto$sql_0_1$;

-- schema.sql: source statement 2
execute $sql_0_2$create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  platform text not null default 'facebook',
  platform_user_id text not null,
  display_name text,
  bot_enabled boolean not null default true,      
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  unique (platform, platform_user_id)
)$sql_0_2$;

-- schema.sql: source statement 3
execute $sql_0_3$create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  external_id text unique,                        
  sender text not null check (sender in ('customer', 'bot', 'agent')),
  body text,
  attachments jsonb not null default '[]',
  created_at timestamptz not null default now()
)$sql_0_3$;

-- schema.sql: source statement 4
execute $sql_0_4$create index if not exists messages_customer_created on messages (customer_id, created_at)$sql_0_4$;

-- schema.sql: source statement 5
execute $sql_0_5$create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete set null,
  external_id text not null unique,               
  post_id text,
  author_name text,
  body text,
  created_at timestamptz not null default now()
)$sql_0_5$;

-- schema.sql: source statement 6
execute $sql_0_6$create index if not exists comments_created on comments (created_at desc)$sql_0_6$;

-- schema.sql: source statement 7
execute $sql_0_7$create table if not exists slips (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete set null,
  image_path text,                                
  expected_amount numeric(12,2),
  amount numeric(12,2),
  trans_ref text,                                 
  status text not null default 'pending'
    check (status in ('pending', 'valid', 'amount_mismatch', 'duplicate', 'fake', 'wrong_receiver', 'error')),
  note text,
  raw jsonb,                                      
  created_at timestamptz not null default now(),
  verified_at timestamptz
)$sql_0_7$;

-- schema.sql: source statement 8
execute $sql_0_8$create index if not exists slips_created on slips (created_at desc)$sql_0_8$;

-- schema.sql: source statement 9
execute $sql_0_9$create unique index if not exists slips_one_valid_per_ref on slips (trans_ref) where status = 'valid'$sql_0_9$;

-- schema.sql: source statement 10
execute $sql_0_10$alter table customers enable row level security$sql_0_10$;

-- schema.sql: source statement 11
execute $sql_0_11$alter table messages  enable row level security$sql_0_11$;

-- schema.sql: source statement 12
execute $sql_0_12$alter table comments  enable row level security$sql_0_12$;

-- schema.sql: source statement 13
execute $sql_0_13$alter table slips     enable row level security$sql_0_13$;

-- schema.sql: source statement 14
execute $sql_0_14$do $$ begin alter publication supabase_realtime add table customers; exception when duplicate_object then null; end $$$sql_0_14$;

-- schema.sql: source statement 15
execute $sql_0_15$do $$ begin alter publication supabase_realtime add table messages;  exception when duplicate_object then null; end $$$sql_0_15$;

-- schema.sql: source statement 16
execute $sql_0_16$do $$ begin alter publication supabase_realtime add table comments;  exception when duplicate_object then null; end $$$sql_0_16$;

-- schema.sql: source statement 17
execute $sql_0_17$do $$ begin alter publication supabase_realtime add table slips;     exception when duplicate_object then null; end $$$sql_0_17$;

-- schema.sql: source statement 18
execute $sql_0_18$insert into storage.buckets (id, name, public) values ('slips', 'slips', false) on conflict do nothing$sql_0_18$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('schema.sql','ba8bdecf1e924d7a19c2c8722310f59b209bcd615bb57922ff84edfc4ad711c0','6e212f1732cf6b5fe4e1b7d5f4e1d56c6cdcc7f6ccc950e71bc0446fd12454bc');
end $migration_0$;

-- 02. tenants.sql
do $migration_1$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='tenants.sql';
  if found then
    if installed <> '9816969b150e794555b5c5c281c614a45722662f2d0dc07098afe2cfb68fce42' then
      raise exception 'Applied migration changed: tenants.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- tenants.sql: source statement 1
execute $sql_1_1$create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  bank_code text not null,                        
  account_number text not null
    check (account_number ~ '^[0-9]+$'),          
  created_at timestamptz not null default now()
)$sql_1_1$;

-- tenants.sql: source statement 2
execute $sql_1_2$alter table slips add column if not exists tenant_id uuid references tenants(id) on delete set null$sql_1_2$;

-- tenants.sql: source statement 3
execute $sql_1_3$create index if not exists slips_tenant on slips (tenant_id, created_at desc)$sql_1_3$;

-- tenants.sql: source statement 4
execute $sql_1_4$alter table tenants enable row level security$sql_1_4$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('tenants.sql','9816969b150e794555b5c5c281c614a45722662f2d0dc07098afe2cfb68fce42','a21e1e3b29b2c68df7fcd1d388ec93aeab63f22140a3cb4546dc50195e23b0e7');
end $migration_1$;

-- 03. comment-rules.sql
do $migration_2$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='comment-rules.sql';
  if found then
    if installed <> 'ebb2c35430a261abd202f4f9f05c62c341c09ec9df3d32ae67a656bffc2ae8a3' then
      raise exception 'Applied migration changed: comment-rules.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- comment-rules.sql: source statement 1
execute $sql_2_1$create table if not exists comment_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  page_ids text[] not null default '{}',          
  match_type text not null default 'keyword'
    check (match_type in ('exact', 'keyword')),   
  keywords text[] not null default '{}',
  reply_enabled boolean not null default true,    
  reply_text text,
  inbox_enabled boolean not null default false,   
  inbox_type text not null default 'text' check (inbox_type in ('text', 'image')),
  inbox_text text,
  inbox_image_url text,                           
  is_active boolean not null default true,
  created_at timestamptz not null default now()
)$sql_2_1$;

-- comment-rules.sql: source statement 2
execute $sql_2_2$create index if not exists comment_rules_pages on comment_rules using gin (page_ids)$sql_2_2$;

-- comment-rules.sql: source statement 3
execute $sql_2_3$alter table comments add column if not exists rule_id uuid references comment_rules(id) on delete set null$sql_2_3$;

-- comment-rules.sql: source statement 4
execute $sql_2_4$create index if not exists comments_rule on comments (rule_id)$sql_2_4$;

-- comment-rules.sql: source statement 5
execute $sql_2_5$alter table comment_rules enable row level security$sql_2_5$;

-- comment-rules.sql: source statement 6
execute $sql_2_6$insert into storage.buckets (id, name, public) values ('comment-media', 'comment-media', true) on conflict do nothing$sql_2_6$;

-- comment-rules.sql: source statement 7
execute $sql_2_7$drop policy if exists staff_upload_comment_media on storage.objects$sql_2_7$;

-- comment-rules.sql: source statement 8
execute $sql_2_8$create policy staff_upload_comment_media on storage.objects
  for insert to authenticated with check (bucket_id = 'comment-media')$sql_2_8$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('comment-rules.sql','ebb2c35430a261abd202f4f9f05c62c341c09ec9df3d32ae67a656bffc2ae8a3','f694088e9cbb3a8249df863d4d73715d56a9b427c61f832ad69b859f82740aa8');
end $migration_2$;

-- 04. platform.sql
do $migration_3$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='platform.sql';
  if found then
    if installed <> '46fa418d7c1c18fc72f69d020b65c926718c7d711c4e0248a4999b4e14001ada' then
      raise exception 'Applied migration changed: platform.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- platform.sql: source statement 1
execute $sql_3_1$alter table tenants add column if not exists account_name text$sql_3_1$;

-- platform.sql: source statement 2
execute $sql_3_2$alter table tenants add column if not exists page_id text unique$sql_3_2$;

-- platform.sql: source statement 3
execute $sql_3_3$alter table tenants add column if not exists expected_amount numeric(12,2)
  check (expected_amount is null or expected_amount > 0)$sql_3_3$;

-- platform.sql: source statement 4
execute $sql_3_4$alter table tenants add column if not exists auto_reply_enabled boolean not null default true$sql_3_4$;

-- platform.sql: source statement 5
execute $sql_3_5$alter table tenants add column if not exists auto_verify_enabled boolean not null default true$sql_3_5$;

-- platform.sql: source statement 6
execute $sql_3_6$alter table tenants add column if not exists slip_quota integer not null default 500 check (slip_quota >= 0)$sql_3_6$;

-- platform.sql: source statement 7
execute $sql_3_7$alter table tenants add column if not exists slip_used integer not null default 0 check (slip_used >= 0)$sql_3_7$;

-- platform.sql: source statement 8
execute $sql_3_8$alter table customers add column if not exists tenant_id uuid references tenants(id) on delete set null$sql_3_8$;

-- platform.sql: source statement 9
execute $sql_3_9$alter table customers add column if not exists phone text$sql_3_9$;

-- platform.sql: source statement 10
execute $sql_3_10$alter table customers add column if not exists address text$sql_3_10$;

-- platform.sql: source statement 11
execute $sql_3_11$alter table customers add column if not exists tags text[] not null default '{}'$sql_3_11$;

-- platform.sql: source statement 12
execute $sql_3_12$alter table customers add column if not exists notes text$sql_3_12$;

-- platform.sql: source statement 13
execute $sql_3_13$alter table customers add column if not exists order_status text not null default 'new'$sql_3_13$;

-- platform.sql: source statement 14
execute $sql_3_14$alter table customers add column if not exists last_interaction_at timestamptz$sql_3_14$;

-- platform.sql: source statement 15
execute $sql_3_15$do $$ begin
  alter table customers add constraint customers_order_status_check
    check (order_status in ('new', 'pending_review', 'paid', 'approved', 'shipped'));
exception when duplicate_object then null; end $$$sql_3_15$;

-- platform.sql: source statement 16
execute $sql_3_16$create index if not exists customers_tenant on customers (tenant_id, last_message_at desc)$sql_3_16$;

-- platform.sql: source statement 17
execute $sql_3_17$alter table slips add column if not exists message_id uuid references messages(id) on delete set null$sql_3_17$;

-- platform.sql: source statement 18
execute $sql_3_18$alter table slips add column if not exists approved_at timestamptz$sql_3_18$;

-- platform.sql: source statement 19
execute $sql_3_19$alter table slips add column if not exists approved_by uuid references auth.users(id) on delete set null$sql_3_19$;

-- platform.sql: source statement 20
execute $sql_3_20$alter table slips add column if not exists confirmed_at timestamptz$sql_3_20$;

-- platform.sql: source statement 21
execute $sql_3_21$create index if not exists slips_customer on slips (customer_id, created_at desc)$sql_3_21$;

-- platform.sql: source statement 22
execute $sql_3_22$create index if not exists slips_message on slips (message_id)$sql_3_22$;

-- platform.sql: source statement 23
begin
execute $sql_3_23$create or replace function consume_slip_credit(p_tenant uuid) returns boolean
language sql as $$
  with taken as (
    update tenants set slip_used = slip_used + 1
    where id = p_tenant and slip_used < slip_quota
    returning 1
  )
  select exists (select 1 from taken)
$$$sql_3_23$;
exception when invalid_function_definition then
  -- A newer signature of consume_slip_credit(uuid) is already installed. Its final definition below is mandatory.
  null;
end;

-- platform.sql: source statement 24
execute $sql_3_24$revoke execute on function consume_slip_credit(uuid) from public, anon, authenticated$sql_3_24$;

-- platform.sql: source statement 25
begin
execute $sql_3_25$create or replace function refund_slip_credit(p_tenant uuid) returns void
language sql as $$
  update tenants set slip_used = slip_used - 1 where id = p_tenant and slip_used > 0
$$$sql_3_25$;
exception when invalid_function_definition then
  -- A newer signature of refund_slip_credit(uuid) is already installed. Its final definition below is mandatory.
  null;
end;

-- platform.sql: source statement 26
execute $sql_3_26$revoke execute on function refund_slip_credit(uuid) from public, anon, authenticated$sql_3_26$;

-- platform.sql: source statement 27
execute $sql_3_27$alter table tenants add column if not exists page_access_token text$sql_3_27$;

-- platform.sql: source statement 28
execute $sql_3_28$alter table tenants add column if not exists page_token_set boolean
  generated always as (page_access_token is not null) stored$sql_3_28$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('platform.sql','46fa418d7c1c18fc72f69d020b65c926718c7d711c4e0248a4999b4e14001ada','4c2c2632ae8de14a33ff67902756d6abac54df6718bb892b2affddbb2d70f8d3');
end $migration_3$;

-- 05. schema_patch.sql
do $migration_4$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='schema_patch.sql';
  if found then
    if installed <> 'dc8b0637d5a62ce883fe85f9f709a83df904befffdb0d216fb349093f8f25e8a' then
      raise exception 'Applied migration changed: schema_patch.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- schema_patch.sql: source statement 2
execute $sql_4_2$alter table comments
  add column if not exists tenant_id uuid references tenants(id) on delete set null$sql_4_2$;

-- schema_patch.sql: source statement 3
execute $sql_4_3$create index if not exists comments_tenant on comments (tenant_id, created_at desc)$sql_4_3$;

-- schema_patch.sql: source statement 4
execute $sql_4_4$alter table comment_rules
  add column if not exists tenant_id uuid references tenants(id) on delete cascade$sql_4_4$;

-- schema_patch.sql: source statement 5
execute $sql_4_5$create index if not exists comment_rules_tenant on comment_rules (tenant_id)$sql_4_5$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('schema_patch.sql','dc8b0637d5a62ce883fe85f9f709a83df904befffdb0d216fb349093f8f25e8a','85060b3c689c124f0b44a262f39519e4c70b9f9b82500cd3450a2e70ffb46c29');
end $migration_4$;

-- 06. orders.sql
do $migration_5$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='orders.sql';
  if found then
    if installed <> '192bb81bd932d2933656ad1ba26cd71cf764c3a7b2e9d74ca0605ed7d6c22378' then
      raise exception 'Applied migration changed: orders.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- orders.sql: source statement 1
execute $sql_5_1$create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  code text not null check (length(trim(code)) between 1 and 20),
  name text not null check (length(trim(name)) > 0),
  price numeric(12,2) not null check (price > 0),
  stock integer not null default 0 check (stock >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
)$sql_5_1$;

-- orders.sql: source statement 2
execute $sql_5_2$create unique index if not exists products_tenant_code on products (tenant_id, lower(code))$sql_5_2$;

-- orders.sql: source statement 3
execute $sql_5_3$create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  product_name text not null,                     
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'paid', 'cancelled', 'shipped')),
  message_id uuid references messages(id) on delete set null,  
  slip_id uuid references slips(id) on delete set null,        
  paid_at timestamptz,
  created_at timestamptz not null default now()
)$sql_5_3$;

-- orders.sql: source statement 4
execute $sql_5_4$create index if not exists orders_tenant on orders (tenant_id, created_at desc)$sql_5_4$;

-- orders.sql: source statement 5
execute $sql_5_5$create index if not exists orders_customer_pending on orders (customer_id) where status = 'pending_payment'$sql_5_5$;

-- orders.sql: source statement 6
execute $sql_5_6$create unique index if not exists orders_one_per_message on orders (message_id)$sql_5_6$;

-- orders.sql: source statement 7
execute $sql_5_7$alter table products enable row level security$sql_5_7$;

-- orders.sql: source statement 8
execute $sql_5_8$alter table orders enable row level security$sql_5_8$;

-- orders.sql: source statement 9
execute $sql_5_9$do $$ begin alter publication supabase_realtime add table orders; exception when duplicate_object then null; end $$$sql_5_9$;

-- orders.sql: source statement 10
begin
execute $sql_5_10$create or replace function place_cf_order(p_tenant uuid, p_customer uuid, p_message uuid, p_code text)
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
end $$$sql_5_10$;
exception when invalid_function_definition then
  -- A newer signature of place_cf_order(uuid,uuid,uuid,text) is already installed. Its final definition below is mandatory.
  null;
end;

-- orders.sql: source statement 11
execute $sql_5_11$revoke execute on function place_cf_order(uuid, uuid, uuid, text) from public, anon, authenticated$sql_5_11$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('orders.sql','192bb81bd932d2933656ad1ba26cd71cf764c3a7b2e9d74ca0605ed7d6c22378','b8d76d6e4dbb3539beb41a4eb89dab77e49b3bf3c111b3c3e30832151a0c6964');
end $migration_5$;

-- 07. automation.sql
do $migration_6$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='automation.sql';
  if found then
    if installed <> '3b38193fdb7cbe163a7d37458417fd8e8e8eed93a802c36a7c7f76fcca8ca1b2' then
      raise exception 'Applied migration changed: automation.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- automation.sql: source statement 1
execute $sql_6_1$create table if not exists bot_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  reply_mode text not null default 'keyword' check (reply_mode in ('keyword', 'ai')),
  ai_instructions text check (length(ai_instructions) <= 8000),   
  fallback_text text check (length(fallback_text) <= 2000),       
  handover_keywords text[] not null default '{แอดมิน,คุยกับแอดมิน,ติดต่อแอดมิน,ขอคุยกับคน}',
  handover_text text check (length(handover_text) <= 2000)
    default 'รับทราบค่ะ แอดมินจะเข้ามาตอบโดยเร็วที่สุดนะคะ 🙏',
  followup_enabled boolean not null default false,
  
  followup_steps jsonb not null default '[
    {"delay_minutes": 15, "text": "คุณ {ชื่อลูกค้า} ยังไม่ได้ส่งสลิปสำหรับยอด {ยอดเงิน} บาทนะคะ โอนแล้วส่งสลิปในแชทนี้ได้เลยค่ะ"},
    {"delay_minutes": 60, "text": "แจ้งเตือนอีกครั้งค่ะ ออเดอร์ยอด {ยอดเงิน} บาท ยังรอการชำระเงิน หากต้องการยกเลิกแจ้งแอดมินได้เลยนะคะ"}
  ]'::jsonb
    check (jsonb_typeof(followup_steps) = 'array' and jsonb_array_length(followup_steps) <= 5),
  updated_at timestamptz not null default now()
)$sql_6_1$;

-- automation.sql: source statement 2
execute $sql_6_2$create table if not exists chat_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  match_type text not null default 'keyword' check (match_type in ('exact', 'keyword')),
  keywords text[] not null default '{}',
  reply_type text not null default 'text' check (reply_type in ('text', 'image')),
  reply_text text check (length(reply_text) <= 2000),
  image_url text,                                   
  quick_replies text[] not null default '{}'        
    check (cardinality(quick_replies) <= 13),
  priority integer not null default 0,              
  is_active boolean not null default true,
  hit_count integer not null default 0,
  created_at timestamptz not null default now()
)$sql_6_2$;

-- automation.sql: source statement 3
execute $sql_6_3$create index if not exists chat_rules_tenant on chat_rules (tenant_id, is_active, priority desc)$sql_6_3$;

-- automation.sql: source statement 4
execute $sql_6_4$create or replace function bump_chat_rule(p_rule uuid) returns void
language sql as $$ update chat_rules set hit_count = hit_count + 1 where id = p_rule $$$sql_6_4$;

-- automation.sql: source statement 5
execute $sql_6_5$revoke execute on function bump_chat_rule(uuid) from public, anon, authenticated$sql_6_5$;

-- automation.sql: source statement 6
execute $sql_6_6$alter table customers add column if not exists handover_at timestamptz$sql_6_6$;

-- automation.sql: source statement 7
execute $sql_6_7$create index if not exists customers_handover on customers (tenant_id, handover_at) where handover_at is not null$sql_6_7$;

-- automation.sql: source statement 8
execute $sql_6_8$create or replace function clear_handover() returns trigger language plpgsql as $$
begin
  if new.bot_enabled and not old.bot_enabled then new.handover_at := null; end if;
  return new;
end $$$sql_6_8$;

-- automation.sql: source statement 9
execute $sql_6_9$drop trigger if exists customers_clear_handover on customers$sql_6_9$;

-- automation.sql: source statement 10
execute $sql_6_10$create trigger customers_clear_handover before update of bot_enabled on customers
  for each row execute function clear_handover()$sql_6_10$;

-- automation.sql: source statement 11
execute $sql_6_11$create table if not exists follow_up_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  step smallint not null,
  text text not null,
  run_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'sent', 'cancelled', 'failed')),
  reason text,                                      
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (order_id, step)
)$sql_6_11$;

-- automation.sql: source statement 12
execute $sql_6_12$create index if not exists follow_up_jobs_due on follow_up_jobs (run_at) where status = 'scheduled'$sql_6_12$;

-- automation.sql: source statement 13
execute $sql_6_13$create index if not exists follow_up_jobs_tenant on follow_up_jobs (tenant_id, created_at desc)$sql_6_13$;

-- automation.sql: source statement 14
execute $sql_6_14$create index if not exists follow_up_jobs_customer on follow_up_jobs (customer_id) where status = 'scheduled'$sql_6_14$;

-- automation.sql: source statement 15
begin
execute $sql_6_15$create or replace function schedule_follow_ups() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s bot_settings%rowtype;
  st jsonb;
  i int := 0;
begin
  if new.status <> 'pending_payment' then return new; end if;
  select * into s from bot_settings where tenant_id = new.tenant_id;
  if not found or not s.followup_enabled then return new; end if;

  update follow_up_jobs set status = 'cancelled', reason = 'superseded'
  where customer_id = new.customer_id and status = 'scheduled';

  for st in select value from jsonb_array_elements(s.followup_steps) loop
    i := i + 1;
    continue when coalesce(trim(st->>'text'), '') = ''
      or coalesce((st->>'delay_minutes')::int, 0) not between 1 and 1380;
    insert into follow_up_jobs (tenant_id, customer_id, order_id, step, text, run_at)
    values (new.tenant_id, new.customer_id, new.id, i, st->>'text',
            new.created_at + make_interval(mins => (st->>'delay_minutes')::int))
    on conflict (order_id, step) do nothing;
  end loop;
  return new;
end $$$sql_6_15$;
exception when invalid_function_definition then
  -- A newer signature of schedule_follow_ups() is already installed. Its final definition below is mandatory.
  null;
end;

-- automation.sql: source statement 16
execute $sql_6_16$drop trigger if exists orders_schedule_follow_ups on orders$sql_6_16$;

-- automation.sql: source statement 17
execute $sql_6_17$create trigger orders_schedule_follow_ups after insert on orders
  for each row execute function schedule_follow_ups()$sql_6_17$;

-- automation.sql: source statement 18
begin
execute $sql_6_18$create or replace function on_order_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = old.status then return new; end if;
  if old.status = 'cancelled' then
    raise exception 'ออเดอร์ที่ยกเลิกแล้วเปลี่ยนสถานะไม่ได้';
  end if;
  if new.status = 'cancelled' and new.product_id is not null then
    update products set stock = stock + 1 where id = new.product_id;
  end if;
  return new;
end $$$sql_6_18$;
exception when invalid_function_definition then
  -- A newer signature of on_order_status() is already installed. Its final definition below is mandatory.
  null;
end;

-- automation.sql: source statement 19
execute $sql_6_19$drop trigger if exists orders_status_change on orders$sql_6_19$;

-- automation.sql: source statement 20
execute $sql_6_20$create trigger orders_status_change before update of status on orders
  for each row execute function on_order_status()$sql_6_20$;

-- automation.sql: source statement 21
begin
execute $sql_6_21$create or replace function cancel_paid_follow_ups() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'pending_payment' and new.status <> 'pending_payment' and not exists (
    select 1 from orders where customer_id = new.customer_id and status = 'pending_payment'
  ) then
    update follow_up_jobs set status = 'cancelled', reason = case when new.status = 'cancelled' then 'order_cancelled' else 'paid' end
    where customer_id = new.customer_id and status = 'scheduled';
  end if;
  return null;
end $$$sql_6_21$;
exception when invalid_function_definition then
  -- A newer signature of cancel_paid_follow_ups() is already installed. Its final definition below is mandatory.
  null;
end;

-- automation.sql: source statement 22
execute $sql_6_22$drop trigger if exists orders_cancel_follow_ups on orders$sql_6_22$;

-- automation.sql: source statement 23
execute $sql_6_23$create trigger orders_cancel_follow_ups after update of status on orders
  for each row execute function cancel_paid_follow_ups()$sql_6_23$;

-- automation.sql: source statement 24
execute $sql_6_24$create table if not exists broadcasts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  message text not null check (length(trim(message)) between 1 and 2000),
  
  audience_segment text not null default 'all' check (audience_segment in ('all', 'pending_payment', 'paid_before')),
  audience_tags text[] not null default '{}',       
  status text not null default 'draft' check (status in ('draft', 'sending', 'sent', 'failed')),
  total integer not null default 0,                 
  sent integer not null default 0,
  failed integer not null default 0,
  skipped integer not null default 0,               
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
)$sql_6_24$;

-- automation.sql: source statement 25
execute $sql_6_25$alter table broadcasts add column if not exists audience_window text not null default 'within_24h'$sql_6_25$;

-- automation.sql: source statement 26
execute $sql_6_26$alter table broadcasts add column if not exists message_tag text$sql_6_26$;

-- automation.sql: source statement 27
execute $sql_6_27$alter table broadcasts add column if not exists last_error text$sql_6_27$;

-- automation.sql: source statement 28
execute $sql_6_28$alter table broadcasts drop constraint if exists broadcasts_audience_window_check$sql_6_28$;

-- automation.sql: source statement 29
execute $sql_6_29$alter table broadcasts add constraint broadcasts_audience_window_check check (audience_window in ('within_24h', 'outside_24h'))$sql_6_29$;

-- automation.sql: source statement 30
execute $sql_6_30$alter table broadcasts drop constraint if exists broadcasts_message_tag_check$sql_6_30$;

-- automation.sql: source statement 31
execute $sql_6_31$alter table broadcasts add constraint broadcasts_message_tag_check check (
  (audience_window = 'within_24h' and message_tag is null)
  or (audience_window = 'outside_24h' and message_tag in ('POST_PURCHASE_UPDATE', 'CONFIRMED_EVENT_UPDATE', 'ACCOUNT_UPDATE', 'HUMAN_AGENT'))
)$sql_6_31$;

-- automation.sql: source statement 32
execute $sql_6_32$create index if not exists broadcasts_tenant on broadcasts (tenant_id, created_at desc)$sql_6_32$;

-- automation.sql: source statement 33
execute $sql_6_33$create index if not exists customers_tags on customers using gin (tags)$sql_6_33$;

-- automation.sql: source statement 34
execute $sql_6_34$create index if not exists messages_broadcast_ref on messages (external_id text_pattern_ops) where external_id like 'bc:%'$sql_6_34$;

-- automation.sql: source statement 35
execute $sql_6_35$alter table products add column if not exists description text check (length(description) <= 2000)$sql_6_35$;

-- automation.sql: source statement 36
execute $sql_6_36$alter table products add column if not exists image_url text$sql_6_36$;

-- automation.sql: source statement 37
execute $sql_6_37$create index if not exists orders_status on orders (tenant_id, status)$sql_6_37$;

-- automation.sql: source statement 38
execute $sql_6_38$alter table bot_settings enable row level security$sql_6_38$;

-- automation.sql: source statement 39
execute $sql_6_39$alter table chat_rules enable row level security$sql_6_39$;

-- automation.sql: source statement 40
execute $sql_6_40$alter table follow_up_jobs enable row level security$sql_6_40$;

-- automation.sql: source statement 41
execute $sql_6_41$alter table broadcasts enable row level security$sql_6_41$;

-- automation.sql: source statement 42
execute $sql_6_42$do $$ begin alter publication supabase_realtime add table follow_up_jobs; exception when duplicate_object then null; end $$$sql_6_42$;

-- automation.sql: source statement 43
execute $sql_6_43$do $$ begin alter publication supabase_realtime add table broadcasts; exception when duplicate_object then null; end $$$sql_6_43$;

-- automation.sql: source statement 44
execute $sql_6_44$do $$ begin alter publication supabase_realtime add table products; exception when duplicate_object then null; end $$$sql_6_44$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('automation.sql','3b38193fdb7cbe163a7d37458417fd8e8e8eed93a802c36a7c7f76fcca8ca1b2','665ac41c61ec4bf4320da06f06112304abec0cb72d5174d732bdc99863fdca8e');
end $migration_6$;

-- 08. billing.sql
do $migration_7$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='billing.sql';
  if found then
    if installed <> '1bb1daf973b0449403983e3a9af7592120a96f5704870514a8b612219111bd7d' then
      raise exception 'Applied migration changed: billing.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- billing.sql: source statement 1
execute $sql_7_1$alter table tenants add column if not exists plan text not null default 'free'$sql_7_1$;

-- billing.sql: source statement 2
execute $sql_7_2$alter table tenants drop constraint if exists tenants_plan_check$sql_7_2$;

-- billing.sql: source statement 3
execute $sql_7_3$alter table tenants add constraint tenants_plan_check check (plan in ('free', 'starter', 'pro'))$sql_7_3$;

-- billing.sql: source statement 4
execute $sql_7_4$alter table tenants add column if not exists plan_expires_at timestamptz$sql_7_4$;

-- billing.sql: source statement 5
execute $sql_7_5$alter table tenants add column if not exists broadcast_allowance integer not null default 100 check (broadcast_allowance >= 0)$sql_7_5$;

-- billing.sql: source statement 6
execute $sql_7_6$alter table tenants add column if not exists broadcast_credits integer not null default 100 check (broadcast_credits >= 0)$sql_7_6$;

-- billing.sql: source statement 7
execute $sql_7_7$alter table tenants add column if not exists broadcast_topup_credits integer not null default 0 check (broadcast_topup_credits >= 0)$sql_7_7$;

-- billing.sql: source statement 8
execute $sql_7_8$alter table tenants add column if not exists slip_quota_credits integer not null default 0 check (slip_quota_credits >= 0)$sql_7_8$;

-- billing.sql: source statement 9
execute $sql_7_9$alter table tenants add column if not exists broadcast_period text not null
  default to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM')$sql_7_9$;

-- billing.sql: source statement 10
begin
execute $sql_7_10$create or replace function refresh_broadcast_credits(p_tenant uuid) returns void
language plpgsql as $$
declare
  this_month text := to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM');
begin
  update tenants set plan = 'free', plan_expires_at = null, broadcast_allowance = 100,
                     broadcast_credits = least(broadcast_credits, 100)
  where id = p_tenant and plan <> 'free' and plan_expires_at is not null and plan_expires_at <= now();
  update tenants set broadcast_credits = broadcast_allowance, broadcast_period = this_month
  where id = p_tenant and broadcast_period <> this_month;
end $$$sql_7_10$;
exception when invalid_function_definition then
  -- A newer signature of refresh_broadcast_credits(uuid) is already installed. Its final definition below is mandatory.
  null;
end;

-- billing.sql: source statement 11
begin
execute $sql_7_11$create or replace function reserve_broadcast_credits(p_tenant uuid, p_count integer)
returns table (monthly integer, topup integer)
language plpgsql as $$
declare
  t tenants;
  m integer;
  u integer;
begin
  perform refresh_broadcast_credits(p_tenant);
  select * into t from tenants where id = p_tenant for update;
  if not found or p_count <= 0 then
    return query select 0, 0;
    return;
  end if;
  m := least(p_count, t.broadcast_credits);
  u := least(p_count - m, t.broadcast_topup_credits);
  update tenants set broadcast_credits = broadcast_credits - m, broadcast_topup_credits = broadcast_topup_credits - u where id = p_tenant;
  return query select m, u;
end $$$sql_7_11$;
exception when invalid_function_definition then
  -- A newer signature of reserve_broadcast_credits(uuid,integer) is already installed. Its final definition below is mandatory.
  null;
end;

-- billing.sql: source statement 12
begin
execute $sql_7_12$create or replace function refund_broadcast_credits(p_tenant uuid, p_monthly integer, p_topup integer) returns void
language sql as $$
  update tenants
  set broadcast_credits = least(broadcast_allowance, broadcast_credits + greatest(p_monthly, 0)),
      broadcast_topup_credits = broadcast_topup_credits + greatest(p_topup, 0)
  where id = p_tenant
$$$sql_7_12$;
exception when invalid_function_definition then
  -- A newer signature of refund_broadcast_credits(uuid,integer,integer) is already installed. Its final definition below is mandatory.
  null;
end;

-- billing.sql: source statement 13
execute $sql_7_13$revoke execute on function refresh_broadcast_credits(uuid) from public, anon, authenticated$sql_7_13$;

-- billing.sql: source statement 14
execute $sql_7_14$revoke execute on function reserve_broadcast_credits(uuid, integer) from public, anon, authenticated$sql_7_14$;

-- billing.sql: source statement 15
execute $sql_7_15$revoke execute on function refund_broadcast_credits(uuid, integer, integer) from public, anon, authenticated$sql_7_15$;

-- billing.sql: source statement 16
execute $sql_7_16$create table if not exists billing_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  item text not null check (item in ('starter', 'pro', 'topup_s', 'topup_m', 'topup_l', 'slip_topup_s', 'slip_topup_m', 'slip_topup_l')),
  price_baht integer not null check (price_baht >= 0),
  credits integer not null check (credits > 0),            
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  note text check (length(note) <= 500),                    
  requested_by uuid references auth.users(id) on delete set null,
  decided_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
)$sql_7_16$;

-- billing.sql: source statement 17
execute $sql_7_17$create index if not exists billing_requests_tenant on billing_requests (tenant_id, created_at desc)$sql_7_17$;

-- billing.sql: source statement 18
execute $sql_7_18$alter table billing_requests drop constraint if exists billing_requests_item_check$sql_7_18$;

-- billing.sql: source statement 19
execute $sql_7_19$alter table billing_requests add constraint billing_requests_item_check
  check (item in ('starter', 'pro', 'topup_s', 'topup_m', 'topup_l', 'slip_topup_s', 'slip_topup_m', 'slip_topup_l'))$sql_7_19$;

-- billing.sql: source statement 20
execute $sql_7_20$create index if not exists billing_requests_pending on billing_requests (created_at) where status = 'pending'$sql_7_20$;

-- billing.sql: source statement 21
execute $sql_7_21$create unique index if not exists billing_requests_one_pending on billing_requests (tenant_id, item) where status = 'pending'$sql_7_21$;

-- billing.sql: source statement 22
begin
execute $sql_7_22$create or replace function approve_billing_request(p_request uuid, p_admin uuid) returns text
language plpgsql as $$
declare
  r billing_requests;
  t tenants;
  this_month text := to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM');
begin
  select * into r from billing_requests where id = p_request for update;
  if not found then return 'ไม่พบคำขอนี้'; end if;
  if r.status = 'approved' then return null; end if;
  if r.status <> 'pending' then return 'คำขอนี้ถูกดำเนินการไปแล้ว'; end if;
  perform refresh_broadcast_credits(r.tenant_id);
  select * into t from tenants where id = r.tenant_id for update;

  if r.item in ('starter', 'pro') then
    update tenants set
      plan = r.item,
      plan_expires_at = (case when t.plan = r.item and t.plan_expires_at > now() then t.plan_expires_at else now() end) + interval '30 days',
      broadcast_allowance = r.credits,
      broadcast_credits = broadcast_credits + r.credits,
      broadcast_period = this_month
    where id = r.tenant_id;
  else
    if r.item in ('slip_topup_s', 'slip_topup_m', 'slip_topup_l') then
      update tenants set slip_quota_credits = slip_quota_credits + r.credits where id = r.tenant_id;
    elsif r.item in ('topup_s', 'topup_m', 'topup_l') then
      -- Keep purchased broadcast credits in their non-expiring bucket.
      update tenants set broadcast_topup_credits = broadcast_topup_credits + r.credits where id = r.tenant_id;
    else
      return 'ไม่พบแพ็กเกจเติมเงินนี้';
    end if;
  end if;

  update billing_requests set status = 'approved', decided_by = p_admin, decided_at = now() where id = p_request;
  return null;
end $$$sql_7_22$;
exception when invalid_function_definition then
  -- A newer signature of approve_billing_request(uuid,uuid) is already installed. Its final definition below is mandatory.
  null;
end;

-- billing.sql: source statement 23
execute $sql_7_23$revoke execute on function approve_billing_request(uuid, uuid) from public, anon, authenticated$sql_7_23$;

-- billing.sql: source statement 24
execute $sql_7_24$alter table billing_requests enable row level security$sql_7_24$;

-- billing.sql: source statement 25
execute $sql_7_25$do $$ begin alter publication supabase_realtime add table billing_requests; exception when duplicate_object then null; end $$$sql_7_25$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('billing.sql','1bb1daf973b0449403983e3a9af7592120a96f5704870514a8b612219111bd7d','29ce43034a42142b202f01c31dab5e0ccb598aa8aac0ebcd115e32238df75fb6');
end $migration_7$;

-- 09. security.sql
do $migration_8$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='security.sql';
  if found then
    if installed <> '9053655b6ac3819e41cbfa4ca0980406dd2a931e15fc2f90baac83c5d4215cda' then
      raise exception 'Applied migration changed: security.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- security.sql: source statement 1
execute $sql_8_1$create table if not exists platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
)$sql_8_1$;

-- security.sql: source statement 2
execute $sql_8_2$create table if not exists tenant_members (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
)$sql_8_2$;

-- security.sql: source statement 3
execute $sql_8_3$create index if not exists tenant_members_user on tenant_members (user_id)$sql_8_3$;

-- security.sql: source statement 4
execute $sql_8_4$alter table public.tenants add column if not exists is_active boolean not null default true$sql_8_4$;

-- security.sql: source statement 5
execute $sql_8_5$alter table platform_admins enable row level security$sql_8_5$;

-- security.sql: source statement 6
execute $sql_8_6$alter table tenant_members enable row level security$sql_8_6$;

-- security.sql: source statement 7
begin
execute $sql_8_7$create or replace function is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid())
$$$sql_8_7$;
exception when invalid_function_definition then
  -- A newer signature of is_platform_admin() is already installed. Its final definition below is mandatory.
  null;
end;

-- security.sql: source statement 8
begin
execute $sql_8_8$create or replace function can_access_tenant(p_tenant uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_platform_admin()
      or (p_tenant is not null
          and exists (select 1 from tenants where id = p_tenant and is_active)
          and exists (select 1 from tenant_members where tenant_id = p_tenant and user_id = auth.uid()))
$$$sql_8_8$;
exception when invalid_function_definition then
  -- A newer signature of can_access_tenant(uuid) is already installed. Its final definition below is mandatory.
  null;
end;

-- security.sql: source statement 9
execute $sql_8_9$revoke execute on function is_platform_admin() from public, anon$sql_8_9$;

-- security.sql: source statement 10
execute $sql_8_10$revoke execute on function can_access_tenant(uuid) from public, anon$sql_8_10$;

-- security.sql: source statement 11
execute $sql_8_11$grant execute on function is_platform_admin() to authenticated$sql_8_11$;

-- security.sql: source statement 12
execute $sql_8_12$grant execute on function can_access_tenant(uuid) to authenticated$sql_8_12$;

-- security.sql: source statement 13
execute $sql_8_13$drop policy if exists staff_read   on customers$sql_8_13$;

-- security.sql: source statement 14
execute $sql_8_14$drop policy if exists staff_toggle on customers$sql_8_14$;

-- security.sql: source statement 15
execute $sql_8_15$drop policy if exists staff_read   on messages$sql_8_15$;

-- security.sql: source statement 16
execute $sql_8_16$drop policy if exists staff_read   on comments$sql_8_16$;

-- security.sql: source statement 17
execute $sql_8_17$drop policy if exists staff_read   on slips$sql_8_17$;

-- security.sql: source statement 18
execute $sql_8_18$drop policy if exists staff_read   on tenants$sql_8_18$;

-- security.sql: source statement 19
execute $sql_8_19$drop policy if exists staff_all    on comment_rules$sql_8_19$;

-- security.sql: source statement 20
execute $sql_8_20$drop policy if exists own_row on platform_admins$sql_8_20$;

-- security.sql: source statement 21
execute $sql_8_21$create policy own_row on platform_admins for select to authenticated using (user_id = auth.uid())$sql_8_21$;

-- security.sql: source statement 22
execute $sql_8_22$drop policy if exists member_read on tenant_members$sql_8_22$;

-- security.sql: source statement 23
execute $sql_8_23$create policy member_read on tenant_members for select to authenticated
  using (user_id = auth.uid() or can_access_tenant(tenant_id))$sql_8_23$;

-- security.sql: source statement 24
execute $sql_8_24$drop policy if exists member_read on tenants$sql_8_24$;

-- security.sql: source statement 25
execute $sql_8_25$create policy member_read on tenants for select to authenticated using (can_access_tenant(id))$sql_8_25$;

-- security.sql: source statement 26
execute $sql_8_26$revoke all on tenants from anon, authenticated$sql_8_26$;

-- security.sql: source statement 27
execute $sql_8_27$grant select (id, name, account_name, bank_code, page_id, expected_amount,
              auto_reply_enabled, auto_verify_enabled, slip_quota, slip_used, is_active, page_token_set, created_at)
  on tenants to authenticated$sql_8_27$;

-- security.sql: source statement 28
execute $sql_8_28$do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenants' and column_name = 'page_name') then
    grant select (page_name) on public.tenants to authenticated;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenants' and column_name = 'slip_quota_credits') then
    grant select (slip_quota_credits) on public.tenants to authenticated;
  end if;
end $$$sql_8_28$;

-- security.sql: source statement 29
execute $sql_8_29$drop policy if exists member_read on customers$sql_8_29$;

-- security.sql: source statement 30
execute $sql_8_30$create policy member_read on customers for select to authenticated using (can_access_tenant(tenant_id))$sql_8_30$;

-- security.sql: source statement 31
execute $sql_8_31$drop policy if exists member_toggle on customers$sql_8_31$;

-- security.sql: source statement 32
execute $sql_8_32$create policy member_toggle on customers for update to authenticated
  using (can_access_tenant(tenant_id)) with check (can_access_tenant(tenant_id))$sql_8_32$;

-- security.sql: source statement 33
execute $sql_8_33$revoke insert, update, delete on customers from anon, authenticated$sql_8_33$;

-- security.sql: source statement 34
execute $sql_8_34$do $$ begin
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='customers' and column_name='conversation_version') then
    revoke update(bot_enabled) on public.customers from authenticated;
  else
    grant update(bot_enabled) on public.customers to authenticated;
  end if;
end $$$sql_8_34$;

-- security.sql: source statement 35
execute $sql_8_35$drop policy if exists member_read on messages$sql_8_35$;

-- security.sql: source statement 36
execute $sql_8_36$create policy member_read on messages for select to authenticated
  using (exists (select 1 from customers c where c.id = messages.customer_id and can_access_tenant(c.tenant_id)))$sql_8_36$;

-- security.sql: source statement 37
execute $sql_8_37$revoke insert, update, delete on messages from anon, authenticated$sql_8_37$;

-- security.sql: source statement 38
execute $sql_8_38$drop policy if exists member_read on comments$sql_8_38$;

-- security.sql: source statement 39
execute $sql_8_39$create policy member_read on comments for select to authenticated using (can_access_tenant(tenant_id))$sql_8_39$;

-- security.sql: source statement 40
execute $sql_8_40$revoke insert, update, delete on comments from anon, authenticated$sql_8_40$;

-- security.sql: source statement 41
execute $sql_8_41$drop policy if exists member_read on slips$sql_8_41$;

-- security.sql: source statement 42
execute $sql_8_42$create policy member_read on slips for select to authenticated using (can_access_tenant(tenant_id))$sql_8_42$;

-- security.sql: source statement 43
execute $sql_8_43$revoke insert, update, delete on slips from anon, authenticated$sql_8_43$;

-- security.sql: source statement 44
execute $sql_8_44$drop policy if exists member_all on comment_rules$sql_8_44$;

-- security.sql: source statement 45
execute $sql_8_45$create policy member_all on comment_rules for all to authenticated
  using (can_access_tenant(tenant_id))
  with check (tenant_id is not null and can_access_tenant(tenant_id))$sql_8_45$;

-- security.sql: source statement 46
execute $sql_8_46$drop policy if exists member_all on products$sql_8_46$;

-- security.sql: source statement 47
execute $sql_8_47$create policy member_all on products for all to authenticated
  using (can_access_tenant(tenant_id)) with check (can_access_tenant(tenant_id))$sql_8_47$;

-- security.sql: source statement 48
execute $sql_8_48$drop policy if exists member_read on orders$sql_8_48$;

-- security.sql: source statement 49
execute $sql_8_49$create policy member_read on orders for select to authenticated using (can_access_tenant(tenant_id))$sql_8_49$;

-- security.sql: source statement 50
execute $sql_8_50$drop policy if exists member_update on orders$sql_8_50$;

-- security.sql: source statement 51
execute $sql_8_51$create policy member_update on orders for update to authenticated
  using (can_access_tenant(tenant_id)) with check (can_access_tenant(tenant_id))$sql_8_51$;

-- security.sql: source statement 52
execute $sql_8_52$revoke insert, delete on orders from anon, authenticated$sql_8_52$;

-- security.sql: source statement 53
execute $sql_8_53$revoke update on orders from anon, authenticated$sql_8_53$;

-- security.sql: source statement 54
execute $sql_8_54$grant update (status) on orders to authenticated$sql_8_54$;

-- security.sql: source statement 55
execute $sql_8_55$drop policy if exists member_all on bot_settings$sql_8_55$;

-- security.sql: source statement 56
execute $sql_8_56$create policy member_all on bot_settings for all to authenticated
  using (can_access_tenant(tenant_id)) with check (can_access_tenant(tenant_id))$sql_8_56$;

-- security.sql: source statement 57
execute $sql_8_57$drop policy if exists member_all on chat_rules$sql_8_57$;

-- security.sql: source statement 58
execute $sql_8_58$create policy member_all on chat_rules for all to authenticated
  using (can_access_tenant(tenant_id)) with check (can_access_tenant(tenant_id))$sql_8_58$;

-- security.sql: source statement 59
execute $sql_8_59$drop policy if exists member_read on follow_up_jobs$sql_8_59$;

-- security.sql: source statement 60
execute $sql_8_60$create policy member_read on follow_up_jobs for select to authenticated using (can_access_tenant(tenant_id))$sql_8_60$;

-- security.sql: source statement 61
execute $sql_8_61$drop policy if exists member_cancel on follow_up_jobs$sql_8_61$;

-- security.sql: source statement 62
execute $sql_8_62$create policy member_cancel on follow_up_jobs for update to authenticated
  using (can_access_tenant(tenant_id) and status = 'scheduled')
  with check (can_access_tenant(tenant_id) and status = 'cancelled')$sql_8_62$;

-- security.sql: source statement 63
execute $sql_8_63$revoke insert, update, delete on follow_up_jobs from anon, authenticated$sql_8_63$;

-- security.sql: source statement 64
execute $sql_8_64$grant update (status, reason) on follow_up_jobs to authenticated$sql_8_64$;

-- security.sql: source statement 65
execute $sql_8_65$drop policy if exists member_read on broadcasts$sql_8_65$;

-- security.sql: source statement 66
execute $sql_8_66$create policy member_read on broadcasts for select to authenticated using (can_access_tenant(tenant_id))$sql_8_66$;

-- security.sql: source statement 67
execute $sql_8_67$drop policy if exists member_draft on broadcasts$sql_8_67$;

-- security.sql: source statement 68
execute $sql_8_68$create policy member_draft on broadcasts for insert to authenticated
  with check (can_access_tenant(tenant_id) and status = 'draft')$sql_8_68$;

-- security.sql: source statement 69
execute $sql_8_69$drop policy if exists member_edit_draft on broadcasts$sql_8_69$;

-- security.sql: source statement 70
execute $sql_8_70$create policy member_edit_draft on broadcasts for update to authenticated
  using (can_access_tenant(tenant_id) and status = 'draft') with check (can_access_tenant(tenant_id) and status = 'draft')$sql_8_70$;

-- security.sql: source statement 71
execute $sql_8_71$drop policy if exists member_delete_draft on broadcasts$sql_8_71$;

-- security.sql: source statement 72
execute $sql_8_72$create policy member_delete_draft on broadcasts for delete to authenticated
  using (can_access_tenant(tenant_id) and status = 'draft')$sql_8_72$;

-- security.sql: source statement 73
execute $sql_8_73$revoke insert, update, delete on broadcasts from anon, authenticated$sql_8_73$;

-- security.sql: source statement 74
execute $sql_8_74$grant insert (tenant_id, name, message, audience_segment, audience_tags, audience_window, message_tag, created_by) on broadcasts to authenticated$sql_8_74$;

-- security.sql: source statement 75
execute $sql_8_75$grant update (name, message, audience_segment, audience_tags, audience_window, message_tag) on broadcasts to authenticated$sql_8_75$;

-- security.sql: source statement 76
execute $sql_8_76$grant delete on broadcasts to authenticated$sql_8_76$;

-- security.sql: source statement 77
execute $sql_8_77$do $$ begin
  if to_regclass('public.billing_requests') is not null then
    drop policy if exists member_read on billing_requests;
    create policy member_read on billing_requests for select to authenticated using (can_access_tenant(tenant_id));
    revoke insert, update, delete on billing_requests from anon, authenticated;
  end if;
end $$$sql_8_77$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('security.sql','9053655b6ac3819e41cbfa4ca0980406dd2a931e15fc2f90baac83c5d4215cda','ec1491b21dc305b4531e12ddb0a92ecdd38ead50b22408e211a7d9aa5326fe8c');
end $migration_8$;

-- 10. facebook-connect.sql
do $migration_9$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='facebook-connect.sql';
  if found then
    if installed <> '9767f5411240e02fea5f9795c6e46a9ecc75050a2cf08cc3164dc925ea5f76a1' then
      raise exception 'Applied migration changed: facebook-connect.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- facebook-connect.sql: source statement 1
execute $sql_9_1$create table if not exists facebook_pages (
  user_id uuid not null references auth.users(id) on delete cascade,
  page_id text not null,
  name text not null,
  picture text,
  access_token text not null,                   
  connected_at timestamptz not null default now(),
  primary key (user_id, page_id)
)$sql_9_1$;

-- facebook-connect.sql: source statement 2
execute $sql_9_2$alter table facebook_pages enable row level security$sql_9_2$;

-- facebook-connect.sql: source statement 3
execute $sql_9_3$revoke all on facebook_pages from anon, authenticated$sql_9_3$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('facebook-connect.sql','9767f5411240e02fea5f9795c6e46a9ecc75050a2cf08cc3164dc925ea5f76a1','bb849ab652fa428cdd6afd02599e666856bf8ede3ee122269988c9cf10433feb');
end $migration_9$;

-- 11. facebook-tenants.sql
do $migration_10$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='facebook-tenants.sql';
  if found then
    if installed <> 'c717431bfaff1bfd64a1c79f1686dd829664e2e380bebb58844a7778bc134b44' then
      raise exception 'Applied migration changed: facebook-tenants.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- facebook-tenants.sql: source statement 2
execute $sql_10_2$do $$ begin
  if to_regclass('public.tenants') is null or to_regclass('public.tenant_members') is null
     or to_regclass('public.platform_admins') is null
     or to_regprocedure('public.can_access_tenant(uuid)') is null then
    raise exception 'Run tenants.sql, platform.sql and security.sql before facebook-tenants.sql';
  end if;
end $$$sql_10_2$;

-- facebook-tenants.sql: source statement 3
execute $sql_10_3$alter table public.tenants alter column bank_code drop not null$sql_10_3$;

-- facebook-tenants.sql: source statement 4
execute $sql_10_4$alter table public.tenants alter column account_number drop not null$sql_10_4$;

-- facebook-tenants.sql: source statement 5
execute $sql_10_5$alter table public.tenants add column if not exists page_name text$sql_10_5$;

-- facebook-tenants.sql: source statement 6
execute $sql_10_6$do $$ begin
  if not exists (
    select 1 from pg_catalog.pg_index i
    join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attname = 'page_id'
    where i.indrelid = 'public.tenants'::regclass and i.indisunique and i.indisvalid
      and i.indpred is null and i.indexprs is null and i.indnkeyatts = 1 and i.indkey[0] = a.attnum
  ) then
    create unique index tenants_page_id_oauth_key on public.tenants (page_id);
  end if;
end $$$sql_10_6$;

-- facebook-tenants.sql: source statement 7
execute $sql_10_7$alter table public.tenants enable row level security$sql_10_7$;

-- facebook-tenants.sql: source statement 8
execute $sql_10_8$alter table public.tenant_members enable row level security$sql_10_8$;

-- facebook-tenants.sql: source statement 9
execute $sql_10_9$drop policy if exists member_read on public.tenants$sql_10_9$;

-- facebook-tenants.sql: source statement 10
execute $sql_10_10$create policy member_read on public.tenants for select to authenticated using (public.can_access_tenant(id))$sql_10_10$;

-- facebook-tenants.sql: source statement 11
execute $sql_10_11$drop policy if exists member_read on public.tenant_members$sql_10_11$;

-- facebook-tenants.sql: source statement 12
execute $sql_10_12$create policy member_read on public.tenant_members for select to authenticated
  using (user_id = auth.uid() or public.can_access_tenant(tenant_id))$sql_10_12$;

-- facebook-tenants.sql: source statement 13
execute $sql_10_13$revoke all on public.tenants from anon, authenticated$sql_10_13$;

-- facebook-tenants.sql: source statement 14
execute $sql_10_14$revoke select (page_access_token) on public.tenants from anon, authenticated$sql_10_14$;

-- facebook-tenants.sql: source statement 15
execute $sql_10_15$grant select (id, name, account_name, bank_code, page_id, page_name, expected_amount,
              auto_reply_enabled, auto_verify_enabled, slip_quota, slip_used, page_token_set, created_at)
  on public.tenants to authenticated$sql_10_15$;

-- facebook-tenants.sql: source statement 16
execute $sql_10_16$grant select on public.tenant_members to authenticated$sql_10_16$;

-- facebook-tenants.sql: source statement 17
begin
execute $sql_10_17$create or replace function public.sync_facebook_tenants(p_user_id uuid, p_pages jsonb)


returns integer language plpgsql security definer set search_path = '' as $$
declare
  p jsonb;
  tenant_uuid uuid;
  saved integer := 0;
begin
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception using errcode = '22023', message = 'Invalid user';
  end if;
  if pg_catalog.jsonb_typeof(p_pages) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Invalid Pages array';
  end if;
  -- A consistent lock order avoids deadlocks when two connections share several Pages.
  for p in select value from pg_catalog.jsonb_array_elements(p_pages) order by value->>'page_id' loop
    if coalesce(p->>'page_id', '') = '' or coalesce(p->>'page_name', '') = ''
       or coalesce(p->>'page_access_token', '') = '' then
      raise exception using errcode = '22023', message = 'Invalid Page';
    end if;
    -- Serialize simultaneous connections for this Page, including first-time creation.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p->>'page_id', 0));
    tenant_uuid := null;
    select id into tenant_uuid from public.tenants where page_id = p->>'page_id' for update;
    -- Membership is granted only after the trusted server verifies MANAGE and the Page token.
    -- Reconnecting must never reactivate a tenant suspended by the platform owner.
    if tenant_uuid is not null and exists (
      select 1 from public.tenants where id = tenant_uuid and not is_active
    ) then
      continue;
    end if;
    insert into public.tenants (name, page_id, page_name, page_access_token, auto_reply_enabled, auto_verify_enabled, slip_quota)
    values (p->>'page_name', p->>'page_id', p->>'page_name', p->>'page_access_token', false, false, 0)
    on conflict (page_id) do update
      set page_name = excluded.page_name, page_access_token = excluded.page_access_token
    returning id into tenant_uuid;
    insert into public.tenant_members (tenant_id, user_id, role) values (tenant_uuid, p_user_id, 'owner')
    on conflict (tenant_id, user_id) do update set role = 'owner';
    saved := saved + 1;
  end loop;
  return saved;
end;
$$$sql_10_17$;
exception when invalid_function_definition then
  -- A newer signature of sync_facebook_tenants(uuid,jsonb) is already installed. Its final definition below is mandatory.
  null;
end;

-- facebook-tenants.sql: source statement 18
execute $sql_10_18$alter function public.sync_facebook_tenants(uuid, jsonb) owner to postgres$sql_10_18$;

-- facebook-tenants.sql: source statement 19
execute $sql_10_19$revoke all on function public.sync_facebook_tenants(uuid, jsonb) from public, anon, authenticated$sql_10_19$;

-- facebook-tenants.sql: source statement 20
execute $sql_10_20$grant execute on function public.sync_facebook_tenants(uuid, jsonb) to service_role$sql_10_20$;

-- facebook-tenants.sql: source statement 21
execute $sql_10_21$notify pgrst, 'reload schema'$sql_10_21$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('facebook-tenants.sql','c717431bfaff1bfd64a1c79f1686dd829664e2e380bebb58844a7778bc134b44','6d97183c5a95c2341b0795c7c185615a25d68f4127c02db9836e62b9a599c9f0');
end $migration_10$;

-- 12. facebook-multi-admin.sql
do $migration_11$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='facebook-multi-admin.sql';
  if found then
    if installed <> 'bc25e40bd394624d8af1e90e69186f628cc2727983cb41b3cb106e19bc302050' then
      raise exception 'Applied migration changed: facebook-multi-admin.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- facebook-multi-admin.sql: source statement 2
execute $sql_11_2$create or replace function public.sync_facebook_tenants(p_user_id uuid, p_pages jsonb)


returns integer language plpgsql security definer set search_path = '' as $$
declare
  p jsonb;
  tenant_uuid uuid;
  saved integer := 0;
begin
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception using errcode = '22023', message = 'Invalid user';
  end if;
  if pg_catalog.jsonb_typeof(p_pages) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Invalid Pages array';
  end if;
  -- A consistent lock order avoids deadlocks when two connections share several Pages.
  for p in select value from pg_catalog.jsonb_array_elements(p_pages) order by value->>'page_id' loop
    if coalesce(p->>'page_id', '') = '' or coalesce(p->>'page_name', '') = ''
       or coalesce(p->>'page_access_token', '') = '' then
      raise exception using errcode = '22023', message = 'Invalid Page';
    end if;
    -- Serialize simultaneous connections for this Page, including first-time creation.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p->>'page_id', 0));
    tenant_uuid := null;
    select id into tenant_uuid from public.tenants where page_id = p->>'page_id' for update;
    -- Membership is granted only after the trusted server verifies MANAGE and the Page token.
    -- Reconnecting must never reactivate a tenant suspended by the platform owner.
    if tenant_uuid is not null and exists (
      select 1 from public.tenants where id = tenant_uuid and not is_active
    ) then
      continue;
    end if;
    insert into public.tenants (name, page_id, page_name, page_access_token, auto_reply_enabled, auto_verify_enabled, slip_quota)
    values (p->>'page_name', p->>'page_id', p->>'page_name', p->>'page_access_token', false, false, 0)
    on conflict (page_id) do update
      set page_name = excluded.page_name, page_access_token = excluded.page_access_token
    returning id into tenant_uuid;
    insert into public.tenant_members (tenant_id, user_id, role) values (tenant_uuid, p_user_id, 'owner')
    on conflict (tenant_id, user_id) do update set role = 'owner';
    saved := saved + 1;
  end loop;
  return saved;
end;
$$$sql_11_2$;

-- facebook-multi-admin.sql: source statement 3
execute $sql_11_3$alter function public.sync_facebook_tenants(uuid, jsonb) owner to postgres$sql_11_3$;

-- facebook-multi-admin.sql: source statement 4
execute $sql_11_4$revoke all on function public.sync_facebook_tenants(uuid, jsonb) from public, anon, authenticated$sql_11_4$;

-- facebook-multi-admin.sql: source statement 5
execute $sql_11_5$grant execute on function public.sync_facebook_tenants(uuid, jsonb) to service_role$sql_11_5$;

-- facebook-multi-admin.sql: source statement 6
execute $sql_11_6$notify pgrst, 'reload schema'$sql_11_6$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('facebook-multi-admin.sql','bc25e40bd394624d8af1e90e69186f628cc2727983cb41b3cb106e19bc302050','9dffbc3d72cea2d237cbfc85dba2869abab1ab147f1766a8ce33b6fff5e8b644');
end $migration_11$;

-- 13. customer-profiles.sql
do $migration_12$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='customer-profiles.sql';
  if found then
    if installed <> '30e5ab0090b1ccd5110471b1bd49829e0aaa722dad1e701d8849eb9553554a1a' then
      raise exception 'Applied migration changed: customer-profiles.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- customer-profiles.sql: source statement 2
execute $sql_12_2$alter table public.customers add column if not exists avatar_url text$sql_12_2$;

-- customer-profiles.sql: source statement 3
execute $sql_12_3$grant select (avatar_url) on public.customers to authenticated$sql_12_3$;

-- customer-profiles.sql: source statement 4
execute $sql_12_4$grant update (avatar_url) on public.customers to service_role$sql_12_4$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('customer-profiles.sql','30e5ab0090b1ccd5110471b1bd49829e0aaa722dad1e701d8849eb9553554a1a','5f997557ed4cca29fece1b20d74c0abd48e3a13df57f3489fe17204165c0b4fa');
end $migration_12$;

-- 14. customer-gender.sql
do $migration_13$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='customer-gender.sql';
  if found then
    if installed <> '18e8189710035aef122598517943021e6091c52f186f94eeb16083d60bd87fec' then
      raise exception 'Applied migration changed: customer-gender.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- customer-gender.sql: source statement 2
execute $sql_13_2$alter table public.customers add column if not exists gender text$sql_13_2$;

-- customer-gender.sql: source statement 3
execute $sql_13_3$comment on column public.customers.gender is 'Customer-provided gender: male / female; NULL or other values are unspecified in overview. Never infer from name or avatar.'$sql_13_3$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('customer-gender.sql','18e8189710035aef122598517943021e6091c52f186f94eeb16083d60bd87fec','4c43982b49d3f2b104be17c39077de05a56ffd69724e17ded105a755d2cea757');
end $migration_13$;

-- 15. payments.sql
do $migration_14$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='payments.sql';
  if found then
    if installed <> '4468b9ef949b129fcf39da3468b3e905c7ceb34835b63076faa83b425d8d086b' then
      raise exception 'Applied migration changed: payments.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- payments.sql: source statement 2
execute $sql_14_2$alter table public.tenants add column if not exists broadcast_credit_mode text not null
  default 'calendar' check (broadcast_credit_mode in ('calendar', 'purchased'))$sql_14_2$;

-- payments.sql: source statement 3
execute $sql_14_3$create table if not exists public.payment_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete set null,
  plan text not null check (plan in ('starter', 'pro')),
  price_baht integer not null check (price_baht > 0),
  credits integer not null check (credits > 0),
  status text not null default 'pending' check (status in ('pending', 'paid')),
  requested_by uuid references auth.users(id) on delete set null,
  receiver_promptpay_id text not null check (receiver_promptpay_id ~ '^(0[0-9]{9}|[0-9]{13}|[0-9]{15})$'),
  receiver_account_no text not null check (length(trim(receiver_account_no)) > 0),
  receiver_account_name text not null check (length(trim(receiver_account_name)) > 0),
  receiver_bank_name text not null check (length(trim(receiver_bank_name)) > 0),
  receiver_bank_code text not null check (length(trim(receiver_bank_code)) > 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '20 minutes'),
  paid_at timestamptz,
  check (expires_at > created_at),
  check ((status = 'paid') = (paid_at is not null))
)$sql_14_3$;

-- payments.sql: source statement 4
execute $sql_14_4$create index if not exists payment_sessions_tenant on public.payment_sessions (tenant_id, created_at desc)$sql_14_4$;

-- payments.sql: source statement 5
execute $sql_14_5$create table if not exists public.payment_receipts (
  session_id uuid primary key references public.payment_sessions(id) on delete restrict,
  trans_ref text not null unique check (length(trim(trans_ref)) between 1 and 200 and trans_ref = trim(trans_ref)),
  image_sha256 text not null unique check (image_sha256 ~ '^[0-9a-f]{64}$'),
  amount numeric(12,2) not null check (amount > 0),
  paid_at timestamptz not null,
  verified_at timestamptz not null default now(),
  applied_at timestamptz
)$sql_14_5$;

-- payments.sql: source statement 6
execute $sql_14_6$create table if not exists public.payment_transfer_ledger (
  trans_ref text primary key,
  source text not null check (source in ('package', 'sale')),
  source_id uuid not null,
  created_at timestamptz not null default now(),
  unique (source, source_id)
)$sql_14_6$;

-- payments.sql: source statement 8
execute $sql_14_8$insert into public.payment_transfer_ledger (trans_ref, source, source_id)
select trans_ref, 'sale', id from public.slips where status = 'valid' and trans_ref is not null
on conflict do nothing$sql_14_8$;

-- payments.sql: source statement 9
execute $sql_14_9$insert into public.payment_transfer_ledger (trans_ref, source, source_id)
select trans_ref, 'package', session_id from public.payment_receipts
on conflict do nothing$sql_14_9$;

-- payments.sql: source statement 10
execute $sql_14_10$do $$ begin
  if exists (
    select 1 from public.slips s left join public.payment_transfer_ledger l on l.trans_ref = s.trans_ref
    where s.status = 'valid' and s.trans_ref is not null
      and (l.source is distinct from 'sale' or l.source_id is distinct from s.id)
  ) or exists (
    select 1 from public.payment_receipts r left join public.payment_transfer_ledger l on l.trans_ref = r.trans_ref
    where l.source is distinct from 'package' or l.source_id is distinct from r.session_id
  ) then raise exception 'Existing transfers conflict; resolve duplicate proofs before migrating'; end if;
end $$$sql_14_10$;

-- payments.sql: source statement 11
execute $sql_14_11$create or replace function public.claim_payment_transfer(p_ref text, p_source text, p_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  insert into public.payment_transfer_ledger (trans_ref, source, source_id)
  values (p_ref, p_source, p_id) on conflict do nothing;
  if not exists (select 1 from public.payment_transfer_ledger
                 where trans_ref = p_ref and source = p_source and source_id = p_id) then
    raise exception 'Transfer already accepted' using errcode = '23505';
  end if;
end $$$sql_14_11$;

-- payments.sql: source statement 12
execute $sql_14_12$create or replace function public.guard_payment_receipt() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare s public.payment_sessions;
begin
  if tg_op = 'UPDATE' then
    if new.session_id is distinct from old.session_id or new.trans_ref is distinct from old.trans_ref
       or new.image_sha256 is distinct from old.image_sha256 or new.amount is distinct from old.amount
       or new.paid_at is distinct from old.paid_at or new.verified_at is distinct from old.verified_at
       or (old.applied_at is not null and new.applied_at is distinct from old.applied_at) then
      raise exception 'Verified payment proof is immutable';
    end if;
    return new;
  end if;
  select * into s from public.payment_sessions where id = new.session_id for update;
  if not found or s.tenant_id is null or s.status <> 'pending' then
    raise exception 'Checkout is not payable';
  end if;
  if new.applied_at is not null or new.amount <> s.price_baht
     or new.paid_at < s.created_at - interval '2 minutes'
     or new.paid_at > s.expires_at or new.paid_at > clock_timestamp() + interval '2 minutes'
     or clock_timestamp() > s.expires_at then
    raise exception 'Payment amount or transfer window is invalid';
  end if;
  perform public.claim_payment_transfer(new.trans_ref, 'package', new.session_id);
  return new;
end $$$sql_14_12$;

-- payments.sql: source statement 13
execute $sql_14_13$drop trigger if exists payment_receipts_guard on public.payment_receipts$sql_14_13$;

-- payments.sql: source statement 14
execute $sql_14_14$create trigger payment_receipts_guard before insert or update on public.payment_receipts
for each row execute function public.guard_payment_receipt()$sql_14_14$;

-- payments.sql: source statement 15
execute $sql_14_15$create or replace function public.guard_sale_payment_transfer() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.status = 'valid' then
    if new.trans_ref is null or length(trim(new.trans_ref)) = 0 then
      raise exception 'Accepted slip requires a bank transaction reference';
    end if;
    perform public.claim_payment_transfer(new.trans_ref, 'sale', new.id);
  end if;
  return new;
end $$$sql_14_15$;

-- payments.sql: source statement 16
execute $sql_14_16$drop trigger if exists slips_payment_transfer_guard on public.slips$sql_14_16$;

-- payments.sql: source statement 17
execute $sql_14_17$create trigger slips_payment_transfer_guard before insert or update on public.slips
for each row execute function public.guard_sale_payment_transfer()$sql_14_17$;

-- payments.sql: source statement 18
begin
execute $sql_14_18$create or replace function public.refresh_broadcast_credits(p_tenant uuid) returns void
language plpgsql set search_path = pg_catalog, public as $$
declare t public.tenants; this_month text := to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM');
begin
  select * into t from public.tenants where id = p_tenant for update;
  if not found then return; end if;
  if t.plan <> 'free' and t.plan_expires_at is not null and t.plan_expires_at <= now() then
    update public.tenants set plan = 'free', plan_expires_at = null, broadcast_allowance = 100,
      broadcast_credits = least(broadcast_credits, 100), broadcast_credit_mode = 'calendar'
    where id = p_tenant;
    t.broadcast_credit_mode := 'calendar';
  end if;
  if t.broadcast_credit_mode = 'calendar' and t.broadcast_period <> this_month then
    update public.tenants set broadcast_credits = broadcast_allowance, broadcast_period = this_month
    where id = p_tenant;
  end if;
end $$$sql_14_18$;
exception when invalid_function_definition then
  -- A newer signature of refresh_broadcast_credits(uuid) is already installed. Its final definition below is mandatory.
  null;
end;

-- payments.sql: source statement 19
begin
execute $sql_14_19$create or replace function public.reserve_broadcast_credits(p_tenant uuid, p_count integer)
returns table (monthly integer, topup integer)
language plpgsql set search_path = pg_catalog, public as $$
declare t public.tenants; m integer; u integer;
begin
  if p_count is null or p_count <= 0 then return query select 0, 0; return; end if;
  perform public.refresh_broadcast_credits(p_tenant);
  select * into t from public.tenants where id = p_tenant for update;
  if not found or not t.is_active then return query select 0, 0; return; end if;
  m := least(p_count, t.broadcast_credits);
  u := least(p_count - m, t.broadcast_topup_credits);
  update public.tenants set broadcast_credits = broadcast_credits - m,
    broadcast_topup_credits = broadcast_topup_credits - u where id = p_tenant;
  return query select m, u;
end $$$sql_14_19$;
exception when invalid_function_definition then
  -- A newer signature of reserve_broadcast_credits(uuid,integer) is already installed. Its final definition below is mandatory.
  null;
end;

-- payments.sql: source statement 20
begin
execute $sql_14_20$create or replace function public.refund_broadcast_credits(p_tenant uuid, p_monthly integer, p_topup integer)
returns void language plpgsql set search_path = pg_catalog, public as $$
begin
  perform public.refresh_broadcast_credits(p_tenant);
  update public.tenants set
    broadcast_credits = case when broadcast_credit_mode = 'purchased'
      then broadcast_credits + greatest(coalesce(p_monthly, 0), 0)
      else least(broadcast_allowance, broadcast_credits + greatest(coalesce(p_monthly, 0), 0)) end,
    broadcast_topup_credits = broadcast_topup_credits + greatest(coalesce(p_topup, 0), 0)
  where id = p_tenant;
end $$$sql_14_20$;
exception when invalid_function_definition then
  -- A newer signature of refund_broadcast_credits(uuid,integer,integer) is already installed. Its final definition below is mandatory.
  null;
end;

-- payments.sql: source statement 21
execute $sql_14_21$create or replace function public.activate_payment(p_session uuid) returns jsonb
language plpgsql set search_path = pg_catalog, public as $$
declare s public.payment_sessions; r public.payment_receipts; t public.tenants;
begin
  select * into s from public.payment_sessions where id = p_session for update;
  if not found or s.tenant_id is null then raise exception 'Checkout not found'; end if;
  select * into r from public.payment_receipts where session_id = p_session for update;
  if not found then raise exception 'Server-verified payment proof required'; end if;
  if r.amount <> s.price_baht then raise exception 'Payment amount mismatch'; end if;
  if (s.status = 'paid') <> (r.applied_at is not null) then
    raise exception 'Inconsistent payment state';
  end if;
  perform public.refresh_broadcast_credits(s.tenant_id);
  select * into t from public.tenants where id = s.tenant_id for update;
  if not found then raise exception 'Tenant not found'; end if;
  -- Stored proof can be retried after QR expiry; no second credit grant.
  if s.status <> 'paid' then
    update public.tenants set plan = s.plan,
      plan_expires_at = greatest(now(), coalesce(t.plan_expires_at, now())) + interval '720 hours',
      broadcast_credit_mode = 'purchased', broadcast_allowance = s.credits,
      broadcast_credits = broadcast_credits + s.credits,
      broadcast_period = to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM')
    where id = s.tenant_id returning * into t;
    update public.payment_receipts set applied_at = now() where session_id = p_session;
    update public.payment_sessions set status = 'paid', paid_at = now() where id = p_session;
  end if;
  return jsonb_build_object('plan', t.plan, 'planExpiresAt', t.plan_expires_at,
    'monthly', t.broadcast_credits, 'allowance', t.broadcast_allowance, 'topup', t.broadcast_topup_credits);
end $$$sql_14_21$;

-- payments.sql: source statement 22
begin
execute $sql_14_22$create or replace function public.payment_legacy_credit_mode() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.status = 'approved' and old.status <> 'approved' and new.item in ('starter', 'pro') then
    update public.tenants set broadcast_credit_mode = 'purchased' where id = new.tenant_id;
  end if;
  return new;
end $$$sql_14_22$;
exception when invalid_function_definition then
  -- A newer signature of payment_legacy_credit_mode() is already installed. Its final definition below is mandatory.
  null;
end;

-- payments.sql: source statement 23
execute $sql_14_23$drop trigger if exists billing_requests_credit_mode on public.billing_requests$sql_14_23$;

-- payments.sql: source statement 24
execute $sql_14_24$create trigger billing_requests_credit_mode after update on public.billing_requests
for each row execute function public.payment_legacy_credit_mode()$sql_14_24$;

-- payments.sql: source statement 25
execute $sql_14_25$alter table public.payment_sessions enable row level security$sql_14_25$;

-- payments.sql: source statement 26
execute $sql_14_26$alter table public.payment_receipts enable row level security$sql_14_26$;

-- payments.sql: source statement 27
execute $sql_14_27$alter table public.payment_transfer_ledger enable row level security$sql_14_27$;

-- payments.sql: source statement 28
execute $sql_14_28$revoke all on public.payment_sessions, public.payment_receipts, public.payment_transfer_ledger from public, anon, authenticated, service_role$sql_14_28$;

-- payments.sql: source statement 29
execute $sql_14_29$grant select, insert, update on public.payment_sessions to service_role$sql_14_29$;

-- payments.sql: source statement 30
execute $sql_14_30$grant select, insert on public.payment_receipts to service_role$sql_14_30$;

-- payments.sql: source statement 31
execute $sql_14_31$grant update (applied_at) on public.payment_receipts to service_role$sql_14_31$;

-- payments.sql: source statement 32
execute $sql_14_32$grant select on public.payment_transfer_ledger to service_role$sql_14_32$;

-- payments.sql: source statement 33
execute $sql_14_33$revoke all on function public.claim_payment_transfer(text, text, uuid),
  public.guard_payment_receipt(), public.guard_sale_payment_transfer(), public.payment_legacy_credit_mode()
  from public, anon, authenticated, service_role$sql_14_33$;

-- payments.sql: source statement 34
execute $sql_14_34$revoke all on function public.activate_payment(uuid), public.refresh_broadcast_credits(uuid),
  public.reserve_broadcast_credits(uuid, integer), public.refund_broadcast_credits(uuid, integer, integer)
  from public, anon, authenticated$sql_14_34$;

-- payments.sql: source statement 35
execute $sql_14_35$grant execute on function public.activate_payment(uuid), public.refresh_broadcast_credits(uuid),
  public.reserve_broadcast_credits(uuid, integer), public.refund_broadcast_credits(uuid, integer, integer)
  to service_role$sql_14_35$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('payments.sql','4468b9ef949b129fcf39da3468b3e905c7ceb34835b63076faa83b425d8d086b','beed8aa96a89ed77807a78f3c4ccc78a47f8bfaa5c19c585cf6d8552fa7a8fb8');
end $migration_14$;

-- 16. ai-agent-gate.sql
do $migration_15$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='ai-agent-gate.sql';
  if found then
    if installed <> 'd449a8e6524b3fca0a4793349b36d371ba2e93619e64c5aaec68a353a98b03f9' then
      raise exception 'Applied migration changed: ai-agent-gate.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- ai-agent-gate.sql: source statement 2
begin
execute $sql_15_2$create or replace function public.guard_ai_agent_plan() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  return new;
end $$$sql_15_2$;
exception when invalid_function_definition then
  -- A newer signature of guard_ai_agent_plan() is already installed. Its final definition below is mandatory.
  null;
end;

-- ai-agent-gate.sql: source statement 3
execute $sql_15_3$revoke all on function public.guard_ai_agent_plan() from public, anon, authenticated, service_role$sql_15_3$;

-- ai-agent-gate.sql: source statement 4
execute $sql_15_4$drop trigger if exists bot_settings_ai_plan_gate on public.bot_settings$sql_15_4$;

-- ai-agent-gate.sql: source statement 5
execute $sql_15_5$create trigger bot_settings_ai_plan_gate before insert or update on public.bot_settings
for each row execute function public.guard_ai_agent_plan()$sql_15_5$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('ai-agent-gate.sql','d449a8e6524b3fca0a4793349b36d371ba2e93619e64c5aaec68a353a98b03f9','98a7375726bbe02bb525cf6db18f3acf81860ae1e6da1304345c1395265a5387');
end $migration_15$;

-- 17. admin-feature-bypass.sql
do $migration_16$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='admin-feature-bypass.sql';
  if found then
    if installed <> '6ff9ad2bffc6f1800cf595607d1098fd6f7c137bd6ae1afcf85e2f6582f9d580' then
      raise exception 'Applied migration changed: admin-feature-bypass.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- admin-feature-bypass.sql: source statement 2
begin
execute $sql_16_2$create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$$sql_16_2$;
exception when invalid_function_definition then
  -- A newer signature of is_platform_admin() is already installed. Its final definition below is mandatory.
  null;
end;

-- admin-feature-bypass.sql: source statement 3
execute $sql_16_3$revoke all on function public.is_platform_admin() from public, anon$sql_16_3$;

-- admin-feature-bypass.sql: source statement 4
execute $sql_16_4$grant execute on function public.is_platform_admin() to authenticated, service_role$sql_16_4$;

-- admin-feature-bypass.sql: source statement 5
begin
execute $sql_16_5$create or replace function public.tenant_has_feature_bypass(p_tenant uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1 from public.tenant_members m
    join public.platform_admins a on a.user_id = m.user_id
    where m.tenant_id = p_tenant and m.role = 'owner'
  )
$$$sql_16_5$;
exception when invalid_function_definition then
  -- A newer signature of tenant_has_feature_bypass(uuid) is already installed. Its final definition below is mandatory.
  null;
end;

-- admin-feature-bypass.sql: source statement 6
execute $sql_16_6$revoke all on function public.tenant_has_feature_bypass(uuid) from public, anon, authenticated$sql_16_6$;

-- admin-feature-bypass.sql: source statement 7
execute $sql_16_7$grant execute on function public.tenant_has_feature_bypass(uuid) to service_role$sql_16_7$;

-- admin-feature-bypass.sql: source statement 8
execute $sql_16_8$do $$
declare signature text; definition text; function_name text;
begin
  foreach signature in array array[
    'public.consume_slip_credit(uuid)', 'public.refund_slip_credit(uuid)',
    'public.reserve_broadcast_credits(uuid,integer)', 'public.refund_broadcast_credits(uuid,integer,integer)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    function_name := split_part(split_part(signature, '.', 2), '(', 1);
    if position(function_name || '_metered(' in definition) = 0 then
      execute replace(definition, 'FUNCTION public.' || function_name || '(',
                                  'FUNCTION public.' || function_name || '_metered(');
    end if;
  end loop;
end $$$sql_16_8$;

-- admin-feature-bypass.sql: source statement 9
begin
execute $sql_16_9$create or replace function public.consume_slip_credit(p_tenant uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if public.is_platform_admin() or public.tenant_has_feature_bypass(p_tenant) then return true; end if;
  return public.consume_slip_credit_metered(p_tenant);
end $$$sql_16_9$;
exception when invalid_function_definition then
  -- A newer signature of consume_slip_credit(uuid) is already installed. Its final definition below is mandatory.
  null;
end;

-- admin-feature-bypass.sql: source statement 10
begin
execute $sql_16_10$create or replace function public.refund_slip_credit(p_tenant uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if public.is_platform_admin() or public.tenant_has_feature_bypass(p_tenant) then return; end if;
  perform public.refund_slip_credit_metered(p_tenant);
end $$$sql_16_10$;
exception when invalid_function_definition then
  -- A newer signature of refund_slip_credit(uuid) is already installed. Its final definition below is mandatory.
  null;
end;

-- admin-feature-bypass.sql: source statement 11
begin
execute $sql_16_11$create or replace function public.reserve_broadcast_credits(p_tenant uuid, p_count integer)
returns table(monthly integer, topup integer)
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if public.is_platform_admin() or public.tenant_has_feature_bypass(p_tenant) then
    return query select greatest(coalesce(p_count, 0), 0), 0;
    return;
  end if;
  return query select * from public.reserve_broadcast_credits_metered(p_tenant, p_count);
end $$$sql_16_11$;
exception when invalid_function_definition then
  -- A newer signature of reserve_broadcast_credits(uuid,integer) is already installed. Its final definition below is mandatory.
  null;
end;

-- admin-feature-bypass.sql: source statement 12
begin
execute $sql_16_12$create or replace function public.refund_broadcast_credits(p_tenant uuid, p_monthly integer, p_topup integer)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if public.is_platform_admin() or public.tenant_has_feature_bypass(p_tenant) then return; end if;
  perform public.refund_broadcast_credits_metered(p_tenant, p_monthly, p_topup);
end $$$sql_16_12$;
exception when invalid_function_definition then
  -- A newer signature of refund_broadcast_credits(uuid,integer,integer) is already installed. Its final definition below is mandatory.
  null;
end;

-- admin-feature-bypass.sql: source statement 13
execute $sql_16_13$revoke all on function public.consume_slip_credit_metered(uuid), public.refund_slip_credit_metered(uuid),
  public.reserve_broadcast_credits_metered(uuid, integer), public.refund_broadcast_credits_metered(uuid, integer, integer)
  from public, anon, authenticated, service_role$sql_16_13$;

-- admin-feature-bypass.sql: source statement 14
execute $sql_16_14$revoke all on function public.consume_slip_credit(uuid), public.refund_slip_credit(uuid),
  public.reserve_broadcast_credits(uuid, integer), public.refund_broadcast_credits(uuid, integer, integer)
  from public, anon, authenticated$sql_16_14$;

-- admin-feature-bypass.sql: source statement 15
execute $sql_16_15$grant execute on function public.consume_slip_credit(uuid), public.refund_slip_credit(uuid),
  public.reserve_broadcast_credits(uuid, integer), public.refund_broadcast_credits(uuid, integer, integer)
  to service_role$sql_16_15$;

-- admin-feature-bypass.sql: source statement 16
begin
execute $sql_16_16$create or replace function public.guard_ai_agent_plan() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  return new;
end $$$sql_16_16$;
exception when invalid_function_definition then
  -- A newer signature of guard_ai_agent_plan() is already installed. Its final definition below is mandatory.
  null;
end;

-- admin-feature-bypass.sql: source statement 17
execute $sql_16_17$revoke all on function public.guard_ai_agent_plan() from public, anon, authenticated, service_role$sql_16_17$;

-- admin-feature-bypass.sql: source statement 18
execute $sql_16_18$do $$ declare definition text; begin
  definition := pg_get_functiondef('public.approve_billing_request(uuid,uuid)'::regprocedure);
  definition := replace(definition, 'if t.plan = ''free'' then',
    'if t.plan = ''free'' and not public.is_platform_admin() and not public.tenant_has_feature_bypass(r.tenant_id) then');
  execute definition;
end $$$sql_16_18$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('admin-feature-bypass.sql','6ff9ad2bffc6f1800cf595607d1098fd6f7c137bd6ae1afcf85e2f6582f9d580','505b9b486b51a29042e87df33caec70510921bad9f9b9a58fa3f4cc7eaee9c94');
end $migration_16$;

-- 18. billing-slip-topups.sql
do $migration_17$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='billing-slip-topups.sql';
  if found then
    if installed <> 'a453a06f067db688a33340487a0da52fe60206ccc1e59f1ca04c057ae9f50cf3' then
      raise exception 'Applied migration changed: billing-slip-topups.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- billing-slip-topups.sql: source statement 2
execute $sql_17_2$alter table public.tenants add column if not exists slip_quota_credits integer not null default 0
  check (slip_quota_credits >= 0)$sql_17_2$;

-- billing-slip-topups.sql: source statement 3
execute $sql_17_3$alter table public.billing_requests drop constraint if exists billing_requests_item_check$sql_17_3$;

-- billing-slip-topups.sql: source statement 4
execute $sql_17_4$alter table public.billing_requests add constraint billing_requests_item_check
  check (item in ('starter', 'pro', 'topup_s', 'topup_m', 'topup_l', 'slip_topup_s', 'slip_topup_m', 'slip_topup_l'))$sql_17_4$;

-- billing-slip-topups.sql: source statement 5
execute $sql_17_5$grant select (slip_quota_credits) on public.tenants to authenticated$sql_17_5$;

-- billing-slip-topups.sql: source statement 6
execute $sql_17_6$do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.approve_billing_request(uuid,uuid)'::regprocedure);
  if position('slip_quota_credits' in definition) = 0 then
    if position('update tenants set broadcast_topup_credits = broadcast_topup_credits + r.credits where id = r.tenant_id;' in definition) = 0 then
      raise exception 'Unsupported approve_billing_request definition; apply the updated billing.sql first';
    end if;
    definition := replace(definition,
      'update tenants set broadcast_topup_credits = broadcast_topup_credits + r.credits where id = r.tenant_id;',
      'if r.item in (''slip_topup_s'', ''slip_topup_m'', ''slip_topup_l'') then
         update tenants set slip_quota_credits = slip_quota_credits + r.credits where id = r.tenant_id;
       elsif r.item in (''topup_s'', ''topup_m'', ''topup_l'') then
         update tenants set broadcast_topup_credits = broadcast_topup_credits + r.credits where id = r.tenant_id;
       else return ''ไม่พบแพ็กเกจเติมเงินนี้'';
       end if;');
    execute definition;
  end if;
end $$$sql_17_6$;

-- billing-slip-topups.sql: source statement 7
execute $sql_17_7$do $$
declare target text;
begin
  target := case when position('consume_slip_credit_metered(' in
    pg_get_functiondef('public.consume_slip_credit(uuid)'::regprocedure)) > 0
    then 'consume_slip_credit_metered' else 'consume_slip_credit' end;
  execute format('create or replace function public.%I(p_tenant uuid) returns boolean
    language sql set search_path = pg_catalog, public as $body$
      with taken as (
        update public.tenants set slip_used = slip_used + 1
        where id = p_tenant and slip_used::bigint < slip_quota::bigint + slip_quota_credits::bigint
        returning 1
      ) select exists (select 1 from taken)
    $body$', target);
  execute format('revoke all on function public.%I(uuid) from public, anon, authenticated', target);
  if target = 'consume_slip_credit' then
    grant execute on function public.consume_slip_credit(uuid) to service_role;
  else
    revoke all on function public.consume_slip_credit_metered(uuid) from service_role;
  end if;
end $$$sql_17_7$;

-- billing-slip-topups.sql: source statement 8
execute $sql_17_8$revoke all on function public.approve_billing_request(uuid, uuid) from public, anon, authenticated$sql_17_8$;

-- billing-slip-topups.sql: source statement 9
execute $sql_17_9$grant execute on function public.approve_billing_request(uuid, uuid) to service_role$sql_17_9$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('billing-slip-topups.sql','a453a06f067db688a33340487a0da52fe60206ccc1e59f1ca04c057ae9f50cf3','eec994d75fd515114f9425e463de7983a59a66c13b04ec742f958fb821f2da27');
end $migration_17$;

-- 19. platform-dashboard.sql
do $migration_18$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='platform-dashboard.sql';
  if found then
    if installed <> '5df3bd6e13578bd8b9d54e00c9b3d0a92590449542f994d75c733ac708aee951' then
      raise exception 'Applied migration changed: platform-dashboard.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- platform-dashboard.sql: source statement 2
execute $sql_18_2$alter table public.tenants add column if not exists is_active boolean not null default true$sql_18_2$;

-- platform-dashboard.sql: source statement 3
execute $sql_18_3$alter table public.billing_requests add column if not exists proof_path text$sql_18_3$;

-- platform-dashboard.sql: source statement 4
execute $sql_18_4$alter table public.billing_requests add column if not exists proof_uploaded_at timestamptz$sql_18_4$;

-- platform-dashboard.sql: source statement 5
execute $sql_18_5$grant select (is_active) on public.tenants to authenticated$sql_18_5$;

-- platform-dashboard.sql: source statement 6
execute $sql_18_6$create table if not exists public.platform_tenant_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete set null,
  admin_id uuid references auth.users(id) on delete set null,
  before_state jsonb not null,
  after_state jsonb not null,
  created_at timestamptz not null default now()
)$sql_18_6$;

-- platform-dashboard.sql: source statement 7
execute $sql_18_7$alter table public.platform_tenant_audit enable row level security$sql_18_7$;

-- platform-dashboard.sql: source statement 8
execute $sql_18_8$revoke all on public.platform_tenant_audit from anon, authenticated$sql_18_8$;

-- platform-dashboard.sql: source statement 9
execute $sql_18_9$grant select, insert on public.platform_tenant_audit to service_role$sql_18_9$;

-- platform-dashboard.sql: source statement 10
begin
execute $sql_18_10$create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$$sql_18_10$;
exception when invalid_function_definition then
  -- A newer signature of is_platform_admin() is already installed. Its final definition below is mandatory.
  null;
end;

-- platform-dashboard.sql: source statement 11
execute $sql_18_11$revoke all on function public.is_platform_admin() from public, anon$sql_18_11$;

-- platform-dashboard.sql: source statement 12
execute $sql_18_12$grant execute on function public.is_platform_admin() to authenticated, service_role$sql_18_12$;

-- platform-dashboard.sql: source statement 13
execute $sql_18_13$create or replace function public.can_access_tenant(p_tenant uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select public.is_platform_admin() or (
    p_tenant is not null
    and exists (select 1 from public.tenants where id = p_tenant and is_active)
    and exists (select 1 from public.tenant_members where tenant_id = p_tenant and user_id = auth.uid())
  )
$$$sql_18_13$;

-- platform-dashboard.sql: source statement 14
execute $sql_18_14$revoke all on function public.can_access_tenant(uuid) from public, anon$sql_18_14$;

-- platform-dashboard.sql: source statement 15
execute $sql_18_15$grant execute on function public.can_access_tenant(uuid) to authenticated$sql_18_15$;

-- platform-dashboard.sql: source statement 16
execute $sql_18_16$create or replace function public.platform_dashboard_overview() returns jsonb
language sql set search_path = pg_catalog, public as $$
  with bounds as (
    select date_trunc('month', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok' as starts_at,
      (date_trunc('month', now() at time zone 'Asia/Bangkok') + interval '1 month') at time zone 'Asia/Bangkok' as ends_at
  )
  select jsonb_build_object(
    'tenantCount', (select count(*) from public.tenants),
    'activeTenantCount', (select count(*) from public.tenants where is_active),
    'pendingCount', (select count(*) from public.billing_requests where status = 'pending'),
    'pendingAmount', (select coalesce(sum(price_baht), 0) from public.billing_requests where status = 'pending'),
    'monthRevenue', (
      select coalesce(sum(amount), 0) from (
        select price_baht as amount from public.billing_requests, bounds
          where status = 'approved' and decided_at >= starts_at and decided_at < ends_at
        union all
        select price_baht as amount from public.payment_sessions, bounds
          where status = 'paid' and paid_at >= starts_at and paid_at < ends_at
      ) received
    )
  )
$$$sql_18_16$;

-- platform-dashboard.sql: source statement 17
execute $sql_18_17$revoke all on function public.platform_dashboard_overview() from public, anon, authenticated$sql_18_17$;

-- platform-dashboard.sql: source statement 18
execute $sql_18_18$grant execute on function public.platform_dashboard_overview() to service_role$sql_18_18$;

-- platform-dashboard.sql: source statement 19
begin
execute $sql_18_19$create or replace function public.platform_update_tenant(
  p_tenant uuid, p_admin uuid, p_plan text default null, p_active boolean default null
) returns void
language plpgsql set search_path = pg_catalog, public as $$
declare t public.tenants; updated public.tenants; allowance integer;
begin
  if not exists (select 1 from public.platform_admins where user_id = p_admin) then
    raise exception 'Only platform admins may manage tenants' using errcode = '42501';
  end if;
  if p_plan is not null and p_plan not in ('free', 'starter', 'pro') then
    raise exception 'Unknown plan' using errcode = '22023';
  end if;
  if p_plan is null and p_active is null then raise exception 'No changes supplied' using errcode = '22023'; end if;
  select * into t from public.tenants where id = p_tenant for update;
  if not found then raise exception 'Tenant not found' using errcode = 'P0002'; end if;
  if p_plan is not null then
    allowance := case p_plan when 'free' then 100 when 'starter' then 1500 when 'pro' then 7500 end;
    update public.tenants set plan = p_plan,
      plan_expires_at = case when p_plan = 'free' then null else now() + interval '30 days' end,
      broadcast_allowance = allowance, broadcast_credits = allowance,
      broadcast_credit_mode = case when p_plan = 'free' then 'calendar' else 'purchased' end,
      broadcast_period = to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM')
    where id = p_tenant;
  end if;
  if p_active is not null then update public.tenants set is_active = p_active where id = p_tenant; end if;
  select * into updated from public.tenants where id = p_tenant;
  insert into public.platform_tenant_audit(tenant_id,admin_id,before_state,after_state)
    values(p_tenant,p_admin,
      jsonb_build_object('plan',t.plan,'expiresAt',t.plan_expires_at,'active',t.is_active,'broadcastCredits',t.broadcast_credits),
      jsonb_build_object('plan',updated.plan,'expiresAt',updated.plan_expires_at,'active',updated.is_active,'broadcastCredits',updated.broadcast_credits));
end $$$sql_18_19$;
exception when invalid_function_definition then
  -- A newer signature of platform_update_tenant(uuid,uuid,text,boolean) is already installed. Its final definition below is mandatory.
  null;
end;

-- platform-dashboard.sql: source statement 20
execute $sql_18_20$revoke all on function public.platform_update_tenant(uuid,uuid,text,boolean) from public, anon, authenticated$sql_18_20$;

-- platform-dashboard.sql: source statement 21
execute $sql_18_21$grant execute on function public.platform_update_tenant(uuid,uuid,text,boolean) to service_role$sql_18_21$;

-- platform-dashboard.sql: source statement 22
execute $sql_18_22$insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('billing-proofs','billing-proofs',false,5242880,array['image/jpeg','image/png','image/webp'])
  on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types$sql_18_22$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('platform-dashboard.sql','5df3bd6e13578bd8b9d54e00c9b3d0a92590449542f994d75c733ac708aee951','115e3a8815ed8c6dfb15d25ccce5f4568e89fdcdc28dccedc3fde06364dd01ce');
end $migration_18$;

-- 20. platform-admin-db-only.sql
do $migration_19$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='platform-admin-db-only.sql';
  if found then
    if installed <> '4750073812a42bad938a91d18bca4196dc0977488f907730406e2e72dc41b630' then
      raise exception 'Applied migration changed: platform-admin-db-only.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- platform-admin-db-only.sql: source statement 2
execute $sql_19_2$create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$$sql_19_2$;

-- platform-admin-db-only.sql: source statement 3
execute $sql_19_3$create or replace function public.tenant_has_feature_bypass(p_tenant uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1 from public.tenant_members m
    join public.platform_admins a on a.user_id = m.user_id
    where m.tenant_id = p_tenant and m.role = 'owner'
  )
$$$sql_19_3$;

-- platform-admin-db-only.sql: source statement 4
begin
execute $sql_19_4$create or replace function public.platform_update_tenant(
  p_tenant uuid, p_admin uuid, p_plan text default null, p_active boolean default null
) returns void
language plpgsql set search_path = pg_catalog, public as $$
declare t public.tenants; updated public.tenants; allowance integer;
begin
  if not exists (select 1 from public.platform_admins where user_id = p_admin) then
    raise exception 'Only platform admins may manage tenants' using errcode = '42501';
  end if;
  if p_plan is not null and p_plan not in ('free', 'starter', 'pro') then
    raise exception 'Unknown plan' using errcode = '22023';
  end if;
  if p_plan is null and p_active is null then raise exception 'No changes supplied' using errcode = '22023'; end if;
  select * into t from public.tenants where id = p_tenant for update;
  if not found then raise exception 'Tenant not found' using errcode = 'P0002'; end if;
  if p_plan is not null then
    allowance := case p_plan when 'free' then 100 when 'starter' then 1500 when 'pro' then 7500 end;
    update public.tenants set plan = p_plan,
      plan_expires_at = case when p_plan = 'free' then null else now() + interval '30 days' end,
      broadcast_allowance = allowance, broadcast_credits = allowance,
      broadcast_credit_mode = case when p_plan = 'free' then 'calendar' else 'purchased' end,
      broadcast_period = to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM')
    where id = p_tenant;
  end if;
  if p_active is not null then update public.tenants set is_active = p_active where id = p_tenant; end if;
  select * into updated from public.tenants where id = p_tenant;
  insert into public.platform_tenant_audit(tenant_id,admin_id,before_state,after_state)
    values(p_tenant,p_admin,
      jsonb_build_object('plan',t.plan,'expiresAt',t.plan_expires_at,'active',t.is_active,'broadcastCredits',t.broadcast_credits),
      jsonb_build_object('plan',updated.plan,'expiresAt',updated.plan_expires_at,'active',updated.is_active,'broadcastCredits',updated.broadcast_credits));
end $$$sql_19_4$;
exception when invalid_function_definition then
  -- A newer signature of platform_update_tenant(uuid,uuid,text,boolean) is already installed. Its final definition below is mandatory.
  null;
end;

-- platform-admin-db-only.sql: source statement 5
execute $sql_19_5$revoke all on function public.is_platform_admin() from public, anon$sql_19_5$;

-- platform-admin-db-only.sql: source statement 6
execute $sql_19_6$grant execute on function public.is_platform_admin() to authenticated, service_role$sql_19_6$;

-- platform-admin-db-only.sql: source statement 7
execute $sql_19_7$revoke all on function public.tenant_has_feature_bypass(uuid), public.platform_update_tenant(uuid,uuid,text,boolean) from public, anon, authenticated$sql_19_7$;

-- platform-admin-db-only.sql: source statement 8
execute $sql_19_8$grant execute on function public.tenant_has_feature_bypass(uuid), public.platform_update_tenant(uuid,uuid,text,boolean) to service_role$sql_19_8$;

-- platform-admin-db-only.sql: source statement 9
execute $sql_19_9$notify pgrst, 'reload schema'$sql_19_9$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('platform-admin-db-only.sql','4750073812a42bad938a91d18bca4196dc0977488f907730406e2e72dc41b630','560dbeeb0cab3c2302461257f01e139c0826b1d4f693d8a9def7801d9b529236');
end $migration_19$;

-- 21. billing-auto-approval.sql
do $migration_20$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='billing-auto-approval.sql';
  if found then
    if installed <> 'feeef0599137eab6c196050bcc3ad286a283fddf81fe6b2d900b431c8fb53514' then
      raise exception 'Applied migration changed: billing-auto-approval.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- billing-auto-approval.sql: source statement 2
execute $sql_20_2$alter table public.billing_requests add column if not exists receiver_promptpay_id text$sql_20_2$;

-- billing-auto-approval.sql: source statement 3
execute $sql_20_3$alter table public.billing_requests add column if not exists receiver_account_no text$sql_20_3$;

-- billing-auto-approval.sql: source statement 4
execute $sql_20_4$alter table public.billing_requests add column if not exists receiver_bank_code text$sql_20_4$;

-- billing-auto-approval.sql: source statement 5
execute $sql_20_5$alter table public.billing_requests add column if not exists verification_status text not null default 'pending'
  check (verification_status in ('pending','failed','verified'))$sql_20_5$;

-- billing-auto-approval.sql: source statement 6
execute $sql_20_6$alter table public.billing_requests add column if not exists verification_error text$sql_20_6$;

-- billing-auto-approval.sql: source statement 7
execute $sql_20_7$alter table public.billing_requests add column if not exists proof_sha256 text check (proof_sha256 ~ '^[0-9a-f]{64}$')$sql_20_7$;

-- billing-auto-approval.sql: source statement 8
execute $sql_20_8$alter table public.payment_transfer_ledger drop constraint if exists payment_transfer_ledger_source_check$sql_20_8$;

-- billing-auto-approval.sql: source statement 9
execute $sql_20_9$alter table public.payment_transfer_ledger add constraint payment_transfer_ledger_source_check
  check(source in ('package','sale','billing','standalone'))$sql_20_9$;

-- billing-auto-approval.sql: source statement 10
execute $sql_20_10$create table if not exists public.payment_image_ledger (
  image_sha256 text primary key check (image_sha256 ~ '^[0-9a-f]{64}$'),
  source text not null check (source in ('package','billing')),
  source_id uuid not null,
  created_at timestamptz not null default now()
)$sql_20_10$;

-- billing-auto-approval.sql: source statement 11
execute $sql_20_11$alter table public.payment_image_ledger enable row level security$sql_20_11$;

-- billing-auto-approval.sql: source statement 12
execute $sql_20_12$revoke all on public.payment_image_ledger from anon,authenticated$sql_20_12$;

-- billing-auto-approval.sql: source statement 13
execute $sql_20_13$grant select,insert on public.payment_image_ledger to service_role$sql_20_13$;

-- billing-auto-approval.sql: source statement 15
execute $sql_20_15$insert into public.payment_image_ledger(image_sha256,source,source_id)
  select image_sha256,'package',session_id from public.payment_receipts on conflict do nothing$sql_20_15$;

-- billing-auto-approval.sql: source statement 16
execute $sql_20_16$do $$ begin
  if exists(select 1 from public.payment_receipts r join public.payment_image_ledger l using(image_sha256)
    where l.source <> 'package' or l.source_id <> r.session_id) then
    raise exception 'Existing image proof conflicts';
  end if;
end $$$sql_20_16$;

-- billing-auto-approval.sql: source statement 17
execute $sql_20_17$create or replace function public.claim_payment_image(p_hash text,p_source text,p_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog,public as $$
begin
  insert into public.payment_image_ledger(image_sha256,source,source_id) values(p_hash,p_source,p_id) on conflict do nothing;
  if not exists(select 1 from public.payment_image_ledger where image_sha256=p_hash and source=p_source and source_id=p_id) then
    raise exception 'Image already accepted' using errcode='23505';
  end if;
end $$$sql_20_17$;

-- billing-auto-approval.sql: source statement 18
execute $sql_20_18$create or replace function public.guard_package_payment_image() returns trigger
language plpgsql security definer set search_path = pg_catalog,public as $$
begin
  perform public.claim_payment_image(new.image_sha256,'package',new.session_id);
  return new;
end $$$sql_20_18$;

-- billing-auto-approval.sql: source statement 19
execute $sql_20_19$drop trigger if exists payment_receipts_image_guard on public.payment_receipts$sql_20_19$;

-- billing-auto-approval.sql: source statement 20
execute $sql_20_20$create trigger payment_receipts_image_guard before insert on public.payment_receipts
for each row execute function public.guard_package_payment_image()$sql_20_20$;

-- billing-auto-approval.sql: source statement 21
execute $sql_20_21$do $$ declare definition text; begin
  definition := pg_get_functiondef('public.guard_payment_receipt()'::regprocedure);
  execute replace(definition,'new.amount <> s.price_baht','new.amount < s.price_baht');
  definition := pg_get_functiondef('public.activate_payment(uuid)'::regprocedure);
  execute replace(definition,'r.amount <> s.price_baht','r.amount < s.price_baht');
end $$$sql_20_21$;

-- billing-auto-approval.sql: source statement 22
execute $sql_20_22$create table if not exists public.billing_payment_receipts (
  request_id uuid primary key references public.billing_requests(id) on delete restrict,
  trans_ref text not null unique check (length(trim(trans_ref)) between 1 and 200 and trans_ref=trim(trans_ref)),
  image_sha256 text not null unique check (image_sha256 ~ '^[0-9a-f]{64}$'),
  amount numeric(12,2) not null check (amount>0),
  paid_at timestamptz not null,
  verified_at timestamptz not null default now(),
  applied_at timestamptz
)$sql_20_22$;

-- billing-auto-approval.sql: source statement 23
execute $sql_20_23$alter table public.billing_payment_receipts enable row level security$sql_20_23$;

-- billing-auto-approval.sql: source statement 24
execute $sql_20_24$revoke all on public.billing_payment_receipts from anon,authenticated$sql_20_24$;

-- billing-auto-approval.sql: source statement 25
execute $sql_20_25$grant select,insert,update on public.billing_payment_receipts to service_role$sql_20_25$;

-- billing-auto-approval.sql: source statement 26
execute $sql_20_26$create or replace function public.guard_billing_payment_receipt() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.billing_requests;
begin
  if tg_op='UPDATE' then
    if new.request_id is distinct from old.request_id or new.trans_ref is distinct from old.trans_ref
      or new.image_sha256 is distinct from old.image_sha256 or new.amount is distinct from old.amount
      or new.paid_at is distinct from old.paid_at or new.verified_at is distinct from old.verified_at
      or (old.applied_at is not null and new.applied_at is distinct from old.applied_at) then
      raise exception 'Verified billing proof is immutable';
    end if;
    return new;
  end if;
  select * into r from public.billing_requests where id=new.request_id for update;
  if not found or r.status<>'pending' or r.proof_path is null then raise exception 'Request is not payable'; end if;
  if new.amount<r.price_baht or new.applied_at is not null
    or (r.proof_sha256 is not null and new.image_sha256<>r.proof_sha256)
    or new.paid_at<r.created_at-interval '2 minutes' or new.paid_at>clock_timestamp()+interval '2 minutes' then
    raise exception 'Payment amount or transfer time invalid';
  end if;
  perform public.claim_payment_transfer(new.trans_ref,'billing',new.request_id);
  perform public.claim_payment_image(new.image_sha256,'billing',new.request_id);
  return new;
end $$$sql_20_26$;

-- billing-auto-approval.sql: source statement 27
execute $sql_20_27$drop trigger if exists billing_payment_receipts_guard on public.billing_payment_receipts$sql_20_27$;

-- billing-auto-approval.sql: source statement 28
execute $sql_20_28$create trigger billing_payment_receipts_guard before insert or update on public.billing_payment_receipts
for each row execute function public.guard_billing_payment_receipt()$sql_20_28$;

-- billing-auto-approval.sql: source statement 29
execute $sql_20_29$create or replace function public.guard_billing_approved_image() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.status='approved' and old.status<>'approved' and new.proof_sha256 is not null then
    perform public.claim_payment_image(new.proof_sha256,'billing',new.id);
  end if;
  return new;
end $$$sql_20_29$;

-- billing-auto-approval.sql: source statement 30
execute $sql_20_30$drop trigger if exists billing_requests_approved_image_guard on public.billing_requests$sql_20_30$;

-- billing-auto-approval.sql: source statement 31
execute $sql_20_31$create trigger billing_requests_approved_image_guard before update on public.billing_requests
for each row execute function public.guard_billing_approved_image()$sql_20_31$;

-- billing-auto-approval.sql: source statement 32
execute $sql_20_32$create or replace function public.activate_billing_payment(p_request uuid) returns boolean
language plpgsql set search_path=pg_catalog,public as $$
declare r public.billing_requests; proof public.billing_payment_receipts; refused text;
begin
  select * into r from public.billing_requests where id=p_request for update;
  if not found then raise exception 'Request not found'; end if;
  select * into proof from public.billing_payment_receipts where request_id=p_request for update;
  if not found then raise exception 'Server-verified proof required'; end if;
  if r.status='approved' then
    update public.billing_requests set verification_status='verified',verification_error=null where id=p_request;
    update public.billing_payment_receipts set applied_at=coalesce(applied_at,now()) where request_id=p_request;
    return true;
  end if;
  if r.status<>'pending' then raise exception 'Request is no longer pending'; end if;
  if not exists(select 1 from public.tenants where id=r.tenant_id and is_active) then raise exception 'Tenant inactive'; end if;
  refused := public.approve_billing_request(p_request,null);
  if refused is not null then raise exception '%',refused; end if;
  update public.billing_requests set verification_status='verified',verification_error=null where id=p_request;
  update public.billing_payment_receipts set applied_at=now() where request_id=p_request;
  return true;
end $$$sql_20_32$;

-- billing-auto-approval.sql: source statement 33
execute $sql_20_33$revoke all on function public.activate_billing_payment(uuid),public.claim_payment_image(text,text,uuid),
  public.guard_package_payment_image(),public.guard_billing_payment_receipt(),public.guard_billing_approved_image() from public,anon,authenticated$sql_20_33$;

-- billing-auto-approval.sql: source statement 34
execute $sql_20_34$grant execute on function public.activate_billing_payment(uuid) to service_role$sql_20_34$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('billing-auto-approval.sql','feeef0599137eab6c196050bcc3ad286a283fddf81fe6b2d900b431c8fb53514','a4ca6ff4e6b74ae24d0a8dd45b66bcd3805e880cff8c9c389de9929dc6d78181');
end $migration_20$;

-- 22. bank-accounts.sql
do $migration_21$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='bank-accounts.sql';
  if found then
    if installed <> 'e3d3781d4e2356c08edf1778ccbd5c56fb4013a242ae410d4b5a928508bb1228' then
      raise exception 'Applied migration changed: bank-accounts.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- bank-accounts.sql: source statement 2
execute $sql_21_2$alter table public.tenants alter column bank_code drop not null$sql_21_2$;

-- bank-accounts.sql: source statement 3
execute $sql_21_3$alter table public.tenants alter column account_number drop not null$sql_21_3$;

-- bank-accounts.sql: source statement 4
execute $sql_21_4$create table if not exists public.bank_accounts (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
 bank_code text not null check(bank_code in ('KBANK','SCB','BBL','KTB','BAY','TTB','GSB','PROMPTPAY')),
 account_name text not null check(length(trim(account_name)) between 1 and 120),
 account_number text not null check(account_number ~ '^[0-9]{10,15}$'),
 is_active boolean not null default true, created_at timestamptz not null default now(),
 unique(tenant_id,bank_code,account_number)
)$sql_21_4$;

-- bank-accounts.sql: source statement 5
execute $sql_21_5$alter table public.bank_accounts enable row level security$sql_21_5$;

-- bank-accounts.sql: source statement 6
execute $sql_21_6$create index if not exists bank_accounts_active on public.bank_accounts(tenant_id,is_active)$sql_21_6$;

-- bank-accounts.sql: source statement 7
execute $sql_21_7$create or replace function public.can_manage_bank_accounts(p_tenant uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select public.is_platform_admin() or (public.can_access_tenant(p_tenant) and exists(
 select 1 from public.tenant_members where tenant_id=p_tenant and user_id=auth.uid() and role='owner'))
$$$sql_21_7$;

-- bank-accounts.sql: source statement 8
execute $sql_21_8$revoke all on function public.can_manage_bank_accounts(uuid) from public,anon$sql_21_8$;

-- bank-accounts.sql: source statement 9
execute $sql_21_9$grant execute on function public.can_manage_bank_accounts(uuid) to authenticated$sql_21_9$;

-- bank-accounts.sql: source statement 10
execute $sql_21_10$drop policy if exists member_read on public.bank_accounts$sql_21_10$;

-- bank-accounts.sql: source statement 11
execute $sql_21_11$create policy member_read on public.bank_accounts for select to authenticated using(public.can_access_tenant(tenant_id))$sql_21_11$;

-- bank-accounts.sql: source statement 12
execute $sql_21_12$drop policy if exists owner_write on public.bank_accounts$sql_21_12$;

-- bank-accounts.sql: source statement 13
execute $sql_21_13$create policy owner_write on public.bank_accounts for all to authenticated using(public.can_manage_bank_accounts(tenant_id)) with check(public.can_manage_bank_accounts(tenant_id))$sql_21_13$;

-- bank-accounts.sql: source statement 14
execute $sql_21_14$revoke all on public.bank_accounts from anon$sql_21_14$;

-- bank-accounts.sql: source statement 15
execute $sql_21_15$grant select,insert,update,delete on public.bank_accounts to authenticated,service_role$sql_21_15$;

-- bank-accounts.sql: source statement 16
execute $sql_21_16$alter table public.tenants add column if not exists bank_accounts_migrated boolean not null default false$sql_21_16$;

-- bank-accounts.sql: source statement 19
begin
execute $sql_21_19$create or replace function public.sync_primary_bank_account() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare target uuid; selected public.bank_accounts;
begin
 target:=case when tg_op='DELETE' then old.tenant_id else new.tenant_id end;
 if tg_op='UPDATE' and new.tenant_id<>old.tenant_id then raise exception 'Cannot move bank accounts between shops'; end if;
 perform 1 from public.tenants where id=target for update;
 select * into selected from public.bank_accounts where tenant_id=target and is_active order by created_at,id limit 1;
 update public.tenants set bank_code=selected.bank_code,account_name=selected.account_name,account_number=selected.account_number where id=target;
 return null;
end $$$sql_21_19$;
exception when invalid_function_definition then
  -- A newer signature of sync_primary_bank_account() is already installed. Its final definition below is mandatory.
  null;
end;

-- bank-accounts.sql: source statement 20
execute $sql_21_20$drop trigger if exists bank_accounts_primary on public.bank_accounts$sql_21_20$;

-- bank-accounts.sql: source statement 21
execute $sql_21_21$create trigger bank_accounts_primary after insert or update or delete on public.bank_accounts for each row execute function public.sync_primary_bank_account()$sql_21_21$;

-- bank-accounts.sql: source statement 22
begin
execute $sql_21_22$create or replace function public.seed_tenant_bank_account() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 update public.tenants set bank_accounts_migrated=true where id=new.id;
 if new.bank_code in ('KBANK','SCB','BBL','KTB','BAY','TTB','GSB','PROMPTPAY') and new.account_number ~ '^[0-9]{10,15}$' then
 insert into public.bank_accounts(tenant_id,bank_code,account_name,account_number) values(new.id,new.bank_code,coalesce(nullif(trim(new.account_name),''),new.name),new.account_number) on conflict do nothing;
 end if;
 return null;
end $$$sql_21_22$;
exception when invalid_function_definition then
  -- A newer signature of seed_tenant_bank_account() is already installed. Its final definition below is mandatory.
  null;
end;

-- bank-accounts.sql: source statement 23
execute $sql_21_23$drop trigger if exists tenants_seed_bank_account on public.tenants$sql_21_23$;

-- bank-accounts.sql: source statement 24
execute $sql_21_24$create trigger tenants_seed_bank_account after insert on public.tenants for each row execute function public.seed_tenant_bank_account()$sql_21_24$;

-- bank-accounts.sql: source statement 25
execute $sql_21_25$revoke all on function public.sync_primary_bank_account(),public.seed_tenant_bank_account() from public,anon,authenticated$sql_21_25$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('bank-accounts.sql','e3d3781d4e2356c08edf1778ccbd5c56fb4013a242ae410d4b5a928508bb1228','9c383587c7273304231ed76384c0222584dd69c03088a3ce5ac29f8bfcdbf540');
end $migration_21$;

-- 23. image-response-rules.sql
do $migration_22$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='image-response-rules.sql';
  if found then
    if installed <> '13d0e1e6fd37e19e2af9f37e38554aa3507424f62ea87d710f0747810c937258' then
      raise exception 'Applied migration changed: image-response-rules.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- image-response-rules.sql: source statement 2
execute $sql_22_2$create table if not exists public.image_response_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check(length(trim(name)) between 1 and 100),
  trigger_type text not null check(trigger_type in ('slip','general','product')),
  response_text text check(length(response_text)<=2000),
  media_url text check(media_url is null or (length(media_url)<=2048 and media_url ~ '^https?://[^[:space:]]+$')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(nullif(trim(response_text),'') is not null or nullif(trim(media_url),'') is not null)
)$sql_22_2$;

-- image-response-rules.sql: source statement 3
execute $sql_22_3$create index if not exists image_response_rules_tenant on public.image_response_rules(tenant_id,created_at desc)$sql_22_3$;

-- image-response-rules.sql: source statement 4
execute $sql_22_4$alter table public.image_response_rules enable row level security$sql_22_4$;

-- image-response-rules.sql: source statement 5
execute $sql_22_5$create or replace function public.can_manage_image_rules(p_tenant uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
  select public.is_platform_admin() or (public.can_access_tenant(p_tenant) and exists(
    select 1 from public.tenant_members where tenant_id=p_tenant and user_id=auth.uid() and role='owner'
  ))
$$$sql_22_5$;

-- image-response-rules.sql: source statement 6
execute $sql_22_6$revoke all on function public.can_manage_image_rules(uuid) from public,anon$sql_22_6$;

-- image-response-rules.sql: source statement 7
execute $sql_22_7$grant execute on function public.can_manage_image_rules(uuid) to authenticated$sql_22_7$;

-- image-response-rules.sql: source statement 8
execute $sql_22_8$drop policy if exists member_read on public.image_response_rules$sql_22_8$;

-- image-response-rules.sql: source statement 9
execute $sql_22_9$create policy member_read on public.image_response_rules for select to authenticated using(public.can_access_tenant(tenant_id))$sql_22_9$;

-- image-response-rules.sql: source statement 10
execute $sql_22_10$drop policy if exists owner_insert on public.image_response_rules$sql_22_10$;

-- image-response-rules.sql: source statement 11
execute $sql_22_11$create policy owner_insert on public.image_response_rules for insert to authenticated with check(public.can_manage_image_rules(tenant_id))$sql_22_11$;

-- image-response-rules.sql: source statement 12
execute $sql_22_12$drop policy if exists owner_update on public.image_response_rules$sql_22_12$;

-- image-response-rules.sql: source statement 13
execute $sql_22_13$create policy owner_update on public.image_response_rules for update to authenticated using(public.can_manage_image_rules(tenant_id)) with check(public.can_manage_image_rules(tenant_id))$sql_22_13$;

-- image-response-rules.sql: source statement 14
execute $sql_22_14$drop policy if exists owner_delete on public.image_response_rules$sql_22_14$;

-- image-response-rules.sql: source statement 15
execute $sql_22_15$create policy owner_delete on public.image_response_rules for delete to authenticated using(public.can_manage_image_rules(tenant_id))$sql_22_15$;

-- image-response-rules.sql: source statement 16
execute $sql_22_16$grant select,insert,update,delete on public.image_response_rules to authenticated,service_role$sql_22_16$;

-- image-response-rules.sql: source statement 17
execute $sql_22_17$revoke all on public.image_response_rules from anon$sql_22_17$;

-- image-response-rules.sql: source statement 18
execute $sql_22_18$create or replace function public.touch_image_response_rule() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin new.updated_at=now(); new.created_at=old.created_at; return new; end $$$sql_22_18$;

-- image-response-rules.sql: source statement 19
execute $sql_22_19$drop trigger if exists image_response_rules_updated on public.image_response_rules$sql_22_19$;

-- image-response-rules.sql: source statement 20
execute $sql_22_20$create trigger image_response_rules_updated before update on public.image_response_rules
for each row execute function public.touch_image_response_rule()$sql_22_20$;

-- image-response-rules.sql: source statement 21
execute $sql_22_21$revoke all on function public.touch_image_response_rule() from public,anon,authenticated$sql_22_21$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('image-response-rules.sql','13d0e1e6fd37e19e2af9f37e38554aa3507424f62ea87d710f0747810c937258','6ac37623854295af127243c2f8d21167f01de236a6c9eeeb6d8cf751347a93fe');
end $migration_22$;

-- 24. followup-plan-gate.sql
do $migration_23$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='followup-plan-gate.sql';
  if found then
    if installed <> '1083e3985db9432c52f395a2f33cfe5addc3862033595d84204ea394422476b2' then
      raise exception 'Applied migration changed: followup-plan-gate.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- followup-plan-gate.sql: source statement 2
begin
execute $sql_23_2$create or replace function public.guard_followup_plan() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.followup_enabled and not public.is_platform_admin()
    and not public.tenant_has_feature_bypass(new.tenant_id) and not exists (
      select 1 from public.tenants where id = new.tenant_id and plan in ('starter', 'pro')
        and (plan_expires_at is null or plan_expires_at > now())
    ) then
    raise exception 'กรุณาอัปเกรดแพ็กเกจเพื่อใช้ผู้ช่วยติดตามลูกค้า' using errcode = '42501';
  end if;
  return new;
end $$$sql_23_2$;
exception when invalid_function_definition then
  -- A newer signature of guard_followup_plan() is already installed. Its final definition below is mandatory.
  null;
end;

-- followup-plan-gate.sql: source statement 3
execute $sql_23_3$revoke all on function public.guard_followup_plan() from public, anon, authenticated, service_role$sql_23_3$;

-- followup-plan-gate.sql: source statement 4
execute $sql_23_4$drop trigger if exists bot_settings_followup_plan_gate on public.bot_settings$sql_23_4$;

-- followup-plan-gate.sql: source statement 5
execute $sql_23_5$create trigger bot_settings_followup_plan_gate before insert or update of followup_enabled, followup_steps
on public.bot_settings for each row execute function public.guard_followup_plan()$sql_23_5$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('followup-plan-gate.sql','1083e3985db9432c52f395a2f33cfe5addc3862033595d84204ea394422476b2','8722938e430e15924bae4bb6bb40330ff247996564aa94ba803b01b59296f96f');
end $migration_23$;

-- 25. package-access.sql
do $migration_24$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='package-access.sql';
  if found then
    if installed <> 'f006837de30cdec18321f59719677234255e09d83bdf1e4c49f244fb977818b7' then
      raise exception 'Applied migration changed: package-access.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- package-access.sql: source statement 2
execute $sql_24_2$create or replace function public.approve_billing_request(p_request uuid, p_admin uuid) returns text
language plpgsql set search_path = pg_catalog, public as $$
declare
  r billing_requests;
  t tenants;
  this_month text := to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM');
begin
  select * into r from billing_requests where id = p_request for update;
  if not found then return 'ไม่พบคำขอนี้'; end if;
  if r.status = 'approved' then return null; end if;
  if r.status <> 'pending' then return 'คำขอนี้ถูกดำเนินการไปแล้ว'; end if;
  perform refresh_broadcast_credits(r.tenant_id);
  select * into t from tenants where id = r.tenant_id for update;

  if r.item in ('starter', 'pro') then
    update tenants set
      plan = r.item,
      plan_expires_at = (case when t.plan = r.item and t.plan_expires_at > now() then t.plan_expires_at else now() end) + interval '30 days',
      broadcast_allowance = r.credits,
      broadcast_credits = broadcast_credits + r.credits,
      broadcast_period = this_month
    where id = r.tenant_id;
  else
    if r.item in ('slip_topup_s', 'slip_topup_m', 'slip_topup_l') then
      update tenants set slip_quota_credits = slip_quota_credits + r.credits where id = r.tenant_id;
    elsif r.item in ('topup_s', 'topup_m', 'topup_l') then
      -- Keep purchased broadcast credits in their non-expiring bucket.
      update tenants set broadcast_topup_credits = broadcast_topup_credits + r.credits where id = r.tenant_id;
    else
      return 'ไม่พบแพ็กเกจเติมเงินนี้';
    end if;
  end if;

  update billing_requests set status = 'approved', decided_by = p_admin, decided_at = now() where id = p_request;
  return null;
end $$$sql_24_2$;

-- package-access.sql: source statement 3
execute $sql_24_3$create or replace function public.payment_legacy_credit_mode() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.status = 'approved' and old.status <> 'approved' and new.item in ('starter', 'pro') then
    update public.tenants set broadcast_credit_mode = 'purchased' where id = new.tenant_id;
  end if;
  return new;
end $$$sql_24_3$;

-- package-access.sql: source statement 4
begin
execute $sql_24_4$create or replace function public.guard_ai_agent_plan() returns trigger language plpgsql set search_path=pg_catalog,public as $$ begin return new; end $$$sql_24_4$;
exception when invalid_function_definition then
  -- A newer signature of guard_ai_agent_plan() is already installed. Its final definition below is mandatory.
  null;
end;

-- package-access.sql: source statement 5
execute $sql_24_5$revoke all on function public.approve_billing_request(uuid,uuid) from public,anon,authenticated$sql_24_5$;

-- package-access.sql: source statement 6
execute $sql_24_6$grant execute on function public.approve_billing_request(uuid,uuid) to service_role$sql_24_6$;

-- package-access.sql: source statement 7
execute $sql_24_7$revoke all on function public.guard_ai_agent_plan() from public,anon,authenticated,service_role$sql_24_7$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('package-access.sql','f006837de30cdec18321f59719677234255e09d83bdf1e4c49f244fb977818b7','31174caa94e6407b3cf95e13f96ca1264d826309acc529310a5df06f75bcf16b');
end $migration_24$;

-- 26. feature-access.sql
do $migration_25$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='feature-access.sql';
  if found then
    if installed <> '21e1be5059e7166bd9c9c3e2b2501cbae20cbb6ec4b5a9880f3f803120dcc513' then
      raise exception 'Applied migration changed: feature-access.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- feature-access.sql: source statement 2
execute $sql_25_2$create table if not exists public.plan_features (
  plan text not null check (plan in ('starter','pro')),
  feature text not null check (feature in ('ai_agent','image_assistant','customer_management','slip_auto_pilot','customer_follow_up')),
  enabled boolean not null default false,
  primary key(plan,feature)
)$sql_25_2$;

-- feature-access.sql: source statement 3
execute $sql_25_3$alter table public.plan_features enable row level security$sql_25_3$;

-- feature-access.sql: source statement 4
execute $sql_25_4$alter table public.plan_features drop constraint if exists plan_features_feature_check$sql_25_4$;

-- feature-access.sql: source statement 5
execute $sql_25_5$alter table public.plan_features add constraint plan_features_feature_check check(feature in ('ai_agent','image_assistant','customer_management','slip_auto_pilot','customer_follow_up'))$sql_25_5$;

-- feature-access.sql: source statement 6
execute $sql_25_6$revoke all on public.plan_features from public,anon,authenticated$sql_25_6$;

-- feature-access.sql: source statement 7
execute $sql_25_7$grant select,insert,update,delete on public.plan_features to service_role$sql_25_7$;

-- feature-access.sql: source statement 8
execute $sql_25_8$insert into public.plan_features(plan,feature,enabled) values
 ('pro','ai_agent',true),('starter','slip_auto_pilot',true),('pro','slip_auto_pilot',true),
 ('starter','image_assistant',true),('pro','image_assistant',true),
 ('starter','customer_management',true),('pro','customer_management',true),
 ('starter','customer_follow_up',true),('pro','customer_follow_up',true)
on conflict(plan,feature) do nothing$sql_25_8$;

-- feature-access.sql: source statement 9
begin
execute $sql_25_9$create or replace function public.has_tenant_feature(p_tenant uuid,p_feature text) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.tenants t join public.plan_features f on f.plan=t.plan
   where t.id=p_tenant and t.is_active and t.plan<>'free'
     and t.plan_expires_at>now() and f.feature=p_feature and f.enabled)
$$$sql_25_9$;
exception when invalid_function_definition then
  -- A newer signature of has_tenant_feature(uuid,text) is already installed. Its final definition below is mandatory.
  null;
end;

-- feature-access.sql: source statement 10
execute $sql_25_10$revoke all on function public.has_tenant_feature(uuid,text) from public,anon$sql_25_10$;

-- feature-access.sql: source statement 11
execute $sql_25_11$grant execute on function public.has_tenant_feature(uuid,text) to authenticated,service_role$sql_25_11$;

-- feature-access.sql: source statement 12
execute $sql_25_12$create or replace function public.guard_ai_agent_plan() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if (new.reply_mode='ai' or (tg_op='INSERT' and nullif(trim(new.ai_instructions),'') is not null)
   or (tg_op='UPDATE' and new.ai_instructions is distinct from old.ai_instructions))
   and not public.has_tenant_feature(new.tenant_id,'ai_agent') then
   raise exception 'FEATURE_LOCKED: ai_agent' using errcode='42501';
 end if;
 return new;
end $$$sql_25_12$;

-- feature-access.sql: source statement 13
execute $sql_25_13$drop trigger if exists bot_settings_ai_plan_gate on public.bot_settings$sql_25_13$;

-- feature-access.sql: source statement 14
execute $sql_25_14$create trigger bot_settings_ai_plan_gate before insert or update on public.bot_settings
for each row execute function public.guard_ai_agent_plan()$sql_25_14$;

-- feature-access.sql: source statement 15
execute $sql_25_15$revoke all on function public.guard_ai_agent_plan() from public,anon,authenticated,service_role$sql_25_15$;

-- feature-access.sql: source statement 16
execute $sql_25_16$drop policy if exists image_feature_access on public.image_response_rules$sql_25_16$;

-- feature-access.sql: source statement 17
execute $sql_25_17$create policy image_feature_access on public.image_response_rules as restrictive for all to authenticated
 using(public.has_tenant_feature(tenant_id,'image_assistant'))
 with check(public.has_tenant_feature(tenant_id,'image_assistant'))$sql_25_17$;

-- feature-access.sql: source statement 18
execute $sql_25_18$drop policy if exists customer_feature_access on public.customers$sql_25_18$;

-- feature-access.sql: source statement 19
execute $sql_25_19$create policy customer_feature_access on public.customers as restrictive for all to authenticated
 using(public.has_tenant_feature(tenant_id,'customer_management'))
 with check(public.has_tenant_feature(tenant_id,'customer_management'))$sql_25_19$;

-- feature-access.sql: source statement 20
execute $sql_25_20$drop policy if exists message_feature_access on public.messages$sql_25_20$;

-- feature-access.sql: source statement 21
execute $sql_25_21$create policy message_feature_access on public.messages as restrictive for select to authenticated
 using(exists(select 1 from public.customers c where c.id=customer_id and public.has_tenant_feature(c.tenant_id,'customer_management')))$sql_25_21$;

-- feature-access.sql: source statement 22
execute $sql_25_22$drop policy if exists comment_feature_access on public.comments$sql_25_22$;

-- feature-access.sql: source statement 23
execute $sql_25_23$create policy comment_feature_access on public.comments as restrictive for select to authenticated
 using(public.has_tenant_feature(tenant_id,'customer_management'))$sql_25_23$;

-- feature-access.sql: source statement 24
execute $sql_25_24$drop policy if exists order_feature_access on public.orders$sql_25_24$;

-- feature-access.sql: source statement 25
execute $sql_25_25$create policy order_feature_access on public.orders as restrictive for all to authenticated
 using(public.has_tenant_feature(tenant_id,'customer_management'))
 with check(public.has_tenant_feature(tenant_id,'customer_management'))$sql_25_25$;

-- feature-access.sql: source statement 26
execute $sql_25_26$drop policy if exists slip_feature_read on public.slips$sql_25_26$;

-- feature-access.sql: source statement 27
execute $sql_25_27$create policy slip_feature_read on public.slips as restrictive for select to authenticated
 using(public.has_tenant_feature(tenant_id,'slip_auto_pilot'))$sql_25_27$;

-- feature-access.sql: source statement 28
execute $sql_25_28$create or replace function public.consume_slip_credit(p_tenant uuid) returns boolean
language sql set search_path=pg_catalog,public as $$
 with taken as(update public.tenants set slip_used=slip_used+1
   where id=p_tenant and public.has_tenant_feature(id,'slip_auto_pilot')
   and slip_used::bigint<slip_quota::bigint+slip_quota_credits::bigint returning 1)
 select exists(select 1 from taken)
$$$sql_25_28$;

-- feature-access.sql: source statement 29
execute $sql_25_29$revoke all on function public.consume_slip_credit(uuid) from public,anon,authenticated$sql_25_29$;

-- feature-access.sql: source statement 30
execute $sql_25_30$grant execute on function public.consume_slip_credit(uuid) to service_role$sql_25_30$;

-- feature-access.sql: source statement 31
execute $sql_25_31$create or replace function public.refund_slip_credit(p_tenant uuid) returns void
language sql set search_path=pg_catalog,public as $$
 update public.tenants set slip_used=slip_used-1 where id=p_tenant and slip_used>0
$$$sql_25_31$;

-- feature-access.sql: source statement 32
execute $sql_25_32$revoke all on function public.refund_slip_credit(uuid) from public,anon,authenticated$sql_25_32$;

-- feature-access.sql: source statement 33
execute $sql_25_33$grant execute on function public.refund_slip_credit(uuid) to service_role$sql_25_33$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('feature-access.sql','21e1be5059e7166bd9c9c3e2b2501cbae20cbb6ec4b5a9880f3f803120dcc513','dc491c46c80669e9f8f62230d1d822fb0c67d9605e2dc2fc22154f4616444ff7');
end $migration_25$;

-- 27. free-message-quota.sql
do $migration_26$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='free-message-quota.sql';
  if found then
    if installed <> 'b9e578a5de13337499c0b85a4d3dbcf994098105179357e10f6de043bfd945e3' then
      raise exception 'Applied migration changed: free-message-quota.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- free-message-quota.sql: source statement 2
execute $sql_26_2$alter table public.tenants alter column broadcast_allowance set default 100$sql_26_2$;

-- free-message-quota.sql: source statement 3
execute $sql_26_3$alter table public.tenants alter column broadcast_credits set default 100$sql_26_3$;

-- free-message-quota.sql: source statement 5
execute $sql_26_5$create or replace function public.refresh_broadcast_credits(p_tenant uuid) returns void
language plpgsql set search_path = pg_catalog, public as $$
declare t public.tenants; this_month text := to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM');
begin
  select * into t from public.tenants where id = p_tenant for update;
  if not found then return; end if;
  if t.plan <> 'free' and t.plan_expires_at is not null and t.plan_expires_at <= now() then
    update public.tenants set plan = 'free', plan_expires_at = null, broadcast_allowance = 100,
      broadcast_credits = least(broadcast_credits, 100), broadcast_credit_mode = 'calendar'
    where id = p_tenant;
    t.broadcast_credit_mode := 'calendar';
  end if;
  if t.broadcast_credit_mode = 'calendar' and t.broadcast_period <> this_month then
    update public.tenants set broadcast_credits = broadcast_allowance, broadcast_period = this_month
    where id = p_tenant;
  end if;
end $$$sql_26_5$;

-- free-message-quota.sql: source statement 6
execute $sql_26_6$create or replace function public.reserve_broadcast_credits(p_tenant uuid, p_count integer)
returns table (monthly integer, topup integer)
language plpgsql set search_path = pg_catalog, public as $$
declare t public.tenants; m integer; u integer;
begin
  if p_count is null or p_count <= 0 then return query select 0, 0; return; end if;
  perform public.refresh_broadcast_credits(p_tenant);
  select * into t from public.tenants where id = p_tenant for update;
  if not found or not t.is_active then return query select 0, 0; return; end if;
  m := least(p_count, t.broadcast_credits);
  u := least(p_count - m, t.broadcast_topup_credits);
  update public.tenants set broadcast_credits = broadcast_credits - m,
    broadcast_topup_credits = broadcast_topup_credits - u where id = p_tenant;
  return query select m, u;
end $$$sql_26_6$;

-- free-message-quota.sql: source statement 7
execute $sql_26_7$create or replace function public.refund_broadcast_credits(p_tenant uuid, p_monthly integer, p_topup integer)
returns void language plpgsql set search_path = pg_catalog, public as $$
begin
  perform public.refresh_broadcast_credits(p_tenant);
  update public.tenants set
    broadcast_credits = case when broadcast_credit_mode = 'purchased'
      then broadcast_credits + greatest(coalesce(p_monthly, 0), 0)
      else least(broadcast_allowance, broadcast_credits + greatest(coalesce(p_monthly, 0), 0)) end,
    broadcast_topup_credits = broadcast_topup_credits + greatest(coalesce(p_topup, 0), 0)
  where id = p_tenant;
end $$$sql_26_7$;

-- free-message-quota.sql: source statement 8
execute $sql_26_8$create or replace function public.platform_update_tenant(
  p_tenant uuid, p_admin uuid, p_plan text default null, p_active boolean default null
) returns void
language plpgsql set search_path = pg_catalog, public as $$
declare t public.tenants; updated public.tenants; allowance integer;
begin
  if not exists (select 1 from public.platform_admins where user_id = p_admin) then
    raise exception 'Only platform admins may manage tenants' using errcode = '42501';
  end if;
  if p_plan is not null and p_plan not in ('free', 'starter', 'pro') then
    raise exception 'Unknown plan' using errcode = '22023';
  end if;
  if p_plan is null and p_active is null then raise exception 'No changes supplied' using errcode = '22023'; end if;
  select * into t from public.tenants where id = p_tenant for update;
  if not found then raise exception 'Tenant not found' using errcode = 'P0002'; end if;
  if p_plan is not null then
    allowance := case p_plan when 'free' then 100 when 'starter' then 1500 when 'pro' then 7500 end;
    update public.tenants set plan = p_plan,
      plan_expires_at = case when p_plan = 'free' then null else now() + interval '30 days' end,
      broadcast_allowance = allowance, broadcast_credits = allowance,
      broadcast_credit_mode = case when p_plan = 'free' then 'calendar' else 'purchased' end,
      broadcast_period = to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM')
    where id = p_tenant;
  end if;
  if p_active is not null then update public.tenants set is_active = p_active where id = p_tenant; end if;
  select * into updated from public.tenants where id = p_tenant;
  insert into public.platform_tenant_audit(tenant_id,admin_id,before_state,after_state)
    values(p_tenant,p_admin,
      jsonb_build_object('plan',t.plan,'expiresAt',t.plan_expires_at,'active',t.is_active,'broadcastCredits',t.broadcast_credits),
      jsonb_build_object('plan',updated.plan,'expiresAt',updated.plan_expires_at,'active',updated.is_active,'broadcastCredits',updated.broadcast_credits));
end $$$sql_26_8$;

-- free-message-quota.sql: source statement 9
execute $sql_26_9$alter table public.plan_features drop constraint if exists plan_features_feature_check$sql_26_9$;

-- free-message-quota.sql: source statement 10
execute $sql_26_10$alter table public.plan_features add constraint plan_features_feature_check check(feature in ('ai_agent','image_assistant','customer_management','slip_auto_pilot','customer_follow_up'))$sql_26_10$;

-- free-message-quota.sql: source statement 11
execute $sql_26_11$insert into public.plan_features(plan,feature,enabled) values('starter','customer_follow_up',true),('pro','customer_follow_up',true) on conflict do nothing$sql_26_11$;

-- free-message-quota.sql: source statement 12
execute $sql_26_12$create or replace function public.guard_followup_plan() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$ begin if new.followup_enabled and not public.has_tenant_feature(new.tenant_id,'customer_follow_up') then raise exception 'FEATURE_LOCKED: customer_follow_up' using errcode='42501'; end if;return new;end $$$sql_26_12$;

-- free-message-quota.sql: source statement 13
execute $sql_26_13$drop trigger if exists bot_settings_followup_plan_gate on public.bot_settings$sql_26_13$;

-- free-message-quota.sql: source statement 14
execute $sql_26_14$create trigger bot_settings_followup_plan_gate before insert or update on public.bot_settings for each row execute function public.guard_followup_plan()$sql_26_14$;

-- free-message-quota.sql: source statement 15
execute $sql_26_15$revoke all on function public.guard_followup_plan() from public,anon,authenticated,service_role$sql_26_15$;

-- free-message-quota.sql: source statement 16
execute $sql_26_16$drop policy if exists followup_feature_access on public.follow_up_jobs$sql_26_16$;

-- free-message-quota.sql: source statement 17
execute $sql_26_17$create policy followup_feature_access on public.follow_up_jobs as restrictive for all to authenticated using(public.has_tenant_feature(tenant_id,'customer_follow_up')) with check(public.has_tenant_feature(tenant_id,'customer_follow_up'))$sql_26_17$;

-- free-message-quota.sql: source statement 18
execute $sql_26_18$revoke all on function public.refresh_broadcast_credits(uuid) from public,anon,authenticated$sql_26_18$;

-- free-message-quota.sql: source statement 19
execute $sql_26_19$grant execute on function public.refresh_broadcast_credits(uuid) to service_role$sql_26_19$;

-- free-message-quota.sql: source statement 20
execute $sql_26_20$revoke all on function public.reserve_broadcast_credits(uuid,integer) from public,anon,authenticated$sql_26_20$;

-- free-message-quota.sql: source statement 21
execute $sql_26_21$grant execute on function public.reserve_broadcast_credits(uuid,integer) to service_role$sql_26_21$;

-- free-message-quota.sql: source statement 22
execute $sql_26_22$revoke all on function public.refund_broadcast_credits(uuid,integer,integer) from public,anon,authenticated$sql_26_22$;

-- free-message-quota.sql: source statement 23
execute $sql_26_23$grant execute on function public.refund_broadcast_credits(uuid,integer,integer) to service_role$sql_26_23$;

-- free-message-quota.sql: source statement 24
execute $sql_26_24$revoke all on function public.platform_update_tenant(uuid,uuid,text,boolean) from public,anon,authenticated$sql_26_24$;

-- free-message-quota.sql: source statement 25
execute $sql_26_25$grant execute on function public.platform_update_tenant(uuid,uuid,text,boolean) to service_role$sql_26_25$;

-- free-message-quota.sql: source statement 26
execute $sql_26_26$notify pgrst, 'reload schema'$sql_26_26$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('free-message-quota.sql','b9e578a5de13337499c0b85a4d3dbcf994098105179357e10f6de043bfd945e3','6c43832ecc28fe37a753487ea001174d0c724f028f45249f3275893f0b6e99a5');
end $migration_26$;

-- 28. keyword-reply-limits.sql
do $migration_27$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='keyword-reply-limits.sql';
  if found then
    if installed <> '39685c871c386d7851389c4c3f0238d73570201c9d7074e173ab10a55d182ea5' then
      raise exception 'Applied migration changed: keyword-reply-limits.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- keyword-reply-limits.sql: source statement 2
execute $sql_27_2$create or replace function public.guard_keyword_reply_limit() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare allowed integer; used integer;
begin
 if tg_op='UPDATE' and new.tenant_id=old.tenant_id then return new;end if;
 -- Serialize creation and tenant moves with subscription changes. RLS still
 -- authorizes the original write; service_role imports obey this guard too.
 select case when t.is_active and t.plan in ('starter','pro')
  and t.plan_expires_at>clock_timestamp() then 20 else 3 end
 into allowed from public.tenants t where t.id=new.tenant_id for update;
 if not found then raise exception 'Tenant not found' using errcode='23503';end if;
 select count(*) into used from public.chat_rules where tenant_id=new.tenant_id;
 if used>=allowed then
  raise exception 'KEYWORD_REPLY_LIMIT: maximum % replies per tenant',allowed
   using errcode='P0422',hint='Delete an existing keyword reply or upgrade the subscription.';
 end if;
 return new;
end $$$sql_27_2$;

-- keyword-reply-limits.sql: source statement 3
execute $sql_27_3$revoke all on function public.guard_keyword_reply_limit() from public,anon,authenticated,service_role$sql_27_3$;

-- keyword-reply-limits.sql: source statement 4
execute $sql_27_4$drop trigger if exists keyword_reply_limit on public.chat_rules$sql_27_4$;

-- keyword-reply-limits.sql: source statement 5
execute $sql_27_5$create trigger keyword_reply_limit before insert or update of tenant_id on public.chat_rules
for each row execute function public.guard_keyword_reply_limit()$sql_27_5$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('keyword-reply-limits.sql','39685c871c386d7851389c4c3f0238d73570201c9d7074e173ab10a55d182ea5','331db8ee61d4e12356f6f883c08403717d136abaa29190bfa71940aa693d9c34');
end $migration_27$;

-- 29. fallback-messages.sql
do $migration_28$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='fallback-messages.sql';
  if found then
    if installed <> 'ebdd583bef19e9865d40b67f204d801cecee1ee7a15051a56a057071b5dcae9c' then
      raise exception 'Applied migration changed: fallback-messages.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- fallback-messages.sql: source statement 2
execute $sql_28_2$alter table public.bot_settings add column if not exists fallback_messages text[] not null default '{}'$sql_28_2$;

-- fallback-messages.sql: source statement 3
execute $sql_28_3$create or replace function public.valid_fallback_messages(messages text[]) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select coalesce(cardinality(messages) <= 20 and not exists (
    select 1 from unnest(messages) message where message is null or length(message) > 2000
  ), false)
$$$sql_28_3$;

-- fallback-messages.sql: source statement 4
execute $sql_28_4$alter table public.bot_settings drop constraint if exists bot_settings_fallback_messages_check$sql_28_4$;

-- fallback-messages.sql: source statement 5
execute $sql_28_5$alter table public.bot_settings add constraint bot_settings_fallback_messages_check
  check (public.valid_fallback_messages(fallback_messages))$sql_28_5$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('fallback-messages.sql','ebdd583bef19e9865d40b67f204d801cecee1ee7a15051a56a057071b5dcae9c','b3a22811de461dac12dca9e85b8f5fd9ed5f5e0130547607eaced5c2ed1ba28b');
end $migration_28$;

-- 30. handover-messages.sql
do $migration_29$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='handover-messages.sql';
  if found then
    if installed <> '831bef8ef4c6046ed8cbf37259a047ab6b41ea3d4390c5715637b3c566beecc3' then
      raise exception 'Applied migration changed: handover-messages.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- handover-messages.sql: source statement 2
execute $sql_29_2$alter table public.bot_settings add column if not exists handover_messages text[] not null default '{}'$sql_29_2$;

-- handover-messages.sql: source statement 3
execute $sql_29_3$create or replace function public.valid_handover_messages(messages text[]) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select coalesce(cardinality(messages) <= 20 and not exists (
    select 1 from unnest(messages) message where message is null or length(message) > 2000
  ), false)
$$$sql_29_3$;

-- handover-messages.sql: source statement 4
execute $sql_29_4$alter table public.bot_settings drop constraint if exists bot_settings_handover_messages_check$sql_29_4$;

-- handover-messages.sql: source statement 5
execute $sql_29_5$alter table public.bot_settings add constraint bot_settings_handover_messages_check
  check (public.valid_handover_messages(handover_messages))$sql_29_5$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('handover-messages.sql','831bef8ef4c6046ed8cbf37259a047ab6b41ea3d4390c5715637b3c566beecc3','47c4af183d56f18eb06929dab7daacf713eb30f77d4b080deb0fe9c9fd99742e');
end $migration_29$;

-- 31. followup-message-defaults.sql
do $migration_30$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='followup-message-defaults.sql';
  if found then
    if installed <> '64cbf3fb5743680daa3252b9ce910aea4bfb714efc90feaddf270d2360eeb7c8' then
      raise exception 'Applied migration changed: followup-message-defaults.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- followup-message-defaults.sql: source statement 1
execute $sql_30_1$alter table public.bot_settings alter column followup_steps set default '[
  {"delay_minutes": 15, "text": "คุณ {ชื่อลูกค้า} ยังไม่ได้ส่งสลิปสำหรับยอด {ยอดเงิน} บาทนะคะ โอนแล้วส่งสลิปในแชทนี้ได้เลยค่ะ"},
  {"delay_minutes": 60, "text": "แจ้งเตือนอีกครั้งค่ะ ออเดอร์ยอด {ยอดเงิน} บาท ยังรอการชำระเงิน หากต้องการยกเลิกแจ้งแอดมินได้เลยนะคะ"}
]'::jsonb$sql_30_1$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('followup-message-defaults.sql','64cbf3fb5743680daa3252b9ce910aea4bfb714efc90feaddf270d2360eeb7c8','1615ee171cacdcd867738276d1f676168275c34067e7067495851c9a34964562');
end $migration_30$;

-- 32. smart-inbox.sql
do $migration_31$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='smart-inbox.sql';
  if found then
    if installed <> '5f275f20a22fd4d8d91d8a353969610df1fd48ca812af75c8f11421a4e1380ef' then
      raise exception 'Applied migration changed: smart-inbox.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- smart-inbox.sql: source statement 2
execute $sql_31_2$alter table public.customers add column if not exists assigned_user_id uuid references auth.users(id) on delete set null$sql_31_2$;

-- smart-inbox.sql: source statement 3
execute $sql_31_3$alter table public.customers add column if not exists conversation_status text not null default 'open' check(conversation_status in ('open','closed'))$sql_31_3$;

-- smart-inbox.sql: source statement 4
execute $sql_31_4$alter table public.customers add column if not exists conversation_version integer not null default 0$sql_31_4$;

-- smart-inbox.sql: source statement 5
execute $sql_31_5$alter table public.customers add column if not exists inbound_seq bigint not null default 0$sql_31_5$;

-- smart-inbox.sql: source statement 6
execute $sql_31_6$alter table public.customers add column if not exists outbound_lock uuid$sql_31_6$;

-- smart-inbox.sql: source statement 7
execute $sql_31_7$alter table public.customers add column if not exists outbound_lock_until timestamptz$sql_31_7$;

-- smart-inbox.sql: source statement 8
execute $sql_31_8$alter table public.messages add column if not exists inbound_seq bigint$sql_31_8$;

-- smart-inbox.sql: source statement 9
execute $sql_31_9$alter table public.messages add column if not exists provider_message_id text$sql_31_9$;

-- smart-inbox.sql: source statement 10
execute $sql_31_10$alter table public.messages add column if not exists delivery_status text check(delivery_status in ('pending','sent','delivered','read','failed','unknown'))$sql_31_10$;

-- smart-inbox.sql: source statement 11
execute $sql_31_11$create index if not exists messages_provider_id on public.messages(provider_message_id) where provider_message_id is not null$sql_31_11$;

-- smart-inbox.sql: source statement 12
execute $sql_31_12$grant select(assigned_user_id,conversation_status,conversation_version,inbound_seq) on public.customers to authenticated$sql_31_12$;

-- smart-inbox.sql: source statement 15
execute $sql_31_15$create table if not exists public.conversation_reads(
 customer_id uuid not null references public.customers(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 read_seq bigint not null default 0, primary key(customer_id,user_id)
)$sql_31_15$;

-- smart-inbox.sql: source statement 16
execute $sql_31_16$create table if not exists public.conversation_events(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,
 customer_id uuid not null references public.customers(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,action text not null,
 previous_assignee uuid,next_assignee uuid,created_at timestamptz not null default now()
)$sql_31_16$;

-- smart-inbox.sql: source statement 17
execute $sql_31_17$alter table public.conversation_reads enable row level security$sql_31_17$;

-- smart-inbox.sql: source statement 18
execute $sql_31_18$alter table public.conversation_events enable row level security$sql_31_18$;

-- smart-inbox.sql: source statement 19
execute $sql_31_19$revoke all on public.conversation_reads,public.conversation_events from public,anon,authenticated$sql_31_19$;

-- smart-inbox.sql: source statement 20
execute $sql_31_20$grant select on public.conversation_reads,public.conversation_events to authenticated$sql_31_20$;

-- smart-inbox.sql: source statement 21
execute $sql_31_21$grant all on public.conversation_reads,public.conversation_events to service_role$sql_31_21$;

-- smart-inbox.sql: source statement 22
execute $sql_31_22$drop policy if exists own_read on public.conversation_reads$sql_31_22$;

-- smart-inbox.sql: source statement 23
execute $sql_31_23$create policy own_read on public.conversation_reads for select to authenticated using(user_id=auth.uid() and exists(select 1 from public.customers c where c.id=customer_id and public.can_access_tenant(c.tenant_id) and public.has_tenant_feature(c.tenant_id,'customer_management')))$sql_31_23$;

-- smart-inbox.sql: source statement 24
execute $sql_31_24$drop policy if exists member_read on public.conversation_events$sql_31_24$;

-- smart-inbox.sql: source statement 25
execute $sql_31_25$create policy member_read on public.conversation_events for select to authenticated using(public.can_access_tenant(tenant_id) and public.has_tenant_feature(tenant_id,'customer_management'))$sql_31_25$;

-- smart-inbox.sql: source statement 26
begin
execute $sql_31_26$create or replace function public.inbox_incoming_message() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.sender='customer' then
  update public.customers set inbound_seq=inbound_seq+1,conversation_status='open',conversation_version=conversation_version+1,
    last_message_at=case when platform='facebook' then last_message_at
      else greatest(coalesce(last_message_at,new.created_at),new.created_at) end
    where id=new.customer_id returning inbound_seq into new.inbound_seq;
 end if;
 return new;
end $$$sql_31_26$;
exception when invalid_function_definition then
  -- A newer signature of inbox_incoming_message() is already installed. Its final definition below is mandatory.
  null;
end;

-- smart-inbox.sql: source statement 27
execute $sql_31_27$drop trigger if exists inbox_message_counter on public.messages$sql_31_27$;

-- smart-inbox.sql: source statement 28
execute $sql_31_28$create trigger inbox_message_counter before insert on public.messages for each row execute function public.inbox_incoming_message()$sql_31_28$;

-- smart-inbox.sql: source statement 29
begin
execute $sql_31_29$create or replace function public.manage_inbox_conversation(p_customer uuid,p_actor uuid,p_action text,p_version integer,p_assignee uuid default null) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare c public.customers;previous uuid; mode text;
begin
 select * into c from public.customers where id=p_customer for update;
 if not found or not(exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_actor)
    or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Forbidden' using errcode='42501';end if;
 if not public.has_tenant_feature(c.tenant_id,'customer_management') then raise exception 'FEATURE_LOCKED' using errcode='42501';end if;
 if p_version is null or c.conversation_version<>p_version then raise exception 'Conversation changed; reload and retry' using errcode='40001';end if;
 if c.outbound_lock_until>clock_timestamp() then raise exception 'A message is being sent; retry shortly' using errcode='55P03';end if;
 previous:=c.assigned_user_id;
 if p_action in ('close','reopen','pause','bot') and c.assigned_user_id is not null and c.assigned_user_id<>p_actor
  and not exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_actor and role='owner')
  and not exists(select 1 from public.platform_admins where user_id=p_actor) then raise exception 'Conversation belongs to another agent' using errcode='42501';end if;
 if p_action='claim' then
  if c.assigned_user_id is not null and c.assigned_user_id<>p_actor then raise exception 'Already assigned' using errcode='40001';end if;
  c.assigned_user_id:=p_actor;c.bot_enabled:=false;c.conversation_status:='open';
 elsif p_action='transfer' then
  if c.assigned_user_id is distinct from p_actor and not exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_actor and role='owner')
   and not exists(select 1 from public.platform_admins where user_id=p_actor) then raise exception 'Forbidden' using errcode='42501';end if;
  if not exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_assignee) then raise exception 'Assignee is not a shop member' using errcode='22023';end if;
  c.assigned_user_id:=p_assignee;c.bot_enabled:=false;c.conversation_status:='open';
 elsif p_action='close' then c.conversation_status:='closed';c.bot_enabled:=false;
 elsif p_action='reopen' then c.conversation_status:='open';c.bot_enabled:=false;
 elsif p_action='pause' then c.bot_enabled:=false;
 elsif p_action='bot' then
  select reply_mode into mode from public.bot_settings where tenant_id=c.tenant_id;
  if mode is null or not exists(select 1 from public.tenants where id=c.tenant_id and auto_reply_enabled) then raise exception 'Bot is not configured or enabled' using errcode='22023';end if;
  if mode='ai' and not public.has_tenant_feature(c.tenant_id,'ai_agent') then raise exception 'FEATURE_LOCKED: ai_agent' using errcode='42501';end if;
  c.bot_enabled:=true;c.assigned_user_id:=null;c.conversation_status:='open';
 else raise exception 'Unknown action' using errcode='22023';end if;
 update public.customers set assigned_user_id=c.assigned_user_id,bot_enabled=c.bot_enabled,conversation_status=c.conversation_status,
  conversation_version=conversation_version+1,handover_at=case when c.bot_enabled then null else now() end where id=c.id;
 insert into public.conversation_events(tenant_id,customer_id,actor_id,action,previous_assignee,next_assignee)
 values(c.tenant_id,c.id,p_actor,p_action,previous,c.assigned_user_id);
 return jsonb_build_object('ok',true);
end $$$sql_31_29$;
exception when invalid_function_definition then
  -- A newer signature of manage_inbox_conversation(uuid,uuid,text,integer,uuid) is already installed. Its final definition below is mandatory.
  null;
end;

-- smart-inbox.sql: source statement 30
execute $sql_31_30$create or replace function public.mark_inbox_read(p_customer uuid,p_actor uuid,p_message uuid) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare c public.customers;seq bigint;
begin
 select * into c from public.customers where id=p_customer;
 if not found or not public.has_tenant_feature(c.tenant_id,'customer_management') or not(exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_actor) or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Forbidden' using errcode='42501';end if;
 select inbound_seq into seq from public.messages where id=p_message and customer_id=p_customer and sender='customer';
 if seq is null then return;end if;
 insert into public.conversation_reads(customer_id,user_id,read_seq) values(p_customer,p_actor,seq)
 on conflict(customer_id,user_id) do update set read_seq=greatest(conversation_reads.read_seq,excluded.read_seq);
end $$$sql_31_30$;

-- smart-inbox.sql: source statement 31
begin
execute $sql_31_31$create or replace function public.start_inbox_delivery(p_customer uuid,p_actor uuid default null) returns uuid
language plpgsql set search_path=pg_catalog,public as $$
declare c public.customers;lease uuid:=gen_random_uuid();
begin
 select * into c from public.customers where id=p_customer for update;
 if not found or c.conversation_status='closed' or not exists(select 1 from public.tenants where id=c.tenant_id and is_active) then raise exception 'Conversation unavailable' using errcode='40001';end if;
 if p_actor is null then
  if not c.bot_enabled then raise exception 'Bot paused for human handoff' using errcode='40001';end if;
 else
  if c.assigned_user_id is distinct from p_actor or c.bot_enabled or not public.has_tenant_feature(c.tenant_id,'customer_management') then raise exception 'Claim the conversation first' using errcode='42501';end if;
  if not(exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_actor) or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Forbidden' using errcode='42501';end if;
 end if;
 if c.outbound_lock_until>clock_timestamp() then raise exception 'Delivery busy' using errcode='55P03';end if;
 update public.customers set outbound_lock=lease,outbound_lock_until=clock_timestamp()+interval '2 minutes' where id=p_customer;
 return lease;
end $$$sql_31_31$;
exception when invalid_function_definition then
  -- A newer signature of start_inbox_delivery(uuid,uuid) is already installed. Its final definition below is mandatory.
  null;
end;

-- smart-inbox.sql: source statement 32
execute $sql_31_32$create or replace function public.end_inbox_delivery(p_customer uuid,p_lease uuid) returns void
language sql set search_path=pg_catalog,public as $$update public.customers set outbound_lock=null,outbound_lock_until=null where id=p_customer and outbound_lock=p_lease$$$sql_31_32$;

-- smart-inbox.sql: source statement 33
execute $sql_31_33$create or replace function public.start_inbox_handover(p_customer uuid) returns uuid
language plpgsql set search_path=pg_catalog,public as $$
declare lease uuid;target uuid;
begin
 lease:=public.start_inbox_delivery(p_customer,null);
 update public.customers set bot_enabled=false,handover_at=now(),conversation_version=conversation_version+1 where id=p_customer returning tenant_id into target;
 insert into public.conversation_events(tenant_id,customer_id,action) values(target,p_customer,'handover');
 return lease;
end $$$sql_31_33$;

-- smart-inbox.sql: source statement 34
execute $sql_31_34$revoke update(bot_enabled) on public.customers from authenticated$sql_31_34$;

-- smart-inbox.sql: source statement 35
execute $sql_31_35$revoke all on function public.manage_inbox_conversation(uuid,uuid,text,integer,uuid),public.mark_inbox_read(uuid,uuid,uuid),public.start_inbox_delivery(uuid,uuid),public.end_inbox_delivery(uuid,uuid),public.inbox_incoming_message() from public,anon,authenticated$sql_31_35$;

-- smart-inbox.sql: source statement 36
execute $sql_31_36$grant execute on function public.manage_inbox_conversation(uuid,uuid,text,integer,uuid),public.mark_inbox_read(uuid,uuid,uuid),public.start_inbox_delivery(uuid,uuid),public.end_inbox_delivery(uuid,uuid) to service_role$sql_31_36$;

-- smart-inbox.sql: source statement 37
execute $sql_31_37$revoke all on function public.start_inbox_handover(uuid) from public,anon,authenticated$sql_31_37$;

-- smart-inbox.sql: source statement 38
execute $sql_31_38$grant execute on function public.start_inbox_handover(uuid) to service_role$sql_31_38$;

-- smart-inbox.sql: source statement 39
execute $sql_31_39$create table if not exists public.inbox_media(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,uploaded_by uuid not null references auth.users(id),path text not null unique,name text not null,mime text not null,kind text not null check(kind in ('image','file')),created_at timestamptz not null default now())$sql_31_39$;

-- smart-inbox.sql: source statement 40
execute $sql_31_40$alter table public.inbox_media enable row level security$sql_31_40$;

-- smart-inbox.sql: source statement 41
execute $sql_31_41$revoke all on public.inbox_media from public,anon,authenticated$sql_31_41$;

-- smart-inbox.sql: source statement 42
execute $sql_31_42$grant select,insert,delete on public.inbox_media to service_role$sql_31_42$;

-- smart-inbox.sql: source statement 43
execute $sql_31_43$insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('inbox-media','inbox-media',false,8388608,array['image/jpeg','image/png','image/gif','image/webp','application/pdf']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types$sql_31_43$;

-- smart-inbox.sql: source statement 44
execute $sql_31_44$do $$begin alter publication supabase_realtime add table public.conversation_reads;exception when duplicate_object then null;end $$$sql_31_44$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('smart-inbox.sql','5f275f20a22fd4d8d91d8a353969610df1fd48ca812af75c8f11421a4e1380ef','2ccfb610d36a3a3acce7138038b3197b8e1203128daa627780d82bc5722ad505');
end $migration_31$;

-- 33. smart-inbox-pro.sql
do $migration_32$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='smart-inbox-pro.sql';
  if found then
    if installed <> '6c0db1e904369e292a1eac9f1021ee284ba341e5ad5ec6b32e69117a1b2824c5' then
      raise exception 'Applied migration changed: smart-inbox-pro.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- smart-inbox-pro.sql: source statement 2
execute $sql_32_2$alter table public.customers add column if not exists inbox_stage text$sql_32_2$;

-- smart-inbox-pro.sql: source statement 3
execute $sql_32_3$alter table public.customers add column if not exists closed_at timestamptz$sql_32_3$;

-- smart-inbox-pro.sql: source statement 4
execute $sql_32_4$alter table public.customers add column if not exists closed_by uuid references auth.users(id)$sql_32_4$;

-- smart-inbox-pro.sql: source statement 5
execute $sql_32_5$alter table public.customers add column if not exists close_reason text$sql_32_5$;

-- smart-inbox-pro.sql: source statement 7
execute $sql_32_7$alter table public.customers alter column inbox_stage set default 'UNASSIGNED'$sql_32_7$;

-- smart-inbox-pro.sql: source statement 8
execute $sql_32_8$alter table public.customers alter column inbox_stage set not null$sql_32_8$;

-- smart-inbox-pro.sql: source statement 9
execute $sql_32_9$do $$begin if not exists(select 1 from pg_constraint where conname='customers_inbox_stage_check' and conrelid='public.customers'::regclass) then
 alter table public.customers add constraint customers_inbox_stage_check check(inbox_stage in ('UNASSIGNED','ASSIGNED','IN_PROGRESS','RESOLVED','CLOSED'));
end if;end $$$sql_32_9$;

-- smart-inbox-pro.sql: source statement 10
execute $sql_32_10$alter table public.conversation_events add column if not exists reason text$sql_32_10$;

-- smart-inbox-pro.sql: source statement 11
execute $sql_32_11$alter table public.conversation_events add column if not exists request_id uuid$sql_32_11$;

-- smart-inbox-pro.sql: source statement 12
execute $sql_32_12$grant select(inbox_stage,closed_at,closed_by,close_reason) on public.customers to authenticated$sql_32_12$;

-- smart-inbox-pro.sql: source statement 13
execute $sql_32_13$create table if not exists public.inbox_action_receipts(
 tenant_id uuid not null references public.tenants(id),actor_id uuid not null references auth.users(id),request_id uuid not null,
 customer_id uuid not null references public.customers(id),payload jsonb not null,result jsonb not null,
 created_at timestamptz not null default now(),primary key(tenant_id,actor_id,request_id)
)$sql_32_13$;

-- smart-inbox-pro.sql: source statement 14
execute $sql_32_14$create index if not exists inbox_action_rate on public.inbox_action_receipts(tenant_id,actor_id,created_at)$sql_32_14$;

-- smart-inbox-pro.sql: source statement 15
execute $sql_32_15$create index if not exists customers_inbox_pro_queue on public.customers(tenant_id,inbox_stage,last_message_at)$sql_32_15$;

-- smart-inbox-pro.sql: source statement 16
execute $sql_32_16$create index if not exists messages_inbox_pro_reply on public.messages(customer_id,created_at,id) where sender='agent' and delivery_status in ('sent','delivered','read')$sql_32_16$;

-- smart-inbox-pro.sql: source statement 17
execute $sql_32_17$alter table public.inbox_action_receipts enable row level security$sql_32_17$;

-- smart-inbox-pro.sql: source statement 18
execute $sql_32_18$revoke all on public.inbox_action_receipts from public,anon,authenticated$sql_32_18$;

-- smart-inbox-pro.sql: source statement 19
execute $sql_32_19$grant select,insert on public.inbox_action_receipts to service_role$sql_32_19$;

-- smart-inbox-pro.sql: source statement 20
execute $sql_32_20$create or replace function public.sync_inbox_pro_stage() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.conversation_status='closed' then new.inbox_stage:='CLOSED';
 elsif tg_op='INSERT' then new.inbox_stage:=case when new.assigned_user_id is null then 'UNASSIGNED' else 'ASSIGNED' end;
 elsif new.assigned_user_id is distinct from old.assigned_user_id or new.conversation_status is distinct from old.conversation_status or new.bot_enabled and not old.bot_enabled then
  new.inbox_stage:=case when new.assigned_user_id is null then 'UNASSIGNED' else 'ASSIGNED' end;
 end if;
 if new.conversation_status<>'closed' then new.closed_at:=null;new.closed_by:=null;new.close_reason:=null;end if;
 return new;
end $$$sql_32_20$;

-- smart-inbox-pro.sql: source statement 21
execute $sql_32_21$drop trigger if exists customers_inbox_pro_stage on public.customers$sql_32_21$;

-- smart-inbox-pro.sql: source statement 22
execute $sql_32_22$create trigger customers_inbox_pro_stage before insert or update on public.customers for each row execute function public.sync_inbox_pro_stage()$sql_32_22$;

-- smart-inbox-pro.sql: source statement 23
execute $sql_32_23$create or replace function public.manage_inbox_pro(p_customer uuid,p_actor uuid,p_action text,p_version integer,p_key uuid,p_reason text default null,p_assignee uuid default null) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare c public.customers;manager boolean;payload jsonb;receipt public.inbox_action_receipts;result jsonb;previous uuid;event_id uuid;
begin
 select * into c from public.customers where id=p_customer for update;
 if not found or not public.has_tenant_feature(c.tenant_id,'customer_management') or not (
  exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_actor) or exists(select 1 from public.platform_admins where user_id=p_actor)
 ) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_key is null or p_action is null or p_action not in ('claim','transfer','release','start','resolve','close','reopen','pause','bot') or p_version is null or p_version<0 or length(coalesce(p_reason,''))>500 then raise exception 'Invalid action' using errcode='22023';end if;
 payload:=jsonb_build_object('customer',p_customer,'action',p_action,'version',p_version,'reason',p_reason,'assignee',p_assignee);
 -- Serialize per actor too: different customer requests cannot race the rate limit/key.
 perform pg_advisory_xact_lock(hashtextextended(c.tenant_id::text||':'||p_actor::text,0));
 select * into receipt from public.inbox_action_receipts where tenant_id=c.tenant_id and actor_id=p_actor and request_id=p_key;
 if found then
  if receipt.payload<>payload then raise exception 'Request key reused' using errcode='22023';end if;
  return receipt.result;
 end if;
 if (select count(*) from public.inbox_action_receipts where tenant_id=c.tenant_id and actor_id=p_actor and created_at>clock_timestamp()-interval '1 minute')>=30 then raise exception 'Rate limit' using errcode='P0429';end if;
 if c.conversation_version<>p_version then raise exception 'Conversation changed' using errcode='40001';end if;
 if c.outbound_lock_until>clock_timestamp() then raise exception 'Delivery busy' using errcode='55P03';end if;
 manager:=exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_actor and role='owner') or exists(select 1 from public.platform_admins where user_id=p_actor);
 previous:=c.assigned_user_id;
 if p_action='transfer' and p_assignee=c.assigned_user_id or p_action='start' and c.inbox_stage='IN_PROGRESS' or p_action='resolve' and c.inbox_stage='RESOLVED' or p_action='release' and c.assigned_user_id is null then raise exception 'State already applied' using errcode='40001';end if;
 if p_action='close' and nullif(trim(p_reason),'') is null then raise exception 'Close reason required' using errcode='22023';end if;
 if p_action in ('release','start','resolve') then
  if c.conversation_status='closed' or (c.assigned_user_id is distinct from p_actor and not manager) then raise exception 'Not assigned to actor' using errcode='42501';end if;
  if p_action in ('start','resolve') and c.assigned_user_id is null then raise exception 'Claim first' using errcode='22023';end if;
  update public.customers set assigned_user_id=case when p_action='release' then null else assigned_user_id end,
   bot_enabled=false,conversation_version=conversation_version+1,handover_at=coalesce(handover_at,now()),
   inbox_stage=case p_action when 'release' then 'UNASSIGNED' when 'start' then 'IN_PROGRESS' else 'RESOLVED' end where id=c.id;
  insert into public.conversation_events(tenant_id,customer_id,actor_id,action,previous_assignee,next_assignee,reason,request_id)
   values(c.tenant_id,c.id,p_actor,p_action,previous,case when p_action='release' then null else previous end,p_reason,p_key);
 else
  if p_action='claim' and c.conversation_status='closed' then raise exception 'Reopen first' using errcode='22023';end if;
  if p_action='claim' and c.assigned_user_id=p_actor then raise exception 'Already assigned' using errcode='40001';end if;
  if p_action='close' and c.conversation_status='closed' or p_action='reopen' and c.conversation_status<>'closed' then raise exception 'Conversation changed' using errcode='40001';end if;
  perform public.manage_inbox_conversation(p_customer,p_actor,p_action,p_version,p_assignee);
  select id into event_id from public.conversation_events where customer_id=c.id and actor_id=p_actor and action=p_action order by created_at desc,id desc limit 1;
  update public.conversation_events set reason=p_reason,request_id=p_key where id=event_id;
  if p_action='close' then update public.customers set closed_at=now(),closed_by=p_actor,close_reason=trim(p_reason) where id=c.id;end if;
 end if;
 select jsonb_build_object('ok',true,'stage',inbox_stage,'version',conversation_version) into result from public.customers where id=c.id;
 insert into public.inbox_action_receipts(tenant_id,actor_id,request_id,customer_id,payload,result) values(c.tenant_id,p_actor,p_key,c.id,payload,result);
 return result;
end $$$sql_32_23$;

-- smart-inbox-pro.sql: source statement 24
execute $sql_32_24$revoke all on function public.manage_inbox_pro(uuid,uuid,text,integer,uuid,text,uuid),public.sync_inbox_pro_stage() from public,anon,authenticated$sql_32_24$;

-- smart-inbox-pro.sql: source statement 25
execute $sql_32_25$grant execute on function public.manage_inbox_pro(uuid,uuid,text,integer,uuid,text,uuid) to service_role$sql_32_25$;

-- smart-inbox-pro.sql: source statement 26
execute $sql_32_26$create or replace function public.inbox_pro_message_progress() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.sender='agent' then
  update public.customers set inbox_stage='IN_PROGRESS',conversation_version=conversation_version+1 where id=new.customer_id and assigned_user_id is not null and conversation_status='open' and inbox_stage in ('ASSIGNED','RESOLVED');
 elsif new.sender='customer' then
  update public.customers set inbox_stage=case when assigned_user_id is null then 'UNASSIGNED' else 'IN_PROGRESS' end,conversation_version=conversation_version+1 where id=new.customer_id and inbox_stage='RESOLVED';
 end if;
 return null;
end $$$sql_32_26$;

-- smart-inbox-pro.sql: source statement 27
execute $sql_32_27$drop trigger if exists messages_inbox_pro_progress on public.messages$sql_32_27$;

-- smart-inbox-pro.sql: source statement 28
execute $sql_32_28$create trigger messages_inbox_pro_progress after insert on public.messages for each row execute function public.inbox_pro_message_progress()$sql_32_28$;

-- smart-inbox-pro.sql: source statement 29
execute $sql_32_29$revoke all on function public.inbox_pro_message_progress() from public,anon,authenticated$sql_32_29$;

-- smart-inbox-pro.sql: source statement 30
execute $sql_32_30$create or replace function public.inbox_pro_overview(p_tenant uuid) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 with counters as (
  select count(*) total,count(*) filter(where inbox_stage='UNASSIGNED' and not bot_enabled) waiting,
   count(*) filter(where inbox_stage in ('ASSIGNED','IN_PROGRESS')) active,
   count(*) filter(where inbox_stage='CLOSED') closed,count(*) filter(where inbox_stage='RESOLVED') resolved,
   count(*) filter(where bot_enabled and conversation_status='open' and assigned_user_id is null) bot,
   count(*) filter(where bot_enabled and conversation_status='open' and assigned_user_id is null and exists(select 1 from public.bot_settings where tenant_id=p_tenant and reply_mode='ai') and public.has_tenant_feature(p_tenant,'ai_agent')) ai,
   count(*) filter(where conversation_status='open' and not bot_enabled and assigned_user_id is null and last_message_at<now()-interval '15 minutes') overdue
  from public.customers where tenant_id=p_tenant
 ), responses as (
  select extract(epoch from(reply.created_at-m.created_at)) seconds from public.messages m
  join public.customers c on c.id=m.customer_id and c.tenant_id=p_tenant
  join lateral (select a.created_at from public.messages a where a.customer_id=c.id and a.sender='agent' and a.delivery_status in ('sent','delivered','read') and a.created_at>=m.created_at order by a.created_at,a.id limit 1) reply on true
  where m.sender='customer' and m.created_at>now()-interval '30 days'
 ), team as (
  select actor_id,count(*) filter(where action='close') closed,count(*) filter(where action='claim') claimed from public.conversation_events where tenant_id=p_tenant and created_at>now()-interval '30 days' and actor_id is not null group by actor_id
 )
 select jsonb_build_object('counts',(select row_to_json(counters) from counters),'averageResponseSeconds',(select round(avg(seconds)) from responses),
  'responseSamples',(select count(*) from responses),'team',coalesce((select jsonb_agg(row_to_json(team)) from team),'[]'::jsonb),'overdueMinutes',15,'days',30)
$$$sql_32_30$;

-- smart-inbox-pro.sql: source statement 31
execute $sql_32_31$revoke all on function public.inbox_pro_overview(uuid) from public,anon,authenticated$sql_32_31$;

-- smart-inbox-pro.sql: source statement 32
execute $sql_32_32$grant execute on function public.inbox_pro_overview(uuid) to service_role$sql_32_32$;

-- smart-inbox-pro.sql: source statement 33
execute $sql_32_33$notify pgrst,'reload schema'$sql_32_33$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('smart-inbox-pro.sql','6c0db1e904369e292a1eac9f1021ee284ba341e5ad5ec6b32e69117a1b2824c5','e5aeb9d94cce891b6ddcfbac736c4db5985f98146a5f582bc4551b5dbaccba6f');
end $migration_32$;

-- 34. smart-inbox-v2.sql
do $migration_33$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='smart-inbox-v2.sql';
  if found then
    if installed <> 'b347a7e9ab5a3dee701401f50d275b88c9607cc9542d0238ad17986517483456' then
      raise exception 'Applied migration changed: smart-inbox-v2.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- smart-inbox-v2.sql: source statement 2
execute $sql_33_2$create table if not exists public.inbox_internal_notes (
 id uuid primary key, tenant_id uuid not null references public.tenants(id) on delete cascade,
 customer_id uuid not null references public.customers(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,
 body text not null check(length(body) between 1 and 2000), created_at timestamptz not null default now()
)$sql_33_2$;

-- smart-inbox-v2.sql: source statement 3
execute $sql_33_3$create index if not exists inbox_internal_notes_customer on public.inbox_internal_notes(tenant_id,customer_id,created_at desc)$sql_33_3$;

-- smart-inbox-v2.sql: source statement 4
execute $sql_33_4$create table if not exists public.inbox_stars (
 customer_id uuid not null references public.customers(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 primary key(customer_id,user_id)
)$sql_33_4$;

-- smart-inbox-v2.sql: source statement 5
execute $sql_33_5$create table if not exists public.inbox_workspace_requests (
 actor_id uuid not null references auth.users(id) on delete cascade, request_id uuid not null,
 customer_id uuid not null references public.customers(id) on delete cascade,
 action text not null, body text, created_at timestamptz not null default now(), primary key(actor_id,request_id)
)$sql_33_5$;

-- smart-inbox-v2.sql: source statement 6
execute $sql_33_6$create index if not exists inbox_workspace_rate on public.inbox_workspace_requests(actor_id,created_at)$sql_33_6$;

-- smart-inbox-v2.sql: source statement 7
execute $sql_33_7$alter table public.inbox_internal_notes enable row level security$sql_33_7$;

-- smart-inbox-v2.sql: source statement 8
execute $sql_33_8$alter table public.inbox_stars enable row level security$sql_33_8$;

-- smart-inbox-v2.sql: source statement 9
execute $sql_33_9$alter table public.inbox_workspace_requests enable row level security$sql_33_9$;

-- smart-inbox-v2.sql: source statement 10
execute $sql_33_10$revoke all on public.inbox_internal_notes,public.inbox_stars,public.inbox_workspace_requests from public,anon,authenticated$sql_33_10$;

-- smart-inbox-v2.sql: source statement 11
execute $sql_33_11$grant all on public.inbox_internal_notes,public.inbox_stars,public.inbox_workspace_requests to service_role$sql_33_11$;

-- smart-inbox-v2.sql: source statement 12
execute $sql_33_12$create or replace function public.manage_inbox_workspace(p_customer uuid,p_actor uuid,p_action text,p_key uuid,p_body text default null)
returns void language plpgsql set search_path=pg_catalog,public as $$
declare c public.customers; old public.inbox_workspace_requests;
begin
 select * into c from public.customers where id=p_customer for share;
 if not found or not(exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_actor)
 or exists(select 1 from public.platform_admins where user_id=p_actor))
 or not public.has_tenant_feature(c.tenant_id,'customer_management') then raise exception 'Forbidden' using errcode='42501'; end if;
 if p_key is null or p_action not in ('note','star','unstar') or p_action is null
 or p_action='note' and (p_body is null or length(trim(p_body))=0 or length(p_body)>2000) then raise exception 'Invalid input' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text,0));
 select * into old from public.inbox_workspace_requests where actor_id=p_actor and request_id=p_key;
 if found then
   if old.customer_id<>p_customer or old.action<>p_action or old.body is distinct from p_body then raise exception 'Request ID reused' using errcode='22023';end if;
   return;
 end if;
 if (select count(*) from public.inbox_workspace_requests where actor_id=p_actor and created_at>clock_timestamp()-interval '1 minute')>=30 then raise exception 'Rate limited' using errcode='P0429';end if;
 if p_action='note' then
   insert into public.inbox_internal_notes(id,tenant_id,customer_id,actor_id,body) values(p_key,c.tenant_id,p_customer,p_actor,p_body);
 elsif p_action='star' then insert into public.inbox_stars values(p_customer,p_actor) on conflict do nothing;
 else delete from public.inbox_stars where customer_id=p_customer and user_id=p_actor;end if;
 insert into public.inbox_workspace_requests(actor_id,request_id,customer_id,action,body) values(p_actor,p_key,p_customer,p_action,p_body);
end $$$sql_33_12$;

-- smart-inbox-v2.sql: source statement 13
execute $sql_33_13$revoke all on function public.manage_inbox_workspace(uuid,uuid,text,uuid,text) from public,anon,authenticated$sql_33_13$;

-- smart-inbox-v2.sql: source statement 14
execute $sql_33_14$grant execute on function public.manage_inbox_workspace(uuid,uuid,text,uuid,text) to service_role$sql_33_14$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('smart-inbox-v2.sql','b347a7e9ab5a3dee701401f50d275b88c9607cc9542d0238ad17986517483456','c554817c3a8c16bd2dc68d725938bc9aef2bba2b63bc8762618157a19584521e');
end $migration_33$;

-- 35. inbox-follow-up-flags.sql
do $migration_34$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='inbox-follow-up-flags.sql';
  if found then
    if installed <> '9584563f84ad0fe2f2cdce52495f97953940f11df49c4844d2d0429413c132a9' then
      raise exception 'Applied migration changed: inbox-follow-up-flags.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- inbox-follow-up-flags.sql: source statement 2
execute $sql_34_2$create table if not exists public.inbox_follow_up_flags (
 customer_id uuid not null references public.customers(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(customer_id,user_id)
)$sql_34_2$;

-- inbox-follow-up-flags.sql: source statement 3
execute $sql_34_3$create index if not exists inbox_follow_up_flags_user on public.inbox_follow_up_flags(tenant_id,user_id,created_at desc)$sql_34_3$;

-- inbox-follow-up-flags.sql: source statement 4
execute $sql_34_4$alter table public.inbox_follow_up_flags enable row level security$sql_34_4$;

-- inbox-follow-up-flags.sql: source statement 5
execute $sql_34_5$revoke all on public.inbox_follow_up_flags from public,anon,authenticated$sql_34_5$;

-- inbox-follow-up-flags.sql: source statement 6
execute $sql_34_6$grant all on public.inbox_follow_up_flags to service_role$sql_34_6$;

-- inbox-follow-up-flags.sql: source statement 7
execute $sql_34_7$create or replace function public.set_inbox_follow_up_flag(p_customer uuid,p_actor uuid,p_enabled boolean,p_key uuid)
returns void language plpgsql set search_path=pg_catalog,public as $$
declare c public.customers; previous public.inbox_workspace_requests; requested_action text;
begin
 select * into c from public.customers where id=p_customer for share;
 if not found or not exists(select 1 from public.tenants where id=c.tenant_id and is_active)
 or not(exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_actor)
 or exists(select 1 from public.platform_admins where user_id=p_actor))
 or not public.has_tenant_feature(c.tenant_id,'customer_management') then
  raise exception 'Forbidden' using errcode='42501';
 end if;
 if p_enabled is null or p_key is null then raise exception 'Invalid input' using errcode='22023';end if;
 requested_action:=case when p_enabled then 'followup' else 'unfollowup' end;
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text,0));
 select * into previous from public.inbox_workspace_requests where actor_id=p_actor and request_id=p_key;
 if found then
  if previous.customer_id<>p_customer or previous.action<>requested_action or previous.body is not null then
   raise exception 'Request ID reused' using errcode='22023';
  end if;
  return;
 end if;
 if (select count(*) from public.inbox_workspace_requests where actor_id=p_actor and created_at>clock_timestamp()-interval '1 minute')>=30 then
  raise exception 'Rate limited' using errcode='P0429';
 end if;
 if p_enabled then
  insert into public.inbox_follow_up_flags(customer_id,user_id,tenant_id) values(c.id,p_actor,c.tenant_id) on conflict do nothing;
 else
  delete from public.inbox_follow_up_flags where customer_id=c.id and user_id=p_actor and tenant_id=c.tenant_id;
 end if;
 insert into public.inbox_workspace_requests(actor_id,request_id,customer_id,action) values(p_actor,p_key,c.id,requested_action);
end $$$sql_34_7$;

-- inbox-follow-up-flags.sql: source statement 8
execute $sql_34_8$revoke all on function public.set_inbox_follow_up_flag(uuid,uuid,boolean,uuid) from public,anon,authenticated$sql_34_8$;

-- inbox-follow-up-flags.sql: source statement 9
execute $sql_34_9$grant execute on function public.set_inbox_follow_up_flag(uuid,uuid,boolean,uuid) to service_role$sql_34_9$;

-- inbox-follow-up-flags.sql: source statement 10
execute $sql_34_10$notify pgrst,'reload schema'$sql_34_10$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('inbox-follow-up-flags.sql','9584563f84ad0fe2f2cdce52495f97953940f11df49c4844d2d0429413c132a9','bdf113d9341ecb5c831a278c0624b0c04ce95ac2aee3a8b0509078099358365d');
end $migration_34$;

-- 36. inbox-quick-replies.sql
do $migration_35$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='inbox-quick-replies.sql';
  if found then
    if installed <> '7d8b33736fed54e475521828127ecf4e2272b9cbbb5e47354181fc6409346ac5' then
      raise exception 'Applied migration changed: inbox-quick-replies.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- inbox-quick-replies.sql: source statement 2
execute $sql_35_2$create table if not exists public.inbox_quick_replies (
 id uuid primary key,tenant_id uuid not null references public.tenants(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,
 body text not null check(length(trim(body)) between 1 and 2000),created_at timestamptz not null default now()
)$sql_35_2$;

-- inbox-quick-replies.sql: source statement 3
execute $sql_35_3$alter table public.inbox_quick_replies add column if not exists shortcut text not null default '' check(length(shortcut)<=60)$sql_35_3$;

-- inbox-quick-replies.sql: source statement 4
execute $sql_35_4$create index if not exists inbox_quick_replies_tenant on public.inbox_quick_replies(tenant_id,created_at)$sql_35_4$;

-- inbox-quick-replies.sql: source statement 5
execute $sql_35_5$alter table public.inbox_quick_replies enable row level security$sql_35_5$;

-- inbox-quick-replies.sql: source statement 6
execute $sql_35_6$revoke all on public.inbox_quick_replies from public,anon,authenticated$sql_35_6$;

-- inbox-quick-replies.sql: source statement 7
execute $sql_35_7$grant all on public.inbox_quick_replies to service_role$sql_35_7$;

-- inbox-quick-replies.sql: source statement 8
execute $sql_35_8$create or replace function public.save_inbox_quick_reply(p_tenant uuid,p_actor uuid,p_key uuid,p_body text,p_shortcut text)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare old public.inbox_quick_replies; row public.inbox_quick_replies;
begin
 if not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor)
 or exists(select 1 from public.platform_admins where user_id=p_actor)) or not public.has_tenant_feature(p_tenant,'customer_management') then raise exception 'Forbidden' using errcode='42501';end if;
 if p_shortcut is null or length(p_shortcut)>60 or p_key is null or p_body is null or length(trim(p_body))=0 or length(p_body)>2000 then raise exception 'Invalid input' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text||':quick-replies-actor',0));
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':quick-replies',0));
 select * into old from public.inbox_quick_replies where id=p_key;
 if found then
  if old.tenant_id<>p_tenant or old.actor_id is distinct from p_actor or old.body<>p_body or old.shortcut<>p_shortcut then raise exception 'Request ID reused' using errcode='22023';end if;
  return jsonb_build_object('id',old.id,'body',old.body,'shortcut',old.shortcut);
 end if;
 if (select count(*) from public.inbox_quick_replies where actor_id=p_actor and created_at>clock_timestamp()-interval '1 minute')>=30 then raise exception 'Rate limited' using errcode='P0429';end if;
 if (select count(*) from public.inbox_quick_replies where tenant_id=p_tenant)>=100 then raise exception 'Store supports up to 100 quick replies' using errcode='22023';end if;
 insert into public.inbox_quick_replies(id,tenant_id,actor_id,body,shortcut) values(p_key,p_tenant,p_actor,p_body,p_shortcut) returning * into row;
 return jsonb_build_object('id',row.id,'body',row.body,'shortcut',row.shortcut);
end $$$sql_35_8$;

-- inbox-quick-replies.sql: source statement 9
execute $sql_35_9$revoke all on function public.save_inbox_quick_reply(uuid,uuid,uuid,text,text) from public,anon,authenticated$sql_35_9$;

-- inbox-quick-replies.sql: source statement 10
execute $sql_35_10$grant execute on function public.save_inbox_quick_reply(uuid,uuid,uuid,text,text) to service_role$sql_35_10$;

-- inbox-quick-replies.sql: source statement 11
execute $sql_35_11$create or replace function public.save_inbox_quick_reply(p_tenant uuid,p_actor uuid,p_key uuid,p_body text)
returns jsonb language sql set search_path=pg_catalog,public as $$
 select public.save_inbox_quick_reply(p_tenant,p_actor,p_key,p_body,'');
$$$sql_35_11$;

-- inbox-quick-replies.sql: source statement 12
execute $sql_35_12$revoke all on function public.save_inbox_quick_reply(uuid,uuid,uuid,text) from public,anon,authenticated$sql_35_12$;

-- inbox-quick-replies.sql: source statement 13
execute $sql_35_13$grant execute on function public.save_inbox_quick_reply(uuid,uuid,uuid,text) to service_role$sql_35_13$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('inbox-quick-replies.sql','7d8b33736fed54e475521828127ecf4e2272b9cbbb5e47354181fc6409346ac5','832f7002fc6a45f2a5054583c19e03942ecb451423afa4b3d168510206f0e6eb');
end $migration_35$;

-- 37. inbox-actions.sql
do $migration_36$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='inbox-actions.sql';
  if found then
    if installed <> 'a9d5ec9163b5fac342843a2e46b5f2eb3f888f42709dce4953a7cea1e0ae190a' then
      raise exception 'Applied migration changed: inbox-actions.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- inbox-actions.sql: source statement 2
execute $sql_36_2$create or replace function public.manage_inbox_conversation(p_customer uuid,p_actor uuid,p_action text,p_version integer,p_assignee uuid default null) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare c public.customers;previous uuid; mode text;
begin
 select * into c from public.customers where id=p_customer for update;
 if not found or not(exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_actor)
    or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Forbidden' using errcode='42501';end if;
 if not public.has_tenant_feature(c.tenant_id,'customer_management') then raise exception 'FEATURE_LOCKED' using errcode='42501';end if;
 if p_version is null or c.conversation_version<>p_version then raise exception 'Conversation changed; reload and retry' using errcode='40001';end if;
 if c.outbound_lock_until>clock_timestamp() then raise exception 'A message is being sent; retry shortly' using errcode='55P03';end if;
 previous:=c.assigned_user_id;
 if p_action in ('close','reopen','pause','bot') and c.assigned_user_id is not null and c.assigned_user_id<>p_actor
  and not exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_actor and role='owner')
  and not exists(select 1 from public.platform_admins where user_id=p_actor) then raise exception 'Conversation belongs to another agent' using errcode='42501';end if;
 if p_action='claim' then
  if c.assigned_user_id is not null and c.assigned_user_id<>p_actor then raise exception 'Already assigned' using errcode='40001';end if;
  c.assigned_user_id:=p_actor;c.bot_enabled:=false;c.conversation_status:='open';
 elsif p_action='transfer' then
  if c.assigned_user_id is distinct from p_actor and not exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_actor and role='owner')
   and not exists(select 1 from public.platform_admins where user_id=p_actor) then raise exception 'Forbidden' using errcode='42501';end if;
  if not exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_assignee) then raise exception 'Assignee is not a shop member' using errcode='22023';end if;
  c.assigned_user_id:=p_assignee;c.bot_enabled:=false;c.conversation_status:='open';
 elsif p_action='close' then c.conversation_status:='closed';c.bot_enabled:=false;
 elsif p_action='reopen' then c.conversation_status:='open';c.bot_enabled:=false;
 elsif p_action='pause' then c.bot_enabled:=false;
 elsif p_action='bot' then
  select reply_mode into mode from public.bot_settings where tenant_id=c.tenant_id;
  if mode is null or not exists(select 1 from public.tenants where id=c.tenant_id and auto_reply_enabled) then raise exception 'Bot is not configured or enabled' using errcode='22023';end if;
  if mode='ai' and not public.has_tenant_feature(c.tenant_id,'ai_agent') then raise exception 'FEATURE_LOCKED: ai_agent' using errcode='42501';end if;
  c.bot_enabled:=true;c.assigned_user_id:=null;c.conversation_status:='open';
 else raise exception 'Unknown action' using errcode='22023';end if;
 update public.customers set assigned_user_id=c.assigned_user_id,bot_enabled=c.bot_enabled,conversation_status=c.conversation_status,
  conversation_version=conversation_version+1,handover_at=case when c.bot_enabled then null else now() end where id=c.id;
 insert into public.conversation_events(tenant_id,customer_id,actor_id,action,previous_assignee,next_assignee)
 values(c.tenant_id,c.id,p_actor,p_action,previous,c.assigned_user_id);
 return jsonb_build_object('ok',true,'customer',(
  select jsonb_build_object('id',id,'tenant_id',tenant_id,'assigned_user_id',assigned_user_id,
    'bot_enabled',bot_enabled,'conversation_status',conversation_status,
    'conversation_version',conversation_version,'inbound_seq',inbound_seq)
  from public.customers where id=c.id and tenant_id=c.tenant_id
  ));
end $$$sql_36_2$;

-- inbox-actions.sql: source statement 3
execute $sql_36_3$revoke all on function public.manage_inbox_conversation(uuid,uuid,text,integer,uuid) from public,anon,authenticated$sql_36_3$;

-- inbox-actions.sql: source statement 4
execute $sql_36_4$grant execute on function public.manage_inbox_conversation(uuid,uuid,text,integer,uuid) to service_role$sql_36_4$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('inbox-actions.sql','a9d5ec9163b5fac342843a2e46b5f2eb3f888f42709dce4953a7cea1e0ae190a','e5f91c58531dd16ff25556e42e3223c0781abe615846f407773143e4d5dd5590');
end $migration_36$;

-- 38. automation-safety.sql
do $migration_37$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='automation-safety.sql';
  if found then
    if installed <> '37da8791492f81612252a073d7d3197e8e4b3907e5f06fe1c413e6cbf73b9d02' then
      raise exception 'Applied migration changed: automation-safety.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- automation-safety.sql: source statement 2
execute $sql_37_2$create table if not exists public.tenant_automation_controls (
 tenant_id uuid primary key references public.tenants(id),
 stopped boolean not null default false,
 updated_at timestamptz not null default now()
)$sql_37_2$;

-- automation-safety.sql: source statement 3
execute $sql_37_3$create table if not exists public.tenant_automation_audit (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 actor_id uuid not null references auth.users(id), stopped boolean not null,
 reason text not null check(length(trim(reason)) between 1 and 500), created_at timestamptz not null default now()
)$sql_37_3$;

-- automation-safety.sql: source statement 4
execute $sql_37_4$alter table public.tenant_automation_controls enable row level security$sql_37_4$;

-- automation-safety.sql: source statement 5
execute $sql_37_5$alter table public.tenant_automation_audit enable row level security$sql_37_5$;

-- automation-safety.sql: source statement 6
execute $sql_37_6$revoke all on public.tenant_automation_controls,public.tenant_automation_audit from public,anon,authenticated$sql_37_6$;

-- automation-safety.sql: source statement 7
execute $sql_37_7$grant select,insert,update on public.tenant_automation_controls to service_role$sql_37_7$;

-- automation-safety.sql: source statement 8
execute $sql_37_8$grant select,insert on public.tenant_automation_audit to service_role$sql_37_8$;

-- automation-safety.sql: source statement 9
execute $sql_37_9$create or replace function public.set_tenant_automation_stop(p_tenant uuid,p_actor uuid,p_stopped boolean,p_reason text) returns void
language plpgsql set search_path=pg_catalog,public as $$
begin
 if not exists(select 1 from public.tenants where id=p_tenant and is_active) or not (
  exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner')
  or exists(select 1 from public.platform_admins where user_id=p_actor)
 ) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_stopped is null or p_reason is null or length(trim(p_reason)) not between 1 and 500 then raise exception 'Invalid stop request' using errcode='22023';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 insert into public.tenant_automation_controls(tenant_id,stopped) values(p_tenant,p_stopped)
 on conflict(tenant_id) do update set stopped=excluded.stopped,updated_at=now();
 insert into public.tenant_automation_audit(tenant_id,actor_id,stopped,reason) values(p_tenant,p_actor,p_stopped,trim(p_reason));
end $$$sql_37_9$;

-- automation-safety.sql: source statement 10
execute $sql_37_10$revoke all on function public.set_tenant_automation_stop(uuid,uuid,boolean,text) from public,anon,authenticated$sql_37_10$;

-- automation-safety.sql: source statement 11
execute $sql_37_11$grant execute on function public.set_tenant_automation_stop(uuid,uuid,boolean,text) to service_role$sql_37_11$;

-- automation-safety.sql: source statement 12
execute $sql_37_12$create or replace function public.claim_and_start_inbox_reply(p_customer uuid,p_actor uuid,p_version integer) returns uuid
language plpgsql set search_path=pg_catalog,public as $$
declare c public.customers;
begin
 select * into c from public.customers where id=p_customer for update;
 if not found then raise exception 'Conversation unavailable' using errcode='40001';end if;
 if not public.has_tenant_feature(c.tenant_id,'customer_management') or not (
  exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_actor)
  or exists(select 1 from public.platform_admins where user_id=p_actor)
 ) then raise exception 'Forbidden' using errcode='42501';end if;
 if c.conversation_version is distinct from p_version or c.conversation_status='closed' or (c.assigned_user_id is not null and c.assigned_user_id<>p_actor) then raise exception 'Conversation changed' using errcode='40001';end if;
 if c.bot_enabled or c.assigned_user_id is null then
  perform public.manage_inbox_conversation(p_customer,p_actor,'claim',p_version);
 end if;
 return public.start_inbox_delivery(p_customer,p_actor);
end $$$sql_37_12$;

-- automation-safety.sql: source statement 13
execute $sql_37_13$revoke all on function public.claim_and_start_inbox_reply(uuid,uuid,integer) from public,anon,authenticated$sql_37_13$;

-- automation-safety.sql: source statement 14
execute $sql_37_14$grant execute on function public.claim_and_start_inbox_reply(uuid,uuid,integer) to service_role$sql_37_14$;

-- automation-safety.sql: source statement 15
execute $sql_37_15$notify pgrst,'reload schema'$sql_37_15$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('automation-safety.sql','37da8791492f81612252a073d7d3197e8e4b3907e5f06fe1c413e6cbf73b9d02','86b4d84d2db794a379520b40c3ff268143107c2a12501c72c90b32445a668096');
end $migration_37$;

-- 39. smart-follow-ups.sql
do $migration_38$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='smart-follow-ups.sql';
  if found then
    if installed <> 'd21abb2a3fc187d74128338926d59140259d1e4ebe8b36dc42806433e20d5f0a' then
      raise exception 'Applied migration changed: smart-follow-ups.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- smart-follow-ups.sql: source statement 2
execute $sql_38_2$alter table public.customers add column if not exists followup_opted_out boolean not null default false$sql_38_2$;

-- smart-follow-ups.sql: source statement 3
execute $sql_38_3$alter table public.customers add column if not exists followup_opted_out_at timestamptz$sql_38_3$;

-- smart-follow-ups.sql: source statement 4
execute $sql_38_4$alter table public.customers add column if not exists contact_suspended boolean not null default false$sql_38_4$;

-- smart-follow-ups.sql: source statement 5
execute $sql_38_5$alter table public.orders add column if not exists confirmed_at timestamptz$sql_38_5$;

-- smart-follow-ups.sql: source statement 7
execute $sql_38_7$create table if not exists public.follow_up_policies(
 tenant_id uuid primary key references public.tenants(id) on delete cascade,enabled boolean not null default false,
 timezone text not null default 'Asia/Bangkok',quiet_enabled boolean not null default false,
 quiet_start integer not null default 1320 check(quiet_start between 0 and 1439),quiet_end integer not null default 480 check(quiet_end between 0 and 1439),
 max_per_customer integer not null default 3 check(max_per_customer between 1 and 20),max_per_order integer not null default 3 check(max_per_order between 1 and 10)
)$sql_38_7$;

-- smart-follow-ups.sql: source statement 8
execute $sql_38_8$create table if not exists public.follow_up_workflows(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,
 kind text not null check(kind in ('payment','interested','after_sales')),enabled boolean not null default false,
 use_ai boolean not null default false,stop_on_reply boolean not null default true,version integer not null default 1,
 steps jsonb not null check(jsonb_typeof(steps)='array' and jsonb_array_length(steps) between 1 and 3),unique(tenant_id,kind)
)$sql_38_8$;

-- smart-follow-ups.sql: source statement 9
execute $sql_38_9$create table if not exists public.order_delivery_events(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),order_id uuid not null unique references public.orders(id),
 customer_id uuid not null references public.customers(id),confirmed_by uuid not null references auth.users(id),
 evidence text not null check(length(trim(evidence)) between 5 and 1000),delivered_at timestamptz not null,created_at timestamptz not null default now()
)$sql_38_9$;

-- smart-follow-ups.sql: source statement 10
execute $sql_38_10$alter table public.follow_up_jobs alter column order_id drop not null$sql_38_10$;

-- smart-follow-ups.sql: source statement 11
execute $sql_38_11$alter table public.follow_up_jobs drop constraint if exists follow_up_jobs_order_id_step_key$sql_38_11$;

-- smart-follow-ups.sql: source statement 12
execute $sql_38_12$alter table public.follow_up_jobs drop constraint if exists follow_up_jobs_status_check$sql_38_12$;

-- smart-follow-ups.sql: source statement 13
execute $sql_38_13$alter table public.follow_up_jobs add constraint follow_up_jobs_status_check check(status in ('scheduled','pending','processing','sent','failed','cancelled','skipped','requires_review'))$sql_38_13$;

-- smart-follow-ups.sql: source statement 14
execute $sql_38_14$alter table public.follow_up_jobs alter column status set default 'pending'$sql_38_14$;

-- smart-follow-ups.sql: source statement 15
execute $sql_38_15$alter table public.follow_up_jobs add column if not exists kind text not null default 'payment' check(kind in ('payment','interested','after_sales'))$sql_38_15$;

-- smart-follow-ups.sql: source statement 16
execute $sql_38_16$alter table public.follow_up_jobs add column if not exists workflow_id uuid references public.follow_up_workflows(id)$sql_38_16$;

-- smart-follow-ups.sql: source statement 17
execute $sql_38_17$alter table public.follow_up_jobs add column if not exists workflow_version integer not null default 1$sql_38_17$;

-- smart-follow-ups.sql: source statement 18
execute $sql_38_18$alter table public.follow_up_jobs add column if not exists source_message_id uuid references public.messages(id)$sql_38_18$;

-- smart-follow-ups.sql: source statement 19
execute $sql_38_19$alter table public.follow_up_jobs add column if not exists product_id uuid references public.products(id)$sql_38_19$;

-- smart-follow-ups.sql: source statement 20
execute $sql_38_20$alter table public.follow_up_jobs add column if not exists source_seq bigint not null default 0$sql_38_20$;

-- smart-follow-ups.sql: source statement 21
execute $sql_38_21$alter table public.follow_up_jobs add column if not exists anchor_at timestamptz not null default now()$sql_38_21$;

-- smart-follow-ups.sql: source statement 22
execute $sql_38_22$alter table public.follow_up_jobs add column if not exists claim_token uuid$sql_38_22$;

-- smart-follow-ups.sql: source statement 23
execute $sql_38_23$alter table public.follow_up_jobs add column if not exists claim_until timestamptz$sql_38_23$;

-- smart-follow-ups.sql: source statement 24
execute $sql_38_24$alter table public.follow_up_jobs add column if not exists attempts integer not null default 0$sql_38_24$;

-- smart-follow-ups.sql: source statement 25
execute $sql_38_25$alter table public.follow_up_jobs add column if not exists dispatch_started_at timestamptz$sql_38_25$;

-- smart-follow-ups.sql: source statement 26
execute $sql_38_26$alter table public.follow_up_jobs add column if not exists message_id uuid references public.messages(id)$sql_38_26$;

-- smart-follow-ups.sql: source statement 27
execute $sql_38_27$alter table public.follow_up_jobs add column if not exists provider_message_id text$sql_38_27$;

-- smart-follow-ups.sql: source statement 28
execute $sql_38_28$alter table public.follow_up_jobs add column if not exists reserved_monthly integer not null default 0$sql_38_28$;

-- smart-follow-ups.sql: source statement 29
execute $sql_38_29$alter table public.follow_up_jobs add column if not exists reserved_topup integer not null default 0$sql_38_29$;

-- smart-follow-ups.sql: source statement 30
execute $sql_38_30$alter table public.follow_up_jobs add column if not exists delivery_lease uuid$sql_38_30$;

-- smart-follow-ups.sql: source statement 31
execute $sql_38_31$alter table public.follow_up_jobs add column if not exists responded_at timestamptz$sql_38_31$;

-- smart-follow-ups.sql: source statement 32
execute $sql_38_32$alter table public.follow_up_jobs add column if not exists ai_approved boolean not null default false$sql_38_32$;

-- smart-follow-ups.sql: source statement 33
execute $sql_38_33$create unique index if not exists follow_up_order_step on public.follow_up_jobs(order_id,kind,step) where order_id is not null$sql_38_33$;

-- smart-follow-ups.sql: source statement 34
execute $sql_38_34$create unique index if not exists follow_up_interest_step on public.follow_up_jobs(source_message_id,step) where kind='interested'$sql_38_34$;

-- smart-follow-ups.sql: source statement 35
execute $sql_38_35$create index if not exists follow_up_pending_due on public.follow_up_jobs(run_at,id) where status='pending'$sql_38_35$;

-- smart-follow-ups.sql: source statement 36
execute $sql_38_36$create index if not exists follow_up_processing_lease on public.follow_up_jobs(claim_until) where status='processing'$sql_38_36$;

-- smart-follow-ups.sql: source statement 37
execute $sql_38_37$create index if not exists follow_up_contact_rate on public.follow_up_jobs(customer_id,dispatch_started_at desc) where dispatch_started_at is not null$sql_38_37$;

-- smart-follow-ups.sql: source statement 38
execute $sql_38_38$create table if not exists public.follow_up_execution_logs(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),job_id uuid not null references public.follow_up_jobs(id),
 status text not null,reason text,actor_id uuid references auth.users(id),created_at timestamptz not null default now()
)$sql_38_38$;

-- smart-follow-ups.sql: source statement 39
execute $sql_38_39$create index if not exists follow_up_logs_tenant on public.follow_up_execution_logs(tenant_id,created_at desc)$sql_38_39$;

-- smart-follow-ups.sql: source statement 46
execute $sql_38_46$do $$declare tab text;begin
 foreach tab in array array['follow_up_policies','follow_up_workflows','order_delivery_events','follow_up_execution_logs'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated',tab);
  execute format('grant select on public.%I to authenticated',tab);
  execute format('grant all on public.%I to service_role',tab);
  execute format('drop policy if exists tenant_read on public.%I',tab);
  execute format('create policy tenant_read on public.%I for select to authenticated using(public.can_access_tenant(tenant_id) and public.has_tenant_feature(tenant_id,''customer_follow_up''))',tab);
 end loop;
end $$$sql_38_46$;

-- smart-follow-ups.sql: source statement 47
execute $sql_38_47$revoke update(status,reason) on public.follow_up_jobs from authenticated$sql_38_47$;

-- smart-follow-ups.sql: source statement 48
execute $sql_38_48$revoke insert,update,delete on public.follow_up_jobs from authenticated,anon$sql_38_48$;

-- smart-follow-ups.sql: source statement 49
execute $sql_38_49$grant select(followup_opted_out,followup_opted_out_at,contact_suspended) on public.customers to authenticated$sql_38_49$;

-- smart-follow-ups.sql: source statement 50
execute $sql_38_50$grant select(confirmed_at) on public.orders to authenticated$sql_38_50$;

-- smart-follow-ups.sql: source statement 51
execute $sql_38_51$create or replace function public.log_follow_up_state() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op='INSERT' or new.status is distinct from old.status or new.reason is distinct from old.reason then
  insert into public.follow_up_execution_logs(tenant_id,job_id,status,reason) values(new.tenant_id,new.id,new.status,new.reason);
 end if;return new;
end $$$sql_38_51$;

-- smart-follow-ups.sql: source statement 52
execute $sql_38_52$drop trigger if exists follow_up_state_log on public.follow_up_jobs$sql_38_52$;

-- smart-follow-ups.sql: source statement 53
execute $sql_38_53$create trigger follow_up_state_log after insert or update on public.follow_up_jobs for each row execute function public.log_follow_up_state()$sql_38_53$;

-- smart-follow-ups.sql: source statement 54
begin
execute $sql_38_54$create or replace function public.enqueue_follow_up(p_tenant uuid,p_customer uuid,p_kind text,p_order uuid default null,p_source uuid default null,p_product uuid default null) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare w public.follow_up_workflows;c public.customers;anchor timestamptz;st jsonb;n integer:=0;source_sequence bigint;
begin
 select * into c from public.customers where id=p_customer and tenant_id=p_tenant;
 if not found or c.followup_opted_out or c.contact_suspended or not c.bot_enabled or c.assigned_user_id is not null or c.conversation_status='closed' then return;end if;
 source_sequence:=c.inbound_seq;
 if not public.has_tenant_feature(p_tenant,'customer_follow_up') or not exists(select 1 from public.follow_up_policies where tenant_id=p_tenant and enabled) then return;end if;
 select * into w from public.follow_up_workflows where tenant_id=p_tenant and kind=p_kind and enabled;
 if not found then return;end if;
 if p_kind<>'payment' and not public.has_tenant_feature(p_tenant,'ai_agent') then return;end if;
 if p_kind='interested' then
  if not public.has_tenant_feature(p_tenant,'ai_agent') then return;end if;
  select created_at into anchor from public.messages where id=p_source and customer_id=c.id and sender='customer' and inbound_seq=c.inbound_seq;
  if anchor is null or not exists(select 1 from public.products where id=p_product and tenant_id=p_tenant and is_active) or exists(select 1 from public.orders where tenant_id=p_tenant and customer_id=c.id and created_at>=anchor) then return;end if;
 elsif p_kind='payment' then
  select o.confirmed_at,coalesce(m.inbound_seq,c.inbound_seq) into anchor,source_sequence from public.orders o left join public.messages m on m.id=o.message_id where o.id=p_order and o.tenant_id=p_tenant and o.customer_id=c.id and o.status='pending_payment';
 elsif p_kind='after_sales' then
  select d.delivered_at into anchor from public.order_delivery_events d join public.orders o on o.id=d.order_id where d.order_id=p_order and d.tenant_id=p_tenant and d.customer_id=c.id and o.status='shipped';
 else return;end if;
 if anchor is null then return;end if;
 for st in select value from jsonb_array_elements(w.steps) loop
  n:=n+1;
  insert into public.follow_up_jobs(tenant_id,customer_id,order_id,kind,workflow_id,workflow_version,source_message_id,product_id,step,text,run_at,anchor_at,source_seq,status,reason)
  values(p_tenant,c.id,p_order,p_kind,w.id,w.version,p_source,p_product,n,st->>'text',anchor+make_interval(mins=>(st->>'delay_minutes')::integer),anchor,source_sequence,
   case when w.use_ai then 'requires_review' else 'pending' end,case when w.use_ai then 'ai_draft' else null end)
  on conflict do nothing;
 end loop;
end $$$sql_38_54$;
exception when invalid_function_definition then
  -- A newer signature of enqueue_follow_up(uuid,uuid,text,uuid,uuid,uuid) is already installed. Its final definition below is mandatory.
  null;
end;

-- smart-follow-ups.sql: source statement 55
execute $sql_38_55$create or replace function public.schedule_follow_ups() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 update public.follow_up_jobs set status='cancelled',reason='new_order' where customer_id=new.customer_id and tenant_id=new.tenant_id and kind='interested' and (status in ('pending','requires_review') or status='processing' and dispatch_started_at is null);
 if new.status='pending_payment' then perform public.enqueue_follow_up(new.tenant_id,new.customer_id,'payment',new.id);end if;
 return new;
end $$$sql_38_55$;

-- smart-follow-ups.sql: source statement 56
execute $sql_38_56$create or replace function public.confirm_cf_order() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.message_id is not null and exists(select 1 from public.messages m where m.id=new.message_id and m.customer_id=new.customer_id and m.sender='customer') then new.confirmed_at:=coalesce(new.confirmed_at,now());end if;
 return new;
end $$$sql_38_56$;

-- smart-follow-ups.sql: source statement 57
execute $sql_38_57$drop trigger if exists orders_confirm_cf on public.orders$sql_38_57$;

-- smart-follow-ups.sql: source statement 58
execute $sql_38_58$create trigger orders_confirm_cf before insert on public.orders for each row execute function public.confirm_cf_order()$sql_38_58$;

-- smart-follow-ups.sql: source statement 59
execute $sql_38_59$create or replace function public.cancel_paid_follow_ups() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.status<>old.status and new.status in ('paid','shipped','cancelled') then
  update public.follow_up_jobs set status='cancelled',reason=case when new.status='cancelled' then 'order_cancelled' else 'paid' end
  where order_id=new.id and (kind='payment' or new.status='cancelled') and (status in ('pending','requires_review') or status='processing' and dispatch_started_at is null);
 end if;return null;
end $$$sql_38_59$;

-- smart-follow-ups.sql: source statement 60
execute $sql_38_60$create or replace function public.on_follow_up_customer() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.followup_opted_out or new.contact_suspended or not new.bot_enabled or new.assigned_user_id is not null or new.conversation_status='closed' then
  update public.follow_up_jobs set status='cancelled',reason=case when new.followup_opted_out then 'opt_out' when new.contact_suspended then 'contact_suspended' else 'handover' end
  where customer_id=new.id and (status in ('pending','requires_review') or status='processing' and dispatch_started_at is null);
 end if;return null;
end $$$sql_38_60$;

-- smart-follow-ups.sql: source statement 61
execute $sql_38_61$drop trigger if exists customers_follow_up_stop on public.customers$sql_38_61$;

-- smart-follow-ups.sql: source statement 62
execute $sql_38_62$create trigger customers_follow_up_stop after update of followup_opted_out,contact_suspended,bot_enabled,assigned_user_id,conversation_status on public.customers for each row execute function public.on_follow_up_customer()$sql_38_62$;

-- smart-follow-ups.sql: source statement 63
execute $sql_38_63$create or replace function public.on_follow_up_message() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare normalized text;
begin
 if new.sender<>'customer' then return null;end if;
 normalized:=lower(regexp_replace(coalesce(new.body,''),'[[:space:][:punct:]]','','g'));
 if normalized in ('stop','unsubscribe','ไม่รับข้อความ','หยุดส่งข้อความ','ยกเลิกติดตาม','ไม่ต้องส่งแล้ว','หยุดติดตาม','ไม่ต้องติดตาม','ไม่ต้องส่งข้อความอีก','เลิกส่งข้อความ','ไม่รับข่าวสาร','ยกเลิกข้อความ') then
  update public.customers set followup_opted_out=true,followup_opted_out_at=now() where id=new.customer_id;
 elsif normalized in ('start','subscribe','เริ่มติดตาม','รับข้อความติดตาม') then
  update public.customers set followup_opted_out=false,followup_opted_out_at=null where id=new.customer_id;
 end if;
 update public.follow_up_jobs set responded_at=coalesce(responded_at,new.created_at) where customer_id=new.customer_id and status='sent' and source_seq<new.inbound_seq and sent_at<=new.created_at;
 update public.follow_up_jobs j set status='cancelled',reason='customer_replied' from public.follow_up_workflows w
 where j.customer_id=new.customer_id and w.id=j.workflow_id and (w.stop_on_reply or j.kind='interested') and j.source_seq<new.inbound_seq and (j.status in ('pending','requires_review') or j.status='processing' and j.dispatch_started_at is null);
 return null;
end $$$sql_38_63$;

-- smart-follow-ups.sql: source statement 64
execute $sql_38_64$drop trigger if exists messages_follow_up_stop on public.messages$sql_38_64$;

-- smart-follow-ups.sql: source statement 65
execute $sql_38_65$create trigger messages_follow_up_stop after insert on public.messages for each row execute function public.on_follow_up_message()$sql_38_65$;

-- smart-follow-ups.sql: source statement 66
execute $sql_38_66$create or replace function public.on_follow_up_delivery() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if not exists(select 1 from public.orders where id=new.order_id and tenant_id=new.tenant_id and customer_id=new.customer_id and status='shipped' and created_at<=new.delivered_at)
  or new.delivered_at>clock_timestamp()+interval '2 minutes' then raise exception 'Actual shipped order and delivery evidence required' using errcode='22023';end if;
 perform public.enqueue_follow_up(new.tenant_id,new.customer_id,'after_sales',new.order_id);
 return null;
end $$$sql_38_66$;

-- smart-follow-ups.sql: source statement 67
execute $sql_38_67$drop trigger if exists delivery_schedule_follow_up on public.order_delivery_events$sql_38_67$;

-- smart-follow-ups.sql: source statement 68
execute $sql_38_68$create trigger delivery_schedule_follow_up after insert on public.order_delivery_events for each row execute function public.on_follow_up_delivery()$sql_38_68$;

-- smart-follow-ups.sql: source statement 69
execute $sql_38_69$create or replace function public.claim_follow_up_jobs(p_tenant uuid default null,p_limit integer default 5) returns setof public.follow_up_jobs
language plpgsql set search_path=pg_catalog,public as $$
begin
 -- Once dispatch starts, a crashed worker must NEVER guess that the request was not delivered.
 update public.follow_up_jobs set status='requires_review',reason='worker_restarted',claim_token=null,claim_until=null
 where status='processing' and claim_until<clock_timestamp() and dispatch_started_at is not null and (p_tenant is null or tenant_id=p_tenant);
 update public.follow_up_jobs set status=case when attempts>=3 then 'failed' else 'pending' end,reason='worker_restarted',claim_token=null,claim_until=null,run_at=greatest(run_at,now()+interval '10 seconds')
 where status='processing' and claim_until<clock_timestamp() and dispatch_started_at is null and (p_tenant is null or tenant_id=p_tenant);
 return query with due as(
  select id from public.follow_up_jobs where status='pending' and run_at<=now() and attempts<3 and (p_tenant is null or tenant_id=p_tenant)
  order by run_at,id limit least(greatest(p_limit,1),10) for update skip locked
 ) update public.follow_up_jobs j set status='processing',claim_token=gen_random_uuid(),claim_until=clock_timestamp()+interval '2 minutes',attempts=attempts+1,reason=null
 from due where j.id=due.id returning j.*;
end $$$sql_38_69$;

-- smart-follow-ups.sql: source statement 70
execute $sql_38_70$create or replace function public.render_smart_follow_up(p_template text,p_name text,p_product text,p_total numeric) returns text
language plpgsql immutable set search_path=pg_catalog,public as $$
declare remaining text:=p_template;result text:='';matched text[];token text;at_position integer;value text;
begin
 loop
  matched:=regexp_match(remaining,'\{(name|ชื่อลูกค้า|product|สินค้า|total|ยอดเงิน)\}');
  exit when matched is null;
  token:='{'||matched[1]||'}';at_position:=strpos(remaining,token);
  value:=case when matched[1] in ('name','ชื่อลูกค้า') then coalesce(p_name,'ลูกค้า') when matched[1] in ('product','สินค้า') then coalesce(p_product,'') else to_char(coalesce(p_total,0),'FM9999999990.00') end;
  result:=result||left(remaining,at_position-1)||value;remaining:=substring(remaining from at_position+length(token));
 end loop;
 return result||remaining;
end $$$sql_38_70$;

-- smart-follow-ups.sql: source statement 71
execute $sql_38_71$revoke all on function public.render_smart_follow_up(text,text,text,numeric) from public,anon,authenticated$sql_38_71$;

-- smart-follow-ups.sql: source statement 72
execute $sql_38_72$grant execute on function public.render_smart_follow_up(text,text,text,numeric) to service_role$sql_38_72$;

-- smart-follow-ups.sql: source statement 73
begin
execute $sql_38_73$create or replace function public.prepare_follow_up(p_job uuid,p_claim uuid) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
<<preflight>>
declare j public.follow_up_jobs;c public.customers;w public.follow_up_workflows;p public.follow_up_policies;t public.tenants;o public.orders;
 reason text;next_status text:='cancelled';local_now timestamp;next_local timestamp;minute_now integer;reservation record;lease uuid;msg uuid;rendered text;product text;total numeric;
begin
 select * into j from public.follow_up_jobs where id=p_job;
 if not found then return jsonb_build_object('status','skipped');end if;
 -- Consistent tenant -> customer -> job order, also used by completion. Customer triggers lock jobs.
 select * into t from public.tenants where id=j.tenant_id for update;
 select * into c from public.customers where id=j.customer_id for update;
 select * into j from public.follow_up_jobs where id=p_job for update;
 if j.status<>'processing' or j.claim_token is distinct from p_claim or j.claim_until<=clock_timestamp() or j.dispatch_started_at is not null then return jsonb_build_object('status','skipped');end if;
 select * into w from public.follow_up_workflows where id=j.workflow_id and tenant_id=j.tenant_id;
 select * into p from public.follow_up_policies where tenant_id=j.tenant_id;
 if c.id is null or c.tenant_id is distinct from j.tenant_id or w.id is null or p.tenant_id is null then reason:='invalid_reference';
 elsif not public.has_tenant_feature(j.tenant_id,'customer_follow_up') or (j.kind<>'payment' or w.use_ai) and not public.has_tenant_feature(j.tenant_id,'ai_agent') then reason:='plan_required';
 elsif not p.enabled or not w.enabled or not t.auto_reply_enabled then reason:='disabled';
 elsif w.version<>j.workflow_version then reason:='workflow_changed';
 elsif c.followup_opted_out then reason:='opt_out';
 elsif c.contact_suspended then reason:='contact_suspended';
 elsif not c.bot_enabled or c.assigned_user_id is not null or c.conversation_status='closed' then reason:='handover';
 elsif (w.stop_on_reply or j.kind='interested') and c.inbound_seq>j.source_seq then reason:='customer_replied';end if;
 if reason is null and j.kind in ('payment','after_sales') then
  select * into o from public.orders where id=j.order_id and tenant_id=j.tenant_id and customer_id=j.customer_id;
  if not found then reason:='invalid_reference';
  elsif o.status='cancelled' then reason:='order_cancelled';
  elsif j.kind='payment' and o.status<>'pending_payment' then reason:='paid';
  elsif j.kind='payment' and o.confirmed_at is null then reason:='order_unconfirmed';next_status:='requires_review';
  elsif j.kind='payment' and exists(select 1 from public.slips where tenant_id=j.tenant_id and customer_id=c.id and created_at>=j.anchor_at) then reason:='slip_received';next_status:='requires_review';
  elsif j.kind='after_sales' and (o.status<>'shipped' or not exists(select 1 from public.order_delivery_events where order_id=o.id and tenant_id=j.tenant_id and delivered_at<=clock_timestamp())) then reason:='invalid_reference';end if;
  product:=o.product_name;total:=o.amount;
 elsif reason is null and j.kind='interested' then
  select name,price into product,total from public.products where id=j.product_id and tenant_id=j.tenant_id and is_active;
  if not found or not exists(select 1 from public.messages where id=j.source_message_id and customer_id=c.id and sender='customer') then reason:='invalid_reference';
  elsif exists(select 1 from public.orders where tenant_id=j.tenant_id and customer_id=c.id and created_at>=j.anchor_at) then reason:='new_order';end if;
 end if;
 if reason is null and (c.last_message_at is null or c.last_message_at<clock_timestamp()-interval '24 hours' or c.last_message_at>clock_timestamp()+interval '2 minutes') then reason:='window_closed';next_status:='requires_review';end if;
 if reason is null and w.use_ai and not j.ai_approved then reason:='ai_draft';next_status:='requires_review';end if;
 if reason is not null then
  update public.follow_up_jobs set status=next_status,reason=preflight.reason,claim_token=null,claim_until=null where id=j.id;
  return jsonb_build_object('status',next_status,'reason',reason);
 end if;
 if p.quiet_enabled then
  local_now:=clock_timestamp() at time zone p.timezone;minute_now:=extract(hour from local_now)::integer*60+extract(minute from local_now)::integer;
  if p.quiet_start=p.quiet_end or (p.quiet_start<p.quiet_end and minute_now>=p.quiet_start and minute_now<p.quiet_end) or (p.quiet_start>p.quiet_end and (minute_now>=p.quiet_start or minute_now<p.quiet_end)) then
   next_local:=date_trunc('day',local_now)+make_interval(mins=>p.quiet_end);
   if next_local<=local_now then next_local:=next_local+interval '1 day';end if;
   update public.follow_up_jobs set status='pending',reason='quiet_hours',run_at=next_local at time zone p.timezone,attempts=greatest(0,attempts-1),claim_token=null,claim_until=null where id=j.id;
   return jsonb_build_object('status','deferred');
  end if;
 end if;
 if (select count(*) from public.follow_up_jobs where customer_id=c.id and dispatch_started_at>clock_timestamp()-interval '24 hours')>=p.max_per_customer
  or j.order_id is not null and (select count(*) from public.follow_up_jobs where order_id=j.order_id and dispatch_started_at is not null)>=p.max_per_order then
  update public.follow_up_jobs set status='skipped',reason='rate_limit',claim_token=null,claim_until=null where id=j.id;return jsonb_build_object('status','skipped','reason','rate_limit');
 end if;
 if c.outbound_lock_until>clock_timestamp() then
  update public.follow_up_jobs set status='pending',reason='delivery_busy',run_at=clock_timestamp()+interval '1 minute',attempts=greatest(0,attempts-1),claim_token=null,claim_until=null where id=j.id;return jsonb_build_object('status','deferred');
 end if;
 if exists(select 1 from public.messages where external_id='followup:'||j.id::text) then
  update public.follow_up_jobs set status='requires_review',reason='delivery_unknown',claim_token=null,claim_until=null where id=j.id;return jsonb_build_object('status','requires_review');
 end if;
 select * into reservation from public.reserve_broadcast_credits(j.tenant_id,1);
 if reservation.monthly+reservation.topup<>1 then
  update public.follow_up_jobs set status='requires_review',reason='quota_exhausted',claim_token=null,claim_until=null where id=j.id;return jsonb_build_object('status','requires_review','reason','quota_exhausted');
 end if;
 -- The lease blocks Inbox claim/transfer while the network request is in flight.
 lease:=public.start_inbox_delivery(c.id,null);
 rendered:=public.render_smart_follow_up(j.text,c.display_name,product,total);
 insert into public.messages(customer_id,sender,external_id,body,delivery_status) values(c.id,'bot','followup:'||j.id::text,rendered,'pending') returning id into msg;
 update public.follow_up_jobs set dispatch_started_at=clock_timestamp(),message_id=msg,delivery_lease=lease,reserved_monthly=reservation.monthly,reserved_topup=reservation.topup where id=j.id;
 return jsonb_build_object('status','ready','text',rendered,'customerId',c.id,'psid',c.platform_user_id,'tenantId',j.tenant_id,'messageId',msg);
end $$$sql_38_73$;
exception when invalid_function_definition then
  -- A newer signature of prepare_follow_up(uuid,uuid) is already installed. Its final definition below is mandatory.
  null;
end;

-- smart-follow-ups.sql: source statement 74
begin
execute $sql_38_74$create or replace function public.complete_follow_up(p_job uuid,p_claim uuid,p_result text,p_provider text default null,p_reason text default null) returns boolean
language plpgsql set search_path=pg_catalog,public as $$
declare j public.follow_up_jobs;
begin
 select * into j from public.follow_up_jobs where id=p_job;
 if not found then return false;end if;
 perform 1 from public.tenants where id=j.tenant_id for update;
 perform 1 from public.customers where id=j.customer_id for update;
 select * into j from public.follow_up_jobs where id=p_job for update;
 if j.status<>'processing' or j.claim_token is distinct from p_claim or j.dispatch_started_at is null then return false;end if;
 if p_result not in ('sent','failed','requires_review') or (p_result='sent' and nullif(trim(p_provider),'') is null) then raise exception 'Provider receipt required' using errcode='22023';end if;
 if p_result='failed' or p_result='requires_review' and p_reason='window_closed' then perform public.refund_broadcast_credits(j.tenant_id,j.reserved_monthly,j.reserved_topup);end if;
 update public.messages set delivery_status=case when p_result='sent' then 'sent' when p_result='failed' or p_reason='window_closed' then 'failed' else 'unknown' end,provider_message_id=p_provider where id=j.message_id;
 update public.follow_up_jobs set status=p_result,reason=p_reason,provider_message_id=p_provider,sent_at=case when p_result='sent' then now() else null end,
  claim_token=null,claim_until=null,reserved_monthly=0,reserved_topup=0 where id=j.id;
 perform public.end_inbox_delivery(j.customer_id,j.delivery_lease);
 return true;
end $$$sql_38_74$;
exception when invalid_function_definition then
  -- A newer signature of complete_follow_up(uuid,uuid,text,text,text) is already installed. Its final definition below is mandatory.
  null;
end;

-- smart-follow-ups.sql: source statement 75
execute $sql_38_75$create or replace function public.follow_up_overview(p_tenant uuid) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('pending',count(*) filter(where status='pending'),'processing',count(*) filter(where status='processing'),'sent',count(*) filter(where status='sent'),'requires_review',count(*) filter(where status='requires_review'),'cancelled',count(*) filter(where status in ('cancelled','skipped')),'failed',count(*) filter(where status='failed'),'responded',count(distinct customer_id) filter(where responded_at is not null)) from public.follow_up_jobs where tenant_id=p_tenant and created_at>now()-interval '30 days'
$$$sql_38_75$;

-- smart-follow-ups.sql: source statement 76
execute $sql_38_76$create or replace function public.save_smart_follow_up(p_tenant uuid,p_actor uuid,p_policy jsonb,p_workflows jsonb) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare row jsonb;st jsonb;previous integer;n integer;current_version integer;
begin
 if not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor) or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Forbidden' using errcode='42501';end if;
 if not public.has_tenant_feature(p_tenant,'customer_follow_up') then raise exception 'FEATURE_LOCKED' using errcode='42501';end if;
 if not exists(select 1 from pg_timezone_names where name=p_policy->>'timezone') or jsonb_typeof(p_workflows)<>'array' or jsonb_array_length(p_workflows)<>3 then raise exception 'Invalid settings' using errcode='22023';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 for row in select value from jsonb_array_elements(p_workflows) loop
  if row->>'kind' not in ('payment','interested','after_sales') or jsonb_typeof(row->'steps')<>'array' or jsonb_array_length(row->'steps') not between 1 and 3 then raise exception 'Invalid workflow' using errcode='22023';end if;
  if ((row->>'enabled')::boolean and row->>'kind'<>'payment' or (row->>'use_ai')::boolean) and not public.has_tenant_feature(p_tenant,'ai_agent') then raise exception 'FEATURE_LOCKED: ai_agent' using errcode='42501';end if;
  previous:=0;n:=0;
  for st in select value from jsonb_array_elements(row->'steps') loop
   n:=(st->>'delay_minutes')::integer;
   if n<=previous or n>43200 or length(trim(st->>'text')) not between 1 and 2000 then raise exception 'Invalid workflow steps' using errcode='22023';end if;
   previous:=n;
  end loop;
  select version into current_version from public.follow_up_workflows where tenant_id=p_tenant and kind=row->>'kind' for update;
  if coalesce(current_version,0)<>(row->>'version')::integer then raise exception 'Workflow changed; reload' using errcode='40001';end if;
 end loop;
 if (select count(distinct value->>'kind') from jsonb_array_elements(p_workflows))<>3 then raise exception 'Duplicate workflow kind' using errcode='22023';end if;
 insert into public.follow_up_policies(tenant_id,enabled,timezone,quiet_enabled,quiet_start,quiet_end,max_per_customer,max_per_order)
 values(p_tenant,(p_policy->>'enabled')::boolean,p_policy->>'timezone',(p_policy->>'quiet_enabled')::boolean,(p_policy->>'quiet_start')::integer,(p_policy->>'quiet_end')::integer,(p_policy->>'max_per_customer')::integer,(p_policy->>'max_per_order')::integer)
 on conflict(tenant_id) do update set enabled=excluded.enabled,timezone=excluded.timezone,quiet_enabled=excluded.quiet_enabled,quiet_start=excluded.quiet_start,quiet_end=excluded.quiet_end,max_per_customer=excluded.max_per_customer,max_per_order=excluded.max_per_order;
 for row in select value from jsonb_array_elements(p_workflows) loop
  insert into public.follow_up_workflows(tenant_id,kind,enabled,use_ai,stop_on_reply,steps)
  values(p_tenant,row->>'kind',(row->>'enabled')::boolean,(row->>'use_ai')::boolean,(row->>'stop_on_reply')::boolean,row->'steps')
  on conflict(tenant_id,kind) do update set enabled=excluded.enabled,use_ai=excluded.use_ai,stop_on_reply=excluded.stop_on_reply,steps=excluded.steps,version=follow_up_workflows.version+1;
 end loop;
 update public.follow_up_jobs set status='cancelled',reason=case when (p_policy->>'enabled')::boolean then 'workflow_changed' else 'disabled' end where tenant_id=p_tenant and (status in ('pending','requires_review') or status='processing' and dispatch_started_at is null);
 -- Existing in-flight deliveries are never retried; changes apply to new orders/events.
end $$$sql_38_76$;

-- smart-follow-ups.sql: source statement 77
execute $sql_38_77$create or replace function public.act_follow_up_job(p_job uuid,p_tenant uuid,p_actor uuid,p_action text,p_text text default null) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare j public.follow_up_jobs;
begin
 if not public.has_tenant_feature(p_tenant,'customer_follow_up') or not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor) or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Forbidden' using errcode='42501';end if;
 select * into j from public.follow_up_jobs where id=p_job and tenant_id=p_tenant for update;
 if not found then raise exception 'Job not found' using errcode='P0002';end if;
 if (j.dispatch_started_at is not null and p_action<>'skip') or j.status not in ('pending','requires_review','failed') then raise exception 'Job cannot be resent or changed' using errcode='40001';end if;
 if p_action='cancel' then update public.follow_up_jobs set status='cancelled',reason='manual' where id=j.id;
 elsif p_action='skip' then update public.follow_up_jobs set status='skipped',reason='manual' where id=j.id;
 elsif p_action='approve' and j.status='requires_review' and j.reason='ai_draft' and length(trim(p_text)) between 1 and 2000 then
  update public.follow_up_jobs set text=trim(p_text),ai_approved=true,status='pending',reason=null,run_at=greatest(run_at,now()),attempts=0 where id=j.id;
 elsif p_action='retry' and j.status in ('failed','requires_review') and j.reason in ('worker_restarted','quota_exhausted','no_token') then
  update public.follow_up_jobs set status='pending',reason=null,run_at=greatest(run_at,now()),attempts=0 where id=j.id;
 else raise exception 'Unsafe action' using errcode='22023';end if;
 insert into public.follow_up_execution_logs(tenant_id,job_id,status,reason,actor_id) values(p_tenant,j.id,'admin_action',p_action,p_actor);
end $$$sql_38_77$;

-- smart-follow-ups.sql: source statement 78
execute $sql_38_78$create or replace function public.confirm_follow_up_order(p_order uuid,p_tenant uuid,p_actor uuid) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare c uuid;
begin
 if not public.has_tenant_feature(p_tenant,'customer_follow_up') or not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Forbidden' using errcode='42501';end if;
 update public.orders set confirmed_at=coalesce(confirmed_at,now()) where id=p_order and tenant_id=p_tenant and status='pending_payment' returning customer_id into c;
 if c is null then raise exception 'Pending order not found' using errcode='P0002';end if;
 perform public.enqueue_follow_up(p_tenant,c,'payment',p_order);
end $$$sql_38_78$;

-- smart-follow-ups.sql: source statement 79
execute $sql_38_79$revoke all on function public.confirm_follow_up_order(uuid,uuid,uuid) from public,anon,authenticated$sql_38_79$;

-- smart-follow-ups.sql: source statement 80
execute $sql_38_80$grant execute on function public.confirm_follow_up_order(uuid,uuid,uuid) to service_role$sql_38_80$;

-- smart-follow-ups.sql: source statement 81
execute $sql_38_81$revoke all on function public.save_smart_follow_up(uuid,uuid,jsonb,jsonb),public.act_follow_up_job(uuid,uuid,uuid,text,text) from public,anon,authenticated$sql_38_81$;

-- smart-follow-ups.sql: source statement 82
execute $sql_38_82$grant execute on function public.save_smart_follow_up(uuid,uuid,jsonb,jsonb),public.act_follow_up_job(uuid,uuid,uuid,text,text) to service_role$sql_38_82$;

-- smart-follow-ups.sql: source statement 83
execute $sql_38_83$revoke all on function public.enqueue_follow_up(uuid,uuid,text,uuid,uuid,uuid),public.claim_follow_up_jobs(uuid,integer),public.prepare_follow_up(uuid,uuid),public.complete_follow_up(uuid,uuid,text,text,text),public.follow_up_overview(uuid),public.log_follow_up_state(),public.confirm_cf_order(),public.on_follow_up_customer(),public.on_follow_up_message(),public.on_follow_up_delivery() from public,anon,authenticated$sql_38_83$;

-- smart-follow-ups.sql: source statement 84
execute $sql_38_84$grant execute on function public.enqueue_follow_up(uuid,uuid,text,uuid,uuid,uuid),public.claim_follow_up_jobs(uuid,integer),public.prepare_follow_up(uuid,uuid),public.complete_follow_up(uuid,uuid,text,text,text),public.follow_up_overview(uuid) to service_role$sql_38_84$;

-- smart-follow-ups.sql: source statement 85
execute $sql_38_85$do $$declare tab text;begin
 foreach tab in array array['follow_up_workflows','follow_up_policies'] loop
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=tab) then execute format('alter publication supabase_realtime add table public.%I',tab);end if;
 end loop;
end $$$sql_38_85$;

-- smart-follow-ups.sql: source statement 86
execute $sql_38_86$notify pgrst,'reload schema'$sql_38_86$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('smart-follow-ups.sql','d21abb2a3fc187d74128338926d59140259d1e4ebe8b36dc42806433e20d5f0a','1a1337af816ff8cb005eb12a2753e1595f0857de717cfe955736cf0769898db1');
end $migration_38$;

-- 40. agent-control.sql
do $migration_39$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='agent-control.sql';
  if found then
    if installed <> '5f9ad2e208aecc260394697ca6d6cb611e964b674338c1c96100139b38940f52' then
      raise exception 'Applied migration changed: agent-control.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- agent-control.sql: source statement 2
execute $sql_39_2$alter table public.customers add column if not exists agent_opted_out boolean not null default false$sql_39_2$;

-- agent-control.sql: source statement 3
execute $sql_39_3$create table if not exists public.agent_control_settings(
 tenant_id uuid primary key references public.tenants(id),flags jsonb not null default '{}' check(jsonb_typeof(flags)='object'),
 ai_monthly_limit integer not null default 0 check(ai_monthly_limit between 0 and 1000000),requests_per_minute integer not null default 10 check(requests_per_minute between 1 and 100)
)$sql_39_3$;

-- agent-control.sql: source statement 4
execute $sql_39_4$create table if not exists public.agent_knowledge_sources(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 kind text not null check(kind in ('shop','shipping','warranty','returns','faq','forbidden','handoff')),title text not null check(length(trim(title)) between 1 and 100),
 content text not null check(length(trim(content)) between 1 and 2000),is_active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
)$sql_39_4$;

-- agent-control.sql: source statement 5
execute $sql_39_5$create table if not exists public.agent_prompt_versions(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),version integer not null,instructions text,
 actor_id uuid references auth.users(id),created_at timestamptz not null default now(),unique(tenant_id,version)
)$sql_39_5$;

-- agent-control.sql: source statement 6
execute $sql_39_6$create table if not exists public.agent_message_jobs(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),customer_id uuid not null references public.customers(id),message_id uuid not null unique references public.messages(id),
 inbound_seq bigint not null,status text not null default 'processing' check(status in ('processing','draft','sent','review','skipped','failed')),route text,reason text,
 claim_token uuid,claim_until timestamptz,dispatch_started_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
)$sql_39_6$;

-- agent-control.sql: source statement 7
execute $sql_39_7$create table if not exists public.agent_ai_monthly_usage(tenant_id uuid not null references public.tenants(id),month date not null,used integer not null default 0 check(used>=0),primary key(tenant_id,month))$sql_39_7$;

-- agent-control.sql: source statement 8
execute $sql_39_8$create table if not exists public.agent_ai_usage(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),customer_id uuid references public.customers(id),job_id uuid unique references public.agent_message_jobs(id),
 invocation_key uuid not null unique,status text not null default 'started' check(status in ('started','completed','review','provider_error')),
 input_tokens integer,output_tokens integer,cost_baht numeric,source_ids jsonb not null default '[]',reason text,created_at timestamptz not null default now(),completed_at timestamptz
)$sql_39_8$;

-- agent-control.sql: source statement 9
execute $sql_39_9$create table if not exists public.agent_control_audit(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),actor_id uuid references auth.users(id),event text not null,subject_id uuid,detail text,created_at timestamptz not null default now())$sql_39_9$;

-- agent-control.sql: source statement 10
execute $sql_39_10$create index if not exists agent_jobs_tenant on public.agent_message_jobs(tenant_id,created_at desc)$sql_39_10$;

-- agent-control.sql: source statement 11
execute $sql_39_11$create index if not exists agent_usage_rate on public.agent_ai_usage(tenant_id,created_at desc)$sql_39_11$;

-- agent-control.sql: source statement 12
execute $sql_39_12$create index if not exists agent_knowledge_tenant on public.agent_knowledge_sources(tenant_id,is_active)$sql_39_12$;

-- agent-control.sql: source statement 13
execute $sql_39_13$create index if not exists agent_audit_tenant on public.agent_control_audit(tenant_id,created_at desc)$sql_39_13$;

-- agent-control.sql: source statement 14
execute $sql_39_14$do $$declare tab text;begin
 foreach tab in array array['agent_control_settings','agent_knowledge_sources','agent_prompt_versions','agent_message_jobs','agent_ai_monthly_usage','agent_ai_usage','agent_control_audit'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated',tab);
  execute format('grant select on public.%I to authenticated',tab);
  execute format('grant all on public.%I to service_role',tab);
  execute format('drop policy if exists tenant_read on public.%I',tab);
  execute format('create policy tenant_read on public.%I for select to authenticated using(public.can_access_tenant(tenant_id) and public.has_tenant_feature(tenant_id,''ai_agent''))',tab);
 end loop;
end $$$sql_39_14$;

-- agent-control.sql: source statement 15
execute $sql_39_15$grant select(agent_opted_out) on public.customers to authenticated$sql_39_15$;

-- agent-control.sql: source statement 16
execute $sql_39_16$revoke select on public.agent_message_jobs,public.agent_ai_usage,public.agent_prompt_versions from authenticated$sql_39_16$;

-- agent-control.sql: source statement 17
execute $sql_39_17$grant select(id,tenant_id,status,route,reason,created_at,updated_at) on public.agent_message_jobs to authenticated$sql_39_17$;

-- agent-control.sql: source statement 18
execute $sql_39_18$grant select(id,tenant_id,status,input_tokens,output_tokens,cost_baht,source_ids,reason,created_at,completed_at) on public.agent_ai_usage to authenticated$sql_39_18$;

-- agent-control.sql: source statement 19
execute $sql_39_19$grant select(id,tenant_id,version,actor_id,created_at) on public.agent_prompt_versions to authenticated$sql_39_19$;

-- agent-control.sql: source statement 21
execute $sql_39_21$create or replace function public.record_agent_prompt() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare revision integer;actor uuid:=coalesce(auth.uid(),nullif(current_setting('snapbot.agent_actor',true),'')::uuid);
begin
 if tg_op='INSERT' or new.ai_instructions is distinct from old.ai_instructions then
  select coalesce(max(version),0)+1 into revision from public.agent_prompt_versions where tenant_id=new.tenant_id;
  insert into public.agent_prompt_versions(tenant_id,version,instructions,actor_id) values(new.tenant_id,revision,new.ai_instructions,actor);
  insert into public.agent_control_audit(tenant_id,actor_id,event,detail) values(new.tenant_id,actor,'prompt_version',revision::text);
 end if;return null;
end $$$sql_39_21$;

-- agent-control.sql: source statement 22
execute $sql_39_22$drop trigger if exists bot_settings_agent_version on public.bot_settings$sql_39_22$;

-- agent-control.sql: source statement 23
execute $sql_39_23$create trigger bot_settings_agent_version after insert or update of ai_instructions on public.bot_settings for each row execute function public.record_agent_prompt()$sql_39_23$;

-- agent-control.sql: source statement 24
execute $sql_39_24$create or replace function public.agent_customer_consent() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare target uuid;normalized text;
begin
 if new.sender<>'customer' then return null;end if;
 select tenant_id into target from public.customers where id=new.customer_id;
 if not exists(select 1 from public.agent_control_settings where tenant_id=target and flags->'agent_orchestrator_enabled'='true'::jsonb) then return null;end if;
 normalized:=lower(regexp_replace(coalesce(new.body,''),'[[:space:][:punct:]]','','g'));
 if normalized in ('stop','unsubscribe','หยุดส่งข้อความ','ไม่รับข้อความ','ไม่ต้องส่งแล้ว') then
  update public.customers set agent_opted_out=true,bot_enabled=false,handover_at=now(),conversation_version=conversation_version+1 where id=new.customer_id;
  insert into public.agent_control_audit(tenant_id,event,subject_id) values(target,'customer_opt_out',new.customer_id);
 elsif normalized in ('start','subscribe','รับข้อความ','เริ่มรับข้อความ') then
  update public.customers set agent_opted_out=false where id=new.customer_id;
  insert into public.agent_control_audit(tenant_id,event,subject_id) values(target,'customer_opt_in',new.customer_id);
 end if;return null;
end $$$sql_39_24$;

-- agent-control.sql: source statement 25
execute $sql_39_25$drop trigger if exists messages_agent_consent on public.messages$sql_39_25$;

-- agent-control.sql: source statement 26
execute $sql_39_26$create trigger messages_agent_consent after insert on public.messages for each row execute function public.agent_customer_consent()$sql_39_26$;

-- agent-control.sql: source statement 27
execute $sql_39_27$create or replace function public.guard_agent_consent() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.bot_enabled and new.agent_opted_out then raise exception 'Customer opted out' using errcode='42501';end if;return new;
end $$$sql_39_27$;

-- agent-control.sql: source statement 28
execute $sql_39_28$drop trigger if exists customers_agent_consent_guard on public.customers$sql_39_28$;

-- agent-control.sql: source statement 29
execute $sql_39_29$create trigger customers_agent_consent_guard before update of bot_enabled on public.customers for each row execute function public.guard_agent_consent()$sql_39_29$;

-- agent-control.sql: source statement 30
execute $sql_39_30$create or replace function public.claim_agent_message(p_tenant uuid,p_customer uuid,p_message uuid) returns setof public.agent_message_jobs language plpgsql set search_path=pg_catalog,public as $$
declare c public.customers;m public.messages;
begin
 perform 1 from public.tenants where id=p_tenant and is_active and auto_reply_enabled for update;
 if not found or not exists(select 1 from public.agent_control_settings where tenant_id=p_tenant and flags->'agent_orchestrator_enabled'='true'::jsonb) then return;end if;
 select * into c from public.customers where id=p_customer and tenant_id=p_tenant for update;
 if not found or c.id is null or c.last_message_at is null or c.last_message_at>clock_timestamp()+interval '2 minutes' or c.agent_opted_out or not c.bot_enabled or c.assigned_user_id is not null or c.conversation_status='closed' then return;end if;
 select * into m from public.messages where id=p_message and customer_id=c.id and sender='customer' and inbound_seq=c.inbound_seq;
 if not found or exists(select 1 from public.messages where external_id in ('reply:'||p_message::text,'handover:reply:'||p_message::text)) then return;end if;
 return query insert into public.agent_message_jobs(tenant_id,customer_id,message_id,inbound_seq,claim_token,claim_until) values(p_tenant,c.id,m.id,c.inbound_seq,gen_random_uuid(),clock_timestamp()+interval '3 minutes') on conflict do nothing returning *;
end $$$sql_39_30$;

-- agent-control.sql: source statement 31
begin
execute $sql_39_31$create or replace function public.start_agent_ai_call(p_tenant uuid,p_key uuid,p_customer uuid default null,p_job uuid default null,p_claim uuid default null) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare s public.agent_control_settings;j public.agent_message_jobs;used_count integer;usage_id uuid;month_start date:=date_trunc('month',now() at time zone 'UTC')::date;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if not public.has_tenant_feature(p_tenant,'ai_agent') then return jsonb_build_object('reason','FEATURE_LOCKED');end if;
 select * into s from public.agent_control_settings where tenant_id=p_tenant;
 if not found or s.flags->'agent_orchestrator_enabled' is distinct from 'true'::jsonb then return jsonb_build_object('reason','ORCHESTRATOR_DISABLED');end if;
 if p_customer is not null and not exists(select 1 from public.customers where id=p_customer and tenant_id=p_tenant and not agent_opted_out) then return jsonb_build_object('reason','CUSTOMER_UNAVAILABLE');end if;
 if p_job is not null then
  perform 1 from public.customers where id=p_customer for update;
  select * into j from public.agent_message_jobs where id=p_job and tenant_id=p_tenant and customer_id=p_customer for update;
  if not found or j.status<>'processing' or j.claim_token is distinct from p_claim or j.claim_until<=clock_timestamp() or not exists(select 1 from public.customers where id=p_customer and tenant_id=p_tenant and bot_enabled and assigned_user_id is null and conversation_status<>'closed' and inbound_seq=j.inbound_seq and not agent_opted_out) then return jsonb_build_object('reason','CONVERSATION_CHANGED');end if;
 end if;
 if exists(select 1 from public.agent_ai_usage where invocation_key=p_key or (p_job is not null and job_id=p_job)) then return jsonb_build_object('reason','DUPLICATE_AI_INVOCATION');end if;
 if (select count(*) from public.agent_ai_usage where tenant_id=p_tenant and created_at>clock_timestamp()-interval '1 minute')>=s.requests_per_minute then return jsonb_build_object('reason','AI_RATE_LIMIT');end if;
 insert into public.agent_ai_monthly_usage(tenant_id,month) values(p_tenant,month_start) on conflict do nothing;
 update public.agent_ai_monthly_usage set used=used+1 where tenant_id=p_tenant and month=month_start and used<s.ai_monthly_limit returning used into used_count;
 if not found then return jsonb_build_object('reason','AI_QUOTA_EXHAUSTED');end if;
 insert into public.agent_ai_usage(tenant_id,customer_id,job_id,invocation_key) values(p_tenant,p_customer,p_job,p_key) returning id into usage_id;
 return jsonb_build_object('id',usage_id);
end $$$sql_39_31$;
exception when invalid_function_definition then
  -- A newer signature of start_agent_ai_call(uuid,uuid,uuid,uuid,uuid) is already installed. Its final definition below is mandatory.
  null;
end;

-- agent-control.sql: source statement 32
execute $sql_39_32$create or replace function public.begin_agent_dispatch(p_job uuid,p_claim uuid) returns boolean language plpgsql set search_path=pg_catalog,public as $$
declare j public.agent_message_jobs;c public.customers;
begin
 select * into j from public.agent_message_jobs where id=p_job;
 if not found then return false;end if;
 perform 1 from public.tenants where id=j.tenant_id for update;
 select * into c from public.customers where id=j.customer_id and tenant_id=j.tenant_id for update;
 select * into j from public.agent_message_jobs where id=p_job for update;
 if j.status<>'processing' or j.claim_token is distinct from p_claim or j.claim_until<=clock_timestamp() or j.dispatch_started_at is not null or c.id is null or c.last_message_at is null or c.last_message_at>clock_timestamp()+interval '2 minutes' or c.agent_opted_out or not c.bot_enabled or c.assigned_user_id is not null or c.conversation_status='closed' or c.inbound_seq<>j.inbound_seq or c.outbound_lock_until>clock_timestamp() or c.last_message_at<clock_timestamp()-interval '24 hours' then return false;end if;
 if not exists(select 1 from public.tenants where id=j.tenant_id and is_active and auto_reply_enabled) or not exists(select 1 from public.agent_control_settings where tenant_id=j.tenant_id and flags->'agent_orchestrator_enabled'='true'::jsonb) then return false;end if;
 if j.route='AI' and not public.has_tenant_feature(j.tenant_id,'ai_agent') then return false;end if;
 update public.agent_message_jobs set dispatch_started_at=clock_timestamp() where id=j.id;return true;
end $$$sql_39_32$;

-- agent-control.sql: source statement 33
execute $sql_39_33$create or replace function public.recover_agent_jobs() returns integer language plpgsql set search_path=pg_catalog,public as $$
declare n integer;
begin
 update public.agent_ai_usage u set status='review',reason='WORKER_RESTARTED',completed_at=now() from public.agent_message_jobs j where u.job_id=j.id and u.status='started' and j.status='processing' and j.claim_until<clock_timestamp();
 update public.agent_message_jobs set status='review',reason='WORKER_RESTARTED',claim_token=null,claim_until=null,updated_at=now() where status='processing' and claim_until<clock_timestamp();get diagnostics n=row_count;return n;
end $$$sql_39_33$;

-- agent-control.sql: source statement 34
execute $sql_39_34$create or replace function public.agent_job_audit() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op='INSERT' or new.status is distinct from old.status then insert into public.agent_control_audit(tenant_id,event,subject_id,detail) values(new.tenant_id,'job_'||new.status,new.id,new.reason);end if;return null;
end $$$sql_39_34$;

-- agent-control.sql: source statement 35
execute $sql_39_35$drop trigger if exists agent_job_audit on public.agent_message_jobs$sql_39_35$;

-- agent-control.sql: source statement 36
execute $sql_39_36$create trigger agent_job_audit after insert or update on public.agent_message_jobs for each row execute function public.agent_job_audit()$sql_39_36$;

-- agent-control.sql: source statement 37
begin
execute $sql_39_37$create or replace function public.save_agent_prompt(p_tenant uuid,p_actor uuid,p_instructions text) returns void language plpgsql set search_path=pg_catalog,public as $$
begin
 if not public.has_tenant_feature(p_tenant,'ai_agent') or not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Owner required' using errcode='42501';end if;
 if length(p_instructions)>8000 then raise exception 'Prompt too long' using errcode='22023';end if;
 perform set_config('snapbot.agent_actor',p_actor::text,true);
 insert into public.bot_settings(tenant_id,ai_instructions) values(p_tenant,p_instructions) on conflict(tenant_id) do update set ai_instructions=excluded.ai_instructions;
 insert into public.agent_control_audit(tenant_id,actor_id,event) values(p_tenant,p_actor,'prompt_saved');
end $$$sql_39_37$;
exception when invalid_function_definition then
  -- A newer signature of save_agent_prompt(uuid,uuid,text) is already installed. Its final definition below is mandatory.
  null;
end;

-- agent-control.sql: source statement 38
execute $sql_39_38$create or replace function public.manage_agent_knowledge(p_tenant uuid,p_actor uuid,p_action text,p_id uuid,p_data jsonb) returns uuid language plpgsql set search_path=pg_catalog,public as $$
declare changed uuid;
begin
 if not public.has_tenant_feature(p_tenant,'ai_agent') or not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Owner required' using errcode='42501';end if;
 if not exists(select 1 from public.agent_control_settings where tenant_id=p_tenant and flags->'agent_knowledge_base_enabled'='true'::jsonb) then raise exception 'Feature disabled' using errcode='42501';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 if p_action='delete' then delete from public.agent_knowledge_sources where id=p_id and tenant_id=p_tenant returning id into changed;
 elsif p_action='save' and p_id is not null then update public.agent_knowledge_sources set kind=p_data->>'kind',title=trim(p_data->>'title'),content=trim(p_data->>'content'),is_active=(p_data->>'is_active')::boolean,updated_at=now() where id=p_id and tenant_id=p_tenant returning id into changed;
 elsif p_action='save' then
  if (select count(*) from public.agent_knowledge_sources where tenant_id=p_tenant)>=100 then raise exception 'Knowledge limit 100' using errcode='22023';end if;
  insert into public.agent_knowledge_sources(tenant_id,kind,title,content,is_active) values(p_tenant,p_data->>'kind',trim(p_data->>'title'),trim(p_data->>'content'),(p_data->>'is_active')::boolean) returning id into changed;
 else raise exception 'Invalid action' using errcode='22023';end if;
 if changed is null then raise exception 'Knowledge not found' using errcode='P0002';end if;
 insert into public.agent_control_audit(tenant_id,actor_id,event,subject_id) values(p_tenant,p_actor,'knowledge_'||p_action,changed);return changed;
end $$$sql_39_38$;

-- agent-control.sql: source statement 39
execute $sql_39_39$create or replace function public.restore_agent_prompt(p_tenant uuid,p_actor uuid,p_version integer) returns boolean language plpgsql set search_path=pg_catalog,public as $$
declare content text;
begin
 if not public.has_tenant_feature(p_tenant,'ai_agent') or not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Owner required' using errcode='42501';end if;
 select instructions into content from public.agent_prompt_versions where tenant_id=p_tenant and version=p_version;
 if not found then return false;end if;
 perform public.save_agent_prompt(p_tenant,p_actor,content);
 insert into public.agent_control_audit(tenant_id,actor_id,event,detail) values(p_tenant,p_actor,'prompt_restored',p_version::text);return true;
end $$$sql_39_39$;

-- agent-control.sql: source statement 40
execute $sql_39_40$create or replace function public.agent_control_overview(p_tenant uuid) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('jobs',count(*),'sent',count(*) filter(where status='sent'),'draft',count(*) filter(where status='draft'),'review',count(*) filter(where status='review'),'handoffs',count(*) filter(where route='ADMIN'),'ai',count(*) filter(where route='AI'),'keyword',count(*) filter(where route='KEYWORD')) from public.agent_message_jobs where tenant_id=p_tenant and created_at>now()-interval '30 days'
$$$sql_39_40$;

-- agent-control.sql: source statement 41
execute $sql_39_41$do $$declare fn record;begin
 for fn in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('record_agent_prompt','agent_customer_consent','guard_agent_consent','claim_agent_message','start_agent_ai_call','begin_agent_dispatch','recover_agent_jobs','agent_job_audit','restore_agent_prompt','save_agent_prompt','manage_agent_knowledge','agent_control_overview') loop
  execute format('revoke all on function %s from public,anon,authenticated',fn.signature);execute format('grant execute on function %s to service_role',fn.signature);
 end loop;
end $$$sql_39_41$;

-- agent-control.sql: source statement 42
execute $sql_39_42$notify pgrst,'reload schema'$sql_39_42$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('agent-control.sql','5f9ad2e208aecc260394697ca6d6cb611e964b674338c1c96100139b38940f52','462a262220a863bbc2ceae0a130173530d9de25285a66423eff8aeb67a436cf2');
end $migration_39$;

-- 41. agent-overview.sql
do $migration_40$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='agent-overview.sql';
  if found then
    if installed <> 'f515d46518524752be2352f7483d479dffa7408aa169247d34a7450a28d0d84b' then
      raise exception 'Applied migration changed: agent-overview.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- agent-overview.sql: source statement 2
execute $sql_40_2$create or replace function public.set_agent_overview_capability(p_tenant uuid,p_actor uuid,p_capability text,p_enabled boolean)
returns void language plpgsql set search_path=pg_catalog,public as $$
declare settings public.agent_control_settings; used_count integer; slip_remaining bigint;
begin
 if not exists(select 1 from public.tenants where id=p_tenant and is_active)
 or not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner')
 or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_enabled is null or p_capability is null or p_capability not in ('master','answers','products','slips','handoff','intent','followup') then raise exception 'Invalid input' using errcode='22023';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 select * into settings from public.agent_control_settings where tenant_id=p_tenant for update;
 if not found then raise exception 'Configure AI settings first' using errcode='22023';end if;
 -- Serialize with start_agent_ai_call, which also locks the tenant before reserving quota.
 -- Enabling a switch does not consume quota. Disabling remains available after expiry.
 if p_enabled then
   if not public.has_tenant_feature(p_tenant,'ai_agent')
   or p_capability='slips' and not public.has_tenant_feature(p_tenant,'slip_auto_pilot')
   or p_capability='followup' and not public.has_tenant_feature(p_tenant,'customer_follow_up') then raise exception 'Feature locked' using errcode='P0403';end if;
   select used into used_count from public.agent_ai_monthly_usage where tenant_id=p_tenant and month=date_trunc('month',timezone('UTC',now()))::date for update;
   if settings.ai_monthly_limit<=coalesce(used_count,0) then raise exception 'AI quota exhausted' using errcode='P0402';end if;
   if p_capability='slips' then
     select coalesce(slip_quota,0)::bigint+coalesce(slip_quota_credits,0)::bigint-coalesce(slip_used,0)::bigint into slip_remaining from public.tenants where id=p_tenant;
     if slip_remaining<=0 then raise exception 'Slip quota exhausted' using errcode='P0404';end if;
   end if;
 end if;
 if p_capability='master' then
   update public.tenants set auto_reply_enabled=p_enabled where id=p_tenant;
 elsif p_capability='slips' then
   if p_enabled and (not public.has_tenant_feature(p_tenant,'slip_auto_pilot') or not exists(select 1 from public.bank_accounts where tenant_id=p_tenant and is_active)) then raise exception 'Configure receiving bank accounts and slip access first' using errcode='22023';end if;
   update public.tenants set auto_verify_enabled=p_enabled where id=p_tenant;
 elsif p_capability='followup' then
   if p_enabled and not public.has_tenant_feature(p_tenant,'customer_follow_up') then raise exception 'Forbidden' using errcode='42501';end if;
   update public.follow_up_policies set enabled=p_enabled where tenant_id=p_tenant;
   if not found then raise exception 'Configure follow-up policy first' using errcode='22023';end if;
   if not p_enabled then
     update public.follow_up_jobs set status='cancelled',reason='disabled' where tenant_id=p_tenant and (status in ('pending','requires_review') or status='processing' and dispatch_started_at is null);
   end if;
 else
   if p_enabled and settings.flags->'agent_orchestrator_enabled' is distinct from 'true'::jsonb then raise exception 'Enable managed AI first' using errcode='22023';end if;
   update public.agent_control_settings set flags=jsonb_set(flags,array['capability_'||p_capability],to_jsonb(p_enabled)) where tenant_id=p_tenant;
 end if;
 insert into public.agent_control_audit(tenant_id,actor_id,event,detail) values(p_tenant,p_actor,'capability_changed',p_capability||':'||p_enabled::text);
end $$$sql_40_2$;

-- agent-overview.sql: source statement 3
execute $sql_40_3$revoke all on function public.set_agent_overview_capability(uuid,uuid,text,boolean) from public,anon,authenticated$sql_40_3$;

-- agent-overview.sql: source statement 4
execute $sql_40_4$grant execute on function public.set_agent_overview_capability(uuid,uuid,text,boolean) to service_role$sql_40_4$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('agent-overview.sql','f515d46518524752be2352f7483d479dffa7408aa169247d34a7450a28d0d84b','bbd87d3b0f164c778eb52983b7862d8d8cd61dfd1bf029bc68be6af164bac819');
end $migration_40$;

-- 42. ai-paid-access.sql
do $migration_41$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='ai-paid-access.sql';
  if found then
    if installed <> '003aa8106b68663022bfa627f0deb78b4a51611f421bdfbfc769a81e8a108fdb' then
      raise exception 'Applied migration changed: ai-paid-access.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- ai-paid-access.sql: source statement 2
execute $sql_41_2$create or replace function public.tenant_has_paid_ai_access(p_tenant uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.tenants t where t.id=p_tenant and t.is_active
   and t.plan in ('starter','pro') and t.plan_expires_at>now()
   and exists(select 1 from public.billing_requests r where r.tenant_id=t.id
     and r.item=t.plan and r.status='approved' and r.price_baht>0));
$$$sql_41_2$;

-- ai-paid-access.sql: source statement 3
execute $sql_41_3$revoke all on function public.tenant_has_paid_ai_access(uuid) from public,anon,authenticated$sql_41_3$;

-- ai-paid-access.sql: source statement 4
execute $sql_41_4$grant execute on function public.tenant_has_paid_ai_access(uuid) to service_role$sql_41_4$;

-- ai-paid-access.sql: source statement 5
execute $sql_41_5$insert into public.plan_features(plan,feature,enabled) values('starter','ai_agent',true),('pro','ai_agent',true)
on conflict(plan,feature) do update set enabled=true$sql_41_5$;

-- ai-paid-access.sql: source statement 6
execute $sql_41_6$create or replace function public.has_tenant_feature(p_tenant uuid,p_feature text) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.tenants t join public.plan_features f on f.plan=t.plan
   where t.id=p_tenant and t.is_active and t.plan in ('starter','pro') and t.plan_expires_at>now()
   and f.feature=p_feature and f.enabled
   and (p_feature not in ('ai_agent','image_assistant') or public.tenant_has_paid_ai_access(t.id)));
$$$sql_41_6$;

-- ai-paid-access.sql: source statement 7
execute $sql_41_7$create or replace function public.normalize_paid_ai_settings() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if public.has_tenant_feature(new.tenant_id,'ai_agent') then
   new.flags := '{"agent_control_center_enabled":true,"agent_knowledge_base_enabled":true,"agent_playground_enabled":true,"agent_analytics_enabled":true,"agent_advanced_guardrails_enabled":true}'::jsonb
     ||coalesce(new.flags,'{}'::jsonb)||jsonb_build_object('agent_control_center_enabled',true,'agent_orchestrator_enabled',new.ai_monthly_limit>0);
 end if;
 return new;
end $$$sql_41_7$;

-- ai-paid-access.sql: source statement 8
execute $sql_41_8$drop trigger if exists paid_ai_settings_ready on public.agent_control_settings$sql_41_8$;

-- ai-paid-access.sql: source statement 9
execute $sql_41_9$create trigger paid_ai_settings_ready before insert or update of ai_monthly_limit on public.agent_control_settings
for each row execute function public.normalize_paid_ai_settings()$sql_41_9$;

-- ai-paid-access.sql: source statement 10
execute $sql_41_10$create or replace function public.prepare_paid_ai_purchase() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.status='approved' and new.item in ('starter','pro') and public.has_tenant_feature(new.tenant_id,'ai_agent') then
   insert into public.agent_control_settings(tenant_id) values(new.tenant_id)
   on conflict(tenant_id) do update set ai_monthly_limit=public.agent_control_settings.ai_monthly_limit;
 end if;
 return new;
end $$$sql_41_10$;

-- ai-paid-access.sql: source statement 11
execute $sql_41_11$drop trigger if exists paid_ai_purchase_ready on public.billing_requests$sql_41_11$;

-- ai-paid-access.sql: source statement 12
execute $sql_41_12$create trigger paid_ai_purchase_ready after insert or update of status on public.billing_requests
for each row execute function public.prepare_paid_ai_purchase()$sql_41_12$;

-- ai-paid-access.sql: source statement 14
execute $sql_41_14$create or replace function public.start_agent_ai_call(p_tenant uuid,p_key uuid,p_customer uuid default null,p_job uuid default null,p_claim uuid default null)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare s public.agent_control_settings;j public.agent_message_jobs;used_count integer;usage_id uuid;month_start date:=date_trunc('month',now() at time zone 'UTC')::date;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if not public.tenant_has_paid_ai_access(p_tenant) or not public.has_tenant_feature(p_tenant,'ai_agent') then return jsonb_build_object('reason','FEATURE_LOCKED');end if;
 select * into s from public.agent_control_settings where tenant_id=p_tenant;
 if not found or s.ai_monthly_limit<=0 then return jsonb_build_object('reason','AI_QUOTA_EXHAUSTED');end if;
 if p_key is null then return jsonb_build_object('reason','INVALID_REQUEST');end if;
 if p_customer is not null and not exists(select 1 from public.customers where id=p_customer and tenant_id=p_tenant and not agent_opted_out) then return jsonb_build_object('reason','CUSTOMER_UNAVAILABLE');end if;
 if p_job is not null then
   perform 1 from public.customers where id=p_customer for update;
   select * into j from public.agent_message_jobs where id=p_job and tenant_id=p_tenant and customer_id=p_customer for update;
   if not found or j.status<>'processing' or j.claim_token is distinct from p_claim or j.claim_until<=clock_timestamp()
   or not exists(select 1 from public.customers where id=p_customer and tenant_id=p_tenant and bot_enabled and assigned_user_id is null and conversation_status<>'closed' and inbound_seq=j.inbound_seq and not agent_opted_out) then return jsonb_build_object('reason','CONVERSATION_CHANGED');end if;
 end if;
 if exists(select 1 from public.agent_ai_usage where invocation_key=p_key or (p_job is not null and job_id=p_job)) then return jsonb_build_object('reason','DUPLICATE_AI_INVOCATION');end if;
 if (select count(*) from public.agent_ai_usage where tenant_id=p_tenant and created_at>clock_timestamp()-interval '1 minute')>=s.requests_per_minute then return jsonb_build_object('reason','AI_RATE_LIMIT');end if;
 insert into public.agent_ai_monthly_usage(tenant_id,month) values(p_tenant,month_start) on conflict do nothing;
 update public.agent_ai_monthly_usage set used=used+1 where tenant_id=p_tenant and month=month_start and used<s.ai_monthly_limit returning used into used_count;
 if not found then return jsonb_build_object('reason','AI_QUOTA_EXHAUSTED');end if;
 insert into public.agent_ai_usage(tenant_id,customer_id,job_id,invocation_key) values(p_tenant,p_customer,p_job,p_key) returning id into usage_id;
 return jsonb_build_object('id',usage_id);
end $$$sql_41_14$;

-- ai-paid-access.sql: source statement 15
execute $sql_41_15$revoke all on function public.start_agent_ai_call(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated$sql_41_15$;

-- ai-paid-access.sql: source statement 16
execute $sql_41_16$grant execute on function public.start_agent_ai_call(uuid,uuid,uuid,uuid,uuid) to service_role$sql_41_16$;

-- ai-paid-access.sql: source statement 17
execute $sql_41_17$revoke all on function public.normalize_paid_ai_settings(),public.prepare_paid_ai_purchase() from public,anon,authenticated,service_role$sql_41_17$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('ai-paid-access.sql','003aa8106b68663022bfa627f0deb78b4a51611f421bdfbfc769a81e8a108fdb','42f6eb4cf373dca787fecb745fb5089f19c610c519768fc6c63e2994dc88ade2');
end $migration_41$;

-- 43. ai-vision.sql
do $migration_42$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='ai-vision.sql';
  if found then
    if installed <> '00a2ef0b3cae53cfad157ad52b609b0dee9eaea580de2bb4056b277ecdae4605' then
      raise exception 'Applied migration changed: ai-vision.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- ai-vision.sql: source statement 2
execute $sql_42_2$alter table public.image_response_rules add column if not exists priority integer not null default 0 check(priority between 0 and 1000)$sql_42_2$;

-- ai-vision.sql: source statement 3
execute $sql_42_3$create table if not exists public.vision_plan_limits(
 plan text primary key check(plan in ('free','starter','pro')),monthly_images integer not null check(monthly_images>=0),product_search boolean not null default false
)$sql_42_3$;

-- ai-vision.sql: source statement 4
execute $sql_42_4$insert into public.vision_plan_limits values('free',0,false),('starter',100,false),('pro',1000,true) on conflict do nothing$sql_42_4$;

-- ai-vision.sql: source statement 5
execute $sql_42_5$alter table public.vision_plan_limits enable row level security$sql_42_5$;

-- ai-vision.sql: source statement 6
execute $sql_42_6$revoke all on public.vision_plan_limits from public,anon,authenticated$sql_42_6$;

-- ai-vision.sql: source statement 7
execute $sql_42_7$grant all on public.vision_plan_limits to service_role$sql_42_7$;

-- ai-vision.sql: source statement 8
execute $sql_42_8$create table if not exists public.vision_settings(
 tenant_id uuid primary key references public.tenants(id) on delete cascade,enabled boolean not null default false,
 mode text not null default 'rules' check(mode in ('rules','catalog')),confidence_threshold numeric not null default 0.8 check(confidence_threshold between 0.8 and 1),handoff_enabled boolean not null default true
)$sql_42_8$;

-- ai-vision.sql: source statement 9
execute $sql_42_9$create table if not exists public.vision_usage(
 tenant_id uuid not null references public.tenants(id) on delete cascade,month date not null,used integer not null default 0 check(used>=0),primary key(tenant_id,month)
)$sql_42_9$;

-- ai-vision.sql: source statement 10
execute $sql_42_10$create table if not exists public.vision_jobs(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),customer_id uuid references public.customers(id),message_id uuid references public.messages(id),
 source text not null check(source in ('test','messenger')),idempotency_key text not null check(length(idempotency_key) between 1 and 200),
 image_path text not null,mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp')),
 status text not null default 'pending' check(status in ('pending','processing','completed','failed','requires_review','cancelled')),
 claim_token uuid,claim_until timestamptz,analysis_started_at timestamptz,dispatch_started_at timestamptz,
 ai_request_started_at timestamptz,usage_month date,quota_reserved boolean not null default false,attempts integer not null default 0,
 result jsonb,decision jsonb,reason text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(tenant_id,source,idempotency_key),check((source='test' and customer_id is null and message_id is null) or (source='messenger' and customer_id is not null and message_id is not null))
)$sql_42_10$;

-- ai-vision.sql: source statement 11
execute $sql_42_11$create index if not exists vision_jobs_pending on public.vision_jobs(created_at) where status='pending'$sql_42_11$;

-- ai-vision.sql: source statement 12
execute $sql_42_12$create table if not exists public.vision_audit_logs(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),job_id uuid references public.vision_jobs(id),actor_id uuid references auth.users(id),event text not null,detail text,created_at timestamptz not null default now()
)$sql_42_12$;

-- ai-vision.sql: source statement 13
execute $sql_42_13$do $$declare tab text;begin
 foreach tab in array array['vision_settings','vision_usage','vision_jobs','vision_audit_logs'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated',tab);
  execute format('grant select on public.%I to authenticated',tab);
  execute format('grant all on public.%I to service_role',tab);
  execute format('drop policy if exists tenant_read on public.%I',tab);
  execute format('create policy tenant_read on public.%I for select to authenticated using(public.can_access_tenant(tenant_id) and public.has_tenant_feature(tenant_id,''image_assistant''))',tab);
 end loop;
end $$$sql_42_13$;

-- ai-vision.sql: source statement 14
execute $sql_42_14$insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('vision-images','vision-images',false,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing$sql_42_14$;

-- ai-vision.sql: source statement 15
execute $sql_42_15$update storage.buckets set public=false,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'] where id='vision-images'$sql_42_15$;

-- ai-vision.sql: source statement 16
execute $sql_42_16$create or replace function public.vision_job_audit() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op='INSERT' or new.status is distinct from old.status then
  insert into public.vision_audit_logs(tenant_id,job_id,event,detail) values(new.tenant_id,new.id,new.status,new.reason);
 end if;return new;
end $$$sql_42_16$;

-- ai-vision.sql: source statement 17
execute $sql_42_17$create or replace function public.retry_unstarted_vision(p_job uuid,p_tenant uuid,p_actor uuid) returns boolean
language plpgsql set search_path=pg_catalog,public as $$
declare changed uuid;
begin
 if not public.has_tenant_feature(p_tenant,'image_assistant') or not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Forbidden' using errcode='42501';end if;
 -- Only a request which has NEVER reached the provider is safe to automatically retry.
 update public.vision_jobs set status='pending',reason=null where id=p_job and tenant_id=p_tenant and status in ('requires_review','cancelled') and ai_request_started_at is null and dispatch_started_at is null and not quota_reserved and attempts<3 returning id into changed;
 if changed is not null then insert into public.vision_audit_logs(tenant_id,job_id,actor_id,event) values(p_tenant,p_job,p_actor,'safe_retry');end if;
 return changed is not null;
end $$$sql_42_17$;

-- ai-vision.sql: source statement 18
execute $sql_42_18$revoke all on function public.retry_unstarted_vision(uuid,uuid,uuid) from public,anon,authenticated$sql_42_18$;

-- ai-vision.sql: source statement 19
execute $sql_42_19$grant execute on function public.retry_unstarted_vision(uuid,uuid,uuid) to service_role$sql_42_19$;

-- ai-vision.sql: source statement 20
execute $sql_42_20$drop trigger if exists vision_job_audit on public.vision_jobs$sql_42_20$;

-- ai-vision.sql: source statement 21
execute $sql_42_21$create trigger vision_job_audit after insert or update on public.vision_jobs for each row execute function public.vision_job_audit()$sql_42_21$;

-- ai-vision.sql: source statement 22
execute $sql_42_22$create or replace function public.claim_vision_job(p_job uuid default null) returns setof public.vision_jobs
language plpgsql set search_path=pg_catalog,public as $$
declare j public.vision_jobs;stale public.vision_jobs;limit_images integer;used_images integer;month_start date:=date_trunc('month',now() at time zone 'UTC')::date;
begin
 -- A crashed provider/send call is uncertain: never automatically repeat it or charge twice.
 for stale in select * from public.vision_jobs where status='processing' and claim_until<clock_timestamp() and (p_job is null or id=p_job) for update skip locked loop
  if stale.ai_request_started_at is null and stale.quota_reserved then
   update public.vision_usage set used=greatest(0,used-1) where tenant_id=stale.tenant_id and month=stale.usage_month;
  end if;
  update public.vision_jobs set status=case when stale.ai_request_started_at is null and stale.attempts<3 then 'pending' else 'requires_review' end,reason='WORKER_INTERRUPTED',quota_reserved=case when stale.ai_request_started_at is null then false else quota_reserved end,claim_token=null,claim_until=null where id=stale.id;
 end loop;
 select * into j from public.vision_jobs where status='pending' and (p_job is null or id=p_job) order by created_at,id limit 1 for update skip locked;
 if not found then return;end if;
 if not public.has_tenant_feature(j.tenant_id,'image_assistant') then
  update public.vision_jobs set status='cancelled',reason='FEATURE_LOCKED' where id=j.id;return;
 end if;
 if j.source='messenger' and (not exists(select 1 from public.vision_settings where tenant_id=j.tenant_id and enabled) or not exists(select 1 from public.customers c join public.tenants t on t.id=c.tenant_id where c.id=j.customer_id and c.tenant_id=j.tenant_id and c.bot_enabled and c.assigned_user_id is null and c.conversation_status<>'closed' and t.auto_reply_enabled) or not exists(select 1 from public.messages where id=j.message_id and customer_id=j.customer_id and sender='customer')) then
  update public.vision_jobs set status='cancelled',reason='ADMIN_HANDLING_OR_DISABLED' where id=j.id;return;
 end if;
 select l.monthly_images into limit_images from public.tenants t join public.vision_plan_limits l on l.plan=t.plan where t.id=j.tenant_id;
 insert into public.vision_usage(tenant_id,month) values(j.tenant_id,month_start) on conflict do nothing;
 update public.vision_usage set used=used+1 where tenant_id=j.tenant_id and month=month_start and used<coalesce(limit_images,0) returning used into used_images;
 if not found then update public.vision_jobs set status='requires_review',reason='VISION_QUOTA_EXHAUSTED' where id=j.id;return;end if;
 return query update public.vision_jobs set status='processing',claim_token=gen_random_uuid(),claim_until=clock_timestamp()+interval '3 minutes',analysis_started_at=clock_timestamp(),usage_month=month_start,quota_reserved=true,attempts=attempts+1 where id=j.id returning *;
end $$$sql_42_22$;

-- ai-vision.sql: source statement 23
execute $sql_42_23$create or replace function public.start_vision_analysis(p_job uuid,p_claim uuid) returns boolean
language plpgsql set search_path=pg_catalog,public as $$
declare j public.vision_jobs;
begin
 select * into j from public.vision_jobs where id=p_job for update;
 if not found or j.status<>'processing' or j.claim_token is distinct from p_claim or j.claim_until<=clock_timestamp() or j.ai_request_started_at is not null or not j.quota_reserved then return false;end if;
 if not public.has_tenant_feature(j.tenant_id,'image_assistant') then return false;end if;
 if j.source='messenger' and (not exists(select 1 from public.vision_settings where tenant_id=j.tenant_id and enabled) or not exists(select 1 from public.customers c join public.tenants t on t.id=c.tenant_id where c.id=j.customer_id and c.tenant_id=j.tenant_id and c.bot_enabled and c.assigned_user_id is null and c.conversation_status<>'closed' and t.auto_reply_enabled)) then return false;end if;
 update public.vision_jobs set ai_request_started_at=clock_timestamp() where id=j.id;return true;
end $$$sql_42_23$;

-- ai-vision.sql: source statement 24
execute $sql_42_24$create or replace function public.refund_unstarted_vision(p_job uuid,p_claim uuid) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare j public.vision_jobs;
begin
 select * into j from public.vision_jobs where id=p_job for update;
 if found and j.status='processing' and j.claim_token=p_claim and j.ai_request_started_at is null and j.quota_reserved then
  update public.vision_usage set used=greatest(0,used-1) where tenant_id=j.tenant_id and month=j.usage_month;
  update public.vision_jobs set quota_reserved=false where id=j.id;
 end if;
end $$$sql_42_24$;

-- ai-vision.sql: source statement 25
execute $sql_42_25$revoke all on function public.start_vision_analysis(uuid,uuid),public.refund_unstarted_vision(uuid,uuid) from public,anon,authenticated$sql_42_25$;

-- ai-vision.sql: source statement 26
execute $sql_42_26$grant execute on function public.start_vision_analysis(uuid,uuid),public.refund_unstarted_vision(uuid,uuid) to service_role$sql_42_26$;

-- ai-vision.sql: source statement 27
execute $sql_42_27$create or replace function public.begin_vision_dispatch(p_job uuid,p_claim uuid) returns boolean
language plpgsql set search_path=pg_catalog,public as $$
declare j public.vision_jobs;c public.customers;
begin
 select * into j from public.vision_jobs where id=p_job;
 if not found or j.customer_id is null then return false;end if;
 -- Match the Inbox lease lock order; a human claiming the conversation wins before a send starts.
 select * into c from public.customers where id=j.customer_id and tenant_id=j.tenant_id for update;
 select * into j from public.vision_jobs where id=p_job for update;
 if j.source<>'messenger' or j.status<>'processing' or j.claim_token is distinct from p_claim or j.claim_until<=clock_timestamp() or j.dispatch_started_at is not null
  or not public.has_tenant_feature(j.tenant_id,'image_assistant')
  or not exists(select 1 from public.vision_settings where tenant_id=j.tenant_id and enabled)
  or not exists(select 1 from public.tenants where id=j.tenant_id and auto_reply_enabled)
  or c.id is null or not c.bot_enabled or c.assigned_user_id is not null or c.conversation_status='closed'
  or c.last_message_at is null or c.last_message_at<clock_timestamp()-interval '24 hours'
  or c.outbound_lock_until>clock_timestamp() then return false;end if;
 if j.decision->>'action'='PRODUCT_SEARCH' and (not public.has_tenant_feature(j.tenant_id,'ai_agent') or not exists(select 1 from public.tenants t join public.vision_plan_limits l on l.plan=t.plan join public.vision_settings s on s.tenant_id=t.id where t.id=j.tenant_id and l.product_search and s.mode='catalog')) then return false;end if;
 if j.decision->>'action'='VERIFY_SLIP' and (not public.has_tenant_feature(j.tenant_id,'slip_auto_pilot') or not exists(select 1 from public.tenants where id=j.tenant_id and auto_verify_enabled and slip_used::bigint<slip_quota::bigint+slip_quota_credits::bigint)) then return false;end if;
 update public.vision_jobs set dispatch_started_at=clock_timestamp() where id=j.id;
 return true;
end $$$sql_42_27$;

-- ai-vision.sql: source statement 28
begin
execute $sql_42_28$create or replace function public.save_vision_settings(p_tenant uuid,p_actor uuid,p_enabled boolean,p_mode text,p_confidence numeric,p_handoff boolean) returns void
language plpgsql set search_path=pg_catalog,public as $$
begin
 if not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or exists(select 1 from public.platform_admins where user_id=p_actor)) or not public.has_tenant_feature(p_tenant,'image_assistant') then raise exception 'FEATURE_LOCKED' using errcode='42501';end if;
 if p_mode='catalog' and (not public.has_tenant_feature(p_tenant,'ai_agent') or not exists(select 1 from public.tenants t join public.vision_plan_limits l on l.plan=t.plan where t.id=p_tenant and l.product_search)) then raise exception 'FEATURE_LOCKED: product_search' using errcode='42501';end if;
 insert into public.vision_settings(tenant_id,enabled,mode,confidence_threshold,handoff_enabled) values(p_tenant,p_enabled,p_mode,p_confidence,p_handoff)
 on conflict(tenant_id) do update set enabled=excluded.enabled,mode=excluded.mode,confidence_threshold=excluded.confidence_threshold,handoff_enabled=excluded.handoff_enabled;
 insert into public.vision_audit_logs(tenant_id,actor_id,event,detail) values(p_tenant,p_actor,'settings_updated',case when p_enabled then 'enabled' else 'disabled' end);
end $$$sql_42_28$;
exception when invalid_function_definition then
  -- A newer signature of save_vision_settings(uuid,uuid,boolean,text,numeric,boolean) is already installed. Its final definition below is mandatory.
  null;
end;

-- ai-vision.sql: source statement 29
execute $sql_42_29$create or replace function public.audit_image_rule_change() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 insert into public.vision_audit_logs(tenant_id,actor_id,event,detail) values(case when tg_op='DELETE' then old.tenant_id else new.tenant_id end,auth.uid(),'rule_'||lower(tg_op),case when tg_op='DELETE' then old.id::text else new.id::text end);
 return null;
end $$$sql_42_29$;

-- ai-vision.sql: source statement 30
execute $sql_42_30$drop trigger if exists image_rule_vision_audit on public.image_response_rules$sql_42_30$;

-- ai-vision.sql: source statement 31
execute $sql_42_31$create trigger image_rule_vision_audit after insert or update or delete on public.image_response_rules for each row execute function public.audit_image_rule_change()$sql_42_31$;

-- ai-vision.sql: source statement 32
execute $sql_42_32$revoke all on function public.begin_vision_dispatch(uuid,uuid),public.save_vision_settings(uuid,uuid,boolean,text,numeric,boolean),public.audit_image_rule_change() from public,anon,authenticated$sql_42_32$;

-- ai-vision.sql: source statement 33
execute $sql_42_33$grant execute on function public.begin_vision_dispatch(uuid,uuid),public.save_vision_settings(uuid,uuid,boolean,text,numeric,boolean) to service_role$sql_42_33$;

-- ai-vision.sql: source statement 34
execute $sql_42_34$revoke all on function public.claim_vision_job(uuid),public.vision_job_audit() from public,anon,authenticated$sql_42_34$;

-- ai-vision.sql: source statement 35
execute $sql_42_35$grant execute on function public.claim_vision_job(uuid) to service_role$sql_42_35$;

-- ai-vision.sql: source statement 36
execute $sql_42_36$notify pgrst,'reload schema'$sql_42_36$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('ai-vision.sql','00a2ef0b3cae53cfad157ad52b609b0dee9eaea580de2bb4056b277ecdae4605','ea63d4c520548a1f13923b62491f7eff31ac55ebef4e1f51e63ae64ee7309301');
end $migration_42$;

-- 44. commerce-v2.sql
do $migration_43$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='commerce-v2.sql';
  if found then
    if installed <> '3834c46549e41bfa3edae84fe5f328d1c91eb270c9b5cc94500d977f96bba4a4' then
      raise exception 'Applied migration changed: commerce-v2.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- commerce-v2.sql: source statement 2
execute $sql_43_2$create table if not exists commerce_limits (
 plan text primary key, max_products integer check(max_products>=0), max_pages integer not null default 1 check(max_pages>=0),
 checkout boolean not null default false, reports boolean not null default false, advanced_templates boolean not null default false
)$sql_43_2$;

-- commerce-v2.sql: source statement 3
execute $sql_43_3$insert into commerce_limits values('free',null,1,false,false,false),('starter',null,3,true,true,false),('pro',null,10,true,true,true) on conflict do nothing$sql_43_3$;

-- commerce-v2.sql: source statement 4
execute $sql_43_4$create table if not exists commerce_stores (
 tenant_id uuid primary key references tenants(id), slug text not null unique check(slug~'^[a-z0-9]+(-[a-z0-9]+)*$'),
 name text not null, description text not null default '', logo text not null default '', banner text not null default '', contact text not null default '',
 is_open boolean not null default false, updated_at timestamptz not null default now()
)$sql_43_4$;

-- commerce-v2.sql: source statement 5
execute $sql_43_5$create table if not exists commerce_categories (id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),name text not null check(length(trim(name)) between 1 and 80),unique(tenant_id,name))$sql_43_5$;

-- commerce-v2.sql: source statement 6
execute $sql_43_6$alter table products add column if not exists commerce_category_id uuid references commerce_categories(id)$sql_43_6$;

-- commerce-v2.sql: source statement 7
execute $sql_43_7$alter table products add column if not exists commerce_images jsonb not null default '[]'$sql_43_7$;

-- commerce-v2.sql: source statement 8
execute $sql_43_8$alter table products add column if not exists commerce_compare_price numeric(12,2)$sql_43_8$;

-- commerce-v2.sql: source statement 9
execute $sql_43_9$alter table products add column if not exists commerce_cost numeric(12,2)$sql_43_9$;

-- commerce-v2.sql: source statement 10
execute $sql_43_10$alter table products add column if not exists commerce_featured boolean not null default false$sql_43_10$;

-- commerce-v2.sql: source statement 11
execute $sql_43_11$alter table products add column if not exists commerce_archived boolean not null default false$sql_43_11$;

-- commerce-v2.sql: source statement 12
execute $sql_43_12$drop index if exists public.products_tenant_code$sql_43_12$;

-- commerce-v2.sql: source statement 13
execute $sql_43_13$create unique index if not exists products_tenant_code on public.products(tenant_id,lower(code)) where not commerce_archived$sql_43_13$;

-- commerce-v2.sql: source statement 14
execute $sql_43_14$alter table products add column if not exists commerce_version integer not null default 0$sql_43_14$;

-- commerce-v2.sql: source statement 15
execute $sql_43_15$create table if not exists commerce_variants (id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),product_id uuid not null references products(id),label text not null,price numeric(12,2) not null check(price>0),stock integer not null check(stock>=0),is_active boolean not null default true)$sql_43_15$;

-- commerce-v2.sql: source statement 16
execute $sql_43_16$create index if not exists commerce_variant_product on commerce_variants(tenant_id,product_id)$sql_43_16$;

-- commerce-v2.sql: source statement 17
execute $sql_43_17$create table if not exists commerce_pages (id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),slug text not null,name text not null,draft jsonb not null,published jsonb,published_at timestamptz,version integer not null default 0,unique(tenant_id,slug))$sql_43_17$;

-- commerce-v2.sql: source statement 18
execute $sql_43_18$create table if not exists commerce_customers (id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),name text not null,phone text not null,address text not null,crm_customer_id uuid references customers(id),created_at timestamptz not null default now(),unique(tenant_id,phone))$sql_43_18$;

-- commerce-v2.sql: source statement 19
execute $sql_43_19$create table if not exists commerce_orders (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),customer_id uuid not null references commerce_customers(id),
 request_key uuid not null,payload jsonb not null,number text not null unique default ('SB-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,16))),
 status text not null default 'pending_payment' check(status in ('pending_payment','payment_review','paid','preparing','shipped','completed','cancelled')),
 total numeric(12,2) not null default 0,shipping jsonb not null,tracking text,created_at timestamptz not null default now(),paid_at timestamptz,unique(tenant_id,request_key)
)$sql_43_19$;

-- commerce-v2.sql: source statement 20
execute $sql_43_20$create table if not exists commerce_order_items (id uuid primary key default gen_random_uuid(),order_id uuid not null references commerce_orders(id),tenant_id uuid not null references tenants(id),product_id uuid not null references products(id),variant_id uuid references commerce_variants(id),name text not null,variant_label text,qty integer not null check(qty between 1 and 99),price numeric(12,2) not null check(price>0))$sql_43_20$;

-- commerce-v2.sql: source statement 21
execute $sql_43_21$create table if not exists commerce_audit (id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),actor_id uuid,entity_id uuid,action text not null,detail text not null default '',created_at timestamptz not null default now())$sql_43_21$;

-- commerce-v2.sql: source statement 22
execute $sql_43_22$create table if not exists commerce_rate (bucket text not null,period bigint not null,hits integer not null default 1,primary key(bucket,period))$sql_43_22$;

-- commerce-v2.sql: source statement 23
execute $sql_43_23$create index if not exists commerce_orders_recent on commerce_orders(tenant_id,created_at desc)$sql_43_23$;

-- commerce-v2.sql: source statement 24
execute $sql_43_24$create index if not exists commerce_orders_customer on commerce_orders(tenant_id,customer_id)$sql_43_24$;

-- commerce-v2.sql: source statement 25
execute $sql_43_25$create index if not exists commerce_items_order on commerce_order_items(order_id,product_id,variant_id)$sql_43_25$;

-- commerce-v2.sql: source statement 26
execute $sql_43_26$create index if not exists commerce_audit_recent on commerce_audit(tenant_id,created_at desc)$sql_43_26$;

-- commerce-v2.sql: source statement 27
execute $sql_43_27$create index if not exists commerce_rate_expiry on commerce_rate(period)$sql_43_27$;

-- commerce-v2.sql: source statement 28
execute $sql_43_28$create index if not exists commerce_products_category on products(tenant_id,commerce_category_id) where not commerce_archived$sql_43_28$;

-- commerce-v2.sql: source statement 29
execute $sql_43_29$do $$declare t text;begin foreach t in array array['commerce_limits','commerce_stores','commerce_categories','commerce_variants','commerce_pages','commerce_customers','commerce_orders','commerce_order_items','commerce_audit','commerce_rate'] loop
 execute format('alter table %I enable row level security',t);execute format('revoke all on %I from public,anon,authenticated',t);execute format('grant all on %I to service_role',t);end loop;end$$$sql_43_29$;

-- commerce-v2.sql: source statement 30
execute $sql_43_30$create or replace function commerce_access(p_tenant uuid,p_actor uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$begin
 if not exists(select 1 from tenants where id=p_tenant and is_active) or not (exists(select 1 from tenant_members where tenant_id=p_tenant and user_id=p_actor and role in ('owner','admin')) or exists(select 1 from platform_admins where user_id=p_actor)) then raise exception 'COMMERCE_FORBIDDEN' using errcode='42501';end if;
end$$$sql_43_30$;

-- commerce-v2.sql: source statement 31
execute $sql_43_31$create or replace function commerce_plan(p_tenant uuid) returns commerce_limits language sql stable security definer set search_path=pg_catalog,public as $$
 select l.* from tenants t join commerce_limits l on l.plan=case when t.plan in ('starter','pro') and t.plan_expires_at>now() then t.plan else 'free' end where t.id=p_tenant and t.is_active
$$$sql_43_31$;

-- commerce-v2.sql: source statement 32
execute $sql_43_32$create or replace function commerce_rate_limit(p_bucket text,p_max integer) returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$declare n integer;window_period bigint:=floor(extract(epoch from clock_timestamp())/60);begin
 delete from commerce_rate where commerce_rate.period<window_period-10;
 insert into commerce_rate(bucket,period) values(p_bucket,window_period) on conflict(bucket,period) do update set hits=commerce_rate.hits+1 returning hits into n;return n<=p_max;
end$$$sql_43_32$;

-- commerce-v2.sql: source statement 33
execute $sql_43_33$create or replace function commerce_product_version() returns trigger language plpgsql set search_path=pg_catalog,public as $$begin new.commerce_version:=old.commerce_version+1;return new;end$$$sql_43_33$;

-- commerce-v2.sql: source statement 34
execute $sql_43_34$drop trigger if exists commerce_product_version on products$sql_43_34$;

-- commerce-v2.sql: source statement 35
execute $sql_43_35$create trigger commerce_product_version before update on products for each row execute function commerce_product_version()$sql_43_35$;

-- commerce-v2.sql: source statement 36
execute $sql_43_36$create or replace function commerce_product_quota() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$declare l commerce_limits;begin
 perform 1 from tenants where id=new.tenant_id for update;l:=commerce_plan(new.tenant_id);
 if l.max_products is not null and (select count(*) from products where tenant_id=new.tenant_id and not commerce_archived)>=l.max_products then raise exception 'COMMERCE_LIMIT' using errcode='42501';end if;return new;
end$$$sql_43_36$;

-- commerce-v2.sql: source statement 37
execute $sql_43_37$drop trigger if exists commerce_product_quota on products$sql_43_37$;

-- commerce-v2.sql: source statement 38
execute $sql_43_38$create trigger commerce_product_quota before insert on products for each row execute function commerce_product_quota()$sql_43_38$;

-- commerce-v2.sql: source statement 39
begin
execute $sql_43_39$create or replace function commerce_save_product(p_tenant uuid,p_actor uuid,p_id uuid,p_value jsonb,p_version integer default null) returns uuid
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
end$$$sql_43_39$;
exception when invalid_function_definition then
  -- A newer signature of commerce_save_product(uuid,uuid,uuid,jsonb,integer) is already installed. Its final definition below is mandatory.
  null;
end;

-- commerce-v2.sql: source statement 40
execute $sql_43_40$create or replace function commerce_checkout(p_slug text,p_value jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
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
end$$$sql_43_40$;

-- commerce-v2.sql: source statement 41
execute $sql_43_41$create or replace function commerce_move_order(p_tenant uuid,p_actor uuid,p_id uuid,p_status text,p_note text) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
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
end$$$sql_43_41$;

-- commerce-v2.sql: source statement 42
execute $sql_43_42$create or replace function commerce_manage(p_tenant uuid,p_actor uuid,p_action text,p_value jsonb) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
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
end$$$sql_43_42$;

-- commerce-v2.sql: source statement 43
begin
execute $sql_43_43$create or replace function place_cf_order(p_tenant uuid,p_customer uuid,p_message uuid,p_code text)
returns table(r_status text,r_order_id uuid,r_name text,r_code text,r_amount numeric)
language plpgsql set search_path=pg_catalog,public as $$declare p products;new_id uuid;begin
 select * into p from products where tenant_id=p_tenant and lower(code)=lower(trim(p_code)) and is_active for update;
 if not found or exists(select 1 from commerce_variants where product_id=p.id and is_active) then
  return query select 'no_match'::text,null::uuid,null::text,null::text,null::numeric;return;end if;
 update products set stock=stock-1 where id=p.id and stock>0;
 if not found then return query select 'sold_out'::text,null::uuid,p.name,p.code,p.price;return;end if;
 insert into orders(tenant_id,customer_id,product_id,product_name,amount,message_id) values(p_tenant,p_customer,p.id,p.name,p.price,p_message) returning id into new_id;
 return query select 'created'::text,new_id,p.name,p.code,p.price;
end$$$sql_43_43$;
exception when invalid_function_definition then
  -- A newer signature of place_cf_order(uuid,uuid,uuid,text) is already installed. Its final definition below is mandatory.
  null;
end;

-- commerce-v2.sql: source statement 44
execute $sql_43_44$revoke execute on function place_cf_order(uuid,uuid,uuid,text) from public,anon,authenticated$sql_43_44$;

-- commerce-v2.sql: source statement 45
execute $sql_43_45$grant execute on function place_cf_order(uuid,uuid,uuid,text) to service_role$sql_43_45$;

-- commerce-v2.sql: source statement 46
execute $sql_43_46$do $$declare r record;begin for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('commerce_access','commerce_plan','commerce_rate_limit','commerce_save_product','commerce_checkout','commerce_move_order','commerce_manage') loop
 execute format('revoke all on function %s from public,anon,authenticated',r.signature);execute format('grant execute on function %s to service_role',r.signature);end loop;end$$$sql_43_46$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('commerce-v2.sql','3834c46549e41bfa3edae84fe5f328d1c91eb270c9b5cc94500d977f96bba4a4','43b4aa77038376bec249d3dfd1c9c53c08fa2094ba24fe40b35afcbcfc94f9f7');
end $migration_43$;

-- 45. product-sku-reuse.sql
do $migration_44$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='product-sku-reuse.sql';
  if found then
    if installed <> '2be83464cda5214221af1e9703ec864a9b26d7e18c1e5b21a164b317d325badf' then
      raise exception 'Applied migration changed: product-sku-reuse.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;

  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('product-sku-reuse.sql','2be83464cda5214221af1e9703ec864a9b26d7e18c1e5b21a164b317d325badf','158567cbd1962b8e6c75c72a9f5aaa52aceb26c84b9fc2c7bb4a7f24c41c41f4');
end $migration_44$;

-- 46. payment-pro.sql
do $migration_45$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='payment-pro.sql';
  if found then
    if installed <> 'cd3319ec00052fc92e98f746533af4a8b45f48d4a8b584bab531a18061736297' then
      raise exception 'Applied migration changed: payment-pro.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- payment-pro.sql: source statement 2
execute $sql_45_2$create table if not exists public.payment_pro_settings(
 tenant_id uuid primary key references public.tenants(id),enabled boolean not null default false,
 flags jsonb not null default '{}' check(jsonb_typeof(flags)='object')
)$sql_45_2$;

-- payment-pro.sql: source statement 3
execute $sql_45_3$create table if not exists public.payment_pro_attempts(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 customer_id uuid references public.customers(id),slip_id uuid not null unique references public.slips(id) on delete restrict,
 message_id uuid references public.messages(id),proof_sha256 text not null check(proof_sha256~'^[0-9a-f]{64}$'),
 proof_kind text not null check(proof_kind in ('image','qr')),image_path text,
 status text not null default 'PENDING' check(status in ('PENDING','VERIFYING','VERIFIED','REVIEW_REQUIRED','REJECTED','CANCELLED')),
 reason text,order_ids uuid[] not null default '{}',expected_satang bigint,earliest_order_at timestamptz,
 claim_token uuid,claim_until timestamptz,provider_started_at timestamptz,credit_charged boolean not null default false,credit_refunded boolean not null default false,
 local_attempts integer not null default 1 check(local_attempts between 1 and 3),
 evidence jsonb,eligible boolean not null default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(tenant_id,proof_sha256)
)$sql_45_3$;

-- payment-pro.sql: source statement 4
execute $sql_45_4$create table if not exists public.payment_pro_audit(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),attempt_id uuid references public.payment_pro_attempts(id),
 actor_id uuid references auth.users(id),event text not null,reason text,created_at timestamptz not null default now()
)$sql_45_4$;

-- payment-pro.sql: source statement 5
execute $sql_45_5$create index if not exists payment_pro_review_queue on public.payment_pro_attempts(tenant_id,created_at desc) where status='REVIEW_REQUIRED'$sql_45_5$;

-- payment-pro.sql: source statement 6
execute $sql_45_6$create index if not exists payment_pro_recovery on public.payment_pro_attempts(claim_until) where status='VERIFYING'$sql_45_6$;

-- payment-pro.sql: source statement 7
execute $sql_45_7$do $$declare tab text;begin
 foreach tab in array array['payment_pro_settings','payment_pro_attempts','payment_pro_audit'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated',tab);
  execute format('grant select on public.%I to authenticated',tab);
  execute format('grant all on public.%I to service_role',tab);
  execute format('drop policy if exists tenant_read on public.%I',tab);
  execute format('create policy tenant_read on public.%I for select to authenticated using(public.can_access_tenant(tenant_id) and public.has_tenant_feature(tenant_id,''slip_auto_pilot''))',tab);
 end loop;
end $$$sql_45_7$;

-- payment-pro.sql: source statement 8
execute $sql_45_8$revoke select on public.payment_pro_attempts from authenticated$sql_45_8$;

-- payment-pro.sql: source statement 9
execute $sql_45_9$grant select(id,tenant_id,customer_id,slip_id,message_id,status,reason,expected_satang,eligible,credit_charged,credit_refunded,provider_started_at,created_at,updated_at) on public.payment_pro_attempts to authenticated$sql_45_9$;

-- payment-pro.sql: source statement 10
execute $sql_45_10$alter table public.payment_image_ledger drop constraint if exists payment_image_ledger_source_check$sql_45_10$;

-- payment-pro.sql: source statement 11
execute $sql_45_11$alter table public.payment_image_ledger add constraint payment_image_ledger_source_check check(source in ('package','billing','sale_pro'))$sql_45_11$;

-- payment-pro.sql: source statement 12
execute $sql_45_12$create or replace function public.payment_pro_state_guard() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.status<>old.status and not (
  old.status='PENDING' and new.status in ('VERIFYING','CANCELLED') or
  old.status='VERIFYING' and new.status in ('VERIFIED','REVIEW_REQUIRED','REJECTED') or
  old.status='REVIEW_REQUIRED' and new.status in ('VERIFYING','VERIFIED','REJECTED','CANCELLED')) then
  raise exception 'Invalid payment transition' using errcode='40001';end if;
 if new.tenant_id<>old.tenant_id or new.slip_id<>old.slip_id or new.proof_sha256<>old.proof_sha256 or new.customer_id is distinct from old.customer_id then raise exception 'Payment identity immutable';end if;
 new.updated_at:=now();return new;
end $$$sql_45_12$;

-- payment-pro.sql: source statement 13
execute $sql_45_13$drop trigger if exists payment_pro_state_guard on public.payment_pro_attempts$sql_45_13$;

-- payment-pro.sql: source statement 14
execute $sql_45_14$create trigger payment_pro_state_guard before update on public.payment_pro_attempts for each row execute function public.payment_pro_state_guard()$sql_45_14$;

-- payment-pro.sql: source statement 15
execute $sql_45_15$create or replace function public.payment_pro_audit_state() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op='INSERT' or new.status is distinct from old.status or new.reason is distinct from old.reason then
  insert into public.payment_pro_audit(tenant_id,attempt_id,event,reason) values(new.tenant_id,new.id,new.status,new.reason);
 end if;return null;
end $$$sql_45_15$;

-- payment-pro.sql: source statement 16
execute $sql_45_16$drop trigger if exists payment_pro_audit_state on public.payment_pro_attempts$sql_45_16$;

-- payment-pro.sql: source statement 17
execute $sql_45_17$create trigger payment_pro_audit_state after insert or update on public.payment_pro_attempts for each row execute function public.payment_pro_audit_state()$sql_45_17$;

-- payment-pro.sql: source statement 18
execute $sql_45_18$create or replace function public.payment_pro_bank(p_bank text) returns text language sql immutable set search_path=pg_catalog,public as $$
 select case upper(trim(p_bank)) when 'KBANK' then '004' when 'SCB' then '014' when 'BBL' then '002' when 'KTB' then '006' when 'BAY' then '025' when 'TTB' then '011' when 'TMB' then '011' when 'TTBNK' then '011' when 'GSB' then '030' else case when trim(p_bank)~'^[0-9]{1,3}$' then lpad(trim(p_bank),3,'0') else upper(trim(p_bank)) end end
$$$sql_45_18$;

-- payment-pro.sql: source statement 19
execute $sql_45_19$create or replace function public.payment_pro_account(p_full text,p_mask text) returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
declare full_no text:=regexp_replace(coalesce(p_full,''),'[^0-9]','','g');masked text:=lower(regexp_replace(replace(coalesce(p_mask,''),'*','x'),'[^0-9xX]','','g'));i integer;parts text[];
begin
 if length(regexp_replace(masked,'x','','g'))<3 or full_no='' then return false;end if;
 if length(full_no)=length(masked) then
  for i in 1..length(masked) loop if substr(masked,i,1)<>'x' and substr(masked,i,1)<>substr(full_no,i,1) then return false;end if;end loop;return true;
 end if;
 parts:=regexp_match(masked,'^([0-9]*)x+([0-9]*)$');
 return coalesce(parts is not null and length(parts[1])+length(parts[2])<=length(full_no) and starts_with(full_no,parts[1]) and right(full_no,length(parts[2]))=parts[2],false);
end $$$sql_45_19$;

-- payment-pro.sql: source statement 20
execute $sql_45_20$create or replace function public.payment_pro_receiver(p_tenant uuid,p_bank text,p_account text,p_proxy text) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.bank_accounts b where b.tenant_id=p_tenant and b.is_active and
  case when b.bank_code='PROMPTPAY' then public.payment_pro_account(b.account_number,regexp_replace(regexp_replace(coalesce(p_proxy,''),'[[:space:]-]','','g'),'^(\+?66|0066)(?=[0-9xX*]{9}$)','0'))
  else public.payment_pro_bank(b.bank_code)=public.payment_pro_bank(p_bank) and public.payment_pro_account(b.account_number,p_account) end)
$$$sql_45_20$;

-- payment-pro.sql: source statement 21
execute $sql_45_21$create or replace function public.claim_payment_pro(p_tenant uuid,p_customer uuid,p_message uuid,p_hash text,p_image text,p_kind text) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare a public.payment_pro_attempts;slip uuid;ids uuid[];total bigint;earliest timestamptz;token uuid:=gen_random_uuid();
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if not public.has_tenant_feature(p_tenant,'slip_auto_pilot') or not exists(select 1 from public.payment_pro_settings where tenant_id=p_tenant and enabled and flags->'riskEngine'='true'::jsonb) then raise exception 'FEATURE_LOCKED' using errcode='42501';end if;
 if p_customer is not null and not exists(select 1 from public.customers where id=p_customer and tenant_id=p_tenant) or p_message is not null and not exists(select 1 from public.messages where id=p_message and customer_id=p_customer) then raise exception 'Invalid tenant references' using errcode='42501';end if;
 select * into a from public.payment_pro_attempts where tenant_id=p_tenant and proof_sha256=p_hash;
 if found then return jsonb_build_object('id',a.id,'slip_id',a.slip_id,'customer_id',a.customer_id,'claim_token',null,'image_path',a.image_path);end if;
 perform 1 from public.customers where id=p_customer and tenant_id=p_tenant for update;
 perform 1 from public.orders where tenant_id=p_tenant and customer_id=p_customer and status='pending_payment' order by id for update;
 select array_agg(id order by id),sum(amount*100)::bigint,min(created_at) into ids,total,earliest from public.orders where tenant_id=p_tenant and customer_id=p_customer and status='pending_payment';
 insert into public.slips(tenant_id,customer_id,message_id,image_path,expected_amount) values(p_tenant,p_customer,p_message,p_image,total::numeric/100) returning id into slip;
 insert into public.payment_pro_attempts(tenant_id,customer_id,message_id,slip_id,proof_sha256,proof_kind,image_path,status,order_ids,expected_satang,earliest_order_at,claim_token,claim_until)
 values(p_tenant,p_customer,p_message,slip,p_hash,p_kind,p_image,'VERIFYING',coalesce(ids,'{}'),total,earliest,token,clock_timestamp()+interval '3 minutes') returning * into a;
 return to_jsonb(a);
end $$$sql_45_21$;

-- payment-pro.sql: source statement 22
execute $sql_45_22$create or replace function public.start_payment_pro_provider(p_attempt uuid,p_claim uuid) returns boolean language plpgsql set search_path=pg_catalog,public as $$
declare a public.payment_pro_attempts;
begin
 select * into a from public.payment_pro_attempts where id=p_attempt;
 if not found then return false;end if;
 perform 1 from public.tenants where id=a.tenant_id for update;
 select * into a from public.payment_pro_attempts where id=p_attempt for update;
 if a.status<>'VERIFYING' or a.claim_token is distinct from p_claim or a.claim_until<=clock_timestamp() or a.provider_started_at is not null then return false;end if;
 if not public.has_tenant_feature(a.tenant_id,'slip_auto_pilot') or not exists(select 1 from public.payment_pro_settings where tenant_id=a.tenant_id and enabled and flags->'riskEngine'='true'::jsonb) then
  update public.payment_pro_attempts set status='REVIEW_REQUIRED',reason='FEATURE_DISABLED' where id=a.id;
  update public.slips set status='error',note='Payment Pro ถูกปิดหรือแพ็กเกจหมดอายุ',verified_at=now() where id=a.slip_id;return false;
 end if;
 if not public.consume_slip_credit(a.tenant_id) then
  update public.payment_pro_attempts set status='REVIEW_REQUIRED',reason='INSUFFICIENT_CREDITS' where id=a.id;
  update public.slips set status='error',note='เครดิตตรวจสลิปหมด กรุณาเติมเครดิต',verified_at=now() where id=a.slip_id;return false;
 end if;
 update public.payment_pro_attempts set provider_started_at=clock_timestamp(),credit_charged=true where id=a.id;return true;
end $$$sql_45_22$;

-- payment-pro.sql: source statement 23
execute $sql_45_23$create or replace function public.apply_payment_pro(p_attempt uuid,p_actor uuid default null) returns boolean language plpgsql set search_path=pg_catalog,public as $$
declare a public.payment_pro_attempts;total bigint;count_orders integer;matched boolean;
begin
 select * into a from public.payment_pro_attempts where id=p_attempt;
 if not found then return false;end if;
 perform 1 from public.tenants where id=a.tenant_id for update;
 perform 1 from public.customers where id=a.customer_id and tenant_id=a.tenant_id for update;
 select * into a from public.payment_pro_attempts where id=p_attempt for update;
 if a.status='VERIFIED' then return true;end if;
 if a.status not in ('VERIFYING','REVIEW_REQUIRED') or not a.eligible or not public.has_tenant_feature(a.tenant_id,'slip_auto_pilot') then return false;end if;
 if not exists(select 1 from public.payment_pro_settings where tenant_id=a.tenant_id and enabled and flags->'riskEngine'='true'::jsonb) then return false;end if;
 if p_actor is null then
  if not exists(select 1 from public.payment_pro_settings where tenant_id=a.tenant_id and enabled and flags->'riskEngine'='true'::jsonb and flags->'autoConfirmation'='true'::jsonb and flags->'orderMatching'='true'::jsonb) then return false;end if;
 elsif not(exists(select 1 from public.tenant_members where tenant_id=a.tenant_id and user_id=p_actor and role='owner') or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Owner required' using errcode='42501';end if;
 matched:=public.payment_pro_receiver(a.tenant_id,a.evidence->>'receiver_bank',a.evidence->>'receiver_account',a.evidence->>'receiver_proxy');
 if not matched then update public.payment_pro_attempts set eligible=false,reason='RECEIVER_CHANGED' where id=a.id;return false;end if;
 perform 1 from public.orders where id=any(a.order_ids) order by id for update;
 select count(*),sum(amount*100)::bigint into count_orders,total from public.orders where id=any(a.order_ids) and tenant_id=a.tenant_id and customer_id=a.customer_id and status='pending_payment';
 if count_orders=0 or count_orders<>cardinality(a.order_ids) or total<>a.expected_satang or total<>(a.evidence->>'amount_satang')::bigint then
  update public.payment_pro_attempts set eligible=false,reason='ORDER_CHANGED' where id=a.id;return false;end if;
 begin
  perform public.claim_payment_transfer(a.evidence->>'trans_ref','sale',a.slip_id);
  if a.proof_kind='image' then perform public.claim_payment_image(a.proof_sha256,'sale_pro',a.slip_id);end if;
  update public.payment_pro_attempts set status='VERIFIED',reason='ALL_CHECKS_PASSED',claim_token=null,claim_until=null where id=a.id;
  update public.slips set status='valid',note=null,approved_at=coalesce(approved_at,now()),approved_by=p_actor where id=a.slip_id;
  update public.orders set status='paid',paid_at=coalesce(paid_at,now()),slip_id=a.slip_id where id=any(a.order_ids) and tenant_id=a.tenant_id and customer_id=a.customer_id and status='pending_payment';
  update public.customers set order_status='paid' where id=a.customer_id and tenant_id=a.tenant_id;
  -- Existing paid-order triggers always cancel payment reminders; never disable this safety.
  update public.follow_up_jobs set status='cancelled',reason='paid' where tenant_id=a.tenant_id and order_id=any(a.order_ids) and kind='payment' and (status in ('scheduled','pending','requires_review') or status='processing' and dispatch_started_at is null);
  insert into public.payment_pro_audit(tenant_id,attempt_id,actor_id,event,reason) values(a.tenant_id,a.id,p_actor,'payment_applied','server_verified_proof');
  return true;
 exception when unique_violation then
  update public.payment_pro_attempts set status='REJECTED',reason='DUPLICATE_TRANSACTION',eligible=false,claim_token=null,claim_until=null where id=a.id;
  update public.slips set status='duplicate',note='หลักฐานนี้ถูกใช้ชำระเงินแล้ว' where id=a.slip_id;return false;
 end;
end $$$sql_45_23$;

-- payment-pro.sql: source statement 24
execute $sql_45_24$create or replace function public.complete_payment_pro(p_attempt uuid,p_claim uuid,p_evidence jsonb) returns void language plpgsql set search_path=pg_catalog,public as $$
<<completion>>
declare a public.payment_pro_attempts;reason text;paid timestamptz;amount bigint;valid boolean;applied boolean;
begin
 select * into a from public.payment_pro_attempts where id=p_attempt;
 if not found then raise exception 'Attempt not found';end if;
 perform 1 from public.tenants where id=a.tenant_id for update;
 perform 1 from public.customers where id=a.customer_id and tenant_id=a.tenant_id for update;
 select * into a from public.payment_pro_attempts where id=p_attempt for update;
 if a.status<>'VERIFYING' or a.claim_token is distinct from p_claim or a.provider_started_at is null or a.evidence is not null then return;end if;
 amount:=(p_evidence->>'amount_satang')::bigint;paid:=(p_evidence->>'paid_at')::timestamptz;
 if p_evidence->>'provider_verdict'='duplicate' or exists(select 1 from public.payment_transfer_ledger where trans_ref=p_evidence->>'trans_ref' and source_id<>a.slip_id) then reason:='DUPLICATE_TRANSACTION';
 elsif coalesce((p_evidence->>'provider_fault')::boolean,false) then reason:='PROVIDER_ERROR';
 elsif not coalesce((p_evidence->>'provider_verified')::boolean,false) then reason:='NOT_PROVIDER_VERIFIED';
 elsif nullif(trim(p_evidence->>'trans_ref'),'') is null or length(p_evidence->>'trans_ref')>200 then reason:='MISSING_TRANSACTION_REFERENCE';
 elsif a.expected_satang is null or a.expected_satang<=0 or cardinality(a.order_ids)=0 then reason:='ORDER_REQUIRED';
 elsif amount is null or amount<=0 or amount<>a.expected_satang then reason:='AMOUNT_MISMATCH';
 elsif not public.payment_pro_receiver(a.tenant_id,p_evidence->>'receiver_bank',p_evidence->>'receiver_account',p_evidence->>'receiver_proxy') then reason:='RECEIVER_NOT_CONFIRMED';
 elsif paid is null or paid<clock_timestamp()-interval '24 hours' or paid>clock_timestamp()+interval '2 minutes' or paid<a.earliest_order_at-interval '2 minutes' then reason:='PAYMENT_TIME_INVALID';end if;
 if coalesce((p_evidence->>'provider_fault')::boolean,false) and a.credit_charged and not a.credit_refunded then
  perform public.refund_slip_credit(a.tenant_id);update public.payment_pro_attempts set credit_refunded=true where id=a.id;
 end if;
 valid:=reason is null;
 update public.payment_pro_attempts set evidence=p_evidence,eligible=valid,reason=completion.reason where id=a.id;
 update public.slips set amount=completion.amount::numeric/100,trans_ref=p_evidence->>'trans_ref',raw=p_evidence->'raw',verified_at=now() where id=a.slip_id;
 if valid and coalesce((p_evidence->>'auto_permitted')::boolean,false) then applied:=public.apply_payment_pro(a.id,null);end if;
 if not coalesce(applied,false) then
  -- apply may already have rejected a unique ledger conflict.
  update public.payment_pro_attempts set status=case when completion.reason='DUPLICATE_TRANSACTION' then 'REJECTED' else 'REVIEW_REQUIRED' end,reason=coalesce(payment_pro_attempts.reason,'AUTO_CONFIRM_DISABLED'),claim_token=null,claim_until=null where id=a.id and status='VERIFYING';
  update public.slips set status=case when completion.reason='DUPLICATE_TRANSACTION' then 'duplicate' when completion.reason='AMOUNT_MISMATCH' then 'amount_mismatch' when completion.reason='RECEIVER_NOT_CONFIRMED' then 'wrong_receiver' else 'error' end,note='Payment Pro: '||coalesce(completion.reason,'รอเจ้าของร้านอนุมัติ') where id=a.slip_id and status<>'duplicate';
  update public.customers set order_status='pending_review' where id=a.customer_id and tenant_id=a.tenant_id;
 end if;
end $$$sql_45_24$;

-- payment-pro.sql: source statement 25
execute $sql_45_25$create or replace function public.review_payment_pro_failure(p_attempt uuid,p_claim uuid) returns void language plpgsql set search_path=pg_catalog,public as $$
declare a public.payment_pro_attempts;
begin
 select * into a from public.payment_pro_attempts where id=p_attempt for update;
 if found and a.status='VERIFYING' and a.claim_token=p_claim then
  update public.payment_pro_attempts set status='REVIEW_REQUIRED',reason=case when provider_started_at is null then 'PROCESSING_FAILED_BEFORE_PROVIDER' else 'PROVIDER_RESULT_UNKNOWN' end,claim_token=null,claim_until=null where id=a.id;
  update public.slips set status='error',note='รอตรวจสอบเพิ่มเติม ระบบไม่ลองเรียก Provider ซ้ำอัตโนมัติ',verified_at=now() where id=a.slip_id;
 end if;
end $$$sql_45_25$;

-- payment-pro.sql: source statement 26
execute $sql_45_26$create or replace function public.recover_payment_pro() returns integer language plpgsql set search_path=pg_catalog,public as $$
declare a public.payment_pro_attempts;n integer:=0;
begin
 for a in select * from public.payment_pro_attempts where status='VERIFYING' and claim_until<clock_timestamp() for update skip locked loop
  perform public.review_payment_pro_failure(a.id,a.claim_token);n:=n+1;
 end loop;return n;
end $$$sql_45_26$;

-- payment-pro.sql: source statement 27
execute $sql_45_27$create or replace function public.act_payment_pro(p_attempt uuid,p_tenant uuid,p_actor uuid,p_action text,p_reason text) returns boolean language plpgsql set search_path=pg_catalog,public as $$
declare a public.payment_pro_attempts;applied boolean;
begin
 if not public.has_tenant_feature(p_tenant,'slip_auto_pilot') or not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Owner required' using errcode='42501';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 select * into a from public.payment_pro_attempts where id=p_attempt and tenant_id=p_tenant for update;
 if not found then raise exception 'Attempt not found' using errcode='P0002';end if;
 if length(trim(coalesce(p_reason,''))) not between 5 and 1000 then raise exception 'Review reason required' using errcode='22023';end if;
 if p_action='approve' then applied:=public.apply_payment_pro(a.id,p_actor);
 elsif p_action='retry' and a.status='REVIEW_REQUIRED' and a.provider_started_at is null and not a.credit_charged and a.proof_kind='image' and a.image_path is not null and a.local_attempts<3 then
  update public.payment_pro_attempts set status='VERIFYING',reason=null,claim_token=gen_random_uuid(),claim_until=clock_timestamp()+interval '3 minutes',local_attempts=local_attempts+1 where id=a.id;
  update public.slips set status='pending',note=null,verified_at=null where id=a.slip_id;applied:=true;
 elsif a.status='REVIEW_REQUIRED' and p_action in ('reject','cancel') then
  update public.payment_pro_attempts set status=case when p_action='reject' then 'REJECTED' else 'CANCELLED' end,reason='MANUAL_'||upper(p_action),eligible=false where id=a.id;
  update public.slips set status='error',note=p_reason where id=a.slip_id;applied:=true;
 else return false;end if;
 insert into public.payment_pro_audit(tenant_id,attempt_id,actor_id,event,reason) values(p_tenant,a.id,p_actor,'manual_'||p_action,p_reason);
 return applied;
end $$$sql_45_27$;

-- payment-pro.sql: source statement 28
execute $sql_45_28$create or replace function public.payment_pro_overview(p_tenant uuid) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('total',count(*),'verified',count(*) filter(where status='VERIFIED'),'review',count(*) filter(where status='REVIEW_REQUIRED'),
 'duplicates',count(*) filter(where reason='DUPLICATE_TRANSACTION'),'amountMismatch',count(*) filter(where reason='AMOUNT_MISMATCH'),
 'receiverMismatch',count(*) filter(where reason in ('RECEIVER_NOT_CONFIRMED','RECEIVER_CHANGED')),
 'charged',count(*) filter(where credit_charged),'refunded',count(*) filter(where credit_refunded),
 'verifiedSatang',coalesce(sum(expected_satang) filter(where status='VERIFIED'),0))
 from public.payment_pro_attempts where tenant_id=p_tenant and created_at>now()-interval '30 days'
$$$sql_45_28$;

-- payment-pro.sql: source statement 29
execute $sql_45_29$create or replace function public.guard_payment_pro_slip() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if (new.status='valid' or new.approved_at is not null) and exists(select 1 from public.payment_pro_attempts where slip_id=new.id and status<>'VERIFIED') then raise exception 'Payment Pro proof approval required' using errcode='42501';end if;return new;
end $$$sql_45_29$;

-- payment-pro.sql: source statement 30
execute $sql_45_30$drop trigger if exists slips_payment_pro_guard on public.slips$sql_45_30$;

-- payment-pro.sql: source statement 31
execute $sql_45_31$create trigger slips_payment_pro_guard before update on public.slips for each row execute function public.guard_payment_pro_slip()$sql_45_31$;

-- payment-pro.sql: source statement 32
execute $sql_45_32$create or replace function public.guard_payment_pro_order() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.status='paid' and (old.status is distinct from new.status or old.slip_id is distinct from new.slip_id) and exists(select 1 from public.payment_pro_attempts where slip_id=new.slip_id) and not exists(select 1 from public.payment_pro_attempts a where a.slip_id=new.slip_id and a.status='VERIFIED' and a.tenant_id=new.tenant_id and a.customer_id=new.customer_id and new.id=any(a.order_ids)) then
  raise exception 'Payment Pro order snapshot required' using errcode='42501';end if;return new;
end $$$sql_45_32$;

-- payment-pro.sql: source statement 33
execute $sql_45_33$drop trigger if exists orders_payment_pro_guard on public.orders$sql_45_33$;

-- payment-pro.sql: source statement 34
execute $sql_45_34$create trigger orders_payment_pro_guard before update of status,slip_id on public.orders for each row execute function public.guard_payment_pro_order()$sql_45_34$;

-- payment-pro.sql: source statement 35
execute $sql_45_35$do $$declare fn record;begin
 for fn in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like '%payment_pro%' or p.proname in ('payment_pro_bank','payment_pro_account','payment_pro_receiver')) loop
  execute format('revoke all on function %s from public,anon,authenticated',fn.signature);
  execute format('grant execute on function %s to service_role',fn.signature);
 end loop;
end $$$sql_45_35$;

-- payment-pro.sql: source statement 36
execute $sql_45_36$notify pgrst,'reload schema'$sql_45_36$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('payment-pro.sql','cd3319ec00052fc92e98f746533af4a8b45f48d4a8b584bab531a18061736297','aa6343641fb6d1c026a0913c81d79d990c295c23e9de63e41bfd42d3cdb7e148');
end $migration_45$;

-- 47. payment-pro-dashboard.sql
do $migration_46$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='payment-pro-dashboard.sql';
  if found then
    if installed <> '8df2ea6f5f1d83802e8ee6ef604638d301b853f4163c45403cb89f15c32785bc' then
      raise exception 'Applied migration changed: payment-pro-dashboard.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- payment-pro-dashboard.sql: source statement 2
execute $sql_46_2$create or replace function public.payment_pro_dashboard_report(p_tenant uuid,p_from timestamptz,p_to timestamptz,p_query text default '') returns jsonb
language sql stable set search_path=pg_catalog,public as $$
 with scoped as(select * from public.payment_pro_attempts where tenant_id=p_tenant and created_at>=p_from and created_at<p_to),
 matched as(select * from scoped where coalesce(p_query,'')='' or strpos(lower(coalesce(reason,'')),lower(p_query))>0),
 daily as(select (created_at at time zone 'Asia/Bangkok')::date bucket,count(*) total,count(*) filter(where status='VERIFIED') verified,coalesce(sum(expected_satang) filter(where status='VERIFIED'),0) satang from scoped group by 1),
 days as(select generate_series((p_from at time zone 'Asia/Bangkok')::date,(p_to at time zone 'Asia/Bangkok')::date,interval '1 day')::date bucket)
 select jsonb_build_object('attempts',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from(select id,slip_id,customer_id,status,reason,expected_satang,eligible,credit_charged,credit_refunded,provider_started_at,created_at,updated_at from matched order by created_at desc,id limit 500)r),
 'stats',(select jsonb_build_object('total',count(*),'verified',count(*) filter(where status='VERIFIED'),'review',count(*) filter(where status in ('PENDING','VERIFYING','REVIEW_REQUIRED')),'rejected',count(*) filter(where status='REJECTED'),'cancelled',count(*) filter(where status='CANCELLED'),'duplicates',count(*) filter(where reason='DUPLICATE_TRANSACTION'),'amountMismatch',count(*) filter(where reason='AMOUNT_MISMATCH'),'receiverMismatch',count(*) filter(where reason in ('RECEIVER_NOT_CONFIRMED','RECEIVER_CHANGED')),'charged',count(*) filter(where credit_charged),'refunded',count(*) filter(where credit_refunded),'verifiedSatang',coalesce(sum(expected_satang) filter(where status='VERIFIED'),0)) from scoped),
 'series',(select jsonb_agg(jsonb_build_object('day',d.bucket,'amount',coalesce(r.satang,0)/100.0,'count',coalesce(r.total,0)) order by d.bucket) from days d left join daily r using(bucket)))
$$$sql_46_2$;

-- payment-pro-dashboard.sql: source statement 3
execute $sql_46_3$revoke all on function public.payment_pro_dashboard_report(uuid,timestamptz,timestamptz,text) from public,anon,authenticated$sql_46_3$;

-- payment-pro-dashboard.sql: source statement 4
execute $sql_46_4$grant execute on function public.payment_pro_dashboard_report(uuid,timestamptz,timestamptz,text) to service_role$sql_46_4$;

-- payment-pro-dashboard.sql: source statement 5
execute $sql_46_5$notify pgrst,'reload schema'$sql_46_5$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('payment-pro-dashboard.sql','8df2ea6f5f1d83802e8ee6ef604638d301b853f4163c45403cb89f15c32785bc','8d4e52e0d834ca8ce7cab97c2b78209535263726b7c5d1796ba4398b7ae54b7b');
end $migration_46$;

-- 48. slip-bank-controls.sql
do $migration_47$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='slip-bank-controls.sql';
  if found then
    if installed <> '08a8fe42aac8571f4b1696b1e4e42c15c0ad6349339e7481be3c70537e703cfa' then
      raise exception 'Applied migration changed: slip-bank-controls.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- slip-bank-controls.sql: source statement 2
execute $sql_47_2$alter table public.bank_accounts add column if not exists is_primary boolean not null default false$sql_47_2$;

-- slip-bank-controls.sql: source statement 4
execute $sql_47_4$create unique index if not exists bank_accounts_one_primary on public.bank_accounts(tenant_id) where is_primary$sql_47_4$;

-- slip-bank-controls.sql: source statement 5
execute $sql_47_5$create table if not exists public.bank_account_audit(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),account_id uuid,actor_id uuid references auth.users(id),action text not null,last_four text,created_at timestamptz not null default now())$sql_47_5$;

-- slip-bank-controls.sql: source statement 6
execute $sql_47_6$alter table public.bank_account_audit enable row level security$sql_47_6$;

-- slip-bank-controls.sql: source statement 7
execute $sql_47_7$revoke all on public.bank_account_audit from public,anon,authenticated$sql_47_7$;

-- slip-bank-controls.sql: source statement 8
execute $sql_47_8$grant select,insert on public.bank_account_audit to service_role$sql_47_8$;

-- slip-bank-controls.sql: source statement 9
execute $sql_47_9$create or replace function public.sync_primary_bank_account() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare target uuid;selected public.bank_accounts;
begin
 target:=case when tg_op='DELETE' then old.tenant_id else new.tenant_id end;
 if tg_op='UPDATE' and new.tenant_id<>old.tenant_id then raise exception 'Cannot move bank accounts between shops';end if;
 perform 1 from public.tenants where id=target for update;
 select * into selected from public.bank_accounts where tenant_id=target and is_active order by is_primary desc,created_at,id limit 1;
 update public.tenants set bank_code=selected.bank_code,account_name=selected.account_name,account_number=selected.account_number where id=target;
 return null;
end $$$sql_47_9$;

-- slip-bank-controls.sql: source statement 10
execute $sql_47_10$revoke insert,update,delete on public.bank_accounts from authenticated$sql_47_10$;

-- slip-bank-controls.sql: source statement 11
execute $sql_47_11$drop policy if exists member_read on public.bank_accounts$sql_47_11$;

-- slip-bank-controls.sql: source statement 12
execute $sql_47_12$drop policy if exists owner_write on public.bank_accounts$sql_47_12$;

-- slip-bank-controls.sql: source statement 13
execute $sql_47_13$drop policy if exists owner_read on public.bank_accounts$sql_47_13$;

-- slip-bank-controls.sql: source statement 14
execute $sql_47_14$create policy owner_read on public.bank_accounts for select to authenticated using(public.can_manage_bank_accounts(tenant_id))$sql_47_14$;

-- slip-bank-controls.sql: source statement 15
execute $sql_47_15$revoke select(account_number) on public.tenants from authenticated$sql_47_15$;

-- slip-bank-controls.sql: source statement 16
execute $sql_47_16$create or replace function public.manage_slip_bank_account(p_tenant uuid,p_actor uuid,p_action text,p_id uuid default null,p_data jsonb default '{}',p_confirmed boolean default false) returns uuid
language plpgsql set search_path=pg_catalog,public as $$
declare saved uuid;old_account public.bank_accounts;
begin
 if not exists(select 1 from public.tenants where id=p_tenant and is_active) or not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_confirmed is distinct from true then raise exception 'Confirmation required' using errcode='22023';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 if p_id is not null then select * into old_account from public.bank_accounts where id=p_id and tenant_id=p_tenant for update;if not found then raise exception 'Account not found' using errcode='P0002';end if;end if;
 if p_action='save' then
  if p_id is null then
   insert into public.bank_accounts(tenant_id,bank_code,account_name,account_number,is_active) values(p_tenant,p_data->>'bank_code',p_data->>'account_name',p_data->>'account_number',(p_data->>'is_active')::boolean) returning id into saved;
  else
   update public.bank_accounts set bank_code=p_data->>'bank_code',account_name=p_data->>'account_name',account_number=p_data->>'account_number',is_active=(p_data->>'is_active')::boolean,is_primary=case when (p_data->>'is_active')::boolean then is_primary else false end where id=p_id returning id into saved;
  end if;
 elsif p_action='primary' and old_account.is_active then
  update public.bank_accounts set is_primary=false where tenant_id=p_tenant and is_primary;
  update public.bank_accounts set is_primary=true where id=p_id; saved:=p_id;
 elsif p_action='toggle' and p_id is not null then
  update public.bank_accounts set is_active=not is_active,is_primary=case when is_active then false else is_primary end where id=p_id; saved:=p_id;
 elsif p_action='delete' and p_id is not null then delete from public.bank_accounts where id=p_id;saved:=p_id;
 else raise exception 'Invalid action or inactive primary account' using errcode='22023';end if;
 -- If the primary was disabled/deleted, choose the oldest active account atomically.
 if not exists(select 1 from public.bank_accounts where tenant_id=p_tenant and is_primary and is_active) then
  update public.bank_accounts set is_primary=true where id=(select id from public.bank_accounts where tenant_id=p_tenant and is_active order by created_at,id limit 1);
 end if;
 insert into public.bank_account_audit(tenant_id,account_id,actor_id,action,last_four) values(p_tenant,saved,p_actor,p_action,right(coalesce(p_data->>'account_number',old_account.account_number),4));
 return saved;
end $$$sql_47_16$;

-- slip-bank-controls.sql: source statement 17
execute $sql_47_17$revoke all on function public.manage_slip_bank_account(uuid,uuid,text,uuid,jsonb,boolean) from public,anon,authenticated$sql_47_17$;

-- slip-bank-controls.sql: source statement 18
execute $sql_47_18$grant execute on function public.manage_slip_bank_account(uuid,uuid,text,uuid,jsonb,boolean) to service_role$sql_47_18$;

-- slip-bank-controls.sql: source statement 19
begin
execute $sql_47_19$create or replace function public.seed_tenant_bank_account() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 update public.tenants set bank_accounts_migrated=true where id=new.id;
 if new.bank_code in ('KBANK','SCB','BBL','KTB','BAY','TTB','GSB','PROMPTPAY') and new.account_number ~ '^[0-9]{10,15}$' then
  insert into public.bank_accounts(tenant_id,bank_code,account_name,account_number,is_primary)
  values(new.id,new.bank_code,coalesce(nullif(trim(new.account_name),''),new.name),new.account_number,true) on conflict do nothing;
 end if;
 return null;
end $$$sql_47_19$;
exception when invalid_function_definition then
  -- A newer signature of seed_tenant_bank_account() is already installed. Its final definition below is mandatory.
  null;
end;

-- slip-bank-controls.sql: source statement 20
execute $sql_47_20$revoke all on function public.seed_tenant_bank_account() from public,anon,authenticated$sql_47_20$;

-- slip-bank-controls.sql: source statement 21
execute $sql_47_21$notify pgrst,'reload schema'$sql_47_21$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('slip-bank-controls.sql','08a8fe42aac8571f4b1696b1e4e42c15c0ad6349339e7481be3c70537e703cfa','08d19ff46fa0d05b9a42f710ea11f212756e4a95fea9440d221bce1b808f98e3');
end $migration_47$;

-- 49. bank-registry.sql
do $migration_48$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='bank-registry.sql';
  if found then
    if installed <> 'e40dbd449546f7ab03061e3c3f770645e5897ef782660b8f880068e06e9fe8db' then
      raise exception 'Applied migration changed: bank-registry.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- bank-registry.sql: source statement 2
execute $sql_48_2$create or replace function public.bank_registry_code_valid(p_code text) returns boolean
language sql immutable set search_path=pg_catalog,public as $$
 select coalesce(p_code in ('KBANK','SCB','KTB','BBL','BAY','KKP','CLICX','JPM','CITI','CIMB','SMTB','SMBC','DB','TTB','TISCO','TCRB','BNP','PROMPTPAY','SME','BAAC','EXIM','MHCB','MEGA','UOB','LH','SCBT','BOC','BOFA','GSB','GHB','RHB','IOB','IBANK','OCBC','ICBC','HSBC'),false)
$$$sql_48_2$;

-- bank-registry.sql: source statement 3
execute $sql_48_3$alter table public.bank_accounts drop constraint if exists bank_accounts_bank_code_check$sql_48_3$;

-- bank-registry.sql: source statement 4
execute $sql_48_4$alter table public.bank_accounts drop constraint if exists bank_accounts_bank_code_registry_check$sql_48_4$;

-- bank-registry.sql: source statement 5
execute $sql_48_5$alter table public.bank_accounts add constraint bank_accounts_bank_code_registry_check check(public.bank_registry_code_valid(bank_code))$sql_48_5$;

-- bank-registry.sql: source statement 6
execute $sql_48_6$create or replace function public.seed_tenant_bank_account() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 update public.tenants set bank_accounts_migrated=true where id=new.id;
 if public.bank_registry_code_valid(new.bank_code) and new.account_number ~ '^[0-9]{10,15}$' then
  insert into public.bank_accounts(tenant_id,bank_code,account_name,account_number,is_primary)
  values(new.id,new.bank_code,coalesce(nullif(trim(new.account_name),''),new.name),new.account_number,true) on conflict do nothing;
 end if;
 return null;
end $$$sql_48_6$;

-- bank-registry.sql: source statement 7
execute $sql_48_7$revoke all on function public.seed_tenant_bank_account() from public,anon,authenticated$sql_48_7$;

-- bank-registry.sql: source statement 8
execute $sql_48_8$notify pgrst,'reload schema'$sql_48_8$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('bank-registry.sql','e40dbd449546f7ab03061e3c3f770645e5897ef782660b8f880068e06e9fe8db','9552aa3856ddf0c584f98f7ac722bc877e9a1a89617d0dd0c2dd5a1d7914b4d0');
end $migration_48$;

-- 50. bank-qr-upload.sql
do $migration_49$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='bank-qr-upload.sql';
  if found then
    if installed <> '1f3644e8fc49b91992c0172ca91aa93000bc79e8a668bd61301baeafe961527b' then
      raise exception 'Applied migration changed: bank-qr-upload.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- bank-qr-upload.sql: source statement 2
execute $sql_49_2$insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('bank-receiving-qr','bank-receiving-qr',false,5242880,array['image/png','image/jpeg'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types$sql_49_2$;

-- bank-qr-upload.sql: source statement 3
execute $sql_49_3$drop policy if exists bank_receiving_qr_private on storage.objects$sql_49_3$;

-- bank-qr-upload.sql: source statement 4
execute $sql_49_4$create policy bank_receiving_qr_private on storage.objects as restrictive for all to anon,authenticated
using(bucket_id<>'bank-receiving-qr') with check(bucket_id<>'bank-receiving-qr')$sql_49_4$;

-- bank-qr-upload.sql: source statement 5
execute $sql_49_5$create table if not exists public.bank_receiving_qr (
 tenant_id uuid primary key references public.tenants(id) on delete cascade,
 account_id uuid not null references public.bank_accounts(id),
 bank_code_snapshot text not null,
 account_number_snapshot text not null,
 image_path text not null,
 payload text not null check(length(payload) between 20 and 2048),
 version integer not null check(version>0),
 updated_at timestamptz not null default now()
)$sql_49_5$;

-- bank-qr-upload.sql: source statement 6
execute $sql_49_6$alter table public.bank_receiving_qr enable row level security$sql_49_6$;

-- bank-qr-upload.sql: source statement 7
execute $sql_49_7$revoke all on public.bank_receiving_qr from public,anon,authenticated$sql_49_7$;

-- bank-qr-upload.sql: source statement 8
execute $sql_49_8$grant select,insert,update,delete on public.bank_receiving_qr to service_role$sql_49_8$;

-- bank-qr-upload.sql: source statement 9
execute $sql_49_9$create or replace function public.save_bank_receiving_qr(
 p_tenant uuid,p_actor uuid,p_bank text,p_name text,p_number text,p_path text,p_payload text,p_version integer
) returns integer language plpgsql set search_path=pg_catalog,public as $$
declare previous public.bank_receiving_qr; saved uuid; next_version integer;
begin
 if not exists(select 1 from public.tenants where id=p_tenant and is_active) or not (
  exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or
  exists(select 1 from public.platform_admins where user_id=p_actor)
 ) then raise exception 'Forbidden' using errcode='42501';end if;
 if not public.has_tenant_feature(p_tenant,'slip_auto_pilot') then raise exception 'Feature locked' using errcode='42501';end if;
 if p_bank is null or p_bank not in ('KBANK','SCB','KTB','BBL','BAY','KKP','CIMB','TTB','TISCO','TCRB','SME','BAAC','EXIM','UOB','LH','GSB','GHB','ICBC') or
  p_name is null or length(trim(p_name)) not between 1 and 120 or p_number is null or p_number !~ '^[0-9]{10,15}$' or
  p_path is null or p_path not like p_tenant::text||'/%' or p_path like '%..%' or
  p_payload is null or length(p_payload) not between 20 and 2048 or p_version is null or p_version<0
 then raise exception 'Invalid receiving QR' using errcode='22023';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 select * into previous from public.bank_receiving_qr where tenant_id=p_tenant for update;
 if coalesce(previous.version,0)<>p_version then raise exception 'QR changed' using errcode='40001';end if;
 -- An existing image cannot be silently reattached to a different account.
 if previous.image_path=p_path and (previous.bank_code_snapshot<>p_bank or previous.account_number_snapshot<>p_number or previous.payload<>p_payload)
 then raise exception 'Upload QR for new account' using errcode='22023';end if;
 select id into saved from public.bank_accounts where tenant_id=p_tenant and bank_code=p_bank and account_number=p_number;
 saved:=public.manage_slip_bank_account(p_tenant,p_actor,'save',saved,
  jsonb_build_object('bank_code',p_bank,'account_name',trim(p_name),'account_number',p_number,'is_active',true),true);
 perform public.manage_slip_bank_account(p_tenant,p_actor,'primary',saved,'{}',true);
 next_version:=p_version+1;
 insert into public.bank_receiving_qr(tenant_id,account_id,bank_code_snapshot,account_number_snapshot,image_path,payload,version)
 values(p_tenant,saved,p_bank,p_number,p_path,p_payload,next_version)
 on conflict(tenant_id) do update set account_id=excluded.account_id,bank_code_snapshot=excluded.bank_code_snapshot,
  account_number_snapshot=excluded.account_number_snapshot,image_path=excluded.image_path,payload=excluded.payload,
  version=excluded.version,updated_at=now();
 return next_version;
end $$$sql_49_9$;

-- bank-qr-upload.sql: source statement 10
execute $sql_49_10$revoke all on function public.save_bank_receiving_qr(uuid,uuid,text,text,text,text,text,integer) from public,anon,authenticated$sql_49_10$;

-- bank-qr-upload.sql: source statement 11
execute $sql_49_11$grant execute on function public.save_bank_receiving_qr(uuid,uuid,text,text,text,text,text,integer) to service_role$sql_49_11$;

-- bank-qr-upload.sql: source statement 12
execute $sql_49_12$notify pgrst,'reload schema'$sql_49_12$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('bank-qr-upload.sql','1f3644e8fc49b91992c0172ca91aa93000bc79e8a668bd61301baeafe961527b','6f115a66a303c4cdffce869df158f47c6090542411f674fdede0c28f9c6f539c');
end $migration_49$;

-- 51. bank-qr-per-account.sql
do $migration_50$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='bank-qr-per-account.sql';
  if found then
    if installed <> '0278f60e9233803ed19593a64a0f77bf1bc950c4d776e42394ab5ccd76ba8191' then
      raise exception 'Applied migration changed: bank-qr-per-account.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- bank-qr-per-account.sql: source statement 2
execute $sql_50_2$do $$ begin
 if exists(select 1 from pg_constraint where conrelid='public.bank_receiving_qr'::regclass
  and contype='p' and pg_get_constraintdef(oid)='PRIMARY KEY (tenant_id)') then
  alter table public.bank_receiving_qr drop constraint bank_receiving_qr_pkey;
  alter table public.bank_receiving_qr add primary key(tenant_id,account_id);
 end if;
end $$$sql_50_2$;

-- bank-qr-per-account.sql: source statement 3
execute $sql_50_3$create or replace function public.save_bank_account_qr(
 p_tenant uuid,p_actor uuid,p_account uuid,p_bank text,p_number text,p_path text,p_payload text,p_version integer
) returns integer language plpgsql set search_path=pg_catalog,public as $$
declare account public.bank_accounts; previous public.bank_receiving_qr; next_version integer;
begin
 if not exists(select 1 from public.tenants where id=p_tenant and is_active) or not (
  exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or
  exists(select 1 from public.platform_admins where user_id=p_actor)
 ) then raise exception 'Forbidden' using errcode='42501';end if;
 if not public.has_tenant_feature(p_tenant,'slip_auto_pilot') then raise exception 'Feature locked' using errcode='42501';end if;
 if p_account is null or p_bank is null or p_number is null or p_path is null or
  p_path not like p_tenant::text||'/'||p_account::text||'/%' or p_path like '%..%' or
  p_payload is null or length(p_payload) not between 20 and 2048 or p_version is null or p_version<0
 then raise exception 'Invalid account QR' using errcode='22023';end if;
 -- Serialize with existing account-edit/toggle/primary RPCs; never change their settings here.
 perform 1 from public.tenants where id=p_tenant for update;
 select * into account from public.bank_accounts where tenant_id=p_tenant and id=p_account for update;
 if not found then raise exception 'Account not found' using errcode='P0002';end if;
 if account.bank_code<>p_bank or account.account_number<>p_number then
  raise exception 'Account changed' using errcode='40001';end if;
 if account.bank_code not in ('KBANK','SCB','KTB','BBL','BAY','KKP','CIMB','TTB','TISCO','TCRB','SME','BAAC','EXIM','UOB','LH','GSB','GHB','ICBC') then
  raise exception 'Unsupported bank' using errcode='22023';end if;
 select * into previous from public.bank_receiving_qr where tenant_id=p_tenant and account_id=p_account for update;
 if coalesce(previous.version,0)<>p_version then raise exception 'QR changed' using errcode='40001';end if;
 next_version:=p_version+1;
 insert into public.bank_receiving_qr(tenant_id,account_id,bank_code_snapshot,account_number_snapshot,image_path,payload,version)
 values(p_tenant,p_account,p_bank,p_number,p_path,p_payload,next_version)
 on conflict(tenant_id,account_id) do update set bank_code_snapshot=excluded.bank_code_snapshot,
  account_number_snapshot=excluded.account_number_snapshot,image_path=excluded.image_path,payload=excluded.payload,
  version=excluded.version,updated_at=now();
 insert into public.bank_account_audit(tenant_id,account_id,actor_id,action,last_four)
 values(p_tenant,p_account,p_actor,'qr_upload',right(account.account_number,4));
 return next_version;
end $$$sql_50_3$;

-- bank-qr-per-account.sql: source statement 4
execute $sql_50_4$revoke all on function public.save_bank_account_qr(uuid,uuid,uuid,text,text,text,text,integer) from public,anon,authenticated$sql_50_4$;

-- bank-qr-per-account.sql: source statement 5
execute $sql_50_5$grant execute on function public.save_bank_account_qr(uuid,uuid,uuid,text,text,text,text,integer) to service_role$sql_50_5$;

-- bank-qr-per-account.sql: source statement 6
execute $sql_50_6$notify pgrst,'reload schema'$sql_50_6$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('bank-qr-per-account.sql','0278f60e9233803ed19593a64a0f77bf1bc950c4d776e42394ab5ccd76ba8191','32f1910876783a4661555a71c8144e1923d9548611ef0cbd5c6927681aecee27');
end $migration_50$;

-- 52. bank-account-combined-save.sql
do $migration_51$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='bank-account-combined-save.sql';
  if found then
    if installed <> '281d6d62139150815e56559a45c5eb043cdda51a7b3b8b5aca960e2150cb47a2' then
      raise exception 'Applied migration changed: bank-account-combined-save.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- bank-account-combined-save.sql: source statement 2
execute $sql_51_2$create table if not exists public.bank_account_save_requests (
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 request_id uuid not null,
 actor_id uuid not null,
 fingerprint text not null check(fingerprint ~ '^[0-9a-f]{64}$'),
 result jsonb not null,
 created_at timestamptz not null default now(),
 primary key(tenant_id,request_id)
)$sql_51_2$;

-- bank-account-combined-save.sql: source statement 3
execute $sql_51_3$alter table public.bank_account_save_requests enable row level security$sql_51_3$;

-- bank-account-combined-save.sql: source statement 4
execute $sql_51_4$revoke all on public.bank_account_save_requests from public,anon,authenticated$sql_51_4$;

-- bank-account-combined-save.sql: source statement 5
execute $sql_51_5$grant select,insert on public.bank_account_save_requests to service_role$sql_51_5$;

-- bank-account-combined-save.sql: source statement 6
execute $sql_51_6$create or replace function public.save_bank_account_with_qr(
 p_tenant uuid,p_actor uuid,p_account uuid,p_create boolean,p_data jsonb,p_original jsonb,
 p_path text,p_payload text,p_version integer,p_request uuid,p_fingerprint text
) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare account public.bank_accounts; previous public.bank_receiving_qr; cached public.bank_account_save_requests;
 saved uuid; result jsonb; next_version integer;
begin
 if not exists(select 1 from public.tenants where id=p_tenant and is_active) or not (
  exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or
  exists(select 1 from public.platform_admins where user_id=p_actor)
 ) then raise exception 'Forbidden' using errcode='42501';end if;
 if not public.has_tenant_feature(p_tenant,'slip_auto_pilot') then raise exception 'Feature locked' using errcode='42501';end if;
 if p_request is null or p_account is null or p_create is null or p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$'
 then raise exception 'Invalid save request' using errcode='22023';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 select * into cached from public.bank_account_save_requests where tenant_id=p_tenant and request_id=p_request;
 if found then
  if cached.actor_id<>p_actor or cached.fingerprint<>p_fingerprint then raise exception 'Save request changed' using errcode='40001';end if;
  return cached.result;
 end if;
 if p_data->>'bank_code' is null or p_data->>'bank_code' not in ('KBANK','SCB','KTB','BBL','BAY','KKP','CIMB','TTB','TISCO','TCRB','SME','BAAC','EXIM','UOB','LH','GSB','GHB','ICBC') or
  p_data->>'account_name' is null or length(trim(p_data->>'account_name')) not between 1 and 120 or
  p_data->>'account_number' is null or p_data->>'account_number' !~ '^[0-9]{10,15}$' or
  jsonb_typeof(p_data->'is_active') is distinct from 'boolean' or p_version is null or p_version<0
 then raise exception 'Invalid account data' using errcode='22023';end if;
 if (p_path is null)<>(p_payload is null) or (p_path is not null and
  (p_path not like p_tenant::text||'/'||p_account::text||'/%' or p_path like '%..%' or length(p_payload) not between 20 and 2048))
 then raise exception 'Invalid QR' using errcode='22023';end if;
 if p_create then
  if p_original is not null and p_original<>'null'::jsonb then raise exception 'Invalid original account' using errcode='22023';end if;
  if exists(select 1 from public.bank_accounts where id=p_account) then raise exception 'Account already exists' using errcode='40001';end if;
  insert into public.bank_accounts(id,tenant_id,bank_code,account_name,account_number,is_active)
  values(p_account,p_tenant,p_data->>'bank_code',trim(p_data->>'account_name'),p_data->>'account_number',(p_data->>'is_active')::boolean);
 else
  select * into account from public.bank_accounts where tenant_id=p_tenant and id=p_account for update;
  if not found then raise exception 'Account not found' using errcode='P0002';end if;
  if p_original is distinct from jsonb_build_object('bank_code',account.bank_code,'account_name',trim(account.account_name),
   'account_number',account.account_number,'is_active',account.is_active)
  then raise exception 'Account changed' using errcode='40001';end if;
 end if;
 select * into previous from public.bank_receiving_qr where tenant_id=p_tenant and account_id=p_account for update;
 if coalesce(previous.version,0)<>p_version then raise exception 'QR changed' using errcode='40001';end if;
 if previous.account_id is not null and p_path is null and
  (previous.bank_code_snapshot<>p_data->>'bank_code' or previous.account_number_snapshot<>p_data->>'account_number')
 then raise exception 'Upload QR for changed account' using errcode='22023';end if;
 saved:=public.manage_slip_bank_account(p_tenant,p_actor,'save',p_account,p_data,true);
 next_version:=p_version;
 if p_path is not null then
  next_version:=public.save_bank_account_qr(p_tenant,p_actor,p_account,p_data->>'bank_code',p_data->>'account_number',p_path,p_payload,p_version);
 end if;
 result:=jsonb_build_object('id',saved,'version',next_version,'image_path',coalesce(p_path,previous.image_path));
 insert into public.bank_account_save_requests(tenant_id,request_id,actor_id,fingerprint,result)
 values(p_tenant,p_request,p_actor,p_fingerprint,result);
 return result;
end $$$sql_51_6$;

-- bank-account-combined-save.sql: source statement 7
execute $sql_51_7$revoke all on function public.save_bank_account_with_qr(uuid,uuid,uuid,boolean,jsonb,jsonb,text,text,integer,uuid,text) from public,anon,authenticated$sql_51_7$;

-- bank-account-combined-save.sql: source statement 8
execute $sql_51_8$grant execute on function public.save_bank_account_with_qr(uuid,uuid,uuid,boolean,jsonb,jsonb,text,text,integer,uuid,text) to service_role$sql_51_8$;

-- bank-account-combined-save.sql: source statement 9
execute $sql_51_9$notify pgrst,'reload schema'$sql_51_9$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('bank-account-combined-save.sql','281d6d62139150815e56559a45c5eb043cdda51a7b3b8b5aca960e2150cb47a2','ba5776e10e9d121d7d374238c8031330a1ac43c18ccfe055a2dafc1551bc1128');
end $migration_51$;

-- 53. payment-receiving-codes.sql
do $migration_52$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='payment-receiving-codes.sql';
  if found then
    if installed <> '9a96597249a877924b57c925eba98dfd2f81933125788850c4f0779e52af5955' then
      raise exception 'Applied migration changed: payment-receiving-codes.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- payment-receiving-codes.sql: source statement 2
execute $sql_52_2$create table if not exists public.payment_receiving_codes(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 account_id uuid not null references public.bank_accounts(id),actor_id uuid not null references auth.users(id),
 request_id uuid not null,label text not null check(length(trim(label)) between 1 and 100),
 payload text not null check(length(payload) between 20 and 1024),
 recipient_snapshot text not null,amount_satang bigint check(amount_satang between 1 and 9999999999),
 order_id uuid references public.orders(id),source text not null check(source in ('generated','imported')),
 is_active boolean not null default true,created_at timestamptz not null default now(),
 unique(tenant_id,actor_id,request_id)
)$sql_52_2$;

-- payment-receiving-codes.sql: source statement 3
execute $sql_52_3$create index if not exists receiving_codes_shop on public.payment_receiving_codes(tenant_id,created_at desc)$sql_52_3$;

-- payment-receiving-codes.sql: source statement 4
execute $sql_52_4$create table if not exists public.payment_receiving_audit(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 code_id uuid not null references public.payment_receiving_codes(id),actor_id uuid not null references auth.users(id),
 action text not null,created_at timestamptz not null default now()
)$sql_52_4$;

-- payment-receiving-codes.sql: source statement 5
execute $sql_52_5$alter table public.payment_receiving_codes enable row level security$sql_52_5$;

-- payment-receiving-codes.sql: source statement 6
execute $sql_52_6$alter table public.payment_receiving_audit enable row level security$sql_52_6$;

-- payment-receiving-codes.sql: source statement 7
execute $sql_52_7$revoke all on public.payment_receiving_codes,public.payment_receiving_audit from public,anon,authenticated$sql_52_7$;

-- payment-receiving-codes.sql: source statement 8
execute $sql_52_8$grant select,insert,update on public.payment_receiving_codes to service_role$sql_52_8$;

-- payment-receiving-codes.sql: source statement 9
execute $sql_52_9$grant select,insert on public.payment_receiving_audit to service_role$sql_52_9$;

-- payment-receiving-codes.sql: source statement 10
execute $sql_52_10$create or replace function public.save_payment_receiving_code(p_tenant uuid,p_actor uuid,p_key uuid,p_account uuid,p_label text,p_payload text,p_recipient text,p_amount bigint,p_order uuid default null,p_source text default 'generated') returns uuid
language plpgsql set search_path=pg_catalog,public as $$
declare account public.bank_accounts;existing public.payment_receiving_codes;saved uuid;order_amount numeric;
begin
 if not public.has_tenant_feature(p_tenant,'slip_auto_pilot') or not (
  exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or exists(select 1 from public.platform_admins where user_id=p_actor)
 ) then raise exception 'Forbidden' using errcode='42501';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 if p_key is null or p_account is null or p_recipient is null or p_label is null or length(trim(p_label)) not between 1 and 100 or p_payload is null or length(p_payload) not between 20 and 1024 or p_source is null or p_source not in ('generated','imported') or p_amount is not null and p_amount not between 1 and 9999999999 then raise exception 'Invalid QR' using errcode='22023';end if;
 select * into existing from public.payment_receiving_codes where tenant_id=p_tenant and actor_id=p_actor and request_id=p_key;
 if found then
  if existing.account_id<>p_account or existing.recipient_snapshot<>p_recipient or existing.label<>trim(p_label) or existing.payload<>p_payload or existing.amount_satang is distinct from p_amount or existing.order_id is distinct from p_order or existing.source<>p_source then raise exception 'Request key reused' using errcode='22023';end if;
  return existing.id;
 end if;
 if (select count(*) from public.payment_receiving_codes where tenant_id=p_tenant and actor_id=p_actor and created_at>now()-interval '1 minute')>=20 then raise exception 'Rate limit' using errcode='P0429';end if;
 select * into account from public.bank_accounts where id=p_account and tenant_id=p_tenant for share;
 if not found or not account.is_active or account.bank_code<>'PROMPTPAY' then raise exception 'Active registered PromptPay required' using errcode='22023';end if;
 if account.account_number<>p_recipient then raise exception 'Receiving account changed' using errcode='40001';end if;
 if p_order is not null then
  select amount into order_amount from public.orders where id=p_order and tenant_id=p_tenant and status='pending_payment' for share;
  if not found or p_amount is null or order_amount*100<>p_amount then raise exception 'Order changed' using errcode='40001';end if;
 end if;
 insert into public.payment_receiving_codes(tenant_id,account_id,actor_id,request_id,label,payload,recipient_snapshot,amount_satang,order_id,source)
  values(p_tenant,p_account,p_actor,p_key,trim(p_label),p_payload,account.account_number,p_amount,p_order,p_source) returning id into saved;
 insert into public.payment_receiving_audit(tenant_id,code_id,actor_id,action) values(p_tenant,saved,p_actor,p_source);
 return saved;
end $$$sql_52_10$;

-- payment-receiving-codes.sql: source statement 11
execute $sql_52_11$create or replace function public.set_payment_receiving_code_active(p_tenant uuid,p_actor uuid,p_id uuid,p_active boolean) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare current_state boolean;
begin
 if p_active is null or not public.has_tenant_feature(p_tenant,'slip_auto_pilot') or not (
  exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or exists(select 1 from public.platform_admins where user_id=p_actor)
 ) then raise exception 'Forbidden' using errcode='42501';end if;
 select is_active into current_state from public.payment_receiving_codes where id=p_id and tenant_id=p_tenant for update;
 if not found then raise exception 'Not found' using errcode='P0002';end if;
 if current_state=p_active then return;end if;
 update public.payment_receiving_codes set is_active=p_active where id=p_id;
 insert into public.payment_receiving_audit(tenant_id,code_id,actor_id,action) values(p_tenant,p_id,p_actor,case when p_active then 'enabled' else 'disabled' end);
end $$$sql_52_11$;

-- payment-receiving-codes.sql: source statement 12
execute $sql_52_12$revoke all on function public.save_payment_receiving_code(uuid,uuid,uuid,uuid,text,text,text,bigint,uuid,text),public.set_payment_receiving_code_active(uuid,uuid,uuid,boolean) from public,anon,authenticated$sql_52_12$;

-- payment-receiving-codes.sql: source statement 13
execute $sql_52_13$grant execute on function public.save_payment_receiving_code(uuid,uuid,uuid,uuid,text,text,text,bigint,uuid,text),public.set_payment_receiving_code_active(uuid,uuid,uuid,boolean) to service_role$sql_52_13$;

-- payment-receiving-codes.sql: source statement 14
execute $sql_52_14$notify pgrst,'reload schema'$sql_52_14$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('payment-receiving-codes.sql','9a96597249a877924b57c925eba98dfd2f81933125788850c4f0779e52af5955','69d202f61858dbf27aaffa6a93e201b0fe43cb15e22fc579fbe82d1bca342826');
end $migration_52$;

-- 54. qr-payment-designer.sql
do $migration_53$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='qr-payment-designer.sql';
  if found then
    if installed <> '9306b7ffda7e95f18dbfe853f2ea29171604d41a57ece1fb86c3da4287a0dc67' then
      raise exception 'Applied migration changed: qr-payment-designer.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- qr-payment-designer.sql: source statement 2
execute $sql_53_2$insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('payment-qr-assets','payment-qr-assets',false,5242880,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types$sql_53_2$;

-- qr-payment-designer.sql: source statement 3
execute $sql_53_3$drop policy if exists payment_qr_assets_private on storage.objects$sql_53_3$;

-- qr-payment-designer.sql: source statement 4
execute $sql_53_4$create policy payment_qr_assets_private on storage.objects as restrictive for all to anon,authenticated
using(bucket_id<>'payment-qr-assets') with check(bucket_id<>'payment-qr-assets')$sql_53_4$;

-- qr-payment-designer.sql: source statement 5
execute $sql_53_5$create table if not exists public.bank_qr_designs(
 account_id uuid primary key references public.bank_accounts(id),
 tenant_id uuid not null references public.tenants(id),
 payload text not null,recipient_snapshot text not null,
 amount_satang bigint check(amount_satang between 1 and 9999999999),
 qr_type text not null default 'promptpay' check(qr_type='promptpay'),
 original_path text,logo_path text,design jsonb not null,
 version integer not null default 1,updated_at timestamptz not null default now(),
 updated_by uuid not null references auth.users(id)
)$sql_53_5$;

-- qr-payment-designer.sql: source statement 6
execute $sql_53_6$alter table public.bank_qr_designs enable row level security$sql_53_6$;

-- qr-payment-designer.sql: source statement 7
execute $sql_53_7$revoke all on public.bank_qr_designs from public,anon,authenticated$sql_53_7$;

-- qr-payment-designer.sql: source statement 8
execute $sql_53_8$grant select,insert,update on public.bank_qr_designs to service_role$sql_53_8$;

-- qr-payment-designer.sql: source statement 9
execute $sql_53_9$create or replace function public.save_bank_qr_design(p_tenant uuid,p_actor uuid,p_account uuid,p_recipient text,p_payload text,p_amount bigint,p_original text,p_logo text,p_design jsonb,p_version integer) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare account public.bank_accounts; current_version integer;
begin
 if not public.has_tenant_feature(p_tenant,'slip_auto_pilot') or not (
 exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Forbidden' using errcode='42501';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 if (select count(*) from public.bank_account_audit where tenant_id=p_tenant and actor_id=p_actor and action='qr_design' and created_at>now()-interval '1 minute')>=20 then raise exception 'Rate limit' using errcode='P0429';end if;
 select * into account from public.bank_accounts where id=p_account and tenant_id=p_tenant for share;
 if not found or not account.is_active or account.bank_code<>'PROMPTPAY' or account.account_number<>p_recipient then raise exception 'Account changed' using errcode='40001';end if;
 select version into current_version from public.bank_qr_designs where account_id=p_account and tenant_id=p_tenant;
 if coalesce(current_version,0)<>p_version then raise exception 'Design changed' using errcode='40001';end if;
 if length(p_payload) not between 20 and 1024 or jsonb_typeof(p_design)<>'object' or
 (p_original is not null and p_original not like p_tenant::text||'/'||p_account::text||'/%') or
 (p_logo is not null and p_logo not like p_tenant::text||'/'||p_account::text||'/%') then raise exception 'Invalid design' using errcode='22023';end if;
 insert into public.bank_qr_designs(account_id,tenant_id,payload,recipient_snapshot,amount_satang,original_path,logo_path,design,updated_by)
 values(p_account,p_tenant,p_payload,p_recipient,p_amount,p_original,p_logo,p_design,p_actor)
 on conflict(account_id) do update set payload=excluded.payload,recipient_snapshot=excluded.recipient_snapshot,amount_satang=excluded.amount_satang,original_path=excluded.original_path,logo_path=excluded.logo_path,design=excluded.design,version=bank_qr_designs.version+1,updated_at=now(),updated_by=p_actor;
 insert into public.bank_account_audit(tenant_id,actor_id,account_id,action,last_four)
 values(p_tenant,p_actor,p_account,'qr_design',right(p_recipient,4));
end $$$sql_53_9$;

-- qr-payment-designer.sql: source statement 10
execute $sql_53_10$revoke all on function public.save_bank_qr_design(uuid,uuid,uuid,text,text,bigint,text,text,jsonb,integer) from public,anon,authenticated$sql_53_10$;

-- qr-payment-designer.sql: source statement 11
execute $sql_53_11$grant execute on function public.save_bank_qr_design(uuid,uuid,uuid,text,text,bigint,text,text,jsonb,integer) to service_role$sql_53_11$;

-- qr-payment-designer.sql: source statement 12
execute $sql_53_12$notify pgrst,'reload schema'$sql_53_12$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('qr-payment-designer.sql','9306b7ffda7e95f18dbfe853f2ea29171604d41a57ece1fb86c3da4287a0dc67','791010165b6065afb641c311106260bb7f574a3624530ee8d9df966d2bee8cd3');
end $migration_53$;

-- 55. store-rules.sql
do $migration_54$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='store-rules.sql';
  if found then
    if installed <> '1c0cc3f48b63cf0cf733537ccc0d986d29396fe8751b4827c17286a0ea759094' then
      raise exception 'Applied migration changed: store-rules.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- store-rules.sql: source statement 2
execute $sql_54_2$alter table public.bot_settings drop constraint if exists bot_settings_ai_instructions_check$sql_54_2$;

-- store-rules.sql: source statement 3
execute $sql_54_3$alter table public.bot_settings add constraint bot_settings_ai_instructions_check check(length(ai_instructions)<=50000)$sql_54_3$;

-- store-rules.sql: source statement 4
execute $sql_54_4$create or replace function public.save_agent_prompt(p_tenant uuid,p_actor uuid,p_instructions text) returns void
language plpgsql set search_path=pg_catalog,public as $$
begin
 if not public.has_tenant_feature(p_tenant,'ai_agent')
 or not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner')
 or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Owner required' using errcode='42501';end if;
 if length(p_instructions)>50000 then raise exception 'Store rules exceed 50000 characters' using errcode='22023';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 perform set_config('snapbot.agent_actor',p_actor::text,true);
 insert into public.bot_settings(tenant_id,ai_instructions) values(p_tenant,p_instructions)
 on conflict(tenant_id) do update set ai_instructions=excluded.ai_instructions;
 insert into public.agent_control_audit(tenant_id,actor_id,event) values(p_tenant,p_actor,'prompt_saved');
end $$$sql_54_4$;

-- store-rules.sql: source statement 5
execute $sql_54_5$revoke all on function public.save_agent_prompt(uuid,uuid,text) from public,anon,authenticated$sql_54_5$;

-- store-rules.sql: source statement 6
execute $sql_54_6$grant execute on function public.save_agent_prompt(uuid,uuid,text) to service_role$sql_54_6$;

-- store-rules.sql: source statement 7
execute $sql_54_7$revoke all on function public.manage_agent_knowledge(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated,service_role$sql_54_7$;

-- store-rules.sql: source statement 8
execute $sql_54_8$notify pgrst,'reload schema'$sql_54_8$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('store-rules.sql','1c0cc3f48b63cf0cf733537ccc0d986d29396fe8751b4827c17286a0ea759094','ea6f24e091470f5d88369563d5f012c9500370aaa7536d84d3bf33c986daaee9');
end $migration_54$;

-- 56. store-rule-items.sql
do $migration_55$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='store-rule-items.sql';
  if found then
    if installed <> '6baac66282ff42d7e6b0d4018e7daaec2f1b5561e22b33c6dfce75c1f9acefe6' then
      raise exception 'Applied migration changed: store-rule-items.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- store-rule-items.sql: source statement 2
execute $sql_55_2$create or replace function public.save_store_rule_items(p_tenant uuid,p_actor uuid,p_expected text,p_instructions text)
returns void language plpgsql set search_path=pg_catalog,public as $$
declare current_rules text;doc jsonb;
begin
 if not public.has_tenant_feature(p_tenant,'ai_agent') or not(
 exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner')
 or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Owner required' using errcode='42501';end if;
 if p_instructions is null or length(p_instructions)>50000 then raise exception 'Invalid rules' using errcode='22023';end if;
 doc:=p_instructions::jsonb;
 if doc->'snapbot_store_rules' is distinct from '1'::jsonb or jsonb_typeof(doc->'rules') is distinct from 'array' then raise exception 'Invalid rules' using errcode='22023';end if;
 if jsonb_array_length(doc->'rules')>200 or exists(select 1 from jsonb_array_elements(doc->'rules') item where jsonb_typeof(item->'id') is distinct from 'string' or jsonb_typeof(item->'body') is distinct from 'string' or length(trim(item->>'body'))=0)
 or (select count(*) from jsonb_array_elements(doc->'rules'))<>(select count(distinct item->>'id') from jsonb_array_elements(doc->'rules') item) then raise exception 'Invalid rules' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(doc->'rules') item where
   item ? 'category' and (jsonb_typeof(item->'category') is distinct from 'string' or item->>'category' not in ('general','shipping','payment','promotion','returns','persona','handoff'))
   or item ? 'enabled' and jsonb_typeof(item->'enabled') is distinct from 'boolean') then raise exception 'Invalid rule category or status' using errcode='22023';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 select ai_instructions into current_rules from public.bot_settings where tenant_id=p_tenant for update;
 if coalesce(current_rules,'') is distinct from coalesce(p_expected,'') then raise exception 'Store rules changed' using errcode='40001';end if;
 perform public.save_agent_prompt(p_tenant,p_actor,p_instructions);
end $$$sql_55_2$;

-- store-rule-items.sql: source statement 3
execute $sql_55_3$revoke all on function public.save_store_rule_items(uuid,uuid,text,text) from public,anon,authenticated$sql_55_3$;

-- store-rule-items.sql: source statement 4
execute $sql_55_4$grant execute on function public.save_store_rule_items(uuid,uuid,text,text) to service_role$sql_55_4$;

-- store-rule-items.sql: source statement 5
execute $sql_55_5$notify pgrst,'reload schema'$sql_55_5$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('store-rule-items.sql','6baac66282ff42d7e6b0d4018e7daaec2f1b5561e22b33c6dfce75c1f9acefe6','7f10a22e7c4ad118a193af3e28a5105070e4eeff33b9fee5d95d836fc9664a41');
end $migration_55$;

-- 57. store-rules-validation.sql
do $migration_56$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='store-rules-validation.sql';
  if found then
    if installed <> '809110a4e553b2296de3469657cacaf441acf0ee68f6bdcfa35f87348589d034' then
      raise exception 'Applied migration changed: store-rules-validation.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- store-rules-validation.sql: source statement 2
execute $sql_56_2$create or replace function public.assert_valid_store_rules(p_instructions text) returns void
language plpgsql immutable set search_path=pg_catalog,public as $$
declare doc jsonb;item jsonb;candidate boolean;seen text[]:=array[]::text[];
 whitespace text:=U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]';
begin
 if p_instructions is null then return;end if;
 if length(p_instructions)>50000 then raise exception 'STORE_RULES_INVALID: ข้อมูลกฎยาวเกิน 50,000 ตัวอักษร' using errcode='22023';end if;
 candidate:=left(ltrim(p_instructions,E' \t\r\n'||chr(65279)),1) in ('{','[') and p_instructions ~ ('"snapbot_store_rules"'||whitespace||'*:');
 begin doc:=p_instructions::jsonb;
 exception when invalid_text_representation or numeric_value_out_of_range or untranslatable_character then
  if candidate then raise exception 'STORE_RULES_INVALID: รูปแบบข้อมูลกฎไม่สมบูรณ์' using errcode='22023';end if;
  return;
 end;
 if jsonb_typeof(doc)<>'object' or not(doc ? 'snapbot_store_rules') then
  if jsonb_typeof(doc)='array' and candidate then raise exception 'STORE_RULES_INVALID: เอกสารกฎไม่ถูกต้อง' using errcode='22023';end if;
  return;
 end if;
 if doc->'snapbot_store_rules' is distinct from '1'::jsonb or jsonb_typeof(doc->'rules') is distinct from 'array'
 or exists(select 1 from jsonb_object_keys(doc) k where k not in ('snapbot_store_rules','rules')) then raise exception 'STORE_RULES_INVALID: โครงสร้างข้อมูลกฎไม่ถูกต้อง' using errcode='22023';end if;
 if jsonb_array_length(doc->'rules')>200 then raise exception 'STORE_RULES_INVALID: เพิ่มกฎได้สูงสุด 200 ข้อ' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(doc->'rules') loop
  if jsonb_typeof(item) is distinct from 'object' then raise exception 'STORE_RULES_INVALID: รายการกฎไม่ถูกต้อง' using errcode='22023';end if;
  if exists(select 1 from jsonb_object_keys(item) k where k not in ('id','body','category','enabled'))
  or jsonb_typeof(item->'id') is distinct from 'string' or length(item->>'id')>128 or regexp_replace(item->>'id',whitespace,'','g')=''
  or item->>'id' ~ U&'[\0001-\001F\007F]' or jsonb_typeof(item->'body') is distinct from 'string' or regexp_replace(item->>'body',whitespace,'','g')=''
  or (item ? 'category' and (jsonb_typeof(item->'category') is distinct from 'string' or item->>'category' not in ('general','shipping','payment','promotion','returns','persona','handoff')))
  or (item ? 'enabled' and jsonb_typeof(item->'enabled') is distinct from 'boolean') then raise exception 'STORE_RULES_INVALID: รายละเอียด หมวดหมู่ หรือสถานะกฎไม่ถูกต้อง' using errcode='22023';end if;
  if item->>'id'=any(seen) then raise exception 'STORE_RULES_INVALID: พบรหัสกฎซ้ำ' using errcode='22023';end if;
  seen:=array_append(seen,item->>'id');
 end loop;
end $$$sql_56_2$;

-- store-rules-validation.sql: source statement 3
execute $sql_56_3$create or replace function public.guard_store_rules_validation() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare revision integer;actor uuid;
begin
 if tg_op='INSERT' then perform public.assert_valid_store_rules(new.ai_instructions);
 elsif new.ai_instructions is distinct from old.ai_instructions then
  perform public.assert_valid_store_rules(new.ai_instructions);
  if old.ai_instructions is not null and not exists(select 1 from public.agent_prompt_versions where tenant_id=old.tenant_id and instructions is not distinct from old.ai_instructions) then
   actor:=coalesce(auth.uid(),nullif(current_setting('snapbot.agent_actor',true),'')::uuid);
   select coalesce(max(version),0)+1 into revision from public.agent_prompt_versions where tenant_id=old.tenant_id;
   insert into public.agent_prompt_versions(tenant_id,version,instructions,actor_id) values(old.tenant_id,revision,old.ai_instructions,actor);
  end if;
 end if;
 return new;
end $$$sql_56_3$;

-- store-rules-validation.sql: source statement 4
execute $sql_56_4$drop trigger if exists bot_settings_store_rules_validation on public.bot_settings$sql_56_4$;

-- store-rules-validation.sql: source statement 5
execute $sql_56_5$create trigger bot_settings_store_rules_validation before insert or update of ai_instructions on public.bot_settings for each row execute function public.guard_store_rules_validation()$sql_56_5$;

-- store-rules-validation.sql: source statement 6
execute $sql_56_6$create or replace function public.save_validated_store_rules(p_tenant uuid,p_actor uuid,p_expected text,p_instructions text) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare current_rules text;
begin
 if not public.has_tenant_feature(p_tenant,'ai_agent') or not(
  exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner')
  or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Owner required' using errcode='42501';end if;
 perform public.assert_valid_store_rules(p_instructions);
 perform 1 from public.tenants where id=p_tenant for update;
 select ai_instructions into current_rules from public.bot_settings where tenant_id=p_tenant for update;
 if coalesce(current_rules,'') is distinct from coalesce(p_expected,'') then raise exception 'Store rules changed' using errcode='40001';end if;
 perform public.save_agent_prompt(p_tenant,p_actor,p_instructions);
end $$$sql_56_6$;

-- store-rules-validation.sql: source statement 7
execute $sql_56_7$revoke all on function public.save_validated_store_rules(uuid,uuid,text,text) from public,anon,authenticated$sql_56_7$;

-- store-rules-validation.sql: source statement 8
execute $sql_56_8$grant execute on function public.save_validated_store_rules(uuid,uuid,text,text) to service_role$sql_56_8$;

-- store-rules-validation.sql: source statement 9
execute $sql_56_9$revoke all on function public.assert_valid_store_rules(text) from public,anon$sql_56_9$;

-- store-rules-validation.sql: source statement 10
execute $sql_56_10$grant execute on function public.assert_valid_store_rules(text) to authenticated,service_role$sql_56_10$;

-- store-rules-validation.sql: source statement 11
execute $sql_56_11$revoke all on function public.guard_store_rules_validation() from public,anon,authenticated,service_role$sql_56_11$;

-- store-rules-validation.sql: source statement 12
execute $sql_56_12$notify pgrst,'reload schema'$sql_56_12$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('store-rules-validation.sql','809110a4e553b2296de3469657cacaf441acf0ee68f6bdcfa35f87348589d034','f8cbdf12cd3851025951edbf50d831548032211d73e43f12b011c1aa51df4883');
end $migration_56$;

-- 58. facebook-webhook-queue.sql
do $migration_57$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='facebook-webhook-queue.sql';
  if found then
    if installed <> '2ee3ebefcea5c085891915b27408e9ebb4fc599f73233b7888507e326b89630d' then
      raise exception 'Applied migration changed: facebook-webhook-queue.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- facebook-webhook-queue.sql: source statement 2
execute $sql_57_2$alter table public.customers add column if not exists last_interaction_at timestamptz$sql_57_2$;

-- facebook-webhook-queue.sql: source statement 3
execute $sql_57_3$alter table public.customers add column if not exists window_expires_at timestamptz$sql_57_3$;

-- facebook-webhook-queue.sql: source statement 4
execute $sql_57_4$create table if not exists public.facebook_webhook_payloads (
 id uuid primary key default gen_random_uuid(), payload_sha256 text not null unique check(payload_sha256 ~ '^[a-f0-9]{64}$'),
 raw_payload text not null check(octet_length(raw_payload)<=2097152), received_at timestamptz not null default clock_timestamp(),
 last_received_at timestamptz not null default clock_timestamp(), delivery_count integer not null default 1
)$sql_57_4$;

-- facebook-webhook-queue.sql: source statement 5
execute $sql_57_5$create table if not exists public.facebook_webhook_events (
 id uuid primary key default gen_random_uuid(), payload_id uuid not null references public.facebook_webhook_payloads(id),
 sequence bigint generated always as identity unique, page_id text not null, event_key text not null, ordering_key text not null,
 kind text not null check(kind in ('message','change')), payload jsonb not null,
 status text not null default 'pending' check(status in ('pending','processing','completed','dead','requires_review')),
 attempts integer not null default 0, available_at timestamptz not null default clock_timestamp(),
 claim_token uuid, lease_until timestamptz, last_error text, created_at timestamptz not null default clock_timestamp(), completed_at timestamptz,
 unique(page_id,event_key)
)$sql_57_5$;

-- facebook-webhook-queue.sql: source statement 6
execute $sql_57_6$create index if not exists facebook_webhook_due on public.facebook_webhook_events(available_at,sequence) where status='pending'$sql_57_6$;

-- facebook-webhook-queue.sql: source statement 7
execute $sql_57_7$create index if not exists facebook_webhook_ordering on public.facebook_webhook_events(page_id,ordering_key,sequence) where status in ('pending','processing','requires_review','dead')$sql_57_7$;

-- facebook-webhook-queue.sql: source statement 8
execute $sql_57_8$create index if not exists facebook_webhook_leases on public.facebook_webhook_events(lease_until) where status='processing'$sql_57_8$;

-- facebook-webhook-queue.sql: source statement 9
execute $sql_57_9$create table if not exists public.facebook_webhook_steps (
 event_id uuid not null references public.facebook_webhook_events(id), name text not null check(length(name) between 1 and 120),
 status text not null check(status in ('started','completed')), result jsonb, started_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz, primary key(event_id,name)
)$sql_57_9$;

-- facebook-webhook-queue.sql: source statement 10
execute $sql_57_10$alter table public.facebook_webhook_payloads enable row level security$sql_57_10$;

-- facebook-webhook-queue.sql: source statement 11
execute $sql_57_11$alter table public.facebook_webhook_events enable row level security$sql_57_11$;

-- facebook-webhook-queue.sql: source statement 12
execute $sql_57_12$alter table public.facebook_webhook_steps enable row level security$sql_57_12$;

-- facebook-webhook-queue.sql: source statement 13
execute $sql_57_13$revoke all on public.facebook_webhook_payloads,public.facebook_webhook_events,public.facebook_webhook_steps from public,anon,authenticated$sql_57_13$;

-- facebook-webhook-queue.sql: source statement 14
execute $sql_57_14$grant select,insert,update,delete on public.facebook_webhook_payloads,public.facebook_webhook_events,public.facebook_webhook_steps to service_role$sql_57_14$;

-- facebook-webhook-queue.sql: source statement 15
execute $sql_57_15$grant usage,select on sequence public.facebook_webhook_events_sequence_seq to service_role$sql_57_15$;

-- facebook-webhook-queue.sql: source statement 16
execute $sql_57_16$create or replace function public.enqueue_facebook_webhook(p_raw text,p_hash text,p_events jsonb) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare receipt uuid; item jsonb; accepted integer:=0; affected integer;
begin
 if p_raw is null or octet_length(p_raw)>2097152 or p_hash is null or p_hash !~ '^[a-f0-9]{64}$'
 or (p_raw::jsonb)->>'object' is distinct from 'page' or jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events)>1000 then
  raise exception 'Invalid webhook envelope' using errcode='22023';
 end if;
 insert into public.facebook_webhook_payloads(raw_payload,payload_sha256) values(p_raw,p_hash)
 on conflict(payload_sha256) do update set last_received_at=clock_timestamp(),delivery_count=facebook_webhook_payloads.delivery_count+1 returning id into receipt;
 for item in select value from jsonb_array_elements(p_events) loop
  if item->>'pageId' is null or item->>'pageId' !~ '^\d{1,64}$' or item->>'orderingKey' is null or item->>'orderingKey' !~ '^\d{1,64}$'
  or item->>'eventKey' is null or item->>'eventKey' !~ '^[a-f0-9]{64}$' or item->>'kind' is null or item->>'kind' not in ('message','change')
  or jsonb_typeof(item->'payload') is distinct from 'object' then raise exception 'Invalid webhook event' using errcode='22023';end if;
  insert into public.facebook_webhook_events(payload_id,page_id,event_key,ordering_key,kind,payload)
  values(receipt,item->>'pageId',item->>'eventKey',item->>'orderingKey',item->>'kind',item->'payload') on conflict(page_id,event_key) do nothing;
  get diagnostics affected=row_count;accepted:=accepted+affected;
 end loop;
 return jsonb_build_object('id',receipt,'accepted',accepted);
end $$$sql_57_16$;

-- facebook-webhook-queue.sql: source statement 17
begin
execute $sql_57_17$create or replace function public.claim_facebook_webhook(p_lease_seconds integer default 120) returns setof public.facebook_webhook_events
language plpgsql set search_path=pg_catalog,public as $$
begin
 -- A side effect whose outcome was not committed is never automatically repeated.
 update public.facebook_webhook_events e set status=case
  when e.kind='message' and exists(select 1 from public.facebook_webhook_steps record where record.event_id=e.id and record.name='record' and record.status='completed' and record.result->>'id' is not null and coalesce(record.result->>'ignored','false')<>'true') then 'completed'
  when exists(select 1 from public.facebook_webhook_steps s where s.event_id=e.id and s.status='started') then 'requires_review'
  when e.attempts>=8 then 'dead' else 'pending' end,
  last_error='WORKER_LEASE_EXPIRED',claim_token=null,lease_until=null,
  completed_at=case when e.kind='message' and exists(select 1 from public.facebook_webhook_steps record where record.event_id=e.id and record.name='record' and record.status='completed' and record.result->>'id' is not null and coalesce(record.result->>'ignored','false')<>'true') then clock_timestamp() else e.completed_at end,
  available_at=clock_timestamp()+make_interval(secs=>least(3600,5*power(2,least(e.attempts-1,10))::integer))
 where e.status='processing' and e.lease_until<clock_timestamp();
 -- Invalid/exhausted pending jobs must not remain ordering barriers.
 update public.facebook_webhook_events set status='dead',last_error=coalesce(last_error,'RETRY_LIMIT_REACHED') where status='pending' and attempts>=8;
 return query with candidate as (
  select e.id from public.facebook_webhook_events e where e.status='pending' and e.available_at<=clock_timestamp() and e.attempts<8
  and not exists(select 1 from public.facebook_webhook_events older where older.page_id=e.page_id and older.ordering_key=e.ordering_key
   and older.sequence<e.sequence and older.status in ('pending','processing'))
  order by e.sequence limit 1 for update skip locked
 ) update public.facebook_webhook_events e set status='processing',attempts=e.attempts+1,claim_token=gen_random_uuid(),
 lease_until=clock_timestamp()+make_interval(secs=>least(300,greatest(30,p_lease_seconds)))
 from candidate where e.id=candidate.id returning e.*;
end $$$sql_57_17$;
exception when invalid_function_definition then
  -- A newer signature of claim_facebook_webhook(integer) is already installed. Its final definition below is mandatory.
  null;
end;

-- facebook-webhook-queue.sql: source statement 18
execute $sql_57_18$create or replace function public.heartbeat_facebook_webhook(p_event uuid,p_claim uuid) returns boolean
language plpgsql set search_path=pg_catalog,public as $$
begin
 update public.facebook_webhook_events set lease_until=clock_timestamp()+interval '120 seconds'
 where id=p_event and claim_token=p_claim and status='processing' and lease_until>clock_timestamp();return found;
end $$$sql_57_18$;

-- facebook-webhook-queue.sql: source statement 19
execute $sql_57_19$create or replace function public.begin_facebook_webhook_step(p_event uuid,p_claim uuid,p_name text) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare step public.facebook_webhook_steps;
begin
 perform 1 from public.facebook_webhook_events where id=p_event and claim_token=p_claim and status='processing' and lease_until>clock_timestamp() for update;
 if not found then raise exception 'Webhook lease lost' using errcode='40001';end if;
 select * into step from public.facebook_webhook_steps where event_id=p_event and name=p_name;
 if found then return jsonb_build_object('status',step.status,'result',step.result);end if;
 insert into public.facebook_webhook_steps(event_id,name,status) values(p_event,p_name,'started');
 return jsonb_build_object('status','new');
end $$$sql_57_19$;

-- facebook-webhook-queue.sql: source statement 20
execute $sql_57_20$create or replace function public.complete_facebook_webhook_step(p_event uuid,p_claim uuid,p_name text,p_result jsonb) returns boolean
language plpgsql set search_path=pg_catalog,public as $$
begin
 perform 1 from public.facebook_webhook_events where id=p_event and claim_token=p_claim and status='processing' and lease_until>clock_timestamp() for update;
 if not found then return false;end if;
 update public.facebook_webhook_steps set status='completed',result=p_result,completed_at=clock_timestamp() where event_id=p_event and name=p_name and status='started';return found;
end $$$sql_57_20$;

-- facebook-webhook-queue.sql: source statement 21
begin
execute $sql_57_21$create or replace function public.finish_facebook_webhook(p_event uuid,p_claim uuid,p_outcome text,p_error text default null) returns text
language plpgsql set search_path=pg_catalog,public as $$
declare e public.facebook_webhook_events;next_state text;
begin
 select * into e from public.facebook_webhook_events where id=p_event and claim_token=p_claim and status='processing' and lease_until>clock_timestamp() for update;
 if not found then return null;end if;
 if p_outcome not in ('completed','retry','requires_review') or p_outcome is null then raise exception 'Invalid outcome' using errcode='22023';end if;
 next_state:=case when p_outcome='completed' and e.kind='message' and exists(select 1 from public.facebook_webhook_steps record where record.event_id=e.id and record.name='record' and record.status='completed' and record.result->>'id' is not null and coalesce(record.result->>'ignored','false')<>'true') then 'completed'
  when exists(select 1 from public.facebook_webhook_steps where event_id=e.id and status='started') then 'requires_review'
  when p_outcome='retry' and e.attempts>=8 then 'dead' when p_outcome='retry' then 'pending' else p_outcome end;
 update public.facebook_webhook_events set status=next_state,last_error=left(p_error,160),claim_token=null,lease_until=null,
 available_at=case when next_state='pending' then clock_timestamp()+make_interval(secs=>least(3600,5*power(2,least(e.attempts-1,10))::integer))+random()*interval '2 seconds' else available_at end,
 completed_at=case when next_state='completed' then clock_timestamp() else null end where id=e.id;
 return next_state;
end $$$sql_57_21$;
exception when invalid_function_definition then
  -- A newer signature of finish_facebook_webhook(uuid,uuid,text,text) is already installed. Its final definition below is mandatory.
  null;
end;

-- facebook-webhook-queue.sql: source statement 22
begin
execute $sql_57_22$create or replace function public.facebook_inbound_message_at(p_payload jsonb,p_page text,p_received_at timestamptz) returns timestamptz
language plpgsql immutable set search_path=pg_catalog,public as $$
declare m jsonb; flag text; has_text boolean; has_media boolean; milliseconds numeric;
 whitespace text:=U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]';
begin
 if jsonb_typeof(p_payload) is distinct from 'object' or p_page is null or p_page !~ '^\d{1,64}$'
 or p_received_at is null or not isfinite(p_received_at) then return null;end if;
 if p_payload ?| array['delivery','read','postback','optin','referral','account_linking','reaction','message_reaction','message_edit','pass_thread_control','take_thread_control','request_thread_control'] then return null;end if;
 if jsonb_typeof(p_payload->'sender'->'id') is distinct from 'string' or p_payload->'sender'->>'id' !~ '^\d{1,64}$'
 or p_payload->'sender'->>'id'=p_page or jsonb_typeof(p_payload->'recipient'->'id') is distinct from 'string'
 or p_payload->'recipient'->>'id' is distinct from p_page then return null;end if;
 m:=p_payload->'message';
 if jsonb_typeof(m) is distinct from 'object' then return null;end if;
 foreach flag in array array['is_echo','is_deleted','is_unsupported'] loop
  if m ? flag and m->flag is distinct from 'false'::jsonb then return null;end if;
 end loop;
 if jsonb_typeof(m->'mid') is distinct from 'string' or regexp_replace(m->>'mid',whitespace,'','g')='' or length(m->>'mid')>512 then return null;end if;
 has_text:=jsonb_typeof(m->'text')='string' and regexp_replace(m->>'text',whitespace,'','g')<>'';
 select exists(select 1 from jsonb_array_elements(case when jsonb_typeof(m->'attachments')='array' then m->'attachments' else '[]'::jsonb end) a
  where jsonb_typeof(a)='object' and a->>'type' in ('image','audio','video','file','location','fallback') and jsonb_typeof(a->'payload')='object') into has_media;
 if not coalesce(has_text,false) and not has_media then return null;end if;
 if jsonb_typeof(p_payload->'timestamp') is distinct from 'number' then return null;end if;
 milliseconds:=(p_payload->>'timestamp')::numeric;
 if milliseconds<=0 or milliseconds<>trunc(milliseconds) or milliseconds>9007199254740991
 or milliseconds>floor(extract(epoch from p_received_at)*1000) then return null;end if;
 return to_timestamp(floor(milliseconds/1000)::double precision)+(mod(milliseconds,1000)::integer*interval '1 millisecond');
end $$$sql_57_22$;
exception when invalid_function_definition then
  -- A newer signature of facebook_inbound_message_at(jsonb,text,timestamptz) is already installed. Its final definition below is mandatory.
  null;
end;

-- facebook-webhook-queue.sql: source statement 23
execute $sql_57_23$revoke all on function public.facebook_inbound_message_at(jsonb,text,timestamptz) from public,anon,authenticated$sql_57_23$;

-- facebook-webhook-queue.sql: source statement 24
execute $sql_57_24$grant execute on function public.facebook_inbound_message_at(jsonb,text,timestamptz) to service_role$sql_57_24$;

-- facebook-webhook-queue.sql: source statement 25
begin
execute $sql_57_25$create or replace function public.inbox_incoming_message() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.sender='customer' then
  -- Facebook timestamps are applied after a real insert by persist_facebook_webhook_record.
  update public.customers set inbound_seq=inbound_seq+1,conversation_status='open',conversation_version=conversation_version+1,
   last_message_at=case when platform='facebook' then last_message_at else greatest(coalesce(last_message_at,new.created_at),new.created_at) end
   where id=new.customer_id returning inbound_seq into new.inbound_seq;
 end if;
 return new;
end $$$sql_57_25$;
exception when invalid_function_definition then
  -- A newer signature of inbox_incoming_message() is already installed. Its final definition below is mandatory.
  null;
end;

-- facebook-webhook-queue.sql: source statement 26
begin
execute $sql_57_26$create or replace function public.persist_facebook_webhook_record(p_event uuid,p_claim uuid,p_tenant uuid) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare e public.facebook_webhook_events; prior jsonb; v jsonb; c public.customers; record_id uuid; result jsonb; event_time timestamptz; duplicate boolean;
begin
 select * into e from public.facebook_webhook_events where id=p_event and claim_token=p_claim and status='processing' and lease_until>clock_timestamp() for update;
 if not found then raise exception 'Webhook lease lost' using errcode='40001';end if;
 if e.kind='message' then
  event_time:=public.facebook_inbound_message_at(e.payload,e.page_id,e.created_at);
  if event_time is null then
   result:=jsonb_build_object('id',null,'tenantId',p_tenant,'duplicate',false,'ignored',true,'reason','INELIGIBLE_INBOUND_MESSAGE','customer',null);
   insert into public.facebook_webhook_steps(event_id,name,status,result,completed_at) values(e.id,'record','completed',result,clock_timestamp()) on conflict(event_id,name) do nothing;
   return result;
  end if;
 end if;
 select s.result into prior from public.facebook_webhook_steps s where s.event_id=e.id and s.name='record' and s.status='completed';
 if found then
  if prior->>'tenantId' is distinct from p_tenant::text then raise exception 'Page tenant changed' using errcode='40001';end if;
  return prior;
 end if;
 if p_tenant is not null and not exists(select 1 from public.tenants where id=p_tenant and page_id=e.page_id and is_active) then raise exception 'Page tenant changed' using errcode='40001';end if;
 v:=case when e.kind='message' then e.payload else e.payload->'value' end;
 if e.kind='message' and exists(select 1 from public.messages where external_id=v->'message'->>'mid') then
  result:=jsonb_build_object('id',null,'tenantId',p_tenant,'duplicate',true,'customer',null);
  insert into public.facebook_webhook_steps(event_id,name,status,result,completed_at) values(e.id,'record','completed',result,clock_timestamp());
  return result;
 end if;
 if e.kind='message' or v->'from'->>'id' is not null then
  insert into public.customers(platform,platform_user_id,tenant_id)
  values('facebook',case when e.kind='message' then v->'sender'->>'id' else v->'from'->>'id' end,p_tenant)
  on conflict(platform,platform_user_id) do update set tenant_id=coalesce(customers.tenant_id,excluded.tenant_id)
  returning * into c;
  if c.tenant_id is distinct from p_tenant then raise exception 'Customer tenant mismatch' using errcode='42501';end if;
  if e.kind='change' and nullif(trim(v->'from'->>'name'),'') is not null then
   update public.customers set display_name=v->'from'->>'name' where id=c.id;
  end if;
 end if;
 if e.kind='message' then
  insert into public.messages(customer_id,external_id,sender,body,attachments,created_at)
  values(c.id,v->'message'->>'mid','customer',v->'message'->>'text',coalesce(v->'message'->'attachments','[]'::jsonb),event_time)
  on conflict(external_id) do nothing returning id into record_id;
  duplicate:=record_id is null;
  if not duplicate then
   update public.customers set
    last_message_at=greatest(coalesce(last_message_at,event_time),event_time),
    last_interaction_at=greatest(coalesce(last_interaction_at,event_time),event_time),
    window_expires_at=greatest(coalesce(last_interaction_at,event_time),event_time)+interval '86400 seconds'
   where id=c.id;
  end if;
 else
  insert into public.comments(customer_id,tenant_id,external_id,post_id,author_name,body)
  values(c.id,p_tenant,v->>'comment_id',v->>'post_id',v->'from'->>'name',v->>'message')
  on conflict(external_id) do nothing returning id into record_id;
  duplicate:=record_id is null;
 end if;
 result:=jsonb_build_object('id',record_id,'tenantId',p_tenant,'duplicate',duplicate,'customer',case when c.id is null then null else jsonb_build_object('id',c.id,'display_name',c.display_name,'bot_enabled',c.bot_enabled) end);
 insert into public.facebook_webhook_steps(event_id,name,status,result,completed_at) values(e.id,'record','completed',result,clock_timestamp());
 return result;
end $$$sql_57_26$;
exception when invalid_function_definition then
  -- A newer signature of persist_facebook_webhook_record(uuid,uuid,uuid) is already installed. Its final definition below is mandatory.
  null;
end;

-- facebook-webhook-queue.sql: source statement 27
execute $sql_57_27$revoke all on function public.persist_facebook_webhook_record(uuid,uuid,uuid) from public,anon,authenticated$sql_57_27$;

-- facebook-webhook-queue.sql: source statement 28
execute $sql_57_28$grant execute on function public.persist_facebook_webhook_record(uuid,uuid,uuid) to service_role$sql_57_28$;

-- facebook-webhook-queue.sql: source statement 29
execute $sql_57_29$revoke all on function public.enqueue_facebook_webhook(text,text,jsonb),public.claim_facebook_webhook(integer),public.heartbeat_facebook_webhook(uuid,uuid),public.begin_facebook_webhook_step(uuid,uuid,text),public.complete_facebook_webhook_step(uuid,uuid,text,jsonb),public.finish_facebook_webhook(uuid,uuid,text,text) from public,anon,authenticated$sql_57_29$;

-- facebook-webhook-queue.sql: source statement 30
execute $sql_57_30$grant execute on function public.enqueue_facebook_webhook(text,text,jsonb),public.claim_facebook_webhook(integer),public.heartbeat_facebook_webhook(uuid,uuid),public.begin_facebook_webhook_step(uuid,uuid,text),public.complete_facebook_webhook_step(uuid,uuid,text,jsonb),public.finish_facebook_webhook(uuid,uuid,text,text) to service_role$sql_57_30$;

-- facebook-webhook-queue.sql: source statement 31
execute $sql_57_31$notify pgrst,'reload schema'$sql_57_31$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('facebook-webhook-queue.sql','2ee3ebefcea5c085891915b27408e9ebb4fc599f73233b7888507e326b89630d','7e67011b3489c011639ea3f4f800fa6ac4825670f76f04fca4e0f7fddb3c641e');
end $migration_57$;

-- 59. facebook-webhook-nonblocking.sql
do $migration_58$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='facebook-webhook-nonblocking.sql';
  if found then
    if installed <> '56d60019b21e77c80f8e4ba3160b0ba1e9fc74b80fface5e8bf20650d437c7f2' then
      raise exception 'Applied migration changed: facebook-webhook-nonblocking.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- facebook-webhook-nonblocking.sql: source statement 2
execute $sql_58_2$create or replace function public.claim_facebook_webhook(p_lease_seconds integer default 120) returns setof public.facebook_webhook_events
language plpgsql set search_path=pg_catalog,public as $$
begin
 -- A side effect whose outcome was not committed is never automatically repeated.
 update public.facebook_webhook_events e set status=case
  when e.kind='message' and exists(select 1 from public.facebook_webhook_steps record where record.event_id=e.id and record.name='record' and record.status='completed' and record.result->>'id' is not null and coalesce(record.result->>'ignored','false')<>'true') then 'completed'
  when exists(select 1 from public.facebook_webhook_steps s where s.event_id=e.id and s.status='started') then 'requires_review'
  when e.attempts>=8 then 'dead' else 'pending' end,
  last_error='WORKER_LEASE_EXPIRED',claim_token=null,lease_until=null,
  completed_at=case when e.kind='message' and exists(select 1 from public.facebook_webhook_steps record where record.event_id=e.id and record.name='record' and record.status='completed' and record.result->>'id' is not null and coalesce(record.result->>'ignored','false')<>'true') then clock_timestamp() else e.completed_at end,
  available_at=clock_timestamp()+make_interval(secs=>least(3600,5*power(2,least(e.attempts-1,10))::integer))
 where e.status='processing' and e.lease_until<clock_timestamp();
 -- Invalid/exhausted pending jobs must not remain ordering barriers.
 update public.facebook_webhook_events set status='dead',last_error=coalesce(last_error,'RETRY_LIMIT_REACHED') where status='pending' and attempts>=8;
 return query with candidate as (
  select e.id from public.facebook_webhook_events e where e.status='pending' and e.available_at<=clock_timestamp() and e.attempts<8
  and not exists(select 1 from public.facebook_webhook_events older where older.page_id=e.page_id and older.ordering_key=e.ordering_key
   and older.sequence<e.sequence and older.status in ('pending','processing'))
  order by e.sequence limit 1 for update skip locked
 ) update public.facebook_webhook_events e set status='processing',attempts=e.attempts+1,claim_token=gen_random_uuid(),
 lease_until=clock_timestamp()+make_interval(secs=>least(300,greatest(30,p_lease_seconds)))
 from candidate where e.id=candidate.id returning e.*;
end $$$sql_58_2$;

-- facebook-webhook-nonblocking.sql: source statement 3
execute $sql_58_3$create or replace function public.finish_facebook_webhook(p_event uuid,p_claim uuid,p_outcome text,p_error text default null) returns text
language plpgsql set search_path=pg_catalog,public as $$
declare e public.facebook_webhook_events;next_state text;
begin
 select * into e from public.facebook_webhook_events where id=p_event and claim_token=p_claim and status='processing' and lease_until>clock_timestamp() for update;
 if not found then return null;end if;
 if p_outcome not in ('completed','retry','requires_review') or p_outcome is null then raise exception 'Invalid outcome' using errcode='22023';end if;
 next_state:=case when p_outcome='completed' and e.kind='message' and exists(select 1 from public.facebook_webhook_steps record where record.event_id=e.id and record.name='record' and record.status='completed' and record.result->>'id' is not null and coalesce(record.result->>'ignored','false')<>'true') then 'completed'
  when exists(select 1 from public.facebook_webhook_steps where event_id=e.id and status='started') then 'requires_review'
  when p_outcome='retry' and e.attempts>=8 then 'dead' when p_outcome='retry' then 'pending' else p_outcome end;
 update public.facebook_webhook_events set status=next_state,last_error=left(p_error,160),claim_token=null,lease_until=null,
 available_at=case when next_state='pending' then clock_timestamp()+make_interval(secs=>least(3600,5*power(2,least(e.attempts-1,10))::integer))+random()*interval '2 seconds' else available_at end,
 completed_at=case when next_state='completed' then clock_timestamp() else null end where id=e.id;
 return next_state;
end $$$sql_58_3$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('facebook-webhook-nonblocking.sql','56d60019b21e77c80f8e4ba3160b0ba1e9fc74b80fface5e8bf20650d437c7f2','0cfe5319ef9b061c353b80a57463e06e1a97ff1424be84ecefb4a7ecb10baf4d');
end $migration_58$;

-- 60. facebook-message-window.sql
do $migration_59$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='facebook-message-window.sql';
  if found then
    if installed <> '84c90a8b951956c4a63a2d15f44ab8ed4ff6c9646ba45f734f1e56f24f3113bc' then
      raise exception 'Applied migration changed: facebook-message-window.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- facebook-message-window.sql: source statement 2
execute $sql_59_2$alter table public.customers add column if not exists last_interaction_at timestamptz$sql_59_2$;

-- facebook-message-window.sql: source statement 3
execute $sql_59_3$alter table public.customers add column if not exists window_expires_at timestamptz$sql_59_3$;

-- facebook-message-window.sql: source statement 4
execute $sql_59_4$create or replace function public.facebook_inbound_message_at(p_payload jsonb,p_page text,p_received_at timestamptz) returns timestamptz
language plpgsql immutable set search_path=pg_catalog,public as $$
declare m jsonb; flag text; has_text boolean; has_media boolean; milliseconds numeric;
 whitespace text:=U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]';
begin
 if jsonb_typeof(p_payload) is distinct from 'object' or p_page is null or p_page !~ '^\d{1,64}$'
 or p_received_at is null or not isfinite(p_received_at) then return null;end if;
 if p_payload ?| array['delivery','read','postback','optin','referral','account_linking','reaction','message_reaction','message_edit','pass_thread_control','take_thread_control','request_thread_control'] then return null;end if;
 if jsonb_typeof(p_payload->'sender'->'id') is distinct from 'string' or p_payload->'sender'->>'id' !~ '^\d{1,64}$'
 or p_payload->'sender'->>'id'=p_page or jsonb_typeof(p_payload->'recipient'->'id') is distinct from 'string'
 or p_payload->'recipient'->>'id' is distinct from p_page then return null;end if;
 m:=p_payload->'message';
 if jsonb_typeof(m) is distinct from 'object' then return null;end if;
 foreach flag in array array['is_echo','is_deleted','is_unsupported'] loop
  if m ? flag and m->flag is distinct from 'false'::jsonb then return null;end if;
 end loop;
 if jsonb_typeof(m->'mid') is distinct from 'string' or regexp_replace(m->>'mid',whitespace,'','g')='' or length(m->>'mid')>512 then return null;end if;
 has_text:=jsonb_typeof(m->'text')='string' and regexp_replace(m->>'text',whitespace,'','g')<>'';
 select exists(select 1 from jsonb_array_elements(case when jsonb_typeof(m->'attachments')='array' then m->'attachments' else '[]'::jsonb end) a
  where jsonb_typeof(a)='object' and a->>'type' in ('image','audio','video','file','location','fallback') and jsonb_typeof(a->'payload')='object') into has_media;
 if not coalesce(has_text,false) and not has_media then return null;end if;
 if jsonb_typeof(p_payload->'timestamp') is distinct from 'number' then return null;end if;
 milliseconds:=(p_payload->>'timestamp')::numeric;
 if milliseconds<=0 or milliseconds<>trunc(milliseconds) or milliseconds>9007199254740991
 or milliseconds>floor(extract(epoch from p_received_at)*1000) then return null;end if;
 return to_timestamp(floor(milliseconds/1000)::double precision)+(mod(milliseconds,1000)::integer*interval '1 millisecond');
end $$$sql_59_4$;

-- facebook-message-window.sql: source statement 5
execute $sql_59_5$revoke all on function public.facebook_inbound_message_at(jsonb,text,timestamptz) from public,anon,authenticated$sql_59_5$;

-- facebook-message-window.sql: source statement 6
execute $sql_59_6$grant execute on function public.facebook_inbound_message_at(jsonb,text,timestamptz) to service_role$sql_59_6$;

-- facebook-message-window.sql: source statement 7
execute $sql_59_7$create or replace function public.inbox_incoming_message() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.sender='customer' then
  -- Facebook timestamps are applied after a real insert by persist_facebook_webhook_record.
  update public.customers set inbound_seq=inbound_seq+1,conversation_status='open',conversation_version=conversation_version+1,
   last_message_at=case when platform='facebook' then last_message_at else greatest(coalesce(last_message_at,new.created_at),new.created_at) end
   where id=new.customer_id returning inbound_seq into new.inbound_seq;
 end if;
 return new;
end $$$sql_59_7$;

-- facebook-message-window.sql: source statement 8
execute $sql_59_8$create or replace function public.persist_facebook_webhook_record(p_event uuid,p_claim uuid,p_tenant uuid) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare e public.facebook_webhook_events; prior jsonb; v jsonb; c public.customers; record_id uuid; result jsonb; event_time timestamptz; duplicate boolean;
begin
 select * into e from public.facebook_webhook_events where id=p_event and claim_token=p_claim and status='processing' and lease_until>clock_timestamp() for update;
 if not found then raise exception 'Webhook lease lost' using errcode='40001';end if;
 if e.kind='message' then
  event_time:=public.facebook_inbound_message_at(e.payload,e.page_id,e.created_at);
  if event_time is null then
   result:=jsonb_build_object('id',null,'tenantId',p_tenant,'duplicate',false,'ignored',true,'reason','INELIGIBLE_INBOUND_MESSAGE','customer',null);
   insert into public.facebook_webhook_steps(event_id,name,status,result,completed_at) values(e.id,'record','completed',result,clock_timestamp()) on conflict(event_id,name) do nothing;
   return result;
  end if;
 end if;
 select s.result into prior from public.facebook_webhook_steps s where s.event_id=e.id and s.name='record' and s.status='completed';
 if found then
  if prior->>'tenantId' is distinct from p_tenant::text then raise exception 'Page tenant changed' using errcode='40001';end if;
  return prior;
 end if;
 if p_tenant is not null and not exists(select 1 from public.tenants where id=p_tenant and page_id=e.page_id and is_active) then raise exception 'Page tenant changed' using errcode='40001';end if;
 v:=case when e.kind='message' then e.payload else e.payload->'value' end;
 if e.kind='message' and exists(select 1 from public.messages where external_id=v->'message'->>'mid') then
  result:=jsonb_build_object('id',null,'tenantId',p_tenant,'duplicate',true,'customer',null);
  insert into public.facebook_webhook_steps(event_id,name,status,result,completed_at) values(e.id,'record','completed',result,clock_timestamp());
  return result;
 end if;
 if e.kind='message' or v->'from'->>'id' is not null then
  insert into public.customers(platform,platform_user_id,tenant_id)
  values('facebook',case when e.kind='message' then v->'sender'->>'id' else v->'from'->>'id' end,p_tenant)
  on conflict(platform,platform_user_id) do update set tenant_id=coalesce(customers.tenant_id,excluded.tenant_id)
  returning * into c;
  if c.tenant_id is distinct from p_tenant then raise exception 'Customer tenant mismatch' using errcode='42501';end if;
  if e.kind='change' and nullif(trim(v->'from'->>'name'),'') is not null then
   update public.customers set display_name=v->'from'->>'name' where id=c.id;
  end if;
 end if;
 if e.kind='message' then
  insert into public.messages(customer_id,external_id,sender,body,attachments,created_at)
  values(c.id,v->'message'->>'mid','customer',v->'message'->>'text',coalesce(v->'message'->'attachments','[]'::jsonb),event_time)
  on conflict(external_id) do nothing returning id into record_id;
  duplicate:=record_id is null;
  if not duplicate then
   update public.customers set
    last_message_at=greatest(coalesce(last_message_at,event_time),event_time),
    last_interaction_at=greatest(coalesce(last_interaction_at,event_time),event_time),
    window_expires_at=greatest(coalesce(last_interaction_at,event_time),event_time)+interval '86400 seconds'
   where id=c.id;
  end if;
 else
  insert into public.comments(customer_id,tenant_id,external_id,post_id,author_name,body)
  values(c.id,p_tenant,v->>'comment_id',v->>'post_id',v->'from'->>'name',v->>'message')
  on conflict(external_id) do nothing returning id into record_id;
  duplicate:=record_id is null;
 end if;
 result:=jsonb_build_object('id',record_id,'tenantId',p_tenant,'duplicate',duplicate,'customer',case when c.id is null then null else jsonb_build_object('id',c.id,'display_name',c.display_name,'bot_enabled',c.bot_enabled) end);
 insert into public.facebook_webhook_steps(event_id,name,status,result,completed_at) values(e.id,'record','completed',result,clock_timestamp());
 return result;
end $$$sql_59_8$;

-- facebook-message-window.sql: source statement 9
execute $sql_59_9$revoke all on function public.persist_facebook_webhook_record(uuid,uuid,uuid) from public,anon,authenticated$sql_59_9$;

-- facebook-message-window.sql: source statement 10
execute $sql_59_10$grant execute on function public.persist_facebook_webhook_record(uuid,uuid,uuid) to service_role$sql_59_10$;

-- facebook-message-window.sql: source statement 11
execute $sql_59_11$notify pgrst,'reload schema'$sql_59_11$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('facebook-message-window.sql','84c90a8b951956c4a63a2d15f44ab8ed4ff6c9646ba45f734f1e56f24f3113bc','d2581ef71797895f11e05f0dfc74302cd202b9c278c9ecbb4c2968418baa9d5e');
end $migration_59$;

-- 61. broadcast-policy.sql
do $migration_60$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='broadcast-policy.sql';
  if found then
    if installed <> '66cab5c036ed8aa9f68d2171411d64161f6d0a5835e4259ca751a0504c3117df' then
      raise exception 'Applied migration changed: broadcast-policy.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- broadcast-policy.sql: source statement 2
execute $sql_60_2$create table if not exists public.broadcast_messaging_events (
 tenant_id uuid not null references public.tenants(id), customer_id uuid not null references public.customers(id),
 event_id text not null, page_id text not null, kind text not null check(kind='inbound_message'),
 interacted_at timestamptz not null, received_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,event_id), check(interacted_at<=received_at)
)$sql_60_2$;

-- broadcast-policy.sql: source statement 3
execute $sql_60_3$create index if not exists broadcast_events_latest on public.broadcast_messaging_events(tenant_id,customer_id,interacted_at desc)$sql_60_3$;

-- broadcast-policy.sql: source statement 4
execute $sql_60_4$create table if not exists public.broadcast_runs (
 broadcast_id uuid primary key references public.broadcasts(id), lease uuid not null,
 locked_until timestamptz not null, actor_id uuid not null, updated_at timestamptz not null default clock_timestamp()
)$sql_60_4$;

-- broadcast-policy.sql: source statement 5
execute $sql_60_5$create table if not exists public.broadcast_deliveries (
 broadcast_id uuid not null references public.broadcasts(id), customer_id uuid not null references public.customers(id), tenant_id uuid not null references public.tenants(id),
 status text not null check(status in ('claimed','accepted','delivered','read','failed','unknown','skipped')),
 reason text, provider_message_id text, lease uuid not null, monthly integer not null default 0, topup integer not null default 0,
 transport_started_at timestamptz, accepted_at timestamptz, created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 primary key(broadcast_id,customer_id), check(monthly>=0 and topup>=0)
)$sql_60_5$;

-- broadcast-policy.sql: source statement 6
execute $sql_60_6$create unique index if not exists broadcast_provider_receipt on public.broadcast_deliveries(provider_message_id) where provider_message_id is not null$sql_60_6$;

-- broadcast-policy.sql: source statement 7
execute $sql_60_7$alter table public.broadcast_messaging_events enable row level security$sql_60_7$;

-- broadcast-policy.sql: source statement 8
execute $sql_60_8$alter table public.broadcast_runs enable row level security$sql_60_8$;

-- broadcast-policy.sql: source statement 9
execute $sql_60_9$alter table public.broadcast_deliveries enable row level security$sql_60_9$;

-- broadcast-policy.sql: source statement 10
execute $sql_60_10$revoke all on public.broadcast_messaging_events,public.broadcast_runs,public.broadcast_deliveries from public,anon,authenticated$sql_60_10$;

-- broadcast-policy.sql: source statement 11
execute $sql_60_11$grant all on public.broadcast_messaging_events,public.broadcast_runs,public.broadcast_deliveries to service_role$sql_60_11$;

-- broadcast-policy.sql: source statement 12
execute $sql_60_12$create or replace function public.freeze_broadcast_content() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if old.status<>'draft' and (new.tenant_id,new.name,new.message,new.audience_segment,new.audience_tags,new.audience_window,new.message_tag)
  is distinct from (old.tenant_id,old.name,old.message,old.audience_segment,old.audience_tags,old.audience_window,old.message_tag) then
  raise exception 'Started campaign content is immutable' using errcode='40001';
 end if;
 return new;
end $$$sql_60_12$;

-- broadcast-policy.sql: source statement 13
execute $sql_60_13$drop trigger if exists freeze_broadcast_content on public.broadcasts$sql_60_13$;

-- broadcast-policy.sql: source statement 14
execute $sql_60_14$create trigger freeze_broadcast_content before update on public.broadcasts for each row execute function public.freeze_broadcast_content()$sql_60_14$;

-- broadcast-policy.sql: source statement 15
execute $sql_60_15$create or replace function public.claim_broadcast_run(p_broadcast uuid,p_actor uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare b public.broadcasts;r public.broadcast_runs;token uuid:=gen_random_uuid();
begin
 select * into b from public.broadcasts where id=p_broadcast for update;
 if not found or b.status='sent' then return null;end if;
 if exists(select 1 from public.messages where external_id like 'bc:'||b.id::text||':%') and not exists(select 1 from public.broadcast_runs where broadcast_id=b.id) then
  raise exception 'Legacy campaign requires review before resuming' using errcode='40001';end if;
 if not exists(select 1 from public.tenants where id=b.tenant_id and is_active)
  or not (exists(select 1 from public.platform_admins where user_id=p_actor) or exists(select 1 from public.tenant_members where tenant_id=b.tenant_id and user_id=p_actor and role='owner')) then
  raise exception 'Forbidden' using errcode='42501';end if;
 if b.audience_window<>'within_24h' or b.message_tag is not null then raise exception 'Unsupported broadcast channel' using errcode='42501';end if;
 select * into r from public.broadcast_runs where broadcast_id=b.id;
 if found and r.locked_until>clock_timestamp() then return null;end if;
 -- A stale claim may already have reached Meta: never retry/refund it speculatively.
 update public.broadcast_deliveries set status='unknown',reason='worker_interrupted',updated_at=clock_timestamp() where broadcast_id=b.id and status='claimed';
 insert into public.broadcast_runs(broadcast_id,lease,locked_until,actor_id) values(b.id,token,clock_timestamp()+interval '90 seconds',p_actor)
 on conflict(broadcast_id) do update set lease=excluded.lease,locked_until=excluded.locked_until,actor_id=excluded.actor_id,updated_at=clock_timestamp();
 update public.broadcasts set status='sending',started_at=coalesce(started_at,clock_timestamp()),last_error=null where id=b.id;
 return token;
end $$$sql_60_15$;

-- broadcast-policy.sql: source statement 16
begin
execute $sql_60_16$create or replace function public.broadcast_recipient_reason(p_broadcast uuid,p_customer uuid) returns text
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare b public.broadcasts;c public.customers;t public.tenants;ev public.broadcast_messaging_events;
begin
 select * into b from public.broadcasts where id=p_broadcast;
 select * into c from public.customers where id=p_customer;
 select * into t from public.tenants where id=b.tenant_id;
 if b.id is null or c.id is null or c.tenant_id is distinct from b.tenant_id or t.is_active is distinct from true then return 'scope_unavailable';end if;
 if b.audience_window<>'within_24h' or b.message_tag is not null then return 'unsupported_channel';end if;
 if c.agent_opted_out is null then return 'consent_unknown';end if;
 if c.agent_opted_out then return 'opted_out';end if;
 -- Inbox pause/handoff/closed controls auto-replies, not owner-confirmed broadcasts.
 -- Consent, audience membership and verified inbound evidence still apply below.
 if cardinality(b.audience_tags)>0 and not(c.tags&&b.audience_tags) then return 'audience_changed';end if;
 if b.audience_segment='pending_payment' and not exists(select 1 from public.orders where tenant_id=b.tenant_id and customer_id=c.id and status='pending_payment') then return 'audience_changed';end if;
 if b.audience_segment='paid_before' and not exists(select 1 from public.orders where tenant_id=b.tenant_id and customer_id=c.id and status in ('paid','shipped')) then return 'audience_changed';end if;
 select * into ev from public.broadcast_messaging_events where tenant_id=b.tenant_id and customer_id=c.id and page_id=t.page_id and kind='inbound_message' order by interacted_at desc limit 1;
 if not found then return 'missing_interaction';end if;
 if ev.interacted_at>clock_timestamp() then return 'invalid_interaction';end if;
 if ev.interacted_at<=clock_timestamp()-interval '24 hours' then return 'outside_window';end if;
 return 'eligible';
end $$$sql_60_16$;
exception when invalid_function_definition then
  -- A newer signature of broadcast_recipient_reason(uuid,uuid) is already installed. Its final definition below is mandatory.
  null;
end;

-- broadcast-policy.sql: source statement 17
execute $sql_60_17$create or replace function public.claim_broadcast_recipient(p_broadcast uuid,p_customer uuid,p_lease uuid) returns text
language plpgsql security definer set search_path=pg_catalog,public as $$
declare b public.broadcasts;why text;m integer;u integer;
begin
 select * into b from public.broadcasts where id=p_broadcast for update;
 if not exists(select 1 from public.broadcast_runs where broadcast_id=b.id and lease=p_lease and locked_until>clock_timestamp()) then raise exception 'Expired lease' using errcode='40001';end if;
 if exists(select 1 from public.broadcast_deliveries where broadcast_id=b.id and customer_id=p_customer) then return 'duplicate';end if;
 perform 1 from public.customers where id=p_customer for update;
 why:=public.broadcast_recipient_reason(b.id,p_customer);
 if why<>'eligible' then
  insert into public.broadcast_deliveries(broadcast_id,customer_id,tenant_id,status,reason,lease) values(b.id,p_customer,b.tenant_id,'skipped',why,p_lease);
  return why;
 end if;
 select monthly,topup into m,u from public.reserve_broadcast_credits(b.tenant_id,1);
 if coalesce(m,0)+coalesce(u,0)<>1 then return 'credits_exhausted';end if;
 insert into public.broadcast_deliveries(broadcast_id,customer_id,tenant_id,status,lease,monthly,topup) values(b.id,p_customer,b.tenant_id,'claimed',p_lease,m,u);
 return 'claimed';
end $$$sql_60_17$;

-- broadcast-policy.sql: source statement 18
execute $sql_60_18$create or replace function public.settle_broadcast_recipient(p_broadcast uuid,p_customer uuid,p_lease uuid,p_result text,p_reason text default null,p_receipt text default null) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.broadcast_deliveries;
begin
 if p_result not in ('accepted','failed','unknown','skipped') or (p_result='accepted' and nullif(trim(p_receipt),'') is null) then raise exception 'Invalid result';end if;
 select * into d from public.broadcast_deliveries where broadcast_id=p_broadcast and customer_id=p_customer for update;
 if not found or d.lease<>p_lease or d.status<>'claimed' then return;end if;
 if p_result in ('failed','skipped') then perform public.refund_broadcast_credits(d.tenant_id,d.monthly,d.topup);end if;
 update public.broadcast_deliveries set status=p_result,reason=p_reason,provider_message_id=p_receipt,
  accepted_at=case when p_result='accepted' then clock_timestamp() else null end,updated_at=clock_timestamp() where broadcast_id=p_broadcast and customer_id=p_customer;
end $$$sql_60_18$;

-- broadcast-policy.sql: source statement 19
execute $sql_60_19$create or replace function public.begin_broadcast_transport(p_broadcast uuid,p_customer uuid,p_lease uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare why text;
begin
 if not exists(select 1 from public.broadcast_runs where broadcast_id=p_broadcast and lease=p_lease and locked_until>clock_timestamp()) then return false;end if;
 if not exists(select 1 from public.broadcast_runs r join public.broadcasts b on b.id=r.broadcast_id where r.broadcast_id=p_broadcast and r.lease=p_lease and
  (exists(select 1 from public.platform_admins where user_id=r.actor_id) or exists(select 1 from public.tenant_members where tenant_id=b.tenant_id and user_id=r.actor_id and role='owner'))) then
  perform public.settle_broadcast_recipient(p_broadcast,p_customer,p_lease,'skipped','owner_access_changed');return false;end if;
 perform 1 from public.broadcast_deliveries where broadcast_id=p_broadcast and customer_id=p_customer and lease=p_lease and status='claimed' and transport_started_at is null for update;
 if not found then return false;end if;
 perform 1 from public.customers where id=p_customer for update;
 why:=public.broadcast_recipient_reason(p_broadcast,p_customer);
 if why<>'eligible' then perform public.settle_broadcast_recipient(p_broadcast,p_customer,p_lease,'skipped',why);return false;end if;
 update public.broadcast_deliveries set transport_started_at=clock_timestamp() where broadcast_id=p_broadcast and customer_id=p_customer;
 return true;
end $$$sql_60_19$;

-- broadcast-policy.sql: source statement 20
execute $sql_60_20$revoke all on function public.claim_broadcast_run(uuid,uuid),public.broadcast_recipient_reason(uuid,uuid),public.claim_broadcast_recipient(uuid,uuid,uuid),public.settle_broadcast_recipient(uuid,uuid,uuid,text,text,text),public.begin_broadcast_transport(uuid,uuid,uuid) from public,anon,authenticated$sql_60_20$;

-- broadcast-policy.sql: source statement 21
execute $sql_60_21$grant execute on function public.claim_broadcast_run(uuid,uuid),public.broadcast_recipient_reason(uuid,uuid),public.claim_broadcast_recipient(uuid,uuid,uuid),public.settle_broadcast_recipient(uuid,uuid,uuid,text,text,text),public.begin_broadcast_transport(uuid,uuid,uuid) to service_role$sql_60_21$;

-- broadcast-policy.sql: source statement 22
execute $sql_60_22$notify pgrst,'reload schema'$sql_60_22$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('broadcast-policy.sql','66cab5c036ed8aa9f68d2171411d64161f6d0a5835e4259ca751a0504c3117df','a45cf7c24ef5f6d31ef31868029bd3e9216370bc5c582b911b80a4ed74071233');
end $migration_60$;

-- 62. broadcast-recipient-eligibility.sql
do $migration_61$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='broadcast-recipient-eligibility.sql';
  if found then
    if installed <> '7a84eb92d28c218f7253d800a5fc1a5d2127d33d66339436cae63a162fb464e8' then
      raise exception 'Applied migration changed: broadcast-recipient-eligibility.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- broadcast-recipient-eligibility.sql: source statement 2
execute $sql_61_2$create or replace function public.broadcast_recipient_reason(p_broadcast uuid,p_customer uuid) returns text
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare b public.broadcasts;c public.customers;t public.tenants;ev public.broadcast_messaging_events;
begin
 select * into b from public.broadcasts where id=p_broadcast;
 select * into c from public.customers where id=p_customer;
 select * into t from public.tenants where id=b.tenant_id;
 if b.id is null or c.id is null or c.tenant_id is distinct from b.tenant_id or t.is_active is distinct from true then return 'scope_unavailable';end if;
 if b.audience_window<>'within_24h' or b.message_tag is not null then return 'unsupported_channel';end if;
 if c.agent_opted_out is null then return 'consent_unknown';end if;
 if c.agent_opted_out then return 'opted_out';end if;
 -- Inbox pause/handoff/closed controls auto-replies, not owner-confirmed broadcasts.
 -- Consent, audience membership and verified inbound evidence still apply below.
 if cardinality(b.audience_tags)>0 and not(c.tags&&b.audience_tags) then return 'audience_changed';end if;
 if b.audience_segment='pending_payment' and not exists(select 1 from public.orders where tenant_id=b.tenant_id and customer_id=c.id and status='pending_payment') then return 'audience_changed';end if;
 if b.audience_segment='paid_before' and not exists(select 1 from public.orders where tenant_id=b.tenant_id and customer_id=c.id and status in ('paid','shipped')) then return 'audience_changed';end if;
 select * into ev from public.broadcast_messaging_events where tenant_id=b.tenant_id and customer_id=c.id and page_id=t.page_id and kind='inbound_message' order by interacted_at desc limit 1;
 if not found then return 'missing_interaction';end if;
 if ev.interacted_at>clock_timestamp() then return 'invalid_interaction';end if;
 if ev.interacted_at<=clock_timestamp()-interval '24 hours' then return 'outside_window';end if;
 return 'eligible';
end $$$sql_61_2$;

-- broadcast-recipient-eligibility.sql: source statement 3
execute $sql_61_3$revoke execute on function public.broadcast_recipient_reason(uuid,uuid) from public,anon,authenticated$sql_61_3$;

-- broadcast-recipient-eligibility.sql: source statement 4
execute $sql_61_4$grant execute on function public.broadcast_recipient_reason(uuid,uuid) to service_role$sql_61_4$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('broadcast-recipient-eligibility.sql','7a84eb92d28c218f7253d800a5fc1a5d2127d33d66339436cae63a162fb464e8','6ea5e1f9044db876fc8d0f07d8da52668f9897fa684851092eab347710e4a74c');
end $migration_61$;

-- 63. broadcast-recipient-selection.sql
do $migration_62$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='broadcast-recipient-selection.sql';
  if found then
    if installed <> '70026dfbbefb9b41b890c32cd03c89aa71fe3fcec79499229b0e0bff9aaca2e2' then
      raise exception 'Applied migration changed: broadcast-recipient-selection.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- broadcast-recipient-selection.sql: source statement 2
execute $sql_62_2$alter table public.broadcasts add column if not exists selected_customer_ids uuid[]$sql_62_2$;

-- broadcast-recipient-selection.sql: source statement 3
execute $sql_62_3$create or replace function public.guard_broadcast_selection() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if old.status<>'draft' and new.selected_customer_ids is distinct from old.selected_customer_ids then
  raise exception 'Started campaign recipients are immutable' using errcode='40001';
 end if;
 return new;
end $$$sql_62_3$;

-- broadcast-recipient-selection.sql: source statement 4
execute $sql_62_4$drop trigger if exists broadcast_selection_immutable on public.broadcasts$sql_62_4$;

-- broadcast-recipient-selection.sql: source statement 5
execute $sql_62_5$create trigger broadcast_selection_immutable before update on public.broadcasts
for each row execute function public.guard_broadcast_selection()$sql_62_5$;

-- broadcast-recipient-selection.sql: source statement 6
execute $sql_62_6$notify pgrst,'reload schema'$sql_62_6$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('broadcast-recipient-selection.sql','70026dfbbefb9b41b890c32cd03c89aa71fe3fcec79499229b0e0bff9aaca2e2','bdd1581c239a6ebc20048d32d342e6697d98ada245dd01260feacde8fe44278f');
end $migration_62$;

-- 64. broadcast-inbound-sync.sql
do $migration_63$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='broadcast-inbound-sync.sql';
  if found then
    if installed <> '6f8046fee506562087aaeaf3f8747231a433832ffed4387efd7e3ece76aa605a' then
      raise exception 'Applied migration changed: broadcast-inbound-sync.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- broadcast-inbound-sync.sql: source statement 2
execute $sql_63_2$create index if not exists facebook_webhook_message_id_lookup on public.facebook_webhook_events
 (page_id,((payload->'message')->>'mid')) where kind='message'$sql_63_2$;

-- broadcast-inbound-sync.sql: source statement 3
execute $sql_63_3$create or replace function public.sync_broadcast_inbound_message() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.sender<>'customer' or new.external_id is null then return new;end if;
 insert into public.broadcast_messaging_events(tenant_id,customer_id,event_id,page_id,kind,interacted_at)
 select c.tenant_id,c.id,new.external_id,t.page_id,'inbound_message',new.created_at
 from public.customers c join public.tenants t on t.id=c.tenant_id
 where c.id=new.customer_id and c.platform='facebook' and t.is_active
 and exists(select 1 from public.facebook_webhook_events e
  where e.kind='message' and e.page_id=t.page_id
   and e.payload->'message'->>'mid'=new.external_id
   and e.payload->'sender'->>'id'=c.platform_user_id
   and public.facebook_inbound_message_at(e.payload,e.page_id,e.created_at)=new.created_at)
 on conflict(tenant_id,event_id) do nothing;
 return new;
end $$$sql_63_3$;

-- broadcast-inbound-sync.sql: source statement 4
execute $sql_63_4$revoke all on function public.sync_broadcast_inbound_message() from public,anon,authenticated,service_role$sql_63_4$;

-- broadcast-inbound-sync.sql: source statement 5
execute $sql_63_5$drop trigger if exists broadcast_inbound_message_sync on public.messages$sql_63_5$;

-- broadcast-inbound-sync.sql: source statement 6
execute $sql_63_6$create trigger broadcast_inbound_message_sync after insert on public.messages
for each row execute function public.sync_broadcast_inbound_message()$sql_63_6$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('broadcast-inbound-sync.sql','6f8046fee506562087aaeaf3f8747231a433832ffed4387efd7e3ece76aa605a','074351e109ac3b2191bc1eece9356c5ea28a58cb5b165a078e63413ad876beba');
end $migration_63$;

-- 65. inbox-messenger-window.sql
do $migration_64$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='inbox-messenger-window.sql';
  if found then
    if installed <> 'ebcb83ce0712072589de616ed3770d2b034b2aefa1a9fefc73285e08943004d4' then
      raise exception 'Applied migration changed: inbox-messenger-window.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- inbox-messenger-window.sql: source statement 2
execute $sql_64_2$create or replace function public.inbox_verified_inbound_at(p_tenant uuid,p_customer uuid)
returns timestamptz language sql stable set search_path=pg_catalog,public as $$
 select max(e.interacted_at) from public.broadcast_messaging_events e
 join public.tenants t on t.id=e.tenant_id and t.page_id=e.page_id
 where e.tenant_id=p_tenant and e.customer_id=p_customer and e.kind='inbound_message'
 and e.interacted_at<=statement_timestamp();
$$$sql_64_2$;

-- inbox-messenger-window.sql: source statement 3
execute $sql_64_3$create or replace function public.start_inbox_delivery(p_customer uuid,p_actor uuid default null) returns uuid
language plpgsql set search_path=pg_catalog,public as $$
declare c public.customers;lease uuid:=gen_random_uuid();inbound_at timestamptz;
begin
 select * into c from public.customers where id=p_customer for update;
 if not found or c.conversation_status='closed' or not exists(select 1 from public.tenants where id=c.tenant_id and is_active) then raise exception 'Conversation unavailable' using errcode='40001';end if;
 if p_actor is null then
  if not c.bot_enabled or c.assigned_user_id is not null then raise exception 'Automation paused for human handoff' using errcode='40001';end if;
 else
  if c.assigned_user_id is distinct from p_actor or c.bot_enabled or not public.has_tenant_feature(c.tenant_id,'customer_management') then raise exception 'Claim the conversation first' using errcode='42501';end if;
  if not(exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_actor) or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Forbidden' using errcode='42501';end if;
 end if;
 if c.platform='facebook' then
  inbound_at:=public.inbox_verified_inbound_at(c.tenant_id,c.id);
  if inbound_at is null or inbound_at<=clock_timestamp()-(case when p_actor is null then interval '24 hours' else interval '7 days' end) then
   raise exception 'Messaging window closed' using errcode='P0424';
  end if;
 end if;
 if c.outbound_lock_until>clock_timestamp() then raise exception 'Delivery busy' using errcode='55P03';end if;
 update public.customers set outbound_lock=lease,outbound_lock_until=clock_timestamp()+interval '2 minutes' where id=p_customer;
 return lease;
end $$$sql_64_3$;

-- inbox-messenger-window.sql: source statement 4
execute $sql_64_4$create or replace function public.guard_inbox_automation_window() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare inbound_at timestamptz;
begin
 if new.bot_enabled and not old.bot_enabled and new.platform='facebook' then
  inbound_at:=public.inbox_verified_inbound_at(new.tenant_id,new.id);
  if inbound_at is null or inbound_at<=clock_timestamp()-interval '24 hours' then raise exception 'Messaging window closed' using errcode='P0424';end if;
 end if;
 return new;
end $$$sql_64_4$;

-- inbox-messenger-window.sql: source statement 5
execute $sql_64_5$drop trigger if exists inbox_automation_window on public.customers$sql_64_5$;

-- inbox-messenger-window.sql: source statement 6
execute $sql_64_6$create trigger inbox_automation_window before update of bot_enabled on public.customers for each row execute function public.guard_inbox_automation_window()$sql_64_6$;

-- inbox-messenger-window.sql: source statement 7
execute $sql_64_7$create or replace function public.guard_agent_dispatch_window() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare inbound_at timestamptz;
begin
 if new.dispatch_started_at is not null and old.dispatch_started_at is null
 and exists(select 1 from public.customers where id=new.customer_id and tenant_id=new.tenant_id and platform='facebook') then
  inbound_at:=public.inbox_verified_inbound_at(new.tenant_id,new.customer_id);
  if inbound_at is null or inbound_at<=clock_timestamp()-interval '24 hours' then raise exception 'Messaging window closed' using errcode='P0424';end if;
 end if;
 return new;
end $$$sql_64_7$;

-- inbox-messenger-window.sql: source statement 8
execute $sql_64_8$drop trigger if exists agent_dispatch_window on public.agent_message_jobs$sql_64_8$;

-- inbox-messenger-window.sql: source statement 9
execute $sql_64_9$create trigger agent_dispatch_window before update of dispatch_started_at on public.agent_message_jobs for each row execute function public.guard_agent_dispatch_window()$sql_64_9$;

-- inbox-messenger-window.sql: source statement 10
execute $sql_64_10$revoke all on function public.inbox_verified_inbound_at(uuid,uuid),public.start_inbox_delivery(uuid,uuid),public.guard_inbox_automation_window(),public.guard_agent_dispatch_window() from public,anon,authenticated$sql_64_10$;

-- inbox-messenger-window.sql: source statement 11
execute $sql_64_11$grant execute on function public.inbox_verified_inbound_at(uuid,uuid),public.start_inbox_delivery(uuid,uuid) to service_role$sql_64_11$;

-- inbox-messenger-window.sql: source statement 12
execute $sql_64_12$notify pgrst,'reload schema'$sql_64_12$;

-- inbox-messenger-window.sql: source statement 13
execute $sql_64_13$create index if not exists inbox_automation_expiry on public.customers(last_message_at,id) where platform='facebook' and bot_enabled$sql_64_13$;

-- inbox-messenger-window.sql: source statement 14
execute $sql_64_14$create or replace function public.inbox_automation_window_open(p_customer uuid,p_tenant uuid default null)
returns boolean language sql stable set search_path=pg_catalog,public as $$
 select exists(select 1 from public.customers c join public.tenants t on t.id=c.tenant_id and t.is_active
 where c.id=p_customer and (p_tenant is null or c.tenant_id=p_tenant)
 and (c.platform<>'facebook' or public.inbox_verified_inbound_at(c.tenant_id,c.id)>statement_timestamp()-interval '24 hours'));
$$$sql_64_14$;

-- inbox-messenger-window.sql: source statement 15
execute $sql_64_15$create or replace function public.expire_inbox_automation(p_customer uuid) returns boolean
language plpgsql set search_path=pg_catalog,public as $$
declare c public.customers;inbound_at timestamptz;
begin
 select * into c from public.customers where id=p_customer for update;
 if not found or c.platform<>'facebook' or not c.bot_enabled then return false;end if;
 inbound_at:=public.inbox_verified_inbound_at(c.tenant_id,c.id);
 -- The message row may commit just before its signed evidence. Never pause a fresh inbound.
 if inbound_at>clock_timestamp()-interval '24 hours' or c.last_message_at>clock_timestamp()-interval '24 hours' then return false;end if;
 update public.customers set bot_enabled=false,conversation_version=conversation_version+1,handover_at=coalesce(handover_at,clock_timestamp()) where id=c.id;
 insert into public.conversation_events(tenant_id,customer_id,action,previous_assignee,next_assignee) values(c.tenant_id,c.id,'pause',c.assigned_user_id,c.assigned_user_id);
 return true;
end $$$sql_64_15$;

-- inbox-messenger-window.sql: source statement 16
execute $sql_64_16$create or replace function public.expire_inbox_automation_windows(p_limit integer default 200) returns integer
language plpgsql set search_path=pg_catalog,public as $$
declare customer uuid;changed integer:=0;
begin
 if p_limit is null or p_limit not between 1 and 1000 then raise exception 'Invalid batch limit' using errcode='22023';end if;
 for customer in select c.id from public.customers c where c.platform='facebook' and c.bot_enabled
 and (c.last_message_at is null or c.last_message_at<=clock_timestamp()-interval '24 hours')
 and not public.inbox_automation_window_open(c.id,c.tenant_id)
 order by c.last_message_at nulls first,c.id limit p_limit for update skip locked loop
  if public.expire_inbox_automation(customer) then changed:=changed+1;end if;
 end loop;
 return changed;
end $$$sql_64_16$;

-- inbox-messenger-window.sql: source statement 17
execute $sql_64_17$revoke all on function public.inbox_automation_window_open(uuid,uuid),public.expire_inbox_automation(uuid),public.expire_inbox_automation_windows(integer) from public,anon,authenticated$sql_64_17$;

-- inbox-messenger-window.sql: source statement 18
execute $sql_64_18$grant execute on function public.inbox_automation_window_open(uuid,uuid),public.expire_inbox_automation(uuid),public.expire_inbox_automation_windows(integer) to service_role$sql_64_18$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('inbox-messenger-window.sql','ebcb83ce0712072589de616ed3770d2b034b2aefa1a9fefc73285e08943004d4','4ebe59d252e016e5d62eb28617e9a08d27847550f925f0273d18cc456c43e77e');
end $migration_64$;

-- 66. smart-follow-up-presend.sql
do $migration_65$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='smart-follow-up-presend.sql';
  if found then
    if installed <> 'a8e00ad6cc324074a95b008038812e9ee5968d6037304f83f50581ac67544c23' then
      raise exception 'Applied migration changed: smart-follow-up-presend.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- smart-follow-up-presend.sql: source statement 2
execute $sql_65_2$alter table public.follow_up_jobs add column if not exists send_authorized_at timestamptz$sql_65_2$;

-- smart-follow-up-presend.sql: source statement 3
execute $sql_65_3$create index if not exists slips_followup_presend on public.slips(tenant_id,customer_id,created_at)$sql_65_3$;

-- smart-follow-up-presend.sql: source statement 4
execute $sql_65_4$create or replace function public.sync_payment_follow_up_switch() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 update public.follow_up_workflows set enabled=new.enabled,version=version+1
 where tenant_id=new.tenant_id and kind='payment' and enabled is distinct from new.enabled;
 return new;
end $$$sql_65_4$;

-- smart-follow-up-presend.sql: source statement 5
execute $sql_65_5$drop trigger if exists payment_follow_up_master_switch on public.follow_up_policies$sql_65_5$;

-- smart-follow-up-presend.sql: source statement 6
execute $sql_65_6$create trigger payment_follow_up_master_switch after insert or update of enabled on public.follow_up_policies
for each row execute function public.sync_payment_follow_up_switch()$sql_65_6$;

-- smart-follow-up-presend.sql: source statement 8
execute $sql_65_8$create or replace function public.hold_payment_follow_up_for_slip() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 update public.follow_up_jobs j set status='requires_review',reason='slip_received',claim_token=null,claim_until=null
 from public.orders o
 where j.tenant_id=new.tenant_id and j.customer_id=new.customer_id and j.kind='payment'
 and o.id=j.order_id and o.tenant_id=j.tenant_id and o.customer_id=j.customer_id
 and new.created_at>=o.created_at and j.dispatch_started_at is null
 and j.status in ('scheduled','pending','processing','requires_review')
 and (j.status<>'requires_review' or j.reason is distinct from 'slip_received');
 return new;
end $$$sql_65_8$;

-- smart-follow-up-presend.sql: source statement 9
execute $sql_65_9$drop trigger if exists slips_hold_payment_follow_up on public.slips$sql_65_9$;

-- smart-follow-up-presend.sql: source statement 10
execute $sql_65_10$create trigger slips_hold_payment_follow_up after insert on public.slips
for each row execute function public.hold_payment_follow_up_for_slip()$sql_65_10$;

-- smart-follow-up-presend.sql: source statement 11
begin
execute $sql_65_11$create or replace function public.authorize_follow_up_dispatch(p_job uuid,p_claim uuid) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare j public.follow_up_jobs;c public.customers;o public.orders;t public.tenants;
 w public.follow_up_workflows;p public.follow_up_policies;block_reason text;next_status text:='cancelled';
begin
 select * into j from public.follow_up_jobs where id=p_job;
 if not found then return jsonb_build_object('status','skipped','reason','invalid_reference');end if;
 -- Lock orders before jobs, matching the order-status trigger's order -> jobs order.
 select * into t from public.tenants where id=j.tenant_id for update;
 select * into c from public.customers where id=j.customer_id for update;
 if j.order_id is not null then
   select * into o from public.orders where id=j.order_id and tenant_id=j.tenant_id and customer_id=j.customer_id for update;
 end if;
 select * into j from public.follow_up_jobs where id=p_job for update;
 if j.status<>'processing' or j.claim_token is distinct from p_claim or j.dispatch_started_at is null or j.send_authorized_at is not null then
   return jsonb_build_object('status','skipped','reason','dispatch_not_available');
 end if;
 select * into w from public.follow_up_workflows where id=j.workflow_id and tenant_id=j.tenant_id;
 select * into p from public.follow_up_policies where tenant_id=j.tenant_id;
 if c.id is null or c.tenant_id is distinct from j.tenant_id or w.id is null or p.tenant_id is null then block_reason:='invalid_reference';
 elsif j.claim_until<=clock_timestamp() then block_reason:='claim_expired';next_status:='requires_review';
 elsif j.run_at>clock_timestamp() then block_reason:='not_due';next_status:='requires_review';
 elsif not public.has_tenant_feature(j.tenant_id,'customer_follow_up') or (j.kind<>'payment' or w.use_ai) and not public.has_tenant_feature(j.tenant_id,'ai_agent') then block_reason:='plan_required';
 elsif not p.enabled or not w.enabled or not t.auto_reply_enabled then block_reason:='disabled';
 elsif w.version<>j.workflow_version then block_reason:='workflow_changed';
 elsif c.followup_opted_out then block_reason:='opt_out';
 elsif c.contact_suspended then block_reason:='contact_suspended';
 elsif not c.bot_enabled or c.assigned_user_id is not null or c.conversation_status='closed' then block_reason:='handover';
 elsif (w.stop_on_reply or j.kind='interested') and c.inbound_seq>j.source_seq then block_reason:='customer_replied';
 end if;
 if block_reason is null and j.kind='payment' then
   if o.id is null then block_reason:='invalid_reference';
   elsif o.status='cancelled' then block_reason:='order_cancelled';
   elsif o.status<>'pending_payment' then block_reason:='paid';
   elsif o.confirmed_at is null then block_reason:='order_unconfirmed';next_status:='requires_review';
   elsif exists(select 1 from public.slips where tenant_id=j.tenant_id and customer_id=j.customer_id and created_at>=o.created_at) then block_reason:='slip_received';next_status:='requires_review';
   end if;
 end if;
 if block_reason is null and (c.last_message_at is null or c.last_message_at<clock_timestamp()-interval '24 hours' or c.last_message_at>clock_timestamp()+interval '2 minutes') then block_reason:='window_closed';next_status:='requires_review';end if;
 if block_reason is not null then
   if not public.complete_follow_up(j.id,p_claim,'failed',null,block_reason) then return jsonb_build_object('status','skipped');end if;
   update public.follow_up_jobs set status=next_status,reason=block_reason where id=j.id;
   insert into public.follow_up_execution_logs(tenant_id,job_id,status,reason) values(j.tenant_id,j.id,'precheck_blocked',block_reason);
   return jsonb_build_object('status',next_status,'reason',block_reason);
 end if;
 update public.follow_up_jobs set send_authorized_at=clock_timestamp() where id=j.id;
 insert into public.follow_up_execution_logs(tenant_id,job_id,status,reason)
 values(j.tenant_id,j.id,'precheck_passed',case when j.kind='payment' then 'unpaid_confirmed' else 'eligibility_confirmed' end);
 return jsonb_build_object('status','ready');
end $$$sql_65_11$;
exception when invalid_function_definition then
  -- A newer signature of authorize_follow_up_dispatch(uuid,uuid) is already installed. Its final definition below is mandatory.
  null;
end;

-- smart-follow-up-presend.sql: source statement 12
execute $sql_65_12$revoke all on function public.authorize_follow_up_dispatch(uuid,uuid) from public,anon,authenticated$sql_65_12$;

-- smart-follow-up-presend.sql: source statement 13
execute $sql_65_13$grant execute on function public.authorize_follow_up_dispatch(uuid,uuid) to service_role$sql_65_13$;

-- smart-follow-up-presend.sql: source statement 14
execute $sql_65_14$revoke all on function public.sync_payment_follow_up_switch(),public.hold_payment_follow_up_for_slip() from public,anon,authenticated,service_role$sql_65_14$;

-- smart-follow-up-presend.sql: source statement 15
begin
execute $sql_65_15$create or replace function public.prepare_follow_up(p_job uuid,p_claim uuid) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
<<preflight>>
declare j public.follow_up_jobs;c public.customers;w public.follow_up_workflows;p public.follow_up_policies;t public.tenants;o public.orders;
 reason text;next_status text:='cancelled';local_now timestamp;next_local timestamp;minute_now integer;reservation record;lease uuid;msg uuid;rendered text;product text;total numeric;
begin
 select * into j from public.follow_up_jobs where id=p_job;
 if not found then return jsonb_build_object('status','skipped');end if;
 -- Consistent tenant -> customer -> job order, also used by completion. Customer triggers lock jobs.
 select * into t from public.tenants where id=j.tenant_id for update;
 select * into c from public.customers where id=j.customer_id for update;
 if j.order_id is not null then perform 1 from public.orders where id=j.order_id and tenant_id=j.tenant_id and customer_id=j.customer_id for update;end if;
 select * into j from public.follow_up_jobs where id=p_job for update;
 if j.status<>'processing' or j.claim_token is distinct from p_claim or j.claim_until<=clock_timestamp() or j.dispatch_started_at is not null then return jsonb_build_object('status','skipped');end if;
 if j.run_at>clock_timestamp() then
  update public.follow_up_jobs set status='pending',reason='not_due',claim_token=null,claim_until=null,attempts=greatest(0,attempts-1) where id=j.id;
  return jsonb_build_object('status','deferred','reason','not_due');
 end if;
 select * into w from public.follow_up_workflows where id=j.workflow_id and tenant_id=j.tenant_id;
 select * into p from public.follow_up_policies where tenant_id=j.tenant_id;
 if c.id is null or c.tenant_id is distinct from j.tenant_id or w.id is null or p.tenant_id is null then reason:='invalid_reference';
 elsif not public.has_tenant_feature(j.tenant_id,'customer_follow_up') or (j.kind<>'payment' or w.use_ai) and not public.has_tenant_feature(j.tenant_id,'ai_agent') then reason:='plan_required';
 elsif not p.enabled or not w.enabled or not t.auto_reply_enabled then reason:='disabled';
 elsif w.version<>j.workflow_version then reason:='workflow_changed';
 elsif c.followup_opted_out then reason:='opt_out';
 elsif c.contact_suspended then reason:='contact_suspended';
 elsif not c.bot_enabled or c.assigned_user_id is not null or c.conversation_status='closed' then reason:='handover';
 elsif (w.stop_on_reply or j.kind='interested') and c.inbound_seq>j.source_seq then reason:='customer_replied';end if;
 if reason is null and j.kind in ('payment','after_sales') then
  select * into o from public.orders where id=j.order_id and tenant_id=j.tenant_id and customer_id=j.customer_id;
  if not found then reason:='invalid_reference';
  elsif o.status='cancelled' then reason:='order_cancelled';
  elsif j.kind='payment' and o.status<>'pending_payment' then reason:='paid';
  elsif j.kind='payment' and o.confirmed_at is null then reason:='order_unconfirmed';next_status:='requires_review';
  elsif j.kind='payment' and exists(select 1 from public.slips where tenant_id=j.tenant_id and customer_id=c.id and created_at>=o.created_at) then reason:='slip_received';next_status:='requires_review';
  elsif j.kind='after_sales' and (o.status<>'shipped' or not exists(select 1 from public.order_delivery_events where order_id=o.id and tenant_id=j.tenant_id and delivered_at<=clock_timestamp())) then reason:='invalid_reference';end if;
  product:=o.product_name;total:=o.amount;
 elsif reason is null and j.kind='interested' then
  select name,price into product,total from public.products where id=j.product_id and tenant_id=j.tenant_id and is_active;
  if not found or not exists(select 1 from public.messages where id=j.source_message_id and customer_id=c.id and sender='customer') then reason:='invalid_reference';
  elsif exists(select 1 from public.orders where tenant_id=j.tenant_id and customer_id=c.id and created_at>=j.anchor_at) then reason:='new_order';end if;
 end if;
 if reason is null and (c.last_message_at is null or c.last_message_at<clock_timestamp()-interval '24 hours' or c.last_message_at>clock_timestamp()+interval '2 minutes') then reason:='window_closed';next_status:='requires_review';end if;
 if reason is null and w.use_ai and not j.ai_approved then reason:='ai_draft';next_status:='requires_review';end if;
 if reason is not null then
  update public.follow_up_jobs set status=next_status,reason=preflight.reason,claim_token=null,claim_until=null where id=j.id;
  return jsonb_build_object('status',next_status,'reason',reason);
 end if;
 if p.quiet_enabled then
  local_now:=clock_timestamp() at time zone p.timezone;minute_now:=extract(hour from local_now)::integer*60+extract(minute from local_now)::integer;
  if p.quiet_start=p.quiet_end or (p.quiet_start<p.quiet_end and minute_now>=p.quiet_start and minute_now<p.quiet_end) or (p.quiet_start>p.quiet_end and (minute_now>=p.quiet_start or minute_now<p.quiet_end)) then
   next_local:=date_trunc('day',local_now)+make_interval(mins=>p.quiet_end);
   if next_local<=local_now then next_local:=next_local+interval '1 day';end if;
   update public.follow_up_jobs set status='pending',reason='quiet_hours',run_at=next_local at time zone p.timezone,attempts=greatest(0,attempts-1),claim_token=null,claim_until=null where id=j.id;
   return jsonb_build_object('status','deferred');
  end if;
 end if;
 if (select count(*) from public.follow_up_jobs where customer_id=c.id and dispatch_started_at>clock_timestamp()-interval '24 hours')>=p.max_per_customer
  or j.order_id is not null and (select count(*) from public.follow_up_jobs where order_id=j.order_id and dispatch_started_at is not null)>=p.max_per_order then
  update public.follow_up_jobs set status='skipped',reason='rate_limit',claim_token=null,claim_until=null where id=j.id;return jsonb_build_object('status','skipped','reason','rate_limit');
 end if;
 if c.outbound_lock_until>clock_timestamp() then
  update public.follow_up_jobs set status='pending',reason='delivery_busy',run_at=clock_timestamp()+interval '1 minute',attempts=greatest(0,attempts-1),claim_token=null,claim_until=null where id=j.id;return jsonb_build_object('status','deferred');
 end if;
 if exists(select 1 from public.messages where external_id='followup:'||j.id::text) then
  update public.follow_up_jobs set status='requires_review',reason='delivery_unknown',claim_token=null,claim_until=null where id=j.id;return jsonb_build_object('status','requires_review');
 end if;
 select * into reservation from public.reserve_broadcast_credits(j.tenant_id,1);
 if reservation.monthly+reservation.topup<>1 then
  update public.follow_up_jobs set status='requires_review',reason='quota_exhausted',claim_token=null,claim_until=null where id=j.id;return jsonb_build_object('status','requires_review','reason','quota_exhausted');
 end if;
 -- The lease blocks Inbox claim/transfer while the network request is in flight.
 lease:=public.start_inbox_delivery(c.id,null);
 rendered:=public.render_smart_follow_up(j.text,c.display_name,product,total);
 insert into public.messages(customer_id,sender,external_id,body,delivery_status) values(c.id,'bot','followup:'||j.id::text,rendered,'pending') returning id into msg;
 update public.follow_up_jobs set dispatch_started_at=clock_timestamp(),message_id=msg,delivery_lease=lease,reserved_monthly=reservation.monthly,reserved_topup=reservation.topup where id=j.id;
 return jsonb_build_object('status','ready','text',rendered,'customerId',c.id,'psid',c.platform_user_id,'tenantId',j.tenant_id,'messageId',msg);
end $$$sql_65_15$;
exception when invalid_function_definition then
  -- A newer signature of prepare_follow_up(uuid,uuid) is already installed. Its final definition below is mandatory.
  null;
end;

-- smart-follow-up-presend.sql: source statement 16
execute $sql_65_16$notify pgrst,'reload schema'$sql_65_16$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('smart-follow-up-presend.sql','a8e00ad6cc324074a95b008038812e9ee5968d6037304f83f50581ac67544c23','978fd4adf4cb9e1f16c8a1f21783ab4c7c43dedb66d7c11c7df20fe6ad36f9e4');
end $migration_65$;

-- 67. manual-follow-ups.sql
do $migration_66$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='manual-follow-ups.sql';
  if found then
    if installed <> '82d1d5153964c81dc9a655d53febf693b821d0c7e2c2b111b6d0886dfef3cd4c' then
      raise exception 'Applied migration changed: manual-follow-ups.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- manual-follow-ups.sql: source statement 2
execute $sql_66_2$alter table public.follow_up_jobs add column if not exists manual_without_order boolean not null default false$sql_66_2$;

-- manual-follow-ups.sql: source statement 3
execute $sql_66_3$create unique index if not exists follow_up_manual_open_step
 on public.follow_up_jobs(tenant_id,customer_id,kind,step)
 where manual_without_order and status in ('pending','processing','requires_review')$sql_66_3$;

-- manual-follow-ups.sql: source statement 4
begin
execute $sql_66_4$create or replace function public.add_manual_follow_up(p_tenant uuid,p_actor uuid,p_customer uuid,p_kind text,p_reference uuid default null)
returns setof public.follow_up_jobs
language plpgsql security definer set search_path=pg_catalog,public as $$
declare source uuid; existing_ids uuid[]; c public.customers; w public.follow_up_workflows; st jsonb; n integer:=0; anchor timestamptz:=clock_timestamp();
begin
 if not public.has_tenant_feature(p_tenant,'customer_follow_up') or not (
  exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor)
  or exists(select 1 from public.platform_admins where user_id=p_actor)) then
  raise exception 'Forbidden' using errcode='42501';
 end if;
 if p_kind not in ('payment','interested','after_sales') or p_kind is null then raise exception 'Invalid kind' using errcode='22023';end if;
 -- Same lock order as dispatch. Existing unique source/order indexes make retries idempotent.
 perform 1 from public.tenants where id=p_tenant for update;
 perform 1 from public.customers where id=p_customer and tenant_id=p_tenant for update;
 if not found then raise exception 'Invalid customer' using errcode='22023';end if;
 if p_reference is null then
  select * into c from public.customers where id=p_customer and tenant_id=p_tenant;
  select * into w from public.follow_up_workflows where tenant_id=p_tenant and kind=p_kind and enabled;
  if w.id is null or not exists(select 1 from public.follow_up_policies where tenant_id=p_tenant and enabled)
   or c.followup_opted_out or c.contact_suspended or not c.bot_enabled or c.assigned_user_id is not null or c.conversation_status='closed'
   or (p_kind<>'payment' or w.use_ai) and not public.has_tenant_feature(p_tenant,'ai_agent') then return;end if;
  for st in select value from jsonb_array_elements(w.steps) loop
   n:=n+1;
   insert into public.follow_up_jobs(tenant_id,customer_id,kind,workflow_id,workflow_version,step,text,run_at,anchor_at,source_seq,status,manual_without_order)
   values(p_tenant,p_customer,p_kind,w.id,w.version,n,
    'สวัสดีค่ะ ขออนุญาตติดตามนะคะ หากต้องการข้อมูลหรือความช่วยเหลือเพิ่มเติม แจ้งได้เลยค่ะ',
    anchor+make_interval(mins=>(st->>'delay_minutes')::integer),anchor,c.inbound_seq,'pending',true)
   on conflict do nothing;
  end loop;
  return query select j.* from public.follow_up_jobs j where j.tenant_id=p_tenant and j.customer_id=p_customer
   and j.kind=p_kind and j.manual_without_order and j.status in ('pending','processing','requires_review') order by j.step;
  return;
 end if;
 if p_kind='interested' then
  select id into source from public.messages where customer_id=p_customer and sender='customer'
   order by created_at desc,id desc limit 1;
 end if;
 select coalesce(array_agg(id),'{}'::uuid[]) into existing_ids from public.follow_up_jobs
 where tenant_id=p_tenant and customer_id=p_customer and kind=p_kind
  and ((p_kind='interested' and source_message_id=source) or (p_kind<>'interested' and order_id=p_reference));
 perform public.enqueue_follow_up(p_tenant,p_customer,p_kind,
  case when p_kind<>'interested' then p_reference end,source,
  case when p_kind='interested' then p_reference end);
 -- New manual entries start pending; AI approval is still enforced by prepare_follow_up.
 update public.follow_up_jobs set status='pending',reason=null
 where tenant_id=p_tenant and customer_id=p_customer and kind=p_kind
  and not (id=any(existing_ids)) and status='requires_review' and reason='ai_draft';
 return query select j.* from public.follow_up_jobs j
 where j.tenant_id=p_tenant and j.customer_id=p_customer and j.kind=p_kind
  and ((p_kind='interested' and j.source_message_id=source and j.product_id=p_reference)
    or (p_kind<>'interested' and j.order_id=p_reference))
  and j.status in ('pending','requires_review') order by j.step;
end $$$sql_66_4$;
exception when invalid_function_definition then
  -- A newer signature of add_manual_follow_up(uuid,uuid,uuid,text,uuid) is already installed. Its final definition below is mandatory.
  null;
end;

-- manual-follow-ups.sql: source statement 5
execute $sql_66_5$revoke all on function public.add_manual_follow_up(uuid,uuid,uuid,text,uuid) from public,anon,authenticated$sql_66_5$;

-- manual-follow-ups.sql: source statement 6
execute $sql_66_6$grant execute on function public.add_manual_follow_up(uuid,uuid,uuid,text,uuid) to service_role$sql_66_6$;

-- manual-follow-ups.sql: source statement 7
execute $sql_66_7$do $$
declare definition text; updated text;
begin
 definition:=pg_get_functiondef('public.prepare_follow_up(uuid,uuid)'::regprocedure);
 updated:=replace(definition,
  'if reason is null and j.kind in (''payment'',''after_sales'') then',
  'if reason is null and j.kind in (''payment'',''after_sales'') and not j.manual_without_order then');
 updated:=replace(updated,
  'if reason is null and w.use_ai and not j.ai_approved then',
  'if reason is null and (w.use_ai or j.manual_without_order) and not j.ai_approved then');
 updated:=replace(updated,'elsif reason is null and j.kind=''interested'' then',
  'elsif reason is null and j.kind=''interested'' and not j.manual_without_order then');
 if updated=definition and position('or j.manual_without_order' in definition)=0 then
  raise exception 'Unsupported prepare_follow_up definition; manual migration not applied';
 end if;
 execute updated;
 if to_regprocedure('public.authorize_follow_up_dispatch(uuid,uuid)') is not null then
  definition:=pg_get_functiondef('public.authorize_follow_up_dispatch(uuid,uuid)'::regprocedure);
  updated:=replace(definition,'if block_reason is null and j.kind=''payment'' then',
   'if block_reason is null and j.kind=''payment'' and not j.manual_without_order then');
  if updated=definition and position('not j.manual_without_order' in definition)=0 then
   raise exception 'Unsupported authorize_follow_up_dispatch definition; manual migration not applied';
  end if;
  -- Approval also remains mandatory at the final network gate.
  if position('j.manual_without_order and not j.ai_approved' in updated)=0 then
   if position('if block_reason is null and (c.last_message_at is null' in updated)=0 then
    raise exception 'Unsupported dispatch approval gate; manual migration not applied';
   end if;
   updated:=replace(updated,'if block_reason is null and (c.last_message_at is null',
    'if block_reason is null and j.manual_without_order and not j.ai_approved then block_reason:=''ai_draft'';next_status:=''requires_review'';end if; if block_reason is null and (c.last_message_at is null');
  end if;
  execute updated;
 end if;
end $$$sql_66_7$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('manual-follow-ups.sql','82d1d5153964c81dc9a655d53febf693b821d0c7e2c2b111b6d0886dfef3cd4c','34d34f06c0a32579c6dc4a80583c4c15040b1919b8f2bd7e6638848adb06e165');
end $migration_66$;

-- 68. follow-up-simplified.sql
do $migration_67$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='follow-up-simplified.sql';
  if found then
    if installed <> '0378bc48899e42e1ead60cff24450c33bc5c3eb8239ecdc4677cf1c92c07c1ab' then
      raise exception 'Applied migration changed: follow-up-simplified.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- follow-up-simplified.sql: source statement 2
begin
execute $sql_67_2$create or replace function public.follow_up_window_open(p_tenant uuid,p_customer uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.customers c join public.tenants t on t.id=c.tenant_id
 where c.id=p_customer and c.tenant_id=p_tenant and t.is_active and
 (c.platform<>'facebook' or (select max(e.interacted_at) from public.broadcast_messaging_events e
 where e.tenant_id=t.id and e.customer_id=c.id and e.page_id=t.page_id and e.kind='inbound_message')
 >statement_timestamp()-interval '24 hours' and (select max(e.interacted_at) from public.broadcast_messaging_events e
 where e.tenant_id=t.id and e.customer_id=c.id and e.page_id=t.page_id and e.kind='inbound_message')<=statement_timestamp()))
$$$sql_67_2$;
exception when invalid_function_definition then
  -- A newer signature of follow_up_window_open(uuid,uuid) is already installed. Its final definition below is mandatory.
  null;
end;

-- follow-up-simplified.sql: source statement 3
execute $sql_67_3$revoke all on function public.follow_up_window_open(uuid,uuid) from public,anon,authenticated$sql_67_3$;

-- follow-up-simplified.sql: source statement 4
execute $sql_67_4$grant execute on function public.follow_up_window_open(uuid,uuid) to service_role$sql_67_4$;

-- follow-up-simplified.sql: source statement 5
begin
execute $sql_67_5$create or replace function public.prepare_follow_up(p_job uuid,p_claim uuid) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
<<preflight>>
declare j public.follow_up_jobs;c public.customers;w public.follow_up_workflows;t public.tenants;o public.orders;
 reason text;next_status text:='cancelled';reservation record;lease uuid;msg uuid;rendered text;product text;total numeric;
begin
 select * into j from public.follow_up_jobs where id=p_job;
 if not found then return jsonb_build_object('status','skipped');end if;
 -- Consistent tenant -> customer -> job order, also used by completion. Customer triggers lock jobs.
 select * into t from public.tenants where id=j.tenant_id for update;
 select * into c from public.customers where id=j.customer_id for update;
 if j.order_id is not null then perform 1 from public.orders where id=j.order_id and tenant_id=j.tenant_id and customer_id=j.customer_id for update;end if;
 select * into j from public.follow_up_jobs where id=p_job for update;
 if j.status<>'processing' or j.claim_token is distinct from p_claim or j.claim_until<=clock_timestamp() or j.dispatch_started_at is not null then return jsonb_build_object('status','skipped');end if;
 if j.run_at>clock_timestamp() then
  update public.follow_up_jobs set status='pending',reason='not_due',claim_token=null,claim_until=null,attempts=greatest(0,attempts-1) where id=j.id;
  return jsonb_build_object('status','deferred','reason','not_due');
 end if;
 select * into w from public.follow_up_workflows where id=j.workflow_id and tenant_id=j.tenant_id;
 if c.id is null or c.tenant_id is distinct from j.tenant_id or w.id is null then reason:='invalid_reference';
 elsif not public.has_tenant_feature(j.tenant_id,'customer_follow_up') or (j.kind<>'payment' or w.use_ai) and not public.has_tenant_feature(j.tenant_id,'ai_agent') then reason:='plan_required';
 elsif not j.manual_without_order and (not w.enabled or not t.auto_reply_enabled) then reason:='disabled';
 elsif w.version<>j.workflow_version then reason:='workflow_changed';
 elsif c.followup_opted_out then reason:='opt_out';
 elsif c.contact_suspended then reason:='contact_suspended';
 elsif not c.bot_enabled or c.assigned_user_id is not null or c.conversation_status='closed' then reason:='handover';
 elsif (w.stop_on_reply or j.kind='interested') and c.inbound_seq>j.source_seq then reason:='customer_replied';end if;
 if reason is null and j.kind in ('payment','after_sales') and not j.manual_without_order then
  select * into o from public.orders where id=j.order_id and tenant_id=j.tenant_id and customer_id=j.customer_id;
  if not found then reason:='invalid_reference';
  elsif o.status='cancelled' then reason:='order_cancelled';
  elsif j.kind='payment' and o.status<>'pending_payment' then reason:='paid';
  elsif j.kind='payment' and o.confirmed_at is null then reason:='order_unconfirmed';next_status:='requires_review';
  elsif j.kind='payment' and exists(select 1 from public.slips where tenant_id=j.tenant_id and customer_id=c.id and created_at>=o.created_at) then reason:='slip_received';next_status:='requires_review';
  elsif j.kind='after_sales' and (o.status<>'shipped' or not exists(select 1 from public.order_delivery_events where order_id=o.id and tenant_id=j.tenant_id and delivered_at<=clock_timestamp())) then reason:='invalid_reference';end if;
  product:=o.product_name;total:=o.amount;
 elsif reason is null and j.kind='interested' and not j.manual_without_order then
  select name,price into product,total from public.products where id=j.product_id and tenant_id=j.tenant_id and is_active;
  if not found or not exists(select 1 from public.messages where id=j.source_message_id and customer_id=c.id and sender='customer') then reason:='invalid_reference';
  elsif exists(select 1 from public.orders where tenant_id=j.tenant_id and customer_id=c.id and created_at>=j.anchor_at) then reason:='new_order';end if;
 end if;
 if reason is null and not public.follow_up_window_open(j.tenant_id,j.customer_id) then reason:='window_closed';next_status:='requires_review';end if;
 if reason is null and (w.use_ai or j.manual_without_order) and not j.ai_approved then reason:='ai_draft';next_status:='requires_review';end if;
 if reason is not null then
  update public.follow_up_jobs set status=next_status,reason=preflight.reason,claim_token=null,claim_until=null where id=j.id;
  return jsonb_build_object('status',next_status,'reason',reason);
 end if;
 if c.outbound_lock_until>clock_timestamp() then
  update public.follow_up_jobs set status='pending',reason='delivery_busy',run_at=clock_timestamp()+interval '1 minute',attempts=greatest(0,attempts-1),claim_token=null,claim_until=null where id=j.id;return jsonb_build_object('status','deferred');
 end if;
 if exists(select 1 from public.messages where external_id='followup:'||j.id::text) then
  update public.follow_up_jobs set status='requires_review',reason='delivery_unknown',claim_token=null,claim_until=null where id=j.id;return jsonb_build_object('status','requires_review');
 end if;
 select * into reservation from public.reserve_broadcast_credits(j.tenant_id,1);
 if reservation.monthly+reservation.topup<>1 then
  update public.follow_up_jobs set status='requires_review',reason='quota_exhausted',claim_token=null,claim_until=null where id=j.id;return jsonb_build_object('status','requires_review','reason','quota_exhausted');
 end if;
 -- The lease blocks Inbox claim/transfer while the network request is in flight.
 lease:=public.start_inbox_delivery(c.id,null);
 rendered:=public.render_smart_follow_up(j.text,c.display_name,product,total);
 insert into public.messages(customer_id,sender,external_id,body,delivery_status) values(c.id,'bot','followup:'||j.id::text,rendered,'pending') returning id into msg;
 update public.follow_up_jobs set dispatch_started_at=clock_timestamp(),message_id=msg,delivery_lease=lease,reserved_monthly=reservation.monthly,reserved_topup=reservation.topup where id=j.id;
 return jsonb_build_object('status','ready','text',rendered,'customerId',c.id,'psid',c.platform_user_id,'tenantId',j.tenant_id,'messageId',msg);
end $$$sql_67_5$;
exception when invalid_function_definition then
  -- A newer signature of prepare_follow_up(uuid,uuid) is already installed. Its final definition below is mandatory.
  null;
end;

-- follow-up-simplified.sql: source statement 6
begin
execute $sql_67_6$create or replace function public.authorize_follow_up_dispatch(p_job uuid,p_claim uuid) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare j public.follow_up_jobs;c public.customers;o public.orders;t public.tenants;
 w public.follow_up_workflows;block_reason text;next_status text:='cancelled';
begin
 select * into j from public.follow_up_jobs where id=p_job;
 if not found then return jsonb_build_object('status','skipped','reason','invalid_reference');end if;
 -- Lock orders before jobs, matching the order-status trigger's order -> jobs order.
 select * into t from public.tenants where id=j.tenant_id for update;
 select * into c from public.customers where id=j.customer_id for update;
 if j.order_id is not null then
   select * into o from public.orders where id=j.order_id and tenant_id=j.tenant_id and customer_id=j.customer_id for update;
 end if;
 select * into j from public.follow_up_jobs where id=p_job for update;
 if j.status<>'processing' or j.claim_token is distinct from p_claim or j.dispatch_started_at is null or j.send_authorized_at is not null then
   return jsonb_build_object('status','skipped','reason','dispatch_not_available');
 end if;
 select * into w from public.follow_up_workflows where id=j.workflow_id and tenant_id=j.tenant_id;
 if c.id is null or c.tenant_id is distinct from j.tenant_id or w.id is null then block_reason:='invalid_reference';
 elsif j.claim_until<=clock_timestamp() then block_reason:='claim_expired';next_status:='requires_review';
 elsif j.run_at>clock_timestamp() then block_reason:='not_due';next_status:='requires_review';
 elsif not public.has_tenant_feature(j.tenant_id,'customer_follow_up') or (j.kind<>'payment' or w.use_ai) and not public.has_tenant_feature(j.tenant_id,'ai_agent') then block_reason:='plan_required';
 elsif not j.manual_without_order and (not w.enabled or not t.auto_reply_enabled) then block_reason:='disabled';
 elsif w.version<>j.workflow_version then block_reason:='workflow_changed';
 elsif c.followup_opted_out then block_reason:='opt_out';
 elsif c.contact_suspended then block_reason:='contact_suspended';
 elsif not c.bot_enabled or c.assigned_user_id is not null or c.conversation_status='closed' then block_reason:='handover';
 elsif (w.stop_on_reply or j.kind='interested') and c.inbound_seq>j.source_seq then block_reason:='customer_replied';
 end if;
 if block_reason is null and j.kind='payment' and not j.manual_without_order then
   if o.id is null then block_reason:='invalid_reference';
   elsif o.status='cancelled' then block_reason:='order_cancelled';
   elsif o.status<>'pending_payment' then block_reason:='paid';
   elsif o.confirmed_at is null then block_reason:='order_unconfirmed';next_status:='requires_review';
   elsif exists(select 1 from public.slips where tenant_id=j.tenant_id and customer_id=j.customer_id and created_at>=o.created_at) then block_reason:='slip_received';next_status:='requires_review';
   end if;
 end if;
 if block_reason is null and j.manual_without_order and not j.ai_approved then block_reason:='ai_draft';next_status:='requires_review';end if;
 if block_reason is null and not public.follow_up_window_open(j.tenant_id,j.customer_id) then block_reason:='window_closed';next_status:='requires_review';end if;
 if block_reason is not null then
   if not public.complete_follow_up(j.id,p_claim,'failed',null,block_reason) then return jsonb_build_object('status','skipped');end if;
   update public.follow_up_jobs set status=next_status,reason=block_reason where id=j.id;
   insert into public.follow_up_execution_logs(tenant_id,job_id,status,reason) values(j.tenant_id,j.id,'precheck_blocked',block_reason);
   return jsonb_build_object('status',next_status,'reason',block_reason);
 end if;
 update public.follow_up_jobs set send_authorized_at=clock_timestamp() where id=j.id;
 insert into public.follow_up_execution_logs(tenant_id,job_id,status,reason)
 values(j.tenant_id,j.id,'precheck_passed',case when j.kind='payment' then 'unpaid_confirmed' else 'eligibility_confirmed' end);
 return jsonb_build_object('status','ready');
end $$$sql_67_6$;
exception when invalid_function_definition then
  -- A newer signature of authorize_follow_up_dispatch(uuid,uuid) is already installed. Its final definition below is mandatory.
  null;
end;

-- follow-up-simplified.sql: source statement 7
execute $sql_67_7$create or replace function public.add_manual_follow_up(p_tenant uuid,p_actor uuid,p_customer uuid,p_kind text,p_reference uuid default null)
returns setof public.follow_up_jobs
language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.customers; w public.follow_up_workflows; st jsonb; n integer:=0; anchor timestamptz:=clock_timestamp();
begin
 if not public.has_tenant_feature(p_tenant,'customer_follow_up') or not (
  exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor)
  or exists(select 1 from public.platform_admins where user_id=p_actor)) then
  raise exception 'Forbidden' using errcode='42501';
 end if;
 if p_kind not in ('payment','interested','after_sales') or p_kind is null then raise exception 'Invalid kind' using errcode='22023';end if;
 -- Same lock order as dispatch. Existing unique source/order indexes make retries idempotent.
 perform 1 from public.tenants where id=p_tenant for update;
 perform 1 from public.customers where id=p_customer and tenant_id=p_tenant for update;
 if not found then raise exception 'Invalid customer' using errcode='22023';end if;
 if p_reference is not null then
  if p_kind='interested' then
   if not exists(select 1 from public.products where id=p_reference and tenant_id=p_tenant) then raise exception 'Invalid product' using errcode='22023';end if;
  else
   if not exists(select 1 from public.orders where id=p_reference and tenant_id=p_tenant and customer_id=p_customer) then raise exception 'Invalid order' using errcode='22023';end if;
  end if;
 end if;
  select * into c from public.customers where id=p_customer and tenant_id=p_tenant;
  insert into public.follow_up_workflows(tenant_id,kind,enabled,steps) values(p_tenant,p_kind,false,'[{"delay_minutes":1,"text":"สวัสดีค่ะ ขออนุญาตติดตามเรื่องที่คุยกันไว้นะคะ"}]') on conflict(tenant_id,kind) do nothing;
  select * into w from public.follow_up_workflows where tenant_id=p_tenant and kind=p_kind;
  if exists(select 1 from public.follow_up_jobs where tenant_id=p_tenant and customer_id=p_customer and kind=p_kind
   and manual_without_order and status in ('pending','processing','requires_review')) then
   return query select j.* from public.follow_up_jobs j where j.tenant_id=p_tenant and j.customer_id=p_customer
    and j.kind=p_kind and j.manual_without_order and j.status in ('pending','processing','requires_review') order by j.step;
   return;
  end if;
  for st in select value from jsonb_array_elements(w.steps) loop
   n:=n+1;
   insert into public.follow_up_jobs(tenant_id,customer_id,kind,workflow_id,workflow_version,step,text,run_at,anchor_at,source_seq,status,manual_without_order)
   values(p_tenant,p_customer,p_kind,w.id,w.version,n,
    'สวัสดีค่ะ ขออนุญาตติดตามนะคะ หากต้องการข้อมูลหรือความช่วยเหลือเพิ่มเติม แจ้งได้เลยค่ะ',
    anchor+make_interval(mins=>(st->>'delay_minutes')::integer),anchor,c.inbound_seq,'pending',true)
   on conflict do nothing;
  end loop;
  return query select j.* from public.follow_up_jobs j where j.tenant_id=p_tenant and j.customer_id=p_customer
   and j.kind=p_kind and j.manual_without_order and j.status in ('pending','processing','requires_review') order by j.step;
  return;
end $$$sql_67_7$;

-- follow-up-simplified.sql: source statement 8
execute $sql_67_8$create or replace function public.enqueue_follow_up(p_tenant uuid,p_customer uuid,p_kind text,p_order uuid default null,p_source uuid default null,p_product uuid default null) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare w public.follow_up_workflows;c public.customers;anchor timestamptz;st jsonb;n integer:=0;source_sequence bigint;
begin
 select * into c from public.customers where id=p_customer and tenant_id=p_tenant;
 if not found or c.followup_opted_out or c.contact_suspended or not c.bot_enabled or c.assigned_user_id is not null or c.conversation_status='closed' then return;end if;
 source_sequence:=c.inbound_seq;
 if not public.has_tenant_feature(p_tenant,'customer_follow_up') then return;end if;
 select * into w from public.follow_up_workflows where tenant_id=p_tenant and kind=p_kind and enabled;
 if not found then return;end if;
 if p_kind<>'payment' and not public.has_tenant_feature(p_tenant,'ai_agent') then return;end if;
 if p_kind='interested' then
  if not public.has_tenant_feature(p_tenant,'ai_agent') then return;end if;
  select created_at into anchor from public.messages where id=p_source and customer_id=c.id and sender='customer' and inbound_seq=c.inbound_seq;
  if anchor is null or not exists(select 1 from public.products where id=p_product and tenant_id=p_tenant and is_active) or exists(select 1 from public.orders where tenant_id=p_tenant and customer_id=c.id and created_at>=anchor) then return;end if;
 elsif p_kind='payment' then
  select o.confirmed_at,coalesce(m.inbound_seq,c.inbound_seq) into anchor,source_sequence from public.orders o left join public.messages m on m.id=o.message_id where o.id=p_order and o.tenant_id=p_tenant and o.customer_id=c.id and o.status='pending_payment';
 elsif p_kind='after_sales' then
  select d.delivered_at into anchor from public.order_delivery_events d join public.orders o on o.id=d.order_id where d.order_id=p_order and d.tenant_id=p_tenant and d.customer_id=c.id and o.status='shipped';
 else return;end if;
 if anchor is null then return;end if;
 for st in select value from jsonb_array_elements(w.steps) loop
  n:=n+1;
  insert into public.follow_up_jobs(tenant_id,customer_id,order_id,kind,workflow_id,workflow_version,source_message_id,product_id,step,text,run_at,anchor_at,source_seq,status,reason)
  values(p_tenant,c.id,p_order,p_kind,w.id,w.version,p_source,p_product,n,st->>'text',anchor+make_interval(mins=>(st->>'delay_minutes')::integer),anchor,source_sequence,
   case when w.use_ai then 'requires_review' else 'pending' end,case when w.use_ai then 'ai_draft' else null end)
  on conflict do nothing;
 end loop;
end $$$sql_67_8$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('follow-up-simplified.sql','0378bc48899e42e1ead60cff24450c33bc5c3eb8239ecdc4677cf1c92c07c1ab','c1463162272b2eb3b5248a42dd663baf9bc2371c23f300c70916df0921f4b86b');
end $migration_67$;

-- 69. follow-up-step-settings.sql
do $migration_68$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='follow-up-step-settings.sql';
  if found then
    if installed <> '514c5e1c51f7031bd1e62875e30f7cd39f65b363fab8a56bb40b1cfdc39f59fa' then
      raise exception 'Applied migration changed: follow-up-step-settings.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- follow-up-step-settings.sql: source statement 2
execute $sql_68_2$create or replace function public.save_follow_up_workflow(p_tenant uuid,p_actor uuid,p_kind text,p_version integer,p_index integer,p_steps jsonb,p_config jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare w public.follow_up_workflows; merged jsonb; st jsonb; previous integer:=0; delay integer;
begin
 if not public.has_tenant_feature(p_tenant,'customer_follow_up') or not (
  exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor)
  or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_kind not in ('payment','interested','after_sales') or p_kind is null or p_version is null
  or jsonb_typeof(p_steps) is distinct from 'array' or jsonb_typeof(p_config) is distinct from 'object'
  or jsonb_typeof(p_config->'enabled') is distinct from 'boolean' or jsonb_typeof(p_config->'use_ai') is distinct from 'boolean'
  or jsonb_typeof(p_config->'stop_on_reply') is distinct from 'boolean' then raise exception 'Invalid settings' using errcode='22023';end if;
 if ((p_kind<>'payment' and (p_config->>'enabled')::boolean) or (p_config->>'use_ai')::boolean)
  and not public.has_tenant_feature(p_tenant,'ai_agent') then raise exception 'Feature locked' using errcode='42501';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 select * into w from public.follow_up_workflows where tenant_id=p_tenant and kind=p_kind for update;
 if coalesce(w.version,0)<>p_version then raise exception 'Workflow changed' using errcode='40001';end if;
 if p_index is null then merged:=p_steps;
 else
  if p_index<0 or p_index>2 or p_index>coalesce(jsonb_array_length(w.steps),0) or jsonb_array_length(p_steps)<>1 then raise exception 'Save preceding steps first' using errcode='22023';end if;
  merged:=jsonb_set(coalesce(w.steps,'[]'::jsonb),array[p_index::text],p_steps->0,true);
 end if;
 if jsonb_array_length(merged) not between 1 and 3 then raise exception 'Invalid step count' using errcode='22023';end if;
 for st in select value from jsonb_array_elements(merged) loop
  if jsonb_typeof(st->'delay_minutes') is distinct from 'number' or jsonb_typeof(st->'text') is distinct from 'string'
   or (st->>'delay_minutes')!~'^\d+$' then raise exception 'Invalid step' using errcode='22023';end if;
  delay:=(st->>'delay_minutes')::integer;
  if delay<=previous or delay>43200 or length(trim(st->>'text')) not between 1 and 2000 then raise exception 'Invalid step values' using errcode='22023';end if;
  previous:=delay;
 end loop;
 insert into public.follow_up_workflows(tenant_id,kind,enabled,use_ai,stop_on_reply,steps)
 values(p_tenant,p_kind,(p_config->>'enabled')::boolean,(p_config->>'use_ai')::boolean,case when p_kind='interested' then true else (p_config->>'stop_on_reply')::boolean end,merged)
 on conflict(tenant_id,kind) do update set enabled=excluded.enabled,use_ai=excluded.use_ai,stop_on_reply=excluded.stop_on_reply,steps=excluded.steps,version=follow_up_workflows.version+1
 returning * into w;
 update public.follow_up_jobs set status='cancelled',reason='workflow_changed',claim_token=null,claim_until=null
 where tenant_id=p_tenant and workflow_id=w.id and (status in ('pending','requires_review') or status='processing' and dispatch_started_at is null);
 return to_jsonb(w);
end $$$sql_68_2$;

-- follow-up-step-settings.sql: source statement 3
execute $sql_68_3$revoke all on function public.save_follow_up_workflow(uuid,uuid,text,integer,integer,jsonb,jsonb) from public,anon,authenticated$sql_68_3$;

-- follow-up-step-settings.sql: source statement 4
execute $sql_68_4$grant execute on function public.save_follow_up_workflow(uuid,uuid,text,integer,integer,jsonb,jsonb) to service_role$sql_68_4$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('follow-up-step-settings.sql','514c5e1c51f7031bd1e62875e30f7cd39f65b363fab8a56bb40b1cfdc39f59fa','96bedcb1959a8d864b018de761fb35e8d989b42450060ca784c2f7143af13a0e');
end $migration_68$;

-- 70. follow-up-manual-dispatch-fix.sql
do $migration_69$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='follow-up-manual-dispatch-fix.sql';
  if found then
    if installed <> '686e7d60ade6ac2a0adf2813fa6ad295c37fd30df2ce80de5b210552bc0dd8d3' then
      raise exception 'Applied migration changed: follow-up-manual-dispatch-fix.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- follow-up-manual-dispatch-fix.sql: source statement 2
begin
execute $sql_69_2$create or replace function public.follow_up_window_open(p_tenant uuid,p_customer uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.customers c join public.tenants t on t.id=c.tenant_id
 where c.id=p_customer and c.tenant_id=p_tenant and t.is_active and
 (c.platform<>'facebook' or (select max(e.interacted_at) from public.broadcast_messaging_events e
 where e.tenant_id=t.id and e.customer_id=c.id and e.page_id=t.page_id and e.kind='inbound_message')
 >statement_timestamp()-interval '24 hours' and (select max(e.interacted_at) from public.broadcast_messaging_events e
 where e.tenant_id=t.id and e.customer_id=c.id and e.page_id=t.page_id and e.kind='inbound_message')<=statement_timestamp()))
$$$sql_69_2$;
exception when invalid_function_definition then
  -- A newer signature of follow_up_window_open(uuid,uuid) is already installed. Its final definition below is mandatory.
  null;
end;

-- follow-up-manual-dispatch-fix.sql: source statement 3
execute $sql_69_3$revoke all on function public.follow_up_window_open(uuid,uuid) from public,anon,authenticated$sql_69_3$;

-- follow-up-manual-dispatch-fix.sql: source statement 4
execute $sql_69_4$grant execute on function public.follow_up_window_open(uuid,uuid) to service_role$sql_69_4$;

-- follow-up-manual-dispatch-fix.sql: source statement 5
begin
execute $sql_69_5$create or replace function public.prepare_follow_up(p_job uuid,p_claim uuid) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
<<preflight>>
declare j public.follow_up_jobs;c public.customers;w public.follow_up_workflows;t public.tenants;o public.orders;
 reason text;next_status text:='cancelled';reservation record;lease uuid;msg uuid;rendered text;product text;total numeric;
begin
 select * into j from public.follow_up_jobs where id=p_job;
 if not found then return jsonb_build_object('status','skipped');end if;
 -- Consistent tenant -> customer -> job order, also used by completion. Customer triggers lock jobs.
 select * into t from public.tenants where id=j.tenant_id for update;
 select * into c from public.customers where id=j.customer_id for update;
 if j.order_id is not null then perform 1 from public.orders where id=j.order_id and tenant_id=j.tenant_id and customer_id=j.customer_id for update;end if;
 select * into j from public.follow_up_jobs where id=p_job for update;
 if j.status<>'processing' or j.claim_token is distinct from p_claim or j.claim_until<=clock_timestamp() or j.dispatch_started_at is not null then return jsonb_build_object('status','skipped');end if;
 if j.run_at>clock_timestamp() then
  update public.follow_up_jobs set status='pending',reason='not_due',claim_token=null,claim_until=null,attempts=greatest(0,attempts-1) where id=j.id;
  return jsonb_build_object('status','deferred','reason','not_due');
 end if;
 select * into w from public.follow_up_workflows where id=j.workflow_id and tenant_id=j.tenant_id;
 if c.id is null or c.tenant_id is distinct from j.tenant_id or w.id is null then reason:='invalid_reference';
 elsif not public.has_tenant_feature(j.tenant_id,'customer_follow_up') or (j.kind<>'payment' or w.use_ai) and not public.has_tenant_feature(j.tenant_id,'ai_agent') then reason:='plan_required';
 elsif not j.manual_without_order and (not w.enabled or not t.auto_reply_enabled) then reason:='disabled';
 elsif w.version<>j.workflow_version then reason:='workflow_changed';
 elsif c.followup_opted_out then reason:='opt_out';
 elsif c.contact_suspended then reason:='contact_suspended';
 elsif not c.bot_enabled or c.assigned_user_id is not null or c.conversation_status='closed' then reason:='handover';
 elsif (w.stop_on_reply or j.kind='interested') and c.inbound_seq>j.source_seq then reason:='customer_replied';end if;
 if reason is null and j.kind in ('payment','after_sales') and not j.manual_without_order then
  select * into o from public.orders where id=j.order_id and tenant_id=j.tenant_id and customer_id=j.customer_id;
  if not found then reason:='invalid_reference';
  elsif o.status='cancelled' then reason:='order_cancelled';
  elsif j.kind='payment' and o.status<>'pending_payment' then reason:='paid';
  elsif j.kind='payment' and o.confirmed_at is null then reason:='order_unconfirmed';next_status:='requires_review';
  elsif j.kind='payment' and exists(select 1 from public.slips where tenant_id=j.tenant_id and customer_id=c.id and created_at>=o.created_at) then reason:='slip_received';next_status:='requires_review';
  elsif j.kind='after_sales' and (o.status<>'shipped' or not exists(select 1 from public.order_delivery_events where order_id=o.id and tenant_id=j.tenant_id and delivered_at<=clock_timestamp())) then reason:='invalid_reference';end if;
  product:=o.product_name;total:=o.amount;
 elsif reason is null and j.kind='interested' and not j.manual_without_order then
  select name,price into product,total from public.products where id=j.product_id and tenant_id=j.tenant_id and is_active;
  if not found or not exists(select 1 from public.messages where id=j.source_message_id and customer_id=c.id and sender='customer') then reason:='invalid_reference';
  elsif exists(select 1 from public.orders where tenant_id=j.tenant_id and customer_id=c.id and created_at>=j.anchor_at) then reason:='new_order';end if;
 end if;
 if reason is null and not public.follow_up_window_open(j.tenant_id,j.customer_id) then reason:='window_closed';next_status:='requires_review';end if;
 if reason is null and (w.use_ai or j.manual_without_order) and not j.ai_approved then reason:='ai_draft';next_status:='requires_review';end if;
 if reason is not null then
  update public.follow_up_jobs set status=next_status,reason=preflight.reason,claim_token=null,claim_until=null where id=j.id;
  return jsonb_build_object('status',next_status,'reason',reason);
 end if;
 if c.outbound_lock_until>clock_timestamp() then
  update public.follow_up_jobs set status='pending',reason='delivery_busy',run_at=clock_timestamp()+interval '1 minute',attempts=greatest(0,attempts-1),claim_token=null,claim_until=null where id=j.id;return jsonb_build_object('status','deferred');
 end if;
 if exists(select 1 from public.messages where external_id='followup:'||j.id::text) then
  update public.follow_up_jobs set status='requires_review',reason='delivery_unknown',claim_token=null,claim_until=null where id=j.id;return jsonb_build_object('status','requires_review');
 end if;
 select * into reservation from public.reserve_broadcast_credits(j.tenant_id,1);
 if reservation.monthly+reservation.topup<>1 then
  update public.follow_up_jobs set status='requires_review',reason='quota_exhausted',claim_token=null,claim_until=null where id=j.id;return jsonb_build_object('status','requires_review','reason','quota_exhausted');
 end if;
 -- The lease blocks Inbox claim/transfer while the network request is in flight.
 lease:=public.start_inbox_delivery(c.id,null);
 rendered:=public.render_smart_follow_up(j.text,c.display_name,product,total);
 insert into public.messages(customer_id,sender,external_id,body,delivery_status) values(c.id,'bot','followup:'||j.id::text,rendered,'pending') returning id into msg;
 update public.follow_up_jobs set dispatch_started_at=clock_timestamp(),message_id=msg,delivery_lease=lease,reserved_monthly=reservation.monthly,reserved_topup=reservation.topup where id=j.id;
 return jsonb_build_object('status','ready','text',rendered,'customerId',c.id,'psid',c.platform_user_id,'tenantId',j.tenant_id,'messageId',msg);
end $$$sql_69_5$;
exception when invalid_function_definition then
  -- A newer signature of prepare_follow_up(uuid,uuid) is already installed. Its final definition below is mandatory.
  null;
end;

-- follow-up-manual-dispatch-fix.sql: source statement 6
begin
execute $sql_69_6$create or replace function public.authorize_follow_up_dispatch(p_job uuid,p_claim uuid) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare j public.follow_up_jobs;c public.customers;o public.orders;t public.tenants;
 w public.follow_up_workflows;block_reason text;next_status text:='cancelled';
begin
 select * into j from public.follow_up_jobs where id=p_job;
 if not found then return jsonb_build_object('status','skipped','reason','invalid_reference');end if;
 -- Lock orders before jobs, matching the order-status trigger's order -> jobs order.
 select * into t from public.tenants where id=j.tenant_id for update;
 select * into c from public.customers where id=j.customer_id for update;
 if j.order_id is not null then
   select * into o from public.orders where id=j.order_id and tenant_id=j.tenant_id and customer_id=j.customer_id for update;
 end if;
 select * into j from public.follow_up_jobs where id=p_job for update;
 if j.status<>'processing' or j.claim_token is distinct from p_claim or j.dispatch_started_at is null or j.send_authorized_at is not null then
   return jsonb_build_object('status','skipped','reason','dispatch_not_available');
 end if;
 select * into w from public.follow_up_workflows where id=j.workflow_id and tenant_id=j.tenant_id;
 if c.id is null or c.tenant_id is distinct from j.tenant_id or w.id is null then block_reason:='invalid_reference';
 elsif j.claim_until<=clock_timestamp() then block_reason:='claim_expired';next_status:='requires_review';
 elsif j.run_at>clock_timestamp() then block_reason:='not_due';next_status:='requires_review';
 elsif not public.has_tenant_feature(j.tenant_id,'customer_follow_up') or (j.kind<>'payment' or w.use_ai) and not public.has_tenant_feature(j.tenant_id,'ai_agent') then block_reason:='plan_required';
 elsif not j.manual_without_order and (not w.enabled or not t.auto_reply_enabled) then block_reason:='disabled';
 elsif w.version<>j.workflow_version then block_reason:='workflow_changed';
 elsif c.followup_opted_out then block_reason:='opt_out';
 elsif c.contact_suspended then block_reason:='contact_suspended';
 elsif not c.bot_enabled or c.assigned_user_id is not null or c.conversation_status='closed' then block_reason:='handover';
 elsif (w.stop_on_reply or j.kind='interested') and c.inbound_seq>j.source_seq then block_reason:='customer_replied';
 end if;
 if block_reason is null and j.kind='payment' and not j.manual_without_order then
   if o.id is null then block_reason:='invalid_reference';
   elsif o.status='cancelled' then block_reason:='order_cancelled';
   elsif o.status<>'pending_payment' then block_reason:='paid';
   elsif o.confirmed_at is null then block_reason:='order_unconfirmed';next_status:='requires_review';
   elsif exists(select 1 from public.slips where tenant_id=j.tenant_id and customer_id=j.customer_id and created_at>=o.created_at) then block_reason:='slip_received';next_status:='requires_review';
   end if;
 end if;
 if block_reason is null and j.manual_without_order and not j.ai_approved then block_reason:='ai_draft';next_status:='requires_review';end if;
 if block_reason is null and not public.follow_up_window_open(j.tenant_id,j.customer_id) then block_reason:='window_closed';next_status:='requires_review';end if;
 if block_reason is not null then
   if not public.complete_follow_up(j.id,p_claim,'failed',null,block_reason) then return jsonb_build_object('status','skipped');end if;
   update public.follow_up_jobs set status=next_status,reason=block_reason where id=j.id;
   insert into public.follow_up_execution_logs(tenant_id,job_id,status,reason) values(j.tenant_id,j.id,'precheck_blocked',block_reason);
   return jsonb_build_object('status',next_status,'reason',block_reason);
 end if;
 update public.follow_up_jobs set send_authorized_at=clock_timestamp() where id=j.id;
 insert into public.follow_up_execution_logs(tenant_id,job_id,status,reason)
 values(j.tenant_id,j.id,'precheck_passed',case when j.kind='payment' then 'unpaid_confirmed' else 'eligibility_confirmed' end);
 return jsonb_build_object('status','ready');
end $$$sql_69_6$;
exception when invalid_function_definition then
  -- A newer signature of authorize_follow_up_dispatch(uuid,uuid) is already installed. Its final definition below is mandatory.
  null;
end;

-- follow-up-manual-dispatch-fix.sql: source statement 7
execute $sql_69_7$revoke all on function public.prepare_follow_up(uuid,uuid),public.authorize_follow_up_dispatch(uuid,uuid) from public,anon,authenticated$sql_69_7$;

-- follow-up-manual-dispatch-fix.sql: source statement 8
execute $sql_69_8$grant execute on function public.prepare_follow_up(uuid,uuid),public.authorize_follow_up_dispatch(uuid,uuid) to service_role$sql_69_8$;

-- follow-up-manual-dispatch-fix.sql: source statement 9
execute $sql_69_9$notify pgrst,'reload schema'$sql_69_9$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('follow-up-manual-dispatch-fix.sql','686e7d60ade6ac2a0adf2813fa6ad295c37fd30df2ce80de5b210552bc0dd8d3','c05b6fe3c8261f43a521871557de3f2436712570afbbfd6d536340e403de1bc5');
end $migration_69$;

-- 71. follow-up-24h-window.sql
do $migration_70$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='follow-up-24h-window.sql';
  if found then
    if installed <> '76caf6b5706c82b2bc43a202e7628cb1d1b2c4b846034479f9e731c441ebcda1' then
      raise exception 'Applied migration changed: follow-up-24h-window.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- follow-up-24h-window.sql: source statement 2
execute $sql_70_2$alter table public.customers add column if not exists last_interaction_at timestamptz$sql_70_2$;

-- follow-up-24h-window.sql: source statement 3
execute $sql_70_3$alter table public.customers add column if not exists window_expires_at timestamptz$sql_70_3$;

-- follow-up-24h-window.sql: source statement 4
execute $sql_70_4$create or replace function public.sync_facebook_customer_window() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.platform='facebook' then
  new.window_expires_at:=case when new.last_interaction_at is null then null
   else new.last_interaction_at+interval '86400 seconds' end;
 end if;
 return new;
end $$$sql_70_4$;

-- follow-up-24h-window.sql: source statement 5
execute $sql_70_5$drop trigger if exists customers_facebook_window on public.customers$sql_70_5$;

-- follow-up-24h-window.sql: source statement 6
execute $sql_70_6$create trigger customers_facebook_window before insert or update of last_interaction_at
 on public.customers for each row execute function public.sync_facebook_customer_window()$sql_70_6$;

-- follow-up-24h-window.sql: source statement 7
execute $sql_70_7$create or replace function public.sync_facebook_evidence_window() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.kind='inbound_message' and new.interacted_at<=clock_timestamp() then
  update public.customers c set last_interaction_at=new.interacted_at
  from public.tenants t where c.id=new.customer_id and c.tenant_id=new.tenant_id
   and c.platform='facebook' and t.id=c.tenant_id and t.page_id=new.page_id
   and (c.last_interaction_at is null or c.last_interaction_at<new.interacted_at);
 end if;
 return new;
end $$$sql_70_7$;

-- follow-up-24h-window.sql: source statement 8
execute $sql_70_8$drop trigger if exists broadcast_inbound_customer_window on public.broadcast_messaging_events$sql_70_8$;

-- follow-up-24h-window.sql: source statement 9
execute $sql_70_9$create trigger broadcast_inbound_customer_window after insert or update
 on public.broadcast_messaging_events for each row execute function public.sync_facebook_evidence_window()$sql_70_9$;

-- follow-up-24h-window.sql: source statement 11
execute $sql_70_11$create or replace function public.follow_up_window_expires_at(p_tenant uuid,p_customer uuid)
returns timestamptz language sql stable security definer set search_path=pg_catalog,public as $$
 select least(c.window_expires_at,e.inbound_at+interval '86400 seconds')
 from public.customers c join public.tenants t on t.id=c.tenant_id and t.is_active
 cross join lateral (select max(b.interacted_at) inbound_at from public.broadcast_messaging_events b
  where b.tenant_id=t.id and b.customer_id=c.id and b.page_id=t.page_id and b.kind='inbound_message') e
 where c.id=p_customer and c.tenant_id=p_tenant and c.platform='facebook'
  and c.window_expires_at is not null and c.last_interaction_at<=statement_timestamp()
  and e.inbound_at<=statement_timestamp()
$$$sql_70_11$;

-- follow-up-24h-window.sql: source statement 12
execute $sql_70_12$create or replace function public.follow_up_window_open(p_tenant uuid,p_customer uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(public.follow_up_window_expires_at(p_tenant,p_customer)>statement_timestamp(),false)
$$$sql_70_12$;

-- follow-up-24h-window.sql: source statement 13
execute $sql_70_13$create or replace function public.complete_follow_up(p_job uuid,p_claim uuid,p_result text,p_provider text default null,p_reason text default null) returns boolean
language plpgsql set search_path=pg_catalog,public as $$
declare j public.follow_up_jobs;
begin
 select * into j from public.follow_up_jobs where id=p_job;
 if not found then return false;end if;
 perform 1 from public.tenants where id=j.tenant_id for update;
 perform 1 from public.customers where id=j.customer_id for update;
 select * into j from public.follow_up_jobs where id=p_job for update;
 if j.status<>'processing' or j.claim_token is distinct from p_claim or j.dispatch_started_at is null then return false;end if;
 if p_result is null or p_result not in ('sent','failed','requires_review','cancelled')
 or (p_result='sent' and nullif(trim(p_provider),'') is null)
 or (p_result='cancelled' and (p_reason is distinct from 'outside_24h_window' or p_provider is not null)) then
  raise exception 'Invalid delivery outcome or missing provider receipt' using errcode='22023';end if;
 if p_result in ('failed','cancelled') or p_result='requires_review' and p_reason='window_closed' then
  perform public.refund_broadcast_credits(j.tenant_id,j.reserved_monthly,j.reserved_topup);end if;
 update public.messages set delivery_status=case when p_result='sent' then 'sent'
  when p_result in ('failed','cancelled') or p_reason='window_closed' then 'failed' else 'unknown' end,
  provider_message_id=p_provider where id=j.message_id;
 update public.follow_up_jobs set status=p_result,reason=p_reason,provider_message_id=p_provider,
  sent_at=case when p_result='sent' then now() else null end,claim_token=null,claim_until=null,
  reserved_monthly=0,reserved_topup=0 where id=j.id;
 perform public.end_inbox_delivery(j.customer_id,j.delivery_lease);
 return true;
end $$$sql_70_13$;

-- follow-up-24h-window.sql: source statement 14
execute $sql_70_14$create or replace function public.expire_follow_up_if_outside_window(p_job uuid,p_claim uuid) returns boolean
language plpgsql set search_path=pg_catalog,public as $$
declare j public.follow_up_jobs;
begin
 select * into j from public.follow_up_jobs where id=p_job;
 if not found then return false;end if;
 perform 1 from public.tenants where id=j.tenant_id for update;
 perform 1 from public.customers where id=j.customer_id for update;
 select * into j from public.follow_up_jobs where id=p_job for update;
 if j.status<>'processing' or j.claim_token is distinct from p_claim or j.claim_until<=clock_timestamp()
 or j.dispatch_started_at is not null then return false;end if;
 if public.follow_up_window_open(j.tenant_id,j.customer_id) then return false;end if;
 update public.follow_up_jobs set status='cancelled',reason='outside_24h_window',claim_token=null,claim_until=null where id=j.id;
 return true;
end $$$sql_70_14$;

-- follow-up-24h-window.sql: source statement 15
execute $sql_70_15$revoke all on function public.sync_facebook_customer_window(),public.sync_facebook_evidence_window() from public,anon,authenticated,service_role$sql_70_15$;

-- follow-up-24h-window.sql: source statement 16
execute $sql_70_16$revoke all on function public.follow_up_window_expires_at(uuid,uuid),public.follow_up_window_open(uuid,uuid),public.complete_follow_up(uuid,uuid,text,text,text),public.expire_follow_up_if_outside_window(uuid,uuid) from public,anon,authenticated$sql_70_16$;

-- follow-up-24h-window.sql: source statement 17
execute $sql_70_17$grant execute on function public.follow_up_window_expires_at(uuid,uuid),public.follow_up_window_open(uuid,uuid),public.complete_follow_up(uuid,uuid,text,text,text),public.expire_follow_up_if_outside_window(uuid,uuid) to service_role$sql_70_17$;

-- follow-up-24h-window.sql: source statement 18
execute $sql_70_18$create or replace function public.prepare_follow_up(p_job uuid,p_claim uuid) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
<<preflight>>
declare j public.follow_up_jobs;c public.customers;w public.follow_up_workflows;t public.tenants;o public.orders;
 reason text;next_status text:='cancelled';reservation record;lease uuid;msg uuid;rendered text;product text;total numeric;
begin
 select * into j from public.follow_up_jobs where id=p_job;
 if not found then return jsonb_build_object('status','skipped');end if;
 -- Consistent tenant -> customer -> job order, also used by completion. Customer triggers lock jobs.
 select * into t from public.tenants where id=j.tenant_id for update;
 select * into c from public.customers where id=j.customer_id for update;
 if j.order_id is not null then perform 1 from public.orders where id=j.order_id and tenant_id=j.tenant_id and customer_id=j.customer_id for update;end if;
 select * into j from public.follow_up_jobs where id=p_job for update;
 if j.status<>'processing' or j.claim_token is distinct from p_claim or j.claim_until<=clock_timestamp() or j.dispatch_started_at is not null then return jsonb_build_object('status','skipped');end if;
 if j.run_at>clock_timestamp() then
  update public.follow_up_jobs set status='pending',reason='not_due',claim_token=null,claim_until=null,attempts=greatest(0,attempts-1) where id=j.id;
  return jsonb_build_object('status','deferred','reason','not_due');
 end if;
 select * into w from public.follow_up_workflows where id=j.workflow_id and tenant_id=j.tenant_id;
 if c.id is null or c.tenant_id is distinct from j.tenant_id or w.id is null then reason:='invalid_reference';
 elsif not public.has_tenant_feature(j.tenant_id,'customer_follow_up') or (j.kind<>'payment' or w.use_ai) and not public.has_tenant_feature(j.tenant_id,'ai_agent') then reason:='plan_required';
 elsif not j.manual_without_order and (not w.enabled or not t.auto_reply_enabled) then reason:='disabled';
 elsif w.version<>j.workflow_version then reason:='workflow_changed';
 elsif c.followup_opted_out then reason:='opt_out';
 elsif c.contact_suspended then reason:='contact_suspended';
 elsif not c.bot_enabled or c.assigned_user_id is not null or c.conversation_status='closed' then reason:='handover';
 elsif (w.stop_on_reply or j.kind='interested') and c.inbound_seq>j.source_seq then reason:='customer_replied';end if;
 if reason is null and j.kind in ('payment','after_sales') and not j.manual_without_order then
  select * into o from public.orders where id=j.order_id and tenant_id=j.tenant_id and customer_id=j.customer_id;
  if not found then reason:='invalid_reference';
  elsif o.status='cancelled' then reason:='order_cancelled';
  elsif j.kind='payment' and o.status<>'pending_payment' then reason:='paid';
  elsif j.kind='payment' and o.confirmed_at is null then reason:='order_unconfirmed';next_status:='requires_review';
  elsif j.kind='payment' and exists(select 1 from public.slips where tenant_id=j.tenant_id and customer_id=c.id and created_at>=o.created_at) then reason:='slip_received';next_status:='requires_review';
  elsif j.kind='after_sales' and (o.status<>'shipped' or not exists(select 1 from public.order_delivery_events where order_id=o.id and tenant_id=j.tenant_id and delivered_at<=clock_timestamp())) then reason:='invalid_reference';end if;
  product:=o.product_name;total:=o.amount;
 elsif reason is null and j.kind='interested' and not j.manual_without_order then
  select name,price into product,total from public.products where id=j.product_id and tenant_id=j.tenant_id and is_active;
  if not found or not exists(select 1 from public.messages where id=j.source_message_id and customer_id=c.id and sender='customer') then reason:='invalid_reference';
  elsif exists(select 1 from public.orders where tenant_id=j.tenant_id and customer_id=c.id and created_at>=j.anchor_at) then reason:='new_order';end if;
 end if;
 if reason is null and not public.follow_up_window_open(j.tenant_id,j.customer_id) then reason:='outside_24h_window';next_status:='cancelled';end if;
 if reason is null and (w.use_ai or j.manual_without_order) and not j.ai_approved then reason:='ai_draft';next_status:='requires_review';end if;
 if reason is not null then
  update public.follow_up_jobs set status=next_status,reason=preflight.reason,claim_token=null,claim_until=null where id=j.id;
  return jsonb_build_object('status',next_status,'reason',reason);
 end if;
 if c.outbound_lock_until>clock_timestamp() then
  update public.follow_up_jobs set status='pending',reason='delivery_busy',run_at=clock_timestamp()+interval '1 minute',attempts=greatest(0,attempts-1),claim_token=null,claim_until=null where id=j.id;return jsonb_build_object('status','deferred');
 end if;
 if exists(select 1 from public.messages where external_id='followup:'||j.id::text) then
  update public.follow_up_jobs set status='requires_review',reason='delivery_unknown',claim_token=null,claim_until=null where id=j.id;return jsonb_build_object('status','requires_review');
 end if;
 select * into reservation from public.reserve_broadcast_credits(j.tenant_id,1);
 if reservation.monthly+reservation.topup<>1 then
  update public.follow_up_jobs set status='requires_review',reason='quota_exhausted',claim_token=null,claim_until=null where id=j.id;return jsonb_build_object('status','requires_review','reason','quota_exhausted');
 end if;
 -- The lease blocks Inbox claim/transfer while the network request is in flight.
 lease:=public.start_inbox_delivery(c.id,null);
 rendered:=public.render_smart_follow_up(j.text,c.display_name,product,total);
 insert into public.messages(customer_id,sender,external_id,body,delivery_status) values(c.id,'bot','followup:'||j.id::text,rendered,'pending') returning id into msg;
 update public.follow_up_jobs set dispatch_started_at=clock_timestamp(),message_id=msg,delivery_lease=lease,reserved_monthly=reservation.monthly,reserved_topup=reservation.topup where id=j.id;
 return jsonb_build_object('status','ready','text',rendered,'customerId',c.id,'psid',c.platform_user_id,'tenantId',j.tenant_id,'messageId',msg);
end $$$sql_70_18$;

-- follow-up-24h-window.sql: source statement 19
execute $sql_70_19$create or replace function public.authorize_follow_up_dispatch(p_job uuid,p_claim uuid) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare j public.follow_up_jobs;c public.customers;o public.orders;t public.tenants;
 w public.follow_up_workflows;block_reason text;next_status text:='cancelled';
begin
 select * into j from public.follow_up_jobs where id=p_job;
 if not found then return jsonb_build_object('status','skipped','reason','invalid_reference');end if;
 -- Lock orders before jobs, matching the order-status trigger's order -> jobs order.
 select * into t from public.tenants where id=j.tenant_id for update;
 select * into c from public.customers where id=j.customer_id for update;
 if j.order_id is not null then
   select * into o from public.orders where id=j.order_id and tenant_id=j.tenant_id and customer_id=j.customer_id for update;
 end if;
 select * into j from public.follow_up_jobs where id=p_job for update;
 if j.status<>'processing' or j.claim_token is distinct from p_claim or j.dispatch_started_at is null or j.send_authorized_at is not null then
   return jsonb_build_object('status','skipped','reason','dispatch_not_available');
 end if;
 select * into w from public.follow_up_workflows where id=j.workflow_id and tenant_id=j.tenant_id;
 if c.id is null or c.tenant_id is distinct from j.tenant_id or w.id is null then block_reason:='invalid_reference';
 elsif j.claim_until<=clock_timestamp() then block_reason:='claim_expired';next_status:='requires_review';
 elsif j.run_at>clock_timestamp() then block_reason:='not_due';next_status:='requires_review';
 elsif not public.has_tenant_feature(j.tenant_id,'customer_follow_up') or (j.kind<>'payment' or w.use_ai) and not public.has_tenant_feature(j.tenant_id,'ai_agent') then block_reason:='plan_required';
 elsif not j.manual_without_order and (not w.enabled or not t.auto_reply_enabled) then block_reason:='disabled';
 elsif w.version<>j.workflow_version then block_reason:='workflow_changed';
 elsif c.followup_opted_out then block_reason:='opt_out';
 elsif c.contact_suspended then block_reason:='contact_suspended';
 elsif not c.bot_enabled or c.assigned_user_id is not null or c.conversation_status='closed' then block_reason:='handover';
 elsif (w.stop_on_reply or j.kind='interested') and c.inbound_seq>j.source_seq then block_reason:='customer_replied';
 end if;
 if block_reason is null and j.kind='payment' and not j.manual_without_order then
   if o.id is null then block_reason:='invalid_reference';
   elsif o.status='cancelled' then block_reason:='order_cancelled';
   elsif o.status<>'pending_payment' then block_reason:='paid';
   elsif o.confirmed_at is null then block_reason:='order_unconfirmed';next_status:='requires_review';
   elsif exists(select 1 from public.slips where tenant_id=j.tenant_id and customer_id=j.customer_id and created_at>=o.created_at) then block_reason:='slip_received';next_status:='requires_review';
   end if;
 end if;
 if block_reason is null and j.manual_without_order and not j.ai_approved then block_reason:='ai_draft';next_status:='requires_review';end if;
 if block_reason is null and not public.follow_up_window_open(j.tenant_id,j.customer_id) then block_reason:='outside_24h_window';next_status:='cancelled';end if;
 if block_reason is not null then
   if not public.complete_follow_up(j.id,p_claim,'failed',null,block_reason) then return jsonb_build_object('status','skipped');end if;
   update public.follow_up_jobs set status=next_status,reason=block_reason where id=j.id;
   insert into public.follow_up_execution_logs(tenant_id,job_id,status,reason) values(j.tenant_id,j.id,'precheck_blocked',block_reason);
   return jsonb_build_object('status',next_status,'reason',block_reason);
 end if;
 update public.follow_up_jobs set send_authorized_at=clock_timestamp() where id=j.id;
 insert into public.follow_up_execution_logs(tenant_id,job_id,status,reason)
 values(j.tenant_id,j.id,'precheck_passed',case when j.kind='payment' then 'unpaid_confirmed' else 'eligibility_confirmed' end);
 return jsonb_build_object('status','ready','windowExpiresAt',public.follow_up_window_expires_at(j.tenant_id,j.customer_id));
end $$$sql_70_19$;

-- follow-up-24h-window.sql: source statement 20
execute $sql_70_20$revoke all on function public.prepare_follow_up(uuid,uuid),public.authorize_follow_up_dispatch(uuid,uuid) from public,anon,authenticated$sql_70_20$;

-- follow-up-24h-window.sql: source statement 21
execute $sql_70_21$grant execute on function public.prepare_follow_up(uuid,uuid),public.authorize_follow_up_dispatch(uuid,uuid) to service_role$sql_70_21$;

-- follow-up-24h-window.sql: source statement 22
execute $sql_70_22$notify pgrst,'reload schema'$sql_70_22$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('follow-up-24h-window.sql','76caf6b5706c82b2bc43a202e7628cb1d1b2c4b846034479f9e731c441ebcda1','18871aeb28c2b8fd9fac9a16588904281380c733721168135fa49d3733eaaacd');
end $migration_70$;

-- 72. follow-up-approval-mode.sql
do $migration_71$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='follow-up-approval-mode.sql';
  if found then
    if installed <> '3717e1cf71a8884a771484919e06243c1cf0940fcc57bf080250c117787192af' then
      raise exception 'Applied migration changed: follow-up-approval-mode.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- follow-up-approval-mode.sql: source statement 2
execute $sql_71_2$alter table public.follow_up_policies add column if not exists approval_mode text
 not null default 'manual_review' check(approval_mode in ('manual_review','auto_approve'))$sql_71_2$;

-- follow-up-approval-mode.sql: source statement 3
execute $sql_71_3$create or replace function public.set_follow_up_approval_mode(p_tenant uuid,p_actor uuid,p_mode text)
returns text language plpgsql set search_path=pg_catalog,public as $$
begin
 if not public.has_tenant_feature(p_tenant,'customer_follow_up') or not (
  exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor)
  or exists(select 1 from public.platform_admins where user_id=p_actor)) then
  raise exception 'Forbidden' using errcode='42501';
 end if;
 if p_mode is null or p_mode not in ('manual_review','auto_approve') then
  raise exception 'Invalid approval mode' using errcode='22023';
 end if;
 perform 1 from public.tenants where id=p_tenant for update;
 -- Update only the approval setting: do not toggle automation, revise workflows,
 -- cancel queues or approve historical drafts.
 insert into public.follow_up_policies(tenant_id,approval_mode) values(p_tenant,p_mode)
 on conflict(tenant_id) do update set approval_mode=excluded.approval_mode;
 return p_mode;
end $$$sql_71_3$;

-- follow-up-approval-mode.sql: source statement 4
execute $sql_71_4$create or replace function public.apply_follow_up_approval_mode() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare mode text;
begin
 if new.status in ('pending','scheduled') or new.status='requires_review' and new.reason='ai_draft' then
  select approval_mode into mode from public.follow_up_policies where tenant_id=new.tenant_id;
  new.ai_approved:=coalesce(mode,'manual_review')='auto_approve';
  new.status:=case when new.ai_approved then 'pending' else 'requires_review' end;
  new.reason:=case when new.ai_approved then null else 'ai_draft' end;
 end if;
 return new;
end $$$sql_71_4$;

-- follow-up-approval-mode.sql: source statement 5
execute $sql_71_5$drop trigger if exists follow_up_approval_mode on public.follow_up_jobs$sql_71_5$;

-- follow-up-approval-mode.sql: source statement 6
execute $sql_71_6$create trigger follow_up_approval_mode before insert on public.follow_up_jobs
 for each row execute function public.apply_follow_up_approval_mode()$sql_71_6$;

-- follow-up-approval-mode.sql: source statement 7
execute $sql_71_7$create or replace function public.retry_rejected_follow_up(p_job uuid,p_tenant uuid,p_actor uuid)
returns text language plpgsql set search_path=pg_catalog,public as $$
declare j public.follow_up_jobs; m public.messages;
begin
 if not public.has_tenant_feature(p_tenant,'customer_follow_up') or not (
  exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor)
  or exists(select 1 from public.platform_admins where user_id=p_actor)) then
  raise exception 'Forbidden' using errcode='42501';
 end if;
 select * into j from public.follow_up_jobs where id=p_job and tenant_id=p_tenant;
 if not found then raise exception 'Job not found' using errcode='P0002';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 perform 1 from public.customers where id=j.customer_id and tenant_id=p_tenant for update;
 select * into j from public.follow_up_jobs where id=p_job and tenant_id=p_tenant for update;
 if j.status<>'failed' or coalesce(j.reason,'') not in ('api_rejected','page_restricted')
 or j.dispatch_started_at is null or j.provider_message_id is not null
 or j.claim_token is not null or j.claim_until is not null
 or j.reserved_monthly<>0 or j.reserved_topup<>0 then
  raise exception 'Only confirmed rejected sends can retry' using errcode='40001';
 end if;
 select * into m from public.messages where id=j.message_id and customer_id=j.customer_id for update;
 if m.id is null or m.delivery_status is distinct from 'failed' or m.provider_message_id is not null
 or m.external_id is distinct from 'followup:'||j.id::text then
  raise exception 'Delivery outcome is not a confirmed refusal' using errcode='40001';
 end if;
 if not public.follow_up_window_open(p_tenant,j.customer_id) then
  update public.follow_up_jobs set status='cancelled',reason='outside_24h_window' where id=j.id;
  insert into public.follow_up_execution_logs(tenant_id,job_id,status,reason,actor_id)
  values(p_tenant,j.id,'admin_action','retry_outside_24h_window',p_actor);
  return 'cancelled';
 end if;
 update public.messages set external_id='followup:'||j.id::text||':rejected:'||m.id::text where id=m.id;
 update public.follow_up_jobs set status='pending',reason=null,attempts=0,
  run_at=greatest(run_at,clock_timestamp()),dispatch_started_at=null,send_authorized_at=null,
  message_id=null,delivery_lease=null,sent_at=null where id=j.id;
 insert into public.follow_up_execution_logs(tenant_id,job_id,status,reason,actor_id)
 values(p_tenant,j.id,'admin_action','retry_confirmed_refusal',p_actor);
 return 'pending';
end $$$sql_71_7$;

-- follow-up-approval-mode.sql: source statement 8
execute $sql_71_8$revoke all on function public.apply_follow_up_approval_mode() from public,anon,authenticated,service_role$sql_71_8$;

-- follow-up-approval-mode.sql: source statement 9
execute $sql_71_9$revoke all on function public.set_follow_up_approval_mode(uuid,uuid,text),public.retry_rejected_follow_up(uuid,uuid,uuid) from public,anon,authenticated$sql_71_9$;

-- follow-up-approval-mode.sql: source statement 10
execute $sql_71_10$grant execute on function public.set_follow_up_approval_mode(uuid,uuid,text),public.retry_rejected_follow_up(uuid,uuid,uuid) to service_role$sql_71_10$;

-- follow-up-approval-mode.sql: source statement 11
execute $sql_71_11$notify pgrst,'reload schema'$sql_71_11$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('follow-up-approval-mode.sql','3717e1cf71a8884a771484919e06243c1cf0940fcc57bf080250c117787192af','53f81f07be504e99d4afbe8fab1f25c6f859f218470b280ceea2dc44760f74a4');
end $migration_71$;

-- 73. dashboard-performance.sql
do $migration_72$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='dashboard-performance.sql';
  if found then
    if installed <> '46d2e45b9ba06db45bd485a127affc7165b8231858c5b8ac9effb619a531bb08' then
      raise exception 'Applied migration changed: dashboard-performance.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- dashboard-performance.sql: source statement 2
execute $sql_72_2$create index if not exists overview_slips_time on public.slips(tenant_id,created_at desc,id)$sql_72_2$;

-- dashboard-performance.sql: source statement 3
execute $sql_72_3$create index if not exists overview_customers_time on public.customers(tenant_id,last_message_at desc,id)$sql_72_3$;

-- dashboard-performance.sql: source statement 4
execute $sql_72_4$create index if not exists overview_messages_latest on public.messages(customer_id,created_at desc,id desc) include(sender)$sql_72_4$;

-- dashboard-performance.sql: source statement 5
execute $sql_72_5$create index if not exists overview_messages_inbound on public.messages(customer_id,created_at) where sender='customer'$sql_72_5$;

-- dashboard-performance.sql: source statement 6
execute $sql_72_6$create index if not exists overview_agent_time on public.agent_message_jobs(tenant_id,created_at) include(route,status,customer_id)$sql_72_6$;

-- dashboard-performance.sql: source statement 7
execute $sql_72_7$create index if not exists commerce_products_page on public.products(tenant_id,created_at desc,id) where not commerce_archived$sql_72_7$;

-- dashboard-performance.sql: source statement 8
execute $sql_72_8$create index if not exists commerce_products_low_stock on public.products(tenant_id,stock,id) where not commerce_archived and is_active and stock<=3$sql_72_8$;

-- dashboard-performance.sql: source statement 9
execute $sql_72_9$create index if not exists commerce_orders_page on public.commerce_orders(tenant_id,created_at desc,id)$sql_72_9$;

-- dashboard-performance.sql: source statement 10
execute $sql_72_10$create index if not exists commerce_orders_status_page on public.commerce_orders(tenant_id,status,created_at desc,id)$sql_72_10$;

-- dashboard-performance.sql: source statement 11
execute $sql_72_11$create index if not exists commerce_orders_paid_time on public.commerce_orders(tenant_id,paid_at) include(total,status)$sql_72_11$;

-- dashboard-performance.sql: source statement 12
execute $sql_72_12$create index if not exists commerce_customers_page on public.commerce_customers(tenant_id,created_at desc,id)$sql_72_12$;

-- dashboard-performance.sql: source statement 13
execute $sql_72_13$create index if not exists commerce_items_tenant_order on public.commerce_order_items(tenant_id,order_id)$sql_72_13$;

-- dashboard-performance.sql: source statement 14
execute $sql_72_14$create index if not exists commerce_audit_entity on public.commerce_audit(tenant_id,entity_id,created_at desc,id)$sql_72_14$;

-- dashboard-performance.sql: source statement 15
execute $sql_72_15$create index if not exists commerce_categories_page on public.commerce_categories(tenant_id,name,id)$sql_72_15$;

-- dashboard-performance.sql: source statement 16
execute $sql_72_16$create index if not exists commerce_pages_page on public.commerce_pages(tenant_id,id)$sql_72_16$;

-- dashboard-performance.sql: source statement 17
execute $sql_72_17$create or replace function public.overview_dashboard_stats(p_tenant uuid,p_from timestamptz,p_to timestamptz,p_previous timestamptz,p_page integer,p_query text)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare answer jsonb;slip_access boolean;chat_access boolean;ai_access boolean;
begin
 if p_tenant is null or not exists(select 1 from public.tenants where id=p_tenant and is_active) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_page is null or p_page not between 1 and 1000 or p_query is null or length(p_query)>100 or p_to is null or not isfinite(p_to)
 or p_from is not null and (not isfinite(p_from) or p_from>=p_to or p_to-p_from>interval '91 days')
 or p_previous is not null and (p_from is null or not isfinite(p_previous) or p_previous>=p_from or p_from-p_previous>interval '90 days') then raise exception 'Invalid filters' using errcode='22023';end if;
 slip_access:=public.has_tenant_feature(p_tenant,'slip_auto_pilot');
 chat_access:=public.has_tenant_feature(p_tenant,'customer_management');
 ai_access:=public.has_tenant_feature(p_tenant,'ai_agent');
 with
 slip_source as materialized (
  select s.id,s.customer_id,s.created_at,s.amount,s.note,s.trans_ref,
   case when s.status='valid' or s.approved_at is not null and s.status in ('amount_mismatch','wrong_receiver','fake','error') then 'passed'
   when s.status in ('pending','amount_mismatch','wrong_receiver') then 'pending' when s.status='error' then 'error' else 'rejected' end result
  from public.slips s where slip_access and s.tenant_id=p_tenant and s.created_at<p_to and (coalesce(p_previous,p_from) is null or s.created_at>=coalesce(p_previous,p_from))
 ), current_slips as materialized (select * from slip_source where p_from is null or created_at>=p_from),
 previous_slips as (select * from slip_source where p_previous is not null and created_at<p_from),
 slip_matches as materialized (
  select s.id,s.created_at,c.display_name customer,to_jsonb(c)->>'avatar_url' avatar_url,s.amount,s.result,s.note
  from current_slips s left join public.customers c on chat_access and c.id=s.customer_id and c.tenant_id=p_tenant
  where p_query='' or strpos(lower(coalesce(s.note,'')),lower(p_query))>0 or strpos(lower(coalesce(s.trans_ref,'')),lower(p_query))>0 or strpos(lower(coalesce(c.display_name,'')),lower(p_query))>0
 ), inbound as materialized (
  select m.customer_id,date_trunc(case when p_from is null then 'month' else 'day' end,m.created_at at time zone 'Asia/Bangkok') as day,
   floor(extract(hour from m.created_at at time zone 'Asia/Bangkok')/3)::integer bin,count(*) messages
  from public.customers c join public.messages m on m.customer_id=c.id
  where chat_access and c.tenant_id=p_tenant and m.sender='customer' and m.created_at<p_to and (p_from is null or m.created_at>=p_from)
  group by 1,2,3
 ), active_customers as (select distinct customer_id from inbound),
 chat_matches as materialized (
  select c.id,c.display_name name,to_jsonb(c)->>'avatar_url' avatar_url,c.last_message_at,
   coalesce((to_jsonb(c)->>'unread_count')::integer,0) unread_count,
   case when to_jsonb(c)->>'assigned_user_id' is not null then 'แอดมินรับแชท' when c.bot_enabled then 'บอท' else 'รอแอดมิน' end owner
  from public.customers c
  where chat_access and c.tenant_id=p_tenant and c.last_message_at<p_to and (p_from is null or c.last_message_at>=p_from)
  and (p_query='' or strpos(lower(coalesce(c.display_name,'')),lower(p_query))>0 or exists(
   select 1 from (select m.body from public.messages m where m.customer_id=c.id and m.created_at<p_to and (p_from is null or m.created_at>=p_from) order by m.created_at desc,m.id desc limit 1) latest
   where strpos(lower(coalesce(latest.body,'')),lower(p_query))>0))
 ), slip_days as (
  select date_trunc(case when p_from is null then 'month' else 'day' end,created_at at time zone 'Asia/Bangkok') as day,
   count(*) count,coalesce(sum(round(amount*100)) filter(where result='passed'),0)/100 amount from current_slips group by 1
 ), previous_days as (
  select date_trunc('day',(created_at+(p_from-p_previous)) at time zone 'Asia/Bangkok') as day,count(*) count,
   coalesce(sum(round(amount*100)) filter(where result='passed'),0)/100 amount from previous_slips group by 1
 ), slip_axis as (
  select generate_series(coalesce(p_from at time zone 'Asia/Bangkok',greatest((select min(day) from slip_days),date_trunc('month',p_to at time zone 'Asia/Bangkok')-interval '119 months')),
   p_to at time zone 'Asia/Bangkok',case when p_from is null then interval '1 month' else interval '1 day' end)::date as day
  where p_from is not null or exists(select 1 from slip_days)
 ), activity_days as (
  select day,sum(messages) messages,count(distinct customer_id) customers from inbound group by 1
 ), activity_axis as (
  select generate_series(coalesce(p_from at time zone 'Asia/Bangkok',greatest((select min(day) from activity_days),date_trunc('month',p_to at time zone 'Asia/Bangkok')-interval '119 months')),
   (p_to at time zone 'Asia/Bangkok')-interval '1 microsecond',case when p_from is null then interval '1 month' else interval '1 day' end)::date as day
  where chat_access and (p_from is not null or exists(select 1 from activity_days))
 ), hours as (select bin,sum(messages) messages from inbound group by 1),
 genders as (select lower(trim(to_jsonb(c)->>'gender')) gender from public.customers c join active_customers a on a.customer_id=c.id where c.tenant_id=p_tenant),
 jobs as (select route,status,customer_id from public.agent_message_jobs where ai_access and tenant_id=p_tenant and created_at<p_to and (p_from is null or created_at>=p_from))
 select jsonb_build_object(
  'access',jsonb_build_object('slips',slip_access,'customers',chat_access,'ai',ai_access),
  'totals',(select jsonb_build_object('totalSlips',count(*),'approved',count(*) filter(where result='passed'),'pending',count(*) filter(where result='pending'),'verifiedSlipAmount',coalesce(sum(round(amount*100)) filter(where result='passed'),0)/100) from current_slips),
  'results',(select jsonb_build_object('passed',count(*) filter(where result='passed'),'pending',count(*) filter(where result='pending'),'rejected',count(*) filter(where result='rejected'),'error',count(*) filter(where result='error')) from current_slips),
  'previous',case when p_previous is null then null else (select jsonb_build_object('totalSlips',count(*),'approved',count(*) filter(where result='passed'),'verifiedSlipAmount',coalesce(sum(round(amount*100)) filter(where result='passed'),0)/100) from previous_slips) end,
  'series',coalesce((select jsonb_agg(jsonb_build_object('day',a.day,'amount',coalesce(s.amount,0),'count',coalesce(s.count,0),'previousAmount',case when p_previous is not null then coalesce(v.amount,0) end,'previousCount',case when p_previous is not null then coalesce(v.count,0) end) order by a.day) from slip_axis a left join slip_days s on s.day=a.day left join previous_days v on v.day=a.day),'[]'),
  'slipMatches',(select count(*) from slip_matches),
  'slips',coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at desc,s.id) from (select * from slip_matches order by created_at desc,id limit 10 offset (p_page-1)*10) s),'[]'),
  'messages',(select coalesce(sum(messages),0) from inbound),'uniqueCustomers',(select count(*) from active_customers),
  'customerGenders',(select jsonb_build_object('male',count(*) filter(where gender in ('male','ชาย','เพศชาย')),'female',count(*) filter(where gender in ('female','หญิง','เพศหญิง')),'unspecified',count(*) filter(where gender is null or gender not in ('male','ชาย','เพศชาย','female','หญิง','เพศหญิง'))) from genders),
  'activity',coalesce((select jsonb_agg(jsonb_build_object('key',a.day,'messages',coalesce(d.messages,0),'customers',coalesce(d.customers,0)) order by a.day) from activity_axis a left join activity_days d on d.day=a.day),'[]'),
  'hours',(select jsonb_agg(jsonb_build_object('bin',b,'messages',coalesce(h.messages,0)) order by b) from generate_series(0,7) b left join hours h on h.bin=b),
  'chatMatches',(select count(*) from chat_matches),
  'chats',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('body',latest.body) order by c.last_message_at desc,c.id)
   from (select * from chat_matches order by last_message_at desc,id limit 10 offset (p_page-1)*10) c
   left join lateral (select m.body from public.messages m where m.customer_id=c.id and m.created_at<p_to and (p_from is null or m.created_at>=p_from) order by m.created_at desc,m.id desc limit 1) latest on true),'[]'),
  'ai',(select jsonb_build_object('replies',count(*) filter(where route='AI' and status='sent'),'conversations',count(distinct customer_id) filter(where route='AI' and status='sent'),'handoffs',count(*) filter(where route='ADMIN'),'usage',null,'limit',null) from jobs)
 ) into answer;
 return answer;
end $$$sql_72_17$;

-- dashboard-performance.sql: source statement 18
execute $sql_72_18$create or replace function public.commerce_dashboard_stats(p_tenant uuid)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare result jsonb;l public.commerce_limits;today timestamptz:=date_trunc('day',now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok';
begin
 select * into l from public.commerce_plan(p_tenant);
 if not found or l.plan is null then raise exception 'Forbidden' using errcode='42501';end if;
 with paid as not materialized (select * from public.commerce_orders where tenant_id=p_tenant and status in ('paid','preparing','shipped','completed')),
 sales as (select (paid_at at time zone 'Asia/Bangkok')::date as day,sum(round(total*100))/100 amount from paid where paid_at>=today-interval '13 days' and paid_at<today+interval '1 day' group by 1),
 monthly as (select to_char(paid_at at time zone 'Asia/Bangkok','YYYY-MM') as month,sum(round(total*100))/100 total from paid where l.reports and paid_at is not null group by 1 order by 1 desc limit 120),
 best as (select i.name,sum(i.qty) qty from paid o join public.commerce_order_items i on i.order_id=o.id and i.tenant_id=p_tenant group by i.name order by sum(i.qty) desc,i.name limit 5)
 select jsonb_build_object(
  'products',(select count(*) from public.products where tenant_id=p_tenant and not commerce_archived),
  'customers',(select count(*) from public.commerce_customers where tenant_id=p_tenant),
  'todayOrders',(select count(*) from public.commerce_orders where tenant_id=p_tenant and created_at>=today and created_at<today+interval '1 day'),
  'pending',(select count(*) from public.commerce_orders where tenant_id=p_tenant and status='pending_payment'),
  'shipping',(select count(*) from public.commerce_orders where tenant_id=p_tenant and status in ('paid','preparing')),
  'revenue',coalesce((select amount from sales where day=(today at time zone 'Asia/Bangkok')::date),0),
  'amounts',(select jsonb_agg(jsonb_build_object('label',to_char(d,'MM-DD'),'amount',coalesce(s.amount,0)) order by d) from generate_series((today at time zone 'Asia/Bangkok')-interval '13 days',today at time zone 'Asia/Bangkok',interval '1 day') d left join sales s on s.day=d::date),
  'best',coalesce((select jsonb_agg(to_jsonb(b) order by qty desc,name) from best b),'[]'),
  'low',coalesce((select jsonb_agg(to_jsonb(p) order by stock,id) from (select id,name,stock from public.products where tenant_id=p_tenant and not commerce_archived and is_active and stock<=3 order by stock,id limit 5) p),'[]'),
  'report',case when l.reports then jsonb_build_object('monthly',coalesce((select jsonb_agg(to_jsonb(m) order by month desc) from monthly m),'[]')) end
 ) into result;
 return result;
end $$$sql_72_18$;

-- dashboard-performance.sql: source statement 19
execute $sql_72_19$create or replace function public.commerce_dashboard_page(p_tenant uuid,p_product_page integer default 1,p_order_page integer default 1,p_customer_page integer default 1,p_category_page integer default 1,p_page_page integer default 1,p_query text default '',p_category uuid default null,p_sort text default 'new',p_status text default 'all')
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare answer jsonb;
begin
 if not exists(select 1 from public.tenants where id=p_tenant and is_active) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_product_page is null or p_order_page is null or p_customer_page is null or p_category_page is null or p_page_page is null
 or least(p_product_page,p_order_page,p_customer_page,p_category_page,p_page_page)<1 or greatest(p_product_page,p_order_page,p_customer_page,p_category_page,p_page_page)>1000
 or p_query is null or length(p_query)>100 or p_sort is null or p_sort not in ('new','price','price_desc')
 or p_status is null or p_status not in ('all','pending_payment','payment_review','paid','preparing','shipped','completed','cancelled') then raise exception 'Invalid filters' using errcode='22023';end if;
 with product_matches as not materialized (
  select * from public.products where tenant_id=p_tenant and not commerce_archived and (p_category is null or commerce_category_id=p_category)
  and (p_query='' or strpos(lower(name||' '||code),lower(p_query))>0)
 ), product_page as materialized (
  select * from product_matches order by case when p_sort='price' then price end,case when p_sort='price_desc' then price end desc,created_at desc,id limit 50 offset (p_product_page-1)*50
 ), order_matches as not materialized (select id,number,customer_id,status,total,shipping,tracking,created_at,paid_at from public.commerce_orders where tenant_id=p_tenant and (p_status='all' or status=p_status)),
 order_page as materialized (select * from order_matches order by created_at desc,id limit 50 offset (p_order_page-1)*50),
 customer_page as materialized (select id,name,phone,created_at from public.commerce_customers where tenant_id=p_tenant order by created_at desc,id limit 50 offset (p_customer_page-1)*50),
 customer_orders as (select o.customer_id,count(*) order_count from public.commerce_orders o join customer_page c on c.id=o.customer_id where o.tenant_id=p_tenant group by o.customer_id),
 category_page as materialized (select id,name from public.commerce_categories where tenant_id=p_tenant order by name,id limit 50 offset (p_category_page-1)*50),
 categories as (select * from category_page
  union select c.id,c.name from public.commerce_categories c join product_page p on p.commerce_category_id=c.id where c.tenant_id=p_tenant
  union select id,name from public.commerce_categories where tenant_id=p_tenant and id=p_category),
 page_page as (select * from public.commerce_pages where tenant_id=p_tenant order by id limit 50 offset (p_page_page-1)*50)
 select jsonb_build_object(
  'products',coalesce((select jsonb_agg(to_jsonb(p) order by case when p_sort='price' then price end,case when p_sort='price_desc' then price end desc,created_at desc,id) from product_page p),'[]'),
  'variants',coalesce((select jsonb_agg(to_jsonb(v) order by v.id) from public.commerce_variants v join product_page p on p.id=v.product_id where v.tenant_id=p_tenant and v.is_active),'[]'),
  'orders',coalesce((select jsonb_agg(to_jsonb(o) order by created_at desc,id) from order_page o),'[]'),
  'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.order_id,i.id) from public.commerce_order_items i join order_page o on o.id=i.order_id where i.tenant_id=p_tenant),'[]'),
  'customers',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('order_count',coalesce(o.order_count,0)) order by c.created_at desc,c.id) from customer_page c left join customer_orders o on o.customer_id=c.id),'[]'),
  'categories',coalesce((select jsonb_agg(to_jsonb(c) order by name,id) from categories c),'[]'),
  'categoryRows',coalesce((select jsonb_agg(to_jsonb(c) order by name,id) from category_page c),'[]'),
  'pages',coalesce((select jsonb_agg(to_jsonb(p) order by id) from page_page p),'[]'),
  'audit',coalesce((select jsonb_agg(to_jsonb(a) order by created_at desc,id) from (select a.id,a.entity_id,a.actor_id,a.action,a.detail,a.created_at from public.commerce_audit a join order_page o on o.id=a.entity_id where a.tenant_id=p_tenant order by a.created_at desc,a.id limit 300) a),'[]'),
  'counts',jsonb_build_object('products',(select count(*) from product_matches),'orders',(select count(*) from order_matches),'customers',(select count(*) from public.commerce_customers where tenant_id=p_tenant),'categories',(select count(*) from public.commerce_categories where tenant_id=p_tenant),'pages',(select count(*) from public.commerce_pages where tenant_id=p_tenant))
 ) into answer;
 return answer;
end $$$sql_72_19$;

-- dashboard-performance.sql: source statement 20
execute $sql_72_20$revoke all on function public.overview_dashboard_stats(uuid,timestamptz,timestamptz,timestamptz,integer,text),public.commerce_dashboard_stats(uuid),public.commerce_dashboard_page(uuid,integer,integer,integer,integer,integer,text,uuid,text,text) from public,anon,authenticated$sql_72_20$;

-- dashboard-performance.sql: source statement 21
execute $sql_72_21$grant execute on function public.overview_dashboard_stats(uuid,timestamptz,timestamptz,timestamptz,integer,text),public.commerce_dashboard_stats(uuid),public.commerce_dashboard_page(uuid,integer,integer,integer,integer,integer,text,uuid,text,text) to service_role$sql_72_21$;

-- dashboard-performance.sql: source statement 22
execute $sql_72_22$notify pgrst,'reload schema'$sql_72_22$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('dashboard-performance.sql','46d2e45b9ba06db45bd485a127affc7165b8231858c5b8ac9effb619a531bb08','87871cb3623b3153a08fd585394dda0fbd296c4fb670e50791ee09527b2c29c5');
end $migration_72$;

-- 74. dashboard-read-models.sql
do $migration_73$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='dashboard-read-models.sql';
  if found then
    if installed <> '19e4d0615b5b7470f7754b4071a957d7d6765e92a06bd4ecaae7933c09ea1e80' then
      raise exception 'Applied migration changed: dashboard-read-models.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- dashboard-read-models.sql: source statement 2
execute $sql_73_2$create index if not exists inbox_customers_recent on public.customers(tenant_id,last_message_at desc nulls last,id desc)$sql_73_2$;

-- dashboard-read-models.sql: source statement 3
execute $sql_73_3$create index if not exists dashboard_valid_customer_slips on public.slips(tenant_id,customer_id) include(amount) where status='valid'$sql_73_3$;

-- dashboard-read-models.sql: source statement 4
execute $sql_73_4$create index if not exists overview_slips_time on public.slips(tenant_id,created_at desc,id)$sql_73_4$;

-- dashboard-read-models.sql: source statement 5
execute $sql_73_5$create index if not exists dashboard_agent_period on public.agent_message_jobs(tenant_id,created_at desc,id) include(route,status,customer_id,updated_at)$sql_73_5$;

-- dashboard-read-models.sql: source statement 6
execute $sql_73_6$create index if not exists dashboard_agent_lifetime on public.agent_message_jobs(tenant_id,customer_id) where route='AI' and status='sent'$sql_73_6$;

-- dashboard-read-models.sql: source statement 7
execute $sql_73_7$create or replace function public.customer_directory(
  p_tenant uuid,
  p_page integer default 1,
  p_query text default '',
  p_status text default 'all',
  p_tag text default ''
)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare answer jsonb;
begin
 if p_tenant is null or not exists(select 1 from public.tenants where id=p_tenant and is_active)
 or not public.has_tenant_feature(p_tenant,'customer_management') then raise exception 'Forbidden' using errcode='42501';end if;
 if p_page is null or p_page not between 1 and 100000 or p_query is null or length(p_query)>100
 or p_tag is null or length(p_tag)>100 or p_status is null or p_status not in ('all','new','pending_review','paid','approved','shipped') then
 raise exception 'Invalid filters' using errcode='22023';end if;
 with matched as materialized (
  select c.id
  from public.customers c where c.tenant_id=p_tenant
  and (p_status='all' or c.order_status=p_status)
  and (p_tag='' or p_tag=any(c.tags))
  and (p_query='' or strpos(lower(coalesce(c.display_name,'ผู้ใช้ ...'||right(c.platform_user_id,4))),lower(p_query))>0
   or strpos(coalesce(c.phone,''),p_query)>0 or strpos(lower(coalesce(c.address,'')),lower(p_query))>0)
 ), meta as (
  select count(*) total,greatest(1,ceil(count(*)/50.0)::integer) pages from matched
 ), selected as materialized (
  select c.id,c.display_name,c.avatar_url,c.platform_user_id,c.last_message_at,c.phone,c.address,c.tags,c.order_status
  from public.customers c join matched m on m.id=c.id
  where c.tenant_id=p_tenant order by c.last_message_at desc nulls last,c.id desc
  limit 50 offset (select (least(p_page,pages)-1)*50 from meta)
 ), paid as (
  select s.customer_id,sum(coalesce(s.amount,0)) amount,count(*) n
  from public.slips s join matched m on m.id=s.customer_id
  where s.tenant_id=p_tenant and s.status='valid' group by s.customer_id
 )
 select jsonb_build_object(
   'rows', coalesce((
     select jsonb_agg(
       to_jsonb(c) || jsonb_build_object(
         'paidTotal', coalesce(p.amount, 0),
         'paidCount', coalesce(p.n, 0)
       ) order by c.last_message_at desc nulls last, c.id desc
     )
     from selected c left join paid p on p.customer_id = c.id
   ), '[]'::jsonb),
   'total', (select total from meta),
   'page', (select least(p_page, pages) from meta),
   'pages', (select pages from meta),
   'pageSize', 50,
   'totalPaid', coalesce((select sum(amount) from paid), 0),
   'tags', coalesce((
     select jsonb_agg(tag order by tag)
     from (
       select distinct unnest(tags) tag from public.customers where tenant_id = p_tenant
     ) t where tag is not null
   ), '[]'::jsonb)
 ) into answer;
 return answer;
end $$$sql_73_7$;

-- dashboard-read-models.sql: source statement 8
execute $sql_73_8$create or replace function public.agent_overview_stats(
  p_tenant uuid,
  p_days integer,
  p_now timestamptz
)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare answer jsonb;start_at timestamptz;
begin
 if p_tenant is null or not exists(select 1 from public.tenants where id=p_tenant and is_active) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_days is null or p_days not in (7,30,90) or p_now is null or not isfinite(p_now) then raise exception 'Invalid range' using errcode='22023';end if;
 start_at:=((p_now at time zone 'Asia/Bangkok')::date-(p_days-1))::timestamp at time zone 'Asia/Bangkok';
 with current_jobs as materialized (
  select customer_id,route,status,created_at,updated_at from public.agent_message_jobs
  where tenant_id=p_tenant and created_at>=start_at and created_at<=p_now
 ), daily as (
  select (created_at at time zone 'Asia/Bangkok')::date as day,count(*) messages,count(distinct customer_id) customers
  from current_jobs where route='AI' and status='sent' group by 1
 ), metrics as (
  select count(*) filter(where route='ADMIN') handoffs,
   avg(extract(epoch from updated_at-created_at)) filter(where route='AI' and status='sent' and updated_at>=created_at) average_seconds,
   100.0*count(*) filter(where route='AI' and status='sent')/nullif(count(*) filter(where route='AI' and status in ('sent','failed','review')),0) success_rate
  from current_jobs
 )
 select jsonb_build_object(
   'repliesToday', coalesce((
     select messages from daily where day = (p_now at time zone 'Asia/Bangkok')::date
   ), 0),
   'customersTotal', (
     select count(distinct customer_id) from public.agent_message_jobs
     where tenant_id = p_tenant and route = 'AI' and status = 'sent' and created_at <= p_now
   ),
   'handoffs', m.handoffs,
   'averageSeconds', m.average_seconds,
   'successRate', m.success_rate,
   'points', (
     select jsonb_agg(jsonb_build_object(
       'day', to_char(d.day, 'YYYY-MM-DD'),
       'messages', coalesce(v.messages, 0),
       'customers', coalesce(v.customers, 0)
     ) order by d.day)
     from (
       select (start_at at time zone 'Asia/Bangkok')::date + i as day
       from generate_series(0, p_days - 1) i
     ) d left join daily v on v.day = d.day
   ),
   'recent', coalesce((
     select jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id)
     from (
       select id, customer_id, route, status, created_at, updated_at
       from public.agent_message_jobs
       where tenant_id = p_tenant and created_at <= p_now
       order by created_at desc, id limit 10
     ) r
   ), '[]'::jsonb)
 ) into answer from metrics m;
 return answer;
end $$$sql_73_8$;

-- dashboard-read-models.sql: source statement 9
execute $sql_73_9$create or replace function public.basic_overview_stats(p_tenant uuid, p_now timestamptz)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare answer jsonb;start_at timestamptz;
begin
 if p_tenant is null or not exists(select 1 from public.tenants where id=p_tenant and is_active)
 or not public.has_tenant_feature(p_tenant,'slip_auto_pilot') then raise exception 'Forbidden' using errcode='42501';end if;
 if p_now is null or not isfinite(p_now) then raise exception 'Invalid time' using errcode='22023';end if;
 start_at:=((p_now at time zone 'Asia/Bangkok')::date-13)::timestamp at time zone 'Asia/Bangkok';
 with source as materialized (
  select s.id,s.customer_id,s.amount,s.status,s.created_at,s.approved_at,s.status='valid' or (s.approved_at is not null and s.status in ('amount_mismatch','wrong_receiver','fake','error')) counted,
   s.status='pending' or (s.status in ('amount_mismatch','duplicate','fake','wrong_receiver','error') and s.approved_at is null) attention
  from public.slips s where s.tenant_id=p_tenant and s.created_at>=start_at and s.created_at<=p_now
 ), daily as (
  select (created_at at time zone 'Asia/Bangkok')::date as day,sum(coalesce(amount,0)) amount,count(*) n from source where counted group by 1
 )
 select jsonb_build_object(
   'totalSlips', (select count(*) from source),
   'attentionCount', (select count(*) from source where attention),
   'periodTotal', coalesce((select sum(amount) from daily), 0),
   'byStatus', coalesce((
     select jsonb_object_agg(status, n)
     from (select status, count(*) n from source group by status) x
   ), '{}'::jsonb),
   'points', (
     select jsonb_agg(jsonb_build_object(
       'day', to_char(d.day, 'YYYY-MM-DD'),
       'amount', coalesce(v.amount, 0),
       'count', coalesce(v.n, 0)
     ) order by d.day)
     from (
       select (start_at at time zone 'Asia/Bangkok')::date + i as day
       from generate_series(0, 13) i
     ) d left join daily v on v.day = d.day
   ),
   'attention', coalesce((
     select jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id)
     from (
       select s.id, s.amount, s.status, s.created_at,
         jsonb_build_object('display_name', c.display_name) customers
       from source s
       left join public.customers c on c.id = s.customer_id and c.tenant_id = p_tenant
       where s.attention order by s.created_at desc, s.id limit 8
     ) r
   ), '[]'::jsonb)
 ) into answer;
 return answer;
end $$$sql_73_9$;

-- dashboard-read-models.sql: source statement 10
execute $sql_73_10$revoke all on function public.customer_directory(uuid,integer,text,text,text),public.agent_overview_stats(uuid,integer,timestamptz),public.basic_overview_stats(uuid,timestamptz) from public,anon,authenticated$sql_73_10$;

-- dashboard-read-models.sql: source statement 11
execute $sql_73_11$grant execute on function public.customer_directory(uuid,integer,text,text,text),public.agent_overview_stats(uuid,integer,timestamptz),public.basic_overview_stats(uuid,timestamptz) to service_role$sql_73_11$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('dashboard-read-models.sql','19e4d0615b5b7470f7754b4071a957d7d6765e92a06bd4ecaae7933c09ea1e80','daca680061c44493d8ec6c139716a5a7e58aca1c20cddab9231ce59f94cf72cf');
end $migration_73$;

-- 75. premium-overview.sql
do $migration_74$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='premium-overview.sql';
  if found then
    if installed <> '2feb5e32d3a8bd095148f421dd7489433cb7acef247772897eed8ce0368932ad' then
      raise exception 'Applied migration changed: premium-overview.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- premium-overview.sql: source statement 2
execute $sql_74_2$create or replace function public.premium_overview_summary(
 p_tenant uuid,p_from timestamptz,p_to timestamptz,p_previous timestamptz default null,
 p_page integer default 1,p_query text default ''
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare slips_allowed boolean;customers_allowed boolean;ai_allowed boolean;result jsonb;
 slip_data jsonb:='{}';chat_data jsonb:='{}';ai_data jsonb;bucket text;
begin
 -- Service-only RPC: the application checks session and tenant membership before invoking it.
 if p_to is null or p_to>now()+interval '2 minutes' or p_from>p_to or p_previous>p_from
  or p_page is null or p_page not between 1 and 1000 or length(coalesce(p_query,''))>100 then
  raise exception 'Invalid dashboard filters' using errcode='22023';
 end if;
 if not exists(select 1 from public.tenants where id=p_tenant and is_active) then raise exception 'Tenant unavailable' using errcode='42501';end if;
 slips_allowed:=public.has_tenant_feature(p_tenant,'slip_auto_pilot');
 customers_allowed:=public.has_tenant_feature(p_tenant,'customer_management');
 ai_allowed:=public.has_tenant_feature(p_tenant,'ai_agent');
 bucket:=case when p_from is null then 'month' else 'day' end;
 if slips_allowed then
  with scoped as(
   select s.*,case when s.status='valid' or (s.approved_at is not null and s.status in ('amount_mismatch','wrong_receiver','fake','error')) then 'passed'
    when s.status in ('pending','amount_mismatch','wrong_receiver') then 'pending' when s.status='error' then 'error' else 'rejected' end outcome
   from public.slips s where s.tenant_id=p_tenant and (p_from is null or s.created_at>=p_from) and s.created_at<p_to
  ), matched as(
   select s.id,s.created_at,case when customers_allowed then c.display_name else null end customer,s.amount,s.outcome result,s.note
   from scoped s left join public.customers c on customers_allowed and c.id=s.customer_id and c.tenant_id=p_tenant
   where coalesce(p_query,'')='' or strpos(lower(coalesce(s.note,'')),lower(p_query))>0 or (customers_allowed and strpos(lower(coalesce(c.display_name,'')),lower(p_query))>0)
  ), previous as(
   select count(*) total,count(*) filter(where status='valid' or (approved_at is not null and status in ('amount_mismatch','wrong_receiver','fake','error'))) approved,
    coalesce(sum(amount) filter(where status='valid' or (approved_at is not null and status in ('amount_mismatch','wrong_receiver','fake','error'))),0) amount
   from public.slips where tenant_id=p_tenant and p_previous is not null and created_at>=p_previous and created_at<p_from
  ), current_days as(
   select date_trunc(bucket,created_at at time zone 'Asia/Bangkok') as bucket_at,count(*) count,coalesce(sum(amount) filter(where outcome='passed'),0) amount from scoped group by 1
  ), previous_days as(
   select (created_at at time zone 'Asia/Bangkok')::date+((p_from at time zone 'Asia/Bangkok')::date-(p_previous at time zone 'Asia/Bangkok')::date) as bucket_at,
    count(*) count,coalesce(sum(amount) filter(where status='valid' or (approved_at is not null and status in ('amount_mismatch','wrong_receiver','fake','error'))),0) amount
   from public.slips where tenant_id=p_tenant and p_previous is not null and created_at>=p_previous and created_at<p_from group by 1
  ), days as(
   select generate_series(coalesce(date_trunc(bucket,p_from at time zone 'Asia/Bangkok'),(select min(bucket_at) from current_days)),date_trunc(bucket,p_to at time zone 'Asia/Bangkok'),case when bucket='month' then interval '1 month' else interval '1 day' end) as bucket_at
  ) select jsonb_build_object(
   'totalSlips',(select count(*) from scoped),'approved',(select count(*) from scoped where outcome='passed'),
   'pending',(select count(*) from scoped where outcome='pending'),'verifiedSlipAmount',(select coalesce(sum(amount),0) from scoped where outcome='passed'),
   'results',(select jsonb_build_object('passed',count(*) filter(where outcome='passed'),'pending',count(*) filter(where outcome='pending'),'rejected',count(*) filter(where outcome='rejected'),'error',count(*) filter(where outcome='error')) from scoped),
   'previous',case when p_previous is null then null else (select jsonb_build_object('approved',approved,'totalSlips',total,'verifiedSlipAmount',amount) from previous) end,
   'series',(select coalesce(jsonb_agg(jsonb_build_object('day',to_char(d.bucket_at,'YYYY-MM-DD'),'count',coalesce(c.count,0),'amount',coalesce(c.amount,0),'previousCount',case when p_previous is null then null else coalesce(p.count,0) end,'previousAmount',case when p_previous is null then null else coalesce(p.amount,0) end) order by d.bucket_at),'[]') from days d left join current_days c using(bucket_at) left join previous_days p on p.bucket_at=d.bucket_at::date),
   'slipMatches',(select count(*) from matched),'slips',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from(select * from matched order by created_at desc,id limit 10 offset (p_page-1)*10) r)
  ) into slip_data;
 end if;
 if customers_allowed then
  with scoped as(
   -- Legacy installations may store unread_count; Smart Inbox derives it per user.
   -- Do not require a column that the current fresh-install schema never creates.
   select c.id,c.display_name name,c.avatar_url,c.last_message_at,
    coalesce((to_jsonb(c)->>'unread_count')::integer,0) unread_count,
    case when c.assigned_user_id is not null then 'แอดมินรับแชท' when c.bot_enabled then 'บอท' else 'รอแอดมิน' end owner,m.body
   from public.customers c left join lateral(select body from public.messages where customer_id=c.id order by created_at desc,id desc limit 1)m on true
   where c.tenant_id=p_tenant and (p_from is null or c.last_message_at>=p_from) and c.last_message_at<p_to
  ), matched as(select * from scoped where coalesce(p_query,'')='' or strpos(lower(coalesce(name,'')||' '||coalesce(body,'')),lower(p_query))>0)
  select jsonb_build_object('messages',(select count(*) from public.messages m join public.customers c on c.id=m.customer_id where c.tenant_id=p_tenant and (p_from is null or m.created_at>=p_from) and m.created_at<p_to),
   'chatMatches',(select count(*) from matched),'chats',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from(select * from matched order by last_message_at desc,id limit 10 offset (p_page-1)*10)r)) into chat_data;
 end if;
 if ai_allowed and to_regclass('public.agent_message_jobs') is not null then
  execute $q$select jsonb_build_object('replies',count(*) filter(where route='AI' and status='sent'),'conversations',count(distinct customer_id) filter(where route='AI' and status='sent'),'handoffs',count(*) filter(where route='ADMIN'),'usage',null,'limit',null) from public.agent_message_jobs where tenant_id=$1 and ($2 is null or created_at>=$2) and created_at<$3$q$ into ai_data using p_tenant,p_from,p_to;
  if to_regclass('public.agent_ai_monthly_usage') is not null then
   execute $q$select $1||jsonb_build_object('usage',coalesce((select used from public.agent_ai_monthly_usage where tenant_id=$2 and month=date_trunc('month',now() at time zone 'UTC')::date),0),'limit',(select ai_monthly_limit from public.agent_control_settings where tenant_id=$2))$q$ into ai_data using ai_data,p_tenant;
  end if;
 end if;
 select jsonb_build_object('shop',jsonb_build_object('id',id,'name',name),'updatedAt',now(),
  'access',jsonb_build_object('slips',slips_allowed,'customers',customers_allowed,'ai',ai_allowed),
  'metrics',jsonb_build_object('reconciledRevenue',null,'messages',chat_data->'messages','approved',slip_data->'approved','totalSlips',slip_data->'totalSlips','pending',slip_data->'pending',
   'verifiedSlipAmount',slip_data->'verifiedSlipAmount','slipCredits',case when slips_allowed then greatest(0,slip_quota::bigint+slip_quota_credits::bigint-slip_used::bigint) else null end),
  'previous',slip_data->'previous','results',slip_data->'results','series',coalesce(slip_data->'series','[]'),'bucket',bucket,
  'slips',coalesce(slip_data->'slips','[]'),'slipMatches',coalesce(slip_data->'slipMatches','0'),'chats',coalesce(chat_data->'chats','[]'),'chatMatches',coalesce(chat_data->'chatMatches','0'),'ai',ai_data)
 into result from public.tenants where id=p_tenant;
 return result;
end $$$sql_74_2$;

-- premium-overview.sql: source statement 3
execute $sql_74_3$revoke all on function public.premium_overview_summary(uuid,timestamptz,timestamptz,timestamptz,integer,text) from public,anon,authenticated$sql_74_3$;

-- premium-overview.sql: source statement 4
execute $sql_74_4$grant execute on function public.premium_overview_summary(uuid,timestamptz,timestamptz,timestamptz,integer,text) to service_role$sql_74_4$;

-- premium-overview.sql: source statement 5
execute $sql_74_5$create index if not exists slips_tenant on public.slips(tenant_id,created_at desc)$sql_74_5$;

-- premium-overview.sql: source statement 6
execute $sql_74_6$create index if not exists customers_tenant on public.customers(tenant_id,last_message_at desc)$sql_74_6$;

-- premium-overview.sql: source statement 7
execute $sql_74_7$notify pgrst,'reload schema'$sql_74_7$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('premium-overview.sql','2feb5e32d3a8bd095148f421dd7489433cb7acef247772897eed8ce0368932ad','19d97393eda4ebd1de925886ce3add41af56164a2541e8e4e0b6f377f861f273');
end $migration_74$;

-- 76. inbox-realtime.sql
do $migration_75$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='inbox-realtime.sql';
  if found then
    if installed <> 'aca5276b1ea1b665035ac261dae5a534dfb1d60d762bf020fdb6c6e82a8ff415' then
      raise exception 'Applied migration changed: inbox-realtime.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- inbox-realtime.sql: source statement 2
execute $sql_75_2$do $$
declare name text;
begin
 if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
  raise exception 'Enable Supabase Realtime before applying this migration';
 end if;
 foreach name in array array['customers','messages','comments','slips'] loop
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=name) then
   execute format('alter publication supabase_realtime add table public.%I',name);
  end if;
 end loop;
end $$$sql_75_2$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('inbox-realtime.sql','aca5276b1ea1b665035ac261dae5a534dfb1d60d762bf020fdb6c6e82a8ff415','a7dc1d4c93f7995e27731bd59a078c4430650c0b627c9f4c14a80c5357d607f7');
end $migration_75$;

-- 77. inbox-load-indexes.sql
do $migration_76$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='inbox-load-indexes.sql';
  if found then
    if installed <> '125a60686bd94ec4ee414d122986ab0be170a40dcb1553c269546c07db17c4e1' then
      raise exception 'Applied migration changed: inbox-load-indexes.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- inbox-load-indexes.sql: source statement 1
execute $sql_76_1$create index if not exists inbox_customers_recent on public.customers
 (tenant_id,last_message_at desc nulls last,id desc)$sql_76_1$;

-- inbox-load-indexes.sql: source statement 2
execute $sql_76_2$create index if not exists overview_messages_latest on public.messages
 (customer_id,created_at desc,id desc) include(sender)$sql_76_2$;

-- inbox-load-indexes.sql: source statement 3
execute $sql_76_3$create index if not exists inbox_recent_inbound on public.messages
 (created_at desc,id desc) where sender='customer'$sql_76_3$;

-- inbox-load-indexes.sql: source statement 4
execute $sql_76_4$create index if not exists inbox_slips_recent on public.slips
 (tenant_id,customer_id,created_at desc)$sql_76_4$;

-- inbox-load-indexes.sql: source statement 5
execute $sql_76_5$create index if not exists inbox_comments_recent on public.comments
 (tenant_id,created_at desc)$sql_76_5$;

-- inbox-load-indexes.sql: source statement 6
execute $sql_76_6$create index if not exists inbox_reads_by_user on public.conversation_reads
 (user_id,customer_id) include(read_seq)$sql_76_6$;

-- inbox-load-indexes.sql: source statement 7
execute $sql_76_7$create index if not exists broadcast_page_recent on public.broadcast_messaging_events
 (tenant_id,page_id,kind,interacted_at desc,event_id)$sql_76_7$;

-- inbox-load-indexes.sql: source statement 8
execute $sql_76_8$create index if not exists broadcast_customer_recent on public.broadcast_messaging_events
 (tenant_id,page_id,customer_id,kind,interacted_at desc,event_id)$sql_76_8$;

-- inbox-load-indexes.sql: source statement 9
execute $sql_76_9$create index if not exists facebook_webhook_message_id_lookup on public.facebook_webhook_events
 (page_id,((payload->'message')->>'mid')) where kind='message'$sql_76_9$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('inbox-load-indexes.sql','125a60686bd94ec4ee414d122986ab0be170a40dcb1553c269546c07db17c4e1','cee506871122e657bfbf6b2a12533272fee5b44607176d4c29298b0aaf404e42');
end $migration_76$;

-- 78. facebook-inbox-recovery.sql
do $migration_77$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='facebook-inbox-recovery.sql';
  if found then
    if installed <> '17c99c5c455e76c04989398dd7e7246f348d3a2758ad5cc8ca76b85f83db97b2' then
      raise exception 'Applied migration changed: facebook-inbox-recovery.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- facebook-inbox-recovery.sql: source statement 2
execute $sql_77_2$do $$
declare missing text;
begin
  foreach missing in array array[
    'public.tenants',
    'public.customers',
    'public.messages',
    'public.facebook_webhook_events',
    'public.facebook_webhook_steps'
  ] loop
    if to_regclass(missing) is null then
      raise exception 'Missing prerequisite relation: %', missing;
    end if;
  end loop;
  if to_regprocedure('public.persist_facebook_webhook_record(uuid,uuid,uuid)') is null then
    raise exception 'Missing prerequisite function: persist_facebook_webhook_record';
  end if;
end $$$sql_77_2$;

-- facebook-inbox-recovery.sql: source statement 3
execute $sql_77_3$create or replace function public.ensure_facebook_customer_fallback_name()
returns trigger
language plpgsql
set search_path=pg_catalog,public
as $$
begin
  if new.platform='facebook'
     and nullif(btrim(coalesce(new.display_name,'')),'') is null
     and nullif(btrim(coalesce(new.platform_user_id,'')),'') is not null then
    new.display_name := 'ลูกค้า Facebook (' || right(new.platform_user_id,4) || ')';
  end if;
  return new;
end $$$sql_77_3$;

-- facebook-inbox-recovery.sql: source statement 4
execute $sql_77_4$drop trigger if exists customers_facebook_fallback_name on public.customers$sql_77_4$;

-- facebook-inbox-recovery.sql: source statement 5
execute $sql_77_5$create trigger customers_facebook_fallback_name
before insert or update on public.customers
for each row execute function public.ensure_facebook_customer_fallback_name()$sql_77_5$;

-- facebook-inbox-recovery.sql: source statement 7
execute $sql_77_7$create index if not exists customers_tenant_last_message_idx
  on public.customers(tenant_id,last_message_at desc,id desc)$sql_77_7$;

-- facebook-inbox-recovery.sql: source statement 8
execute $sql_77_8$create index if not exists messages_customer_created_idx
  on public.messages(customer_id,created_at desc,id desc)$sql_77_8$;

-- facebook-inbox-recovery.sql: source statement 9
execute $sql_77_9$grant select,insert,update on public.customers to service_role$sql_77_9$;

-- facebook-inbox-recovery.sql: source statement 10
execute $sql_77_10$grant select,insert,update on public.messages to service_role$sql_77_10$;

-- facebook-inbox-recovery.sql: source statement 11
execute $sql_77_11$grant execute on function public.persist_facebook_webhook_record(uuid,uuid,uuid) to service_role$sql_77_11$;

-- facebook-inbox-recovery.sql: source statement 12
execute $sql_77_12$notify pgrst,'reload schema'$sql_77_12$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('facebook-inbox-recovery.sql','17c99c5c455e76c04989398dd7e7246f348d3a2758ad5cc8ca76b85f83db97b2','1eb9f1832583ddae48cd6adda766c7c3828e48d5c9401f2b0b96442977e6a1ad');
end $migration_77$;

-- 79. live-cf-variants.sql
do $migration_78$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='live-cf-variants.sql';
  if found then
    if installed <> 'a370e2e8b6358f365a5335ecae56045919dd28ed001f7d9388f7a8bedc809184' then
      raise exception 'Applied migration changed: live-cf-variants.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- live-cf-variants.sql: source statement 2
execute $sql_78_2$alter table public.commerce_variants add column if not exists variant_code text$sql_78_2$;

-- live-cf-variants.sql: source statement 3
execute $sql_78_3$create unique index if not exists commerce_variant_tenant_code
  on public.commerce_variants(tenant_id, lower(variant_code))
  where variant_code is not null and length(trim(variant_code)) > 0$sql_78_3$;

-- live-cf-variants.sql: source statement 4
execute $sql_78_4$alter table public.orders add column if not exists variant_id uuid
  references public.commerce_variants(id)$sql_78_4$;

-- live-cf-variants.sql: source statement 5
execute $sql_78_5$alter table public.orders add column if not exists variant_label text$sql_78_5$;

-- live-cf-variants.sql: source statement 6
execute $sql_78_6$alter table public.orders add column if not exists source text$sql_78_6$;

-- live-cf-variants.sql: source statement 7
execute $sql_78_7$alter table public.orders add column if not exists source_id text$sql_78_7$;

-- live-cf-variants.sql: source statement 8
execute $sql_78_8$alter table public.orders add column if not exists source_code text$sql_78_8$;

-- live-cf-variants.sql: source statement 9
execute $sql_78_9$create unique index if not exists orders_one_per_source
  on public.orders(tenant_id, source, source_id)
  where source is not null and source_id is not null$sql_78_9$;

-- live-cf-variants.sql: source statement 10
execute $sql_78_10$create or replace function public.commerce_save_product(
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
end $$$sql_78_10$;

-- live-cf-variants.sql: source statement 11
begin
execute $sql_78_11$create or replace function public.on_order_status() returns trigger
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
end $$$sql_78_11$;
exception when invalid_function_definition then
  -- A newer signature of on_order_status() is already installed. Its final definition below is mandatory.
  null;
end;

-- live-cf-variants.sql: source statement 12
execute $sql_78_12$drop trigger if exists orders_status_change on public.orders$sql_78_12$;

-- live-cf-variants.sql: source statement 13
execute $sql_78_13$create trigger orders_status_change before update of status on public.orders
 for each row execute function public.on_order_status()$sql_78_13$;

-- live-cf-variants.sql: source statement 14
execute $sql_78_14$drop function if exists public.place_cf_order(uuid,uuid,uuid,text)$sql_78_14$;

-- live-cf-variants.sql: source statement 15
execute $sql_78_15$create or replace function public.place_cf_order_core(
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
end $$$sql_78_15$;

-- live-cf-variants.sql: source statement 16
execute $sql_78_16$create or replace function public.place_cf_order(
 p_tenant uuid,p_customer uuid,p_message uuid,p_code text
) returns table(
 r_status text,r_order_id uuid,r_name text,r_code text,r_amount numeric,r_variant_label text
) language sql security definer set search_path=pg_catalog,public as $$
 select * from public.place_cf_order_core(p_tenant,p_customer,p_message,p_code,null,null)
$$$sql_78_16$;

-- live-cf-variants.sql: source statement 17
execute $sql_78_17$create or replace function public.place_cf_order(
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
end $$$sql_78_17$;

-- live-cf-variants.sql: source statement 18
execute $sql_78_18$revoke all on function public.place_cf_order_core(uuid,uuid,uuid,text,text,text)
 from public,anon,authenticated$sql_78_18$;

-- live-cf-variants.sql: source statement 19
execute $sql_78_19$revoke all on function public.place_cf_order(uuid,uuid,uuid,text)
 from public,anon,authenticated$sql_78_19$;

-- live-cf-variants.sql: source statement 20
execute $sql_78_20$revoke all on function public.place_cf_order(uuid,text,text,text,text)
 from public,anon,authenticated$sql_78_20$;

-- live-cf-variants.sql: source statement 21
execute $sql_78_21$grant execute on function public.place_cf_order(uuid,uuid,uuid,text)
 to service_role$sql_78_21$;

-- live-cf-variants.sql: source statement 22
execute $sql_78_22$grant execute on function public.place_cf_order(uuid,text,text,text,text)
 to service_role$sql_78_22$;

-- live-cf-variants.sql: source statement 23
execute $sql_78_23$notify pgrst,'reload schema'$sql_78_23$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('live-cf-variants.sql','a370e2e8b6358f365a5335ecae56045919dd28ed001f7d9388f7a8bedc809184','76d033c8d7df54314df3ec983143fa1194d4fbf29c3f261507c29fedbdec00f1');
end $migration_78$;

-- 80. live-cf-mode.sql
do $migration_79$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='live-cf-mode.sql';
  if found then
    if installed <> '536347d3bd60c59c5713f1003ee83c7323aa795f8c916a95be925908123c1add' then
      raise exception 'Applied migration changed: live-cf-mode.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- live-cf-mode.sql: source statement 2
execute $sql_79_2$alter table public.comment_rules add column if not exists mode text not null default 'general'
  check (mode in ('general','live_cf'))$sql_79_2$;

-- live-cf-mode.sql: source statement 3
execute $sql_79_3$alter table public.comment_rules add column if not exists live_product_id uuid references public.products(id)$sql_79_3$;

-- live-cf-mode.sql: source statement 4
execute $sql_79_4$alter table public.comment_rules add column if not exists live_variant_id uuid references public.commerce_variants(id)$sql_79_4$;

-- live-cf-mode.sql: source statement 5
execute $sql_79_5$alter table public.comment_rules add column if not exists live_stock_limit integer
  check (live_stock_limit between 1 and 1000000)$sql_79_5$;

-- live-cf-mode.sql: source statement 6
execute $sql_79_6$alter table public.comment_rules add column if not exists live_post_id text$sql_79_6$;

-- live-cf-mode.sql: source statement 7
execute $sql_79_7$alter table public.orders add column if not exists live_rule_id uuid
  references public.comment_rules(id) on delete set null$sql_79_7$;

-- live-cf-mode.sql: source statement 8
execute $sql_79_8$create index if not exists orders_live_rule on public.orders(tenant_id,live_rule_id,status)$sql_79_8$;

-- live-cf-mode.sql: source statement 9
execute $sql_79_9$create unique index if not exists orders_one_facebook_comment
  on public.orders(tenant_id,source_id)
  where source in ('facebook_comment','live_comment') and source_id is not null$sql_79_9$;

-- live-cf-mode.sql: source statement 10
execute $sql_79_10$create or replace function public.validate_live_cf_rule() returns trigger
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
end $$$sql_79_10$;

-- live-cf-mode.sql: source statement 11
execute $sql_79_11$drop trigger if exists validate_live_cf_rule on public.comment_rules$sql_79_11$;

-- live-cf-mode.sql: source statement 12
execute $sql_79_12$create trigger validate_live_cf_rule before insert or update on public.comment_rules
 for each row execute function public.validate_live_cf_rule()$sql_79_12$;

-- live-cf-mode.sql: source statement 13
execute $sql_79_13$revoke all on function public.validate_live_cf_rule() from public,anon,authenticated$sql_79_13$;

-- live-cf-mode.sql: source statement 14
begin
execute $sql_79_14$create or replace function public.on_order_status() returns trigger
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
end $$$sql_79_14$;
exception when invalid_function_definition then
  -- A newer signature of on_order_status() is already installed. Its final definition below is mandatory.
  null;
end;

-- live-cf-mode.sql: source statement 15
begin
execute $sql_79_15$create or replace function public.place_live_cf_order(
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
end $$$sql_79_15$;
exception when invalid_function_definition then
  -- A newer signature of place_live_cf_order(uuid,uuid,uuid,text,text,text,text) is already installed. Its final definition below is mandatory.
  null;
end;

-- live-cf-mode.sql: source statement 16
execute $sql_79_16$revoke all on function public.place_live_cf_order(uuid,uuid,uuid,text,text,text,text) from public,anon,authenticated$sql_79_16$;

-- live-cf-mode.sql: source statement 17
execute $sql_79_17$grant execute on function public.place_live_cf_order(uuid,uuid,uuid,text,text,text,text) to service_role$sql_79_17$;

-- live-cf-mode.sql: source statement 18
execute $sql_79_18$do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='products') then
   alter publication supabase_realtime add table public.products;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='commerce_variants') then
   alter publication supabase_realtime add table public.commerce_variants;
  end if;
 end if;
end $$$sql_79_18$;

-- live-cf-mode.sql: source statement 19
execute $sql_79_19$notify pgrst,'reload schema'$sql_79_19$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('live-cf-mode.sql','536347d3bd60c59c5713f1003ee83c7323aa795f8c916a95be925908123c1add','91f67f49d0e22fcdba1f1a77d9fb169c5a66b14ac83d53eb8e001f6580cd966c');
end $migration_79$;

-- 81. live-cf-setup.sql
do $migration_80$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='live-cf-setup.sql';
  if found then
    if installed <> '589ea9c1e4ca903a23339123036c3d82639419639283bbabd3f004d4734a9c3f' then
      raise exception 'Applied migration changed: live-cf-setup.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- live-cf-setup.sql: source statement 2
execute $sql_80_2$alter table public.comment_rules add column if not exists live_bank_account_id uuid
  references public.bank_accounts(id) on delete set null$sql_80_2$;

-- live-cf-setup.sql: source statement 3
execute $sql_80_3$alter table public.comment_rules add column if not exists live_deduct_stock boolean not null default true$sql_80_3$;

-- live-cf-setup.sql: source statement 4
execute $sql_80_4$alter table public.orders add column if not exists live_bank_account_id uuid
  references public.bank_accounts(id) on delete set null$sql_80_4$;

-- live-cf-setup.sql: source statement 5
execute $sql_80_5$alter table public.orders add column if not exists live_stock_deducted boolean not null default true$sql_80_5$;

-- live-cf-setup.sql: source statement 6
execute $sql_80_6$create table if not exists public.live_cf_webhook_receipts (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  page_id text not null,
  comment_id text not null,
  live_rule_id uuid references public.comment_rules(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(tenant_id,page_id,comment_id)
)$sql_80_6$;

-- live-cf-setup.sql: source statement 7
execute $sql_80_7$alter table public.live_cf_webhook_receipts enable row level security$sql_80_7$;

-- live-cf-setup.sql: source statement 8
execute $sql_80_8$revoke all on public.live_cf_webhook_receipts from public,anon,authenticated$sql_80_8$;

-- live-cf-setup.sql: source statement 9
execute $sql_80_9$grant select,insert on public.live_cf_webhook_receipts to service_role$sql_80_9$;

-- live-cf-setup.sql: source statement 10
begin
execute $sql_80_10$create or replace function public.validate_live_cf_setup_rule() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.products;v public.commerce_variants;b public.bank_accounts;normalized text[];
begin
 if tg_op='UPDATE' and new.tenant_id is distinct from old.tenant_id then
  raise exception 'Cannot move a Live CF rule to another tenant' using errcode='23514';
 end if;
 if new.mode<>'live_cf' then
  new.live_product_id:=null;new.live_variant_id:=null;new.live_stock_limit:=null;
  new.live_post_id:=null;new.live_bank_account_id:=null;new.live_deduct_stock:=true;return new;
 end if;
 perform 1 from public.tenants where id=new.tenant_id for update;
 if not found then raise exception 'Live CF tenant not found' using errcode='23514';end if;
 select * into p from public.products where id=new.live_product_id and tenant_id=new.tenant_id;
 if not found or (new.is_active and (not p.is_active or p.commerce_archived)) then
  raise exception 'Live CF product is unavailable' using errcode='23514';end if;
 if new.live_variant_id is not null then
  select * into v from public.commerce_variants where id=new.live_variant_id and tenant_id=new.tenant_id and product_id=p.id;
  if not found or (new.is_active and not v.is_active) then raise exception 'Live CF variant is unavailable' using errcode='23514';end if;
 elsif new.is_active and exists(select 1 from public.commerce_variants where product_id=p.id and is_active) then
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
end $$$sql_80_10$;
exception when invalid_function_definition then
  -- A newer signature of validate_live_cf_setup_rule() is already installed. Its final definition below is mandatory.
  null;
end;

-- live-cf-setup.sql: source statement 11
execute $sql_80_11$drop trigger if exists validate_live_cf_rule on public.comment_rules$sql_80_11$;

-- live-cf-setup.sql: source statement 12
execute $sql_80_12$drop trigger if exists validate_live_cf_setup_rule on public.comment_rules$sql_80_12$;

-- live-cf-setup.sql: source statement 13
execute $sql_80_13$create trigger validate_live_cf_setup_rule before insert or update on public.comment_rules
 for each row execute function public.validate_live_cf_setup_rule()$sql_80_13$;

-- live-cf-setup.sql: source statement 14
execute $sql_80_14$revoke all on function public.validate_live_cf_setup_rule() from public,anon,authenticated$sql_80_14$;

-- live-cf-setup.sql: source statement 15
execute $sql_80_15$create or replace function public.on_order_status() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.status=old.status then return new;end if;
 if old.status='cancelled' then raise exception 'Cancelled order status cannot be changed';end if;
 if new.status='cancelled' and new.product_id is not null and coalesce(new.live_stock_deducted,true) then
  update public.products set stock=stock+1 where id=new.product_id and tenant_id=new.tenant_id;
  if new.variant_id is not null then
   update public.commerce_variants set stock=stock+1 where id=new.variant_id and tenant_id=new.tenant_id;
  end if;
 end if;
 return new;
end $$$sql_80_15$;

-- live-cf-setup.sql: source statement 16
begin
execute $sql_80_16$create or replace function public.place_cf_order(
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
 elsif exists(select 1 from public.commerce_variants where product_id=p.id and tenant_id=p_tenant and is_active) then
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
 insert into public.orders(tenant_id,customer_id,product_id,product_name,amount,variant_id,variant_label,source,source_id,source_code,live_rule_id,live_bank_account_id,live_stock_deducted)
 values(p_tenant,p_customer,p.id,p.name,price,r.live_variant_id,label,'live_comment',p_comment,lower(trim(p_code)),r.id,r.live_bank_account_id,r.live_deduct_stock) returning id into new_id;
 insert into public.commerce_audit(tenant_id,entity_id,action,detail) values(p_tenant,new_id,'live_cf_order',r.id::text);
 return query select 'created'::text,new_id,p.name,p_code,price,label;
end $$$sql_80_16$;
exception when invalid_function_definition then
  -- A newer signature of place_cf_order(uuid,uuid,uuid,text,text,text,text) is already installed. Its final definition below is mandatory.
  null;
end;

-- live-cf-setup.sql: source statement 17
execute $sql_80_17$create or replace function public.place_live_cf_order(
 p_tenant uuid,p_customer uuid,p_rule uuid,p_code text,p_comment text,p_post text,p_page text
) returns table(r_status text,r_order_id uuid,r_name text,r_code text,r_amount numeric,r_variant_label text)
language sql security definer set search_path=pg_catalog,public as $$
 select * from public.place_cf_order(p_tenant,p_customer,p_rule,p_code,p_comment,p_post,p_page)
$$$sql_80_17$;

-- live-cf-setup.sql: source statement 18
execute $sql_80_18$revoke all on function public.place_cf_order(uuid,uuid,uuid,text,text,text,text) from public,anon,authenticated$sql_80_18$;

-- live-cf-setup.sql: source statement 19
execute $sql_80_19$revoke all on function public.place_live_cf_order(uuid,uuid,uuid,text,text,text,text) from public,anon,authenticated$sql_80_19$;

-- live-cf-setup.sql: source statement 20
execute $sql_80_20$grant execute on function public.place_cf_order(uuid,uuid,uuid,text,text,text,text) to service_role$sql_80_20$;

-- live-cf-setup.sql: source statement 21
execute $sql_80_21$grant execute on function public.place_live_cf_order(uuid,uuid,uuid,text,text,text,text) to service_role$sql_80_21$;

-- live-cf-setup.sql: source statement 22
execute $sql_80_22$notify pgrst,'reload schema'$sql_80_22$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('live-cf-setup.sql','589ea9c1e4ca903a23339123036c3d82639419639283bbabd3f004d4734a9c3f','05dfcefd0d101569a99dd462230fc8fd87ce2a43476027432e201410644b4ad0');
end $migration_80$;

-- 82. messenger-product-lookup.sql
do $migration_81$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='messenger-product-lookup.sql';
  if found then
    if installed <> '2dd1cd7eee223dc082d72696bb2cdf80bea7bd4bfa3c8c393d59f0b84431617b' then
      raise exception 'Applied migration changed: messenger-product-lookup.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- messenger-product-lookup.sql: source statement 2
execute $sql_81_2$create or replace function public.messenger_product_lookup(p_tenant uuid, p_code text)
returns table (
  id uuid, name text, price numeric, description text, images jsonb,
  store_slug text, sales_page_url text, variant_id uuid, variant_label text
)
language sql stable security definer set search_path = pg_catalog, public as $$
  with candidates as (
    select p.id, p.name, p.price, p.description,
      coalesce(nullif(p.commerce_images, '[]'::jsonb),
        case when p.image_url is not null then jsonb_build_array(p.image_url) else '[]'::jsonb end) images,
      s.slug store_slug, to_jsonb(p)->>'sales_page_url' sales_page_url,
      null::uuid variant_id, null::text variant_label
    from public.products p
    join public.commerce_stores s on s.tenant_id = p.tenant_id and s.is_open
    join public.tenants t on t.id = p.tenant_id and t.is_active
    where p.tenant_id = p_tenant and p.is_active and not p.commerce_archived
      and length(p_code) between 1 and 60
      and (
        lower(p.code) = lower(p_code)
        or lower(p.id::text) = lower(p_code)
        -- Some installations call the product SKU cf_code/sku; the current editor stores it in code.
        or lower(to_jsonb(p)->>'cf_code') = lower(p_code)
        or lower(to_jsonb(p)->>'sku') = lower(p_code)
      )
    union all
    select p.id, p.name, v.price, p.description,
      coalesce(nullif(p.commerce_images, '[]'::jsonb),
        case when p.image_url is not null then jsonb_build_array(p.image_url) else '[]'::jsonb end),
      s.slug, to_jsonb(p)->>'sales_page_url', v.id, v.label
    from public.commerce_variants v
    join public.products p on p.id = v.product_id and p.tenant_id = v.tenant_id
    join public.commerce_stores s on s.tenant_id = p.tenant_id and s.is_open
    join public.tenants t on t.id = p.tenant_id and t.is_active
    where v.tenant_id = p_tenant and v.is_active and p.is_active and not p.commerce_archived
      and length(p_code) between 1 and 60
      and lower(to_jsonb(v)->>'variant_code') = lower(p_code)
  )
  -- Overlapping aliases are ambiguous: leave the question with normal chat/staff.
  select * from candidates where (select count(*) from candidates) = 1;
$$$sql_81_2$;

-- messenger-product-lookup.sql: source statement 3
execute $sql_81_3$revoke all on function public.messenger_product_lookup(uuid, text) from public, anon, authenticated$sql_81_3$;

-- messenger-product-lookup.sql: source statement 4
execute $sql_81_4$grant execute on function public.messenger_product_lookup(uuid, text) to service_role$sql_81_4$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('messenger-product-lookup.sql','2dd1cd7eee223dc082d72696bb2cdf80bea7bd4bfa3c8c393d59f0b84431617b','d7dc47ee4ae0c13a90593a213044a0f6dd4f99075e09726bfab58b1ccb9140c0');
end $migration_81$;

-- 83. slip-confirmation-template.sql
do $migration_82$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='slip-confirmation-template.sql';
  if found then
    if installed <> '81c5fbea2256012194b8eee2a4b8234a95067344c3948ab74205d24de79160e2' then
      raise exception 'Applied migration changed: slip-confirmation-template.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- slip-confirmation-template.sql: source statement 2
execute $sql_82_2$create table if not exists public.slip_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  slip_confirmation_template text check (length(slip_confirmation_template) <= 2000),
  updated_at timestamptz not null default now()
)$sql_82_2$;

-- slip-confirmation-template.sql: source statement 3
execute $sql_82_3$alter table public.slip_settings enable row level security$sql_82_3$;

-- slip-confirmation-template.sql: source statement 4
execute $sql_82_4$drop policy if exists member_read on public.slip_settings$sql_82_4$;

-- slip-confirmation-template.sql: source statement 5
execute $sql_82_5$create policy member_read on public.slip_settings for select to authenticated
  using (public.can_access_tenant(tenant_id))$sql_82_5$;

-- slip-confirmation-template.sql: source statement 6
execute $sql_82_6$revoke all on public.slip_settings from public, anon, authenticated$sql_82_6$;

-- slip-confirmation-template.sql: source statement 7
execute $sql_82_7$grant select on public.slip_settings to authenticated$sql_82_7$;

-- slip-confirmation-template.sql: source statement 8
execute $sql_82_8$grant select, insert, update, delete on public.slip_settings to service_role$sql_82_8$;

-- slip-confirmation-template.sql: source statement 9
execute $sql_82_9$notify pgrst, 'reload schema'$sql_82_9$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('slip-confirmation-template.sql','81c5fbea2256012194b8eee2a4b8234a95067344c3948ab74205d24de79160e2','591e7c6185b3c102ecc0e7045ffaeb6f0b3b7bf4b7fd1f0e19247995b1b8778f');
end $migration_82$;

-- 84. standalone-slips.sql
do $migration_83$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='standalone-slips.sql';
  if found then
    if installed <> '7c4a15f753634dc091c75dfacbbddbffe4a567e636402f8864b4c6b7d6d980a7' then
      raise exception 'Applied migration changed: standalone-slips.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- standalone-slips.sql: source statement 2
execute $sql_83_2$create table if not exists public.standalone_slips (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  trans_ref text not null check(length(trim(trans_ref)) between 1 and 200 and trans_ref=trim(trans_ref)),
  amount numeric(12,2) not null check(amount>0),
  sender_name text,
  sender_bank text,
  receiver_name text,
  receiver_account text,
  trans_timestamp timestamptz not null,
  raw_payload jsonb,
  customer_id uuid references public.customers(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  image_sha256 text check(image_sha256 is null or image_sha256~'^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint uq_standalone_slip_ref unique(tenant_id,trans_ref),
  constraint uq_standalone_slip_image unique(tenant_id,image_sha256)
)$sql_83_2$;

-- standalone-slips.sql: source statement 3
execute $sql_83_3$alter table public.standalone_slips add column if not exists customer_id uuid references public.customers(id) on delete set null$sql_83_3$;

-- standalone-slips.sql: source statement 4
execute $sql_83_4$alter table public.standalone_slips add column if not exists message_id uuid references public.messages(id) on delete set null$sql_83_4$;

-- standalone-slips.sql: source statement 5
execute $sql_83_5$alter table public.standalone_slips add column if not exists image_sha256 text check(image_sha256 is null or image_sha256~'^[0-9a-f]{64}$')$sql_83_5$;

-- standalone-slips.sql: source statement 6
execute $sql_83_6$create unique index if not exists uq_standalone_slip_image on public.standalone_slips(tenant_id,image_sha256)$sql_83_6$;

-- standalone-slips.sql: source statement 7
execute $sql_83_7$create unique index if not exists uq_standalone_slip_ref on public.standalone_slips(tenant_id,trans_ref)$sql_83_7$;

-- standalone-slips.sql: source statement 8
execute $sql_83_8$create index if not exists standalone_slips_tenant_created on public.standalone_slips(tenant_id,created_at desc)$sql_83_8$;

-- standalone-slips.sql: source statement 9
execute $sql_83_9$alter table public.standalone_slips enable row level security$sql_83_9$;

-- standalone-slips.sql: source statement 10
execute $sql_83_10$revoke all on public.standalone_slips from public,anon,authenticated,service_role$sql_83_10$;

-- standalone-slips.sql: source statement 11
execute $sql_83_11$grant select,insert on public.standalone_slips to service_role$sql_83_11$;

-- standalone-slips.sql: source statement 12
execute $sql_83_12$grant select on public.standalone_slips to authenticated$sql_83_12$;

-- standalone-slips.sql: source statement 13
execute $sql_83_13$drop policy if exists member_read on public.standalone_slips$sql_83_13$;

-- standalone-slips.sql: source statement 14
execute $sql_83_14$create policy member_read on public.standalone_slips for select to authenticated
  using(public.can_access_tenant(tenant_id))$sql_83_14$;

-- standalone-slips.sql: source statement 15
execute $sql_83_15$alter table public.payment_transfer_ledger drop constraint if exists payment_transfer_ledger_source_check$sql_83_15$;

-- standalone-slips.sql: source statement 16
execute $sql_83_16$alter table public.payment_transfer_ledger add constraint payment_transfer_ledger_source_check
  check(source in ('package','sale','billing','standalone'))$sql_83_16$;

-- standalone-slips.sql: source statement 18
execute $sql_83_18$insert into public.payment_transfer_ledger(trans_ref,source,source_id)
  select trans_ref,'standalone',id from public.standalone_slips on conflict do nothing$sql_83_18$;

-- standalone-slips.sql: source statement 19
execute $sql_83_19$do $$ begin
  if exists(
    select 1 from public.standalone_slips s left join public.payment_transfer_ledger l on l.trans_ref=s.trans_ref
    where l.source is distinct from 'standalone' or l.source_id is distinct from s.id
  ) then raise exception 'Existing standalone transfers conflict with the payment ledger; review before installing';end if;
end $$$sql_83_19$;

-- standalone-slips.sql: source statement 20
execute $sql_83_20$create or replace function public.guard_standalone_slip() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if not exists(select 1 from public.tenants where id=new.tenant_id and is_active) then
    raise exception 'Standalone tenant is unavailable' using errcode='42501';
  end if;
  if new.customer_id is not null and not exists(
    select 1 from public.customers where id=new.customer_id and tenant_id=new.tenant_id
  ) then raise exception 'Standalone customer scope mismatch' using errcode='42501';end if;
  if new.message_id is not null and not exists(
    select 1 from public.messages m join public.customers c on c.id=m.customer_id
    where m.id=new.message_id and c.id=new.customer_id and c.tenant_id=new.tenant_id
  ) then raise exception 'Standalone message scope mismatch' using errcode='42501';end if;
  perform public.claim_payment_transfer(new.trans_ref,'standalone',new.id);
  return new;
end $$$sql_83_20$;

-- standalone-slips.sql: source statement 21
execute $sql_83_21$drop trigger if exists standalone_slip_transfer_guard on public.standalone_slips$sql_83_21$;

-- standalone-slips.sql: source statement 22
execute $sql_83_22$create trigger standalone_slip_transfer_guard before insert on public.standalone_slips
  for each row execute function public.guard_standalone_slip()$sql_83_22$;

-- standalone-slips.sql: source statement 23
execute $sql_83_23$revoke all on function public.guard_standalone_slip() from public,anon,authenticated$sql_83_23$;

-- standalone-slips.sql: source statement 24
execute $sql_83_24$notify pgrst,'reload schema'$sql_83_24$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('standalone-slips.sql','7c4a15f753634dc091c75dfacbbddbffe4a567e636402f8864b4c6b7d6d980a7','96608fd194cf79cae1e2972b7bb8e8e93dc199b75029eb8305dc2576f9a2227b');
end $migration_83$;

-- 85. tenant-ai-quota.sql
do $migration_84$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='tenant-ai-quota.sql';
  if found then
    if installed <> '673b0b070a71b1aee8d59d3e7ecb77f993d389c425f67e534a2318a7ceace9e9' then
      raise exception 'Applied migration changed: tenant-ai-quota.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- tenant-ai-quota.sql: source statement 2
execute $sql_84_2$alter table public.tenants add column if not exists ai_quota_limit integer default 1000$sql_84_2$;

-- tenant-ai-quota.sql: source statement 3
execute $sql_84_3$alter table public.tenants add column if not exists ai_quota_used integer default 0$sql_84_3$;

-- tenant-ai-quota.sql: source statement 4
execute $sql_84_4$alter table public.tenants alter column ai_quota_limit set default 1000$sql_84_4$;

-- tenant-ai-quota.sql: source statement 5
execute $sql_84_5$alter table public.tenants alter column ai_quota_used set default 0$sql_84_5$;

-- tenant-ai-quota.sql: source statement 6
execute $sql_84_6$update public.tenants set ai_quota_limit=coalesce(ai_quota_limit,1000),ai_quota_used=coalesce(ai_quota_used,0)
 where ai_quota_limit is null or ai_quota_used is null$sql_84_6$;

-- tenant-ai-quota.sql: source statement 7
execute $sql_84_7$alter table public.tenants alter column ai_quota_limit set not null$sql_84_7$;

-- tenant-ai-quota.sql: source statement 8
execute $sql_84_8$alter table public.tenants alter column ai_quota_used set not null$sql_84_8$;

-- tenant-ai-quota.sql: source statement 9
execute $sql_84_9$do $$begin
 if not exists(select 1 from pg_constraint where conrelid='public.tenants'::regclass and conname='tenants_ai_quota_nonnegative') then
  alter table public.tenants add constraint tenants_ai_quota_nonnegative check(ai_quota_limit>=0 and ai_quota_used>=0);
 end if;
end $$$sql_84_9$;

-- tenant-ai-quota.sql: source statement 10
execute $sql_84_10$alter table public.conversation_events add column if not exists reason text$sql_84_10$;

-- tenant-ai-quota.sql: source statement 11
execute $sql_84_11$create table if not exists public.tenant_ai_reply_reservations(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,
 customer_id uuid not null references public.customers(id) on delete cascade,
 source_message_id uuid not null references public.messages(id),external_id text not null,
 status text not null default 'reserved' check(status in ('reserved','dispatching','unknown','sent','released')),
 created_at timestamptz not null default clock_timestamp(),completed_at timestamptz,
 unique(tenant_id,source_message_id),unique(tenant_id,external_id)
)$sql_84_11$;

-- tenant-ai-quota.sql: source statement 12
execute $sql_84_12$create index if not exists tenant_ai_reply_capacity on public.tenant_ai_reply_reservations(tenant_id,status)
 where status in ('reserved','dispatching','unknown')$sql_84_12$;

-- tenant-ai-quota.sql: source statement 13
execute $sql_84_13$alter table public.tenant_ai_reply_reservations enable row level security$sql_84_13$;

-- tenant-ai-quota.sql: source statement 14
execute $sql_84_14$revoke all on public.tenant_ai_reply_reservations from public,anon,authenticated$sql_84_14$;

-- tenant-ai-quota.sql: source statement 15
execute $sql_84_15$grant all on public.tenant_ai_reply_reservations to service_role$sql_84_15$;

-- tenant-ai-quota.sql: source statement 16
execute $sql_84_16$create or replace function public.guard_tenant_ai_quota() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if current_user in ('anon','authenticated') and
  ((tg_op='UPDATE' and (new.ai_quota_limit is distinct from old.ai_quota_limit or new.ai_quota_used is distinct from old.ai_quota_used))
   or (tg_op='INSERT' and (new.ai_quota_limit<>1000 or new.ai_quota_used<>0))) then
  raise exception 'AI quota is server managed' using errcode='42501';
 end if;
 return new;
end $$$sql_84_16$;

-- tenant-ai-quota.sql: source statement 17
execute $sql_84_17$drop trigger if exists tenants_ai_quota_server_only on public.tenants$sql_84_17$;

-- tenant-ai-quota.sql: source statement 18
execute $sql_84_18$create trigger tenants_ai_quota_server_only before insert or update on public.tenants
 for each row execute function public.guard_tenant_ai_quota()$sql_84_18$;

-- tenant-ai-quota.sql: source statement 19
execute $sql_84_19$create or replace function public.reserve_tenant_ai_reply(p_tenant uuid,p_customer uuid,p_message uuid)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare t public.tenants;reservation uuid;held bigint;
begin
 select * into t from public.tenants where id=p_tenant and is_active for update;
 if not found or not t.auto_reply_enabled or not public.has_tenant_feature(p_tenant,'ai_agent') then
  return jsonb_build_object('status','blocked');end if;
 if not exists(select 1 from public.customers where id=p_customer and tenant_id=p_tenant
  and bot_enabled and assigned_user_id is null and conversation_status<>'closed')
  or not exists(select 1 from public.messages where id=p_message and customer_id=p_customer and sender='customer') then
  return jsonb_build_object('status','blocked');end if;
 if exists(select 1 from public.tenant_ai_reply_reservations where tenant_id=p_tenant and source_message_id=p_message)
  or exists(select 1 from public.messages where customer_id=p_customer and external_id='reply:'||p_message::text) then
  return jsonb_build_object('status','duplicate');end if;
 select count(*) into held from public.tenant_ai_reply_reservations
  where tenant_id=p_tenant and status in ('reserved','dispatching','unknown');
 if t.ai_quota_used::bigint+held>=t.ai_quota_limit then return jsonb_build_object('status','quota_exceeded');end if;
 insert into public.tenant_ai_reply_reservations(tenant_id,customer_id,source_message_id,external_id)
 values(p_tenant,p_customer,p_message,'reply:'||p_message::text) returning id into reservation;
 return jsonb_build_object('status','reserved','id',reservation);
end $$$sql_84_19$;

-- tenant-ai-quota.sql: source statement 20
execute $sql_84_20$create or replace function public.authorize_tenant_ai_reply(p_reservation uuid)
returns text language plpgsql set search_path=pg_catalog,public as $$
declare r public.tenant_ai_reply_reservations;t public.tenants;held bigint;
begin
 select * into r from public.tenant_ai_reply_reservations where id=p_reservation;
 if not found then return 'blocked';end if;
 select * into t from public.tenants where id=r.tenant_id for update;
 select * into r from public.tenant_ai_reply_reservations where id=p_reservation for update;
 if r.status<>'reserved' or not t.is_active or not t.auto_reply_enabled then return 'blocked';end if;
 select count(*) into held from public.tenant_ai_reply_reservations where tenant_id=r.tenant_id and status in ('dispatching','unknown');
 if t.ai_quota_used::bigint+held>=t.ai_quota_limit then return 'quota_exceeded';end if;
 update public.tenant_ai_reply_reservations set status='dispatching' where id=r.id;
 return 'authorized';
end $$$sql_84_20$;

-- tenant-ai-quota.sql: source statement 21
execute $sql_84_21$create or replace function public.account_tenant_ai_reply() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.tenant_ai_reply_reservations;
begin
 if new.sender<>'bot' or new.external_id is null or new.delivery_status is null
  or new.delivery_status not in ('sent','delivered','read','failed','unknown') then return new;end if;
 select * into r from public.tenant_ai_reply_reservations where customer_id=new.customer_id and external_id=new.external_id;
 if not found then return new;end if;
 perform 1 from public.tenants where id=r.tenant_id for update;
 select * into r from public.tenant_ai_reply_reservations where id=r.id for update;
 if r.status='sent' then return new;end if;
 if new.delivery_status in ('sent','delivered','read') then
  update public.tenants set ai_quota_used=ai_quota_used+1 where id=r.tenant_id;
  update public.tenant_ai_reply_reservations set status='sent',completed_at=clock_timestamp() where id=r.id;
 elsif new.delivery_status='failed' then
  update public.tenant_ai_reply_reservations set status='released',completed_at=clock_timestamp() where id=r.id;
 else
  update public.tenant_ai_reply_reservations set status='unknown' where id=r.id;
 end if;
 return new;
end $$$sql_84_21$;

-- tenant-ai-quota.sql: source statement 22
execute $sql_84_22$drop trigger if exists messages_account_tenant_ai_reply on public.messages$sql_84_22$;

-- tenant-ai-quota.sql: source statement 23
execute $sql_84_23$create trigger messages_account_tenant_ai_reply after insert or update of delivery_status on public.messages
 for each row execute function public.account_tenant_ai_reply()$sql_84_23$;

-- tenant-ai-quota.sql: source statement 24
execute $sql_84_24$create or replace function public.settle_tenant_ai_reply(p_reservation uuid)
returns text language plpgsql set search_path=pg_catalog,public as $$
declare r public.tenant_ai_reply_reservations;delivery text;
begin
 select * into r from public.tenant_ai_reply_reservations where id=p_reservation;
 if not found then return 'missing';end if;
 perform 1 from public.tenants where id=r.tenant_id for update;
 select * into r from public.tenant_ai_reply_reservations where id=p_reservation for update;
 if r.status in ('sent','released') then return r.status;end if;
 select delivery_status into delivery from public.messages where customer_id=r.customer_id and external_id=r.external_id;
 if delivery in ('sent','delivered','read') then
  update public.tenants set ai_quota_used=ai_quota_used+1 where id=r.tenant_id;
  update public.tenant_ai_reply_reservations set status='sent',completed_at=clock_timestamp() where id=r.id;
  return 'sent';
 elsif not found or delivery='failed' then
  update public.tenant_ai_reply_reservations set status='released',completed_at=clock_timestamp() where id=r.id;
  return 'released';
 end if;
 -- Pending/unknown sends may have reached Meta: keep the capacity held for review.
 update public.tenant_ai_reply_reservations set status='unknown' where id=r.id;
 return 'unknown';
end $$$sql_84_24$;

-- tenant-ai-quota.sql: source statement 25
execute $sql_84_25$create or replace function public.handover_tenant_ai_quota(p_tenant uuid,p_customer uuid,p_message uuid)
returns boolean language plpgsql set search_path=pg_catalog,public as $$
declare c public.customers;
begin
 perform 1 from public.tenants where id=p_tenant and is_active for update;
 if not found then return false;end if;
 select * into c from public.customers where id=p_customer and tenant_id=p_tenant for update;
 if not found or not exists(select 1 from public.messages where id=p_message and customer_id=c.id and sender='customer') then return false;end if;
 if c.bot_enabled and c.assigned_user_id is null and c.conversation_status<>'closed' then
  update public.customers set bot_enabled=false,handover_at=clock_timestamp(),conversation_version=conversation_version+1 where id=c.id;
  insert into public.conversation_events(tenant_id,customer_id,action,reason) values(p_tenant,c.id,'handover','quota_exceeded');
 end if;
 return true;
end $$$sql_84_25$;

-- tenant-ai-quota.sql: source statement 26
execute $sql_84_26$revoke all on function public.guard_tenant_ai_quota(),public.account_tenant_ai_reply() from public,anon,authenticated,service_role$sql_84_26$;

-- tenant-ai-quota.sql: source statement 27
execute $sql_84_27$revoke all on function public.reserve_tenant_ai_reply(uuid,uuid,uuid),public.authorize_tenant_ai_reply(uuid),public.settle_tenant_ai_reply(uuid),public.handover_tenant_ai_quota(uuid,uuid,uuid) from public,anon,authenticated$sql_84_27$;

-- tenant-ai-quota.sql: source statement 28
execute $sql_84_28$grant execute on function public.reserve_tenant_ai_reply(uuid,uuid,uuid),public.authorize_tenant_ai_reply(uuid),public.settle_tenant_ai_reply(uuid),public.handover_tenant_ai_quota(uuid,uuid,uuid) to service_role$sql_84_28$;

-- tenant-ai-quota.sql: source statement 29
execute $sql_84_29$do $$
declare definition text;proof text;
begin
 if to_regprocedure('public.start_agent_ai_call(uuid,uuid,uuid,uuid,uuid)') is not null then
  definition:=pg_get_functiondef('public.start_agent_ai_call(uuid,uuid,uuid,uuid,uuid)'::regprocedure);
  if position('tenant_ai_reply_reservations' in definition)=0 then
   proof:='exists(select 1 from public.tenant_ai_reply_reservations r where r.id=p_key and r.tenant_id=p_tenant and r.customer_id=p_customer and r.status=''reserved'' and (p_job is null or exists(select 1 from public.agent_message_jobs q where q.id=p_job and q.message_id=r.source_message_id)))';
   definition:=replace(definition,'s.ai_monthly_limit<=0','(s.ai_monthly_limit<=0 and not '||proof||')');
   definition:=replace(definition,'used<s.ai_monthly_limit','(used<s.ai_monthly_limit or '||proof||')');
   execute definition;
  end if;
 end if;
end $$$sql_84_29$;

-- tenant-ai-quota.sql: source statement 30
execute $sql_84_30$notify pgrst,'reload schema'$sql_84_30$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('tenant-ai-quota.sql','673b0b070a71b1aee8d59d3e7ecb77f993d389c425f67e534a2318a7ceace9e9','a26fd232c74124152b04a4d9b73ee77ceac9f1f36fd62a6eea75becf363638f3');
end $migration_84$;

-- 86. vision-master-switch.sql
do $migration_85$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='vision-master-switch.sql';
  if found then
    if installed <> '59ad5e7e4032c8ca944ddfd3727164461ea7292b548a38114defb05f1fe381fe' then
      raise exception 'Applied migration changed: vision-master-switch.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- vision-master-switch.sql: source statement 2
execute $sql_85_2$do $$
declare signature text; definition text;
begin
 foreach signature in array array['public.claim_vision_job(uuid)',
  'public.start_vision_analysis(uuid,uuid)','public.begin_vision_dispatch(uuid,uuid)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if position('vision_settings' in definition)=0 then
   raise exception 'Missing Vision Master Switch guard in %',signature;
  end if;
  definition:=replace(definition,' and t.auto_reply_enabled',' and t.is_active');
  definition:=replace(definition,'where id=j.tenant_id and auto_reply_enabled','where id=j.tenant_id and is_active');
  if position('auto_reply_enabled' in definition)>0 then
   raise exception 'Unrecognized Vision gate in %; no changes committed',signature;
  end if;
  execute definition;
 end loop;
end $$$sql_85_2$;

-- vision-master-switch.sql: source statement 3
execute $sql_85_3$create or replace function public.save_vision_settings(p_tenant uuid,p_actor uuid,p_enabled boolean,p_mode text,p_confidence numeric,p_handoff boolean) returns void
language plpgsql set search_path=pg_catalog,public as $$
begin
 if not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner')
  or exists(select 1 from public.platform_admins where user_id=p_actor))
  or not public.has_tenant_feature(p_tenant,'image_assistant') then
  raise exception 'FEATURE_LOCKED' using errcode='42501';
 end if;
 if p_enabled is null then raise exception 'Invalid enabled setting' using errcode='22023';end if;
 insert into public.vision_settings(tenant_id,enabled,mode,confidence_threshold,handoff_enabled)
 values(p_tenant,p_enabled,'rules',0.8,true)
 on conflict(tenant_id) do update set enabled=excluded.enabled,mode='rules',confidence_threshold=0.8,handoff_enabled=true;
 insert into public.vision_audit_logs(tenant_id,actor_id,event,detail)
 values(p_tenant,p_actor,'settings_updated',case when p_enabled then 'enabled' else 'disabled' end);
end $$$sql_85_3$;

-- vision-master-switch.sql: source statement 4
execute $sql_85_4$create or replace function public.handover_vision_job(p_job uuid,p_claim uuid,p_reason text)
returns boolean language plpgsql set search_path=pg_catalog,public as $$
declare j public.vision_jobs;c public.customers;
begin
 select * into j from public.vision_jobs where id=p_job;
 if not found or j.source<>'messenger' or j.customer_id is null then return false;end if;
 perform 1 from public.tenants where id=j.tenant_id and is_active for update;
 if not found then return false;end if;
 select * into c from public.customers where id=j.customer_id and tenant_id=j.tenant_id for update;
 select * into j from public.vision_jobs where id=p_job for update;
 if j.status<>'processing' or p_claim is null or j.claim_token is distinct from p_claim
  or c.id is null or not exists(select 1 from public.vision_settings where tenant_id=j.tenant_id and enabled)
  or not exists(select 1 from public.messages where id=j.message_id and customer_id=c.id and sender='customer') then return false;end if;
 if c.bot_enabled and c.assigned_user_id is null and c.conversation_status<>'closed' then
  update public.customers set bot_enabled=false,handover_at=clock_timestamp(),conversation_version=conversation_version+1 where id=c.id;
  insert into public.conversation_events(tenant_id,customer_id,action) values(j.tenant_id,c.id,'handover');
 end if;
 update public.vision_jobs set status='requires_review',reason=left(coalesce(nullif(p_reason,''),'VISION_ANALYSIS_FAILED'),200),
  claim_token=null,claim_until=null,updated_at=clock_timestamp() where id=j.id;
 return true;
end $$$sql_85_4$;

-- vision-master-switch.sql: source statement 5
execute $sql_85_5$revoke all on function public.handover_vision_job(uuid,uuid,text),public.save_vision_settings(uuid,uuid,boolean,text,numeric,boolean) from public,anon,authenticated$sql_85_5$;

-- vision-master-switch.sql: source statement 6
execute $sql_85_6$grant execute on function public.handover_vision_job(uuid,uuid,text),public.save_vision_settings(uuid,uuid,boolean,text,numeric,boolean) to service_role$sql_85_6$;

-- vision-master-switch.sql: source statement 7
execute $sql_85_7$notify pgrst,'reload schema'$sql_85_7$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('vision-master-switch.sql','59ad5e7e4032c8ca944ddfd3727164461ea7292b548a38114defb05f1fe381fe','137f222b26061e467b6444853806fb3c4d2ea5c74674ac6a986b7fc7a65883b6');
end $migration_85$;

-- 87. live-cf-customer-variants.sql
do $migration_86$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='live-cf-customer-variants.sql';
  if found then
    if installed <> '9c7cc9a0379ab9c20d056f017dfb87b7c48c175f6a3c57ab65d61d364042365b' then
      raise exception 'Applied migration changed: live-cf-customer-variants.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- live-cf-customer-variants.sql: source statement 2
execute $sql_86_2$alter table public.comment_rules add column if not exists live_customer_select_variant boolean not null default false$sql_86_2$;

-- live-cf-customer-variants.sql: source statement 3
execute $sql_86_3$alter table public.orders add column if not exists live_variant_selection_required boolean not null default false$sql_86_3$;

-- live-cf-customer-variants.sql: source statement 4
execute $sql_86_4$alter table public.orders add column if not exists live_variant_confirmed_at timestamptz$sql_86_4$;

-- live-cf-customer-variants.sql: source statement 5
execute $sql_86_5$create or replace function public.validate_live_cf_setup_rule() returns trigger
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
end $$$sql_86_5$;

-- live-cf-customer-variants.sql: source statement 6
begin
execute $sql_86_6$create or replace function public.place_cf_order(
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
end $$$sql_86_6$;
exception when invalid_function_definition then
  -- A newer signature of place_cf_order(uuid,uuid,uuid,text,text,text,text) is already installed. Its final definition below is mandatory.
  null;
end;

-- live-cf-customer-variants.sql: source statement 7
execute $sql_86_7$create or replace function public.confirm_live_cf_variant(p_order uuid,p_variant uuid)
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
end $$$sql_86_7$;

-- live-cf-customer-variants.sql: source statement 8
execute $sql_86_8$revoke all on function public.confirm_live_cf_variant(uuid,uuid) from public,anon,authenticated$sql_86_8$;

-- live-cf-customer-variants.sql: source statement 9
execute $sql_86_9$grant execute on function public.confirm_live_cf_variant(uuid,uuid) to service_role$sql_86_9$;

-- live-cf-customer-variants.sql: source statement 10
begin
execute $sql_86_10$create or replace function public.guard_live_cf_variant_payment() returns trigger
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
end $$$sql_86_10$;
exception when invalid_function_definition then
  -- A newer signature of guard_live_cf_variant_payment() is already installed. Its final definition below is mandatory.
  null;
end;

-- live-cf-customer-variants.sql: source statement 11
execute $sql_86_11$drop trigger if exists orders_live_cf_variant_guard on public.orders$sql_86_11$;

-- live-cf-customer-variants.sql: source statement 12
execute $sql_86_12$create trigger orders_live_cf_variant_guard before update on public.orders
 for each row execute function public.guard_live_cf_variant_payment()$sql_86_12$;

-- live-cf-customer-variants.sql: source statement 13
execute $sql_86_13$revoke all on function public.guard_live_cf_variant_payment() from public,anon,authenticated$sql_86_13$;

-- live-cf-customer-variants.sql: source statement 14
begin
execute $sql_86_14$create or replace function public.guard_live_cf_variant_slip() returns trigger
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
end $$$sql_86_14$;
exception when invalid_function_definition then
  -- A newer signature of guard_live_cf_variant_slip() is already installed. Its final definition below is mandatory.
  null;
end;

-- live-cf-customer-variants.sql: source statement 15
execute $sql_86_15$drop trigger if exists slips_live_cf_selection_guard on public.slips$sql_86_15$;

-- live-cf-customer-variants.sql: source statement 16
execute $sql_86_16$create trigger slips_live_cf_selection_guard before insert or update on public.slips
 for each row execute function public.guard_live_cf_variant_slip()$sql_86_16$;

-- live-cf-customer-variants.sql: source statement 17
execute $sql_86_17$revoke all on function public.guard_live_cf_variant_slip() from public,anon,authenticated$sql_86_17$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('live-cf-customer-variants.sql','9c7cc9a0379ab9c20d056f017dfb87b7c48c175f6a3c57ab65d61d364042365b','c620b8852bf6067a70bc0cb265a285e3d9fddd0d05d55e9ed5a8a6c72fa6df29');
end $migration_86$;

-- 88. live-auctions.sql
do $migration_87$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='live-auctions.sql';
  if found then
    if installed <> 'a9db4f872fcd501ce2a254c804e901b489440fdaf4747bda2aa7594857447aef' then
      raise exception 'Applied migration changed: live-auctions.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- live-auctions.sql: source statement 2
execute $sql_87_2$create table if not exists public.auctions (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 page_id text not null, live_post_id text not null check(live_post_id ~ '^[0-9]+$'),
 live_post_aliases text[] not null default '{}',
 item_name text not null check(length(trim(item_name)) between 1 and 200),
 start_price numeric(12,2) not null check(start_price>0 and start_price<=999999999),
 min_step numeric(12,2) not null check(min_step>0 and min_step<=999999999),
 shipping_fee numeric(12,2) not null default 0 check(shipping_fee>=0 and shipping_fee<=999999),
 current_price numeric(12,2) not null default 0 check(current_price>=0),
 leading_bidder_id text, leading_bidder_name text, leading_comment_id text,
 host_ids text[] not null default '{}', host_count text,
 bank_account_id uuid not null references public.bank_accounts(id),
 status text not null default 'active' check(status in ('active','closed','cancelled')),
 closed_at timestamptz, close_event_id uuid references public.facebook_webhook_events(id),
 order_id uuid unique references public.orders(id),
 created_at timestamptz not null default clock_timestamp()
)$sql_87_2$;

-- live-auctions.sql: source statement 3
execute $sql_87_3$create unique index if not exists auctions_one_active on public.auctions(page_id,live_post_id) where status='active'$sql_87_3$;

-- live-auctions.sql: source statement 4
execute $sql_87_4$create index if not exists auctions_tenant_recent on public.auctions(tenant_id,created_at desc)$sql_87_4$;

-- live-auctions.sql: source statement 5
execute $sql_87_5$create table if not exists public.auction_bids (
 id uuid primary key default gen_random_uuid(),
 auction_id uuid not null references public.auctions(id) on delete cascade,
 event_id uuid not null unique references public.facebook_webhook_events(id),
 comment_id text not null, bidder_id text not null, bidder_name text,
 comment_text text not null, bid_amount numeric(12,2), is_opening boolean not null default false,
 status text not null, result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(auction_id,comment_id)
)$sql_87_5$;

-- live-auctions.sql: source statement 6
execute $sql_87_6$create index if not exists auction_bids_recent on public.auction_bids(auction_id,created_at desc)$sql_87_6$;

-- live-auctions.sql: source statement 7
execute $sql_87_7$create table if not exists public.auction_deliveries (
 id uuid primary key default gen_random_uuid(),
 auction_id uuid not null references public.auctions(id) on delete cascade,
 channel text not null check(channel in ('public','private')),
 comment_id text not null,
 status text not null default 'pending' check(status in ('pending','sending','sent','requires_review')),
 started_at timestamptz, completed_at timestamptz, error_code text,
 unique(auction_id,channel)
)$sql_87_7$;

-- live-auctions.sql: source statement 8
execute $sql_87_8$create table if not exists public.auction_payment_proofs (
 order_id uuid primary key references public.orders(id),
 tenant_id uuid not null references public.tenants(id),
 slip_id uuid not null unique references public.slips(id),
 created_at timestamptz not null default clock_timestamp()
)$sql_87_8$;

-- live-auctions.sql: source statement 9
execute $sql_87_9$alter table public.auctions enable row level security$sql_87_9$;

-- live-auctions.sql: source statement 10
execute $sql_87_10$alter table public.auction_bids enable row level security$sql_87_10$;

-- live-auctions.sql: source statement 11
execute $sql_87_11$alter table public.auction_deliveries enable row level security$sql_87_11$;

-- live-auctions.sql: source statement 12
execute $sql_87_12$alter table public.auction_payment_proofs enable row level security$sql_87_12$;

-- live-auctions.sql: source statement 13
execute $sql_87_13$revoke all on public.auctions,public.auction_bids,public.auction_deliveries from public,anon,authenticated$sql_87_13$;

-- live-auctions.sql: source statement 14
execute $sql_87_14$grant all on public.auctions,public.auction_bids,public.auction_deliveries to service_role$sql_87_14$;

-- live-auctions.sql: source statement 15
execute $sql_87_15$revoke all on public.auction_payment_proofs from public,anon,authenticated$sql_87_15$;

-- live-auctions.sql: source statement 16
execute $sql_87_16$grant all on public.auction_payment_proofs to service_role$sql_87_16$;

-- live-auctions.sql: source statement 17
execute $sql_87_17$create or replace function public.submit_auction_payment_proof(p_order uuid,p_image text)
returns uuid language plpgsql set search_path=pg_catalog,public as $$
declare o public.orders; sid uuid;
begin
 select * into o from public.orders where id=p_order and source='live_auction' for update;
 if not found or o.status<>'pending_payment' then raise exception 'AUCTION_PAYMENT_LOCKED' using errcode='P0002';end if;
 if exists(select 1 from public.auction_payment_proofs where order_id=o.id) then
  raise exception 'AUCTION_PROOF_EXISTS' using errcode='23505';
 end if;
 insert into public.slips(tenant_id,customer_id,image_path,expected_amount,status,note)
  values(o.tenant_id,o.customer_id,p_image,o.amount,'error','หลักฐานชำระประมูล: รอเจ้าของร้านตรวจสอบและอนุมัติด้วยตนเอง') returning id into sid;
 insert into public.auction_payment_proofs(order_id,tenant_id,slip_id) values(o.id,o.tenant_id,sid);
 return sid;
end $$$sql_87_17$;

-- live-auctions.sql: source statement 18
execute $sql_87_18$create or replace function public.approve_auction_payment_proof(p_slip uuid,p_tenant uuid,p_actor uuid)
returns timestamptz language plpgsql set search_path=pg_catalog,public as $$
declare s public.slips; o public.orders; approved timestamptz;
begin
 select slip.* into s from public.slips slip join public.auction_payment_proofs proof on proof.slip_id=slip.id
  where slip.id=p_slip and slip.tenant_id=p_tenant and proof.tenant_id=p_tenant for update of slip;
 if not found or s.status not in ('error','valid','fake','amount_mismatch','wrong_receiver') then
  raise exception 'AUCTION_PROOF_NOT_APPROVABLE' using errcode='42501';
 end if;
 select sale.* into o from public.orders sale join public.auction_payment_proofs proof on proof.order_id=sale.id
  where proof.slip_id=s.id and sale.tenant_id=p_tenant and sale.customer_id=s.customer_id for update of sale;
 if not found or o.status not in ('pending_payment','paid') then
  raise exception 'AUCTION_PAYMENT_LOCKED' using errcode='42501';
 end if;
 approved:=coalesce(s.approved_at,clock_timestamp());
 update public.slips set approved_at=approved,approved_by=coalesce(approved_by,p_actor) where id=s.id;
 update public.orders set status='paid',paid_at=approved,slip_id=s.id where id=o.id and status='pending_payment';
 return approved;
end $$$sql_87_18$;

-- live-auctions.sql: source statement 19
execute $sql_87_19$create or replace function public.auction_comment_ordering() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.kind='change' and new.payload->>'field' in ('feed','live_comments')
    and new.payload->'value'->>'item'='comment' then
  new.ordering_key:='comments:'||new.page_id;
 end if;
 return new;
end $$$sql_87_19$;

-- live-auctions.sql: source statement 20
execute $sql_87_20$drop trigger if exists auction_comment_ordering on public.facebook_webhook_events$sql_87_20$;

-- live-auctions.sql: source statement 21
execute $sql_87_21$create trigger auction_comment_ordering before insert on public.facebook_webhook_events
 for each row execute function public.auction_comment_ordering()$sql_87_21$;

-- live-auctions.sql: source statement 23
begin
execute $sql_87_23$create or replace function public.finalize_live_auction(p_auction uuid,p_tenant uuid,p_event uuid default null,p_cancel boolean default false)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare a public.auctions; c public.customers; oid uuid;
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
  insert into public.orders(tenant_id,customer_id,product_name,amount,source,source_id,live_bank_account_id)
   values(a.tenant_id,c.id,a.item_name,a.current_price+a.shipping_fee,'live_auction',a.id::text,a.bank_account_id)
   returning id into oid;
  insert into public.auction_deliveries(auction_id,channel,comment_id) values(a.id,'private',a.leading_comment_id);
 end if;
 update public.auctions set status=case when p_cancel then 'cancelled' else 'closed' end,
  closed_at=clock_timestamp(),close_event_id=p_event,order_id=oid where id=a.id;
 if p_event is not null and not p_cancel then
  insert into public.auction_deliveries(auction_id,channel,comment_id)
   select a.id,'public',payload->'value'->>'comment_id' from public.facebook_webhook_events where id=p_event;
 end if;
 return jsonb_build_object('status',case when p_cancel then 'cancelled' else 'closed' end,'orderId',oid);
end $$$sql_87_23$;
exception when invalid_function_definition then
  -- A newer signature of finalize_live_auction(uuid,uuid,uuid,boolean) is already installed. Its final definition below is mandatory.
  null;
end;

-- live-auctions.sql: source statement 24
begin
execute $sql_87_24$create or replace function public.process_live_auction_comment(p_auction uuid,p_tenant uuid,p_event uuid,p_kind text,p_amount numeric default null,p_control text default null)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare a public.auctions; e public.facebook_webhook_events; v jsonb; prior jsonb; r jsonb;
 sender text; cid text; bidder text; amount numeric; minimum numeric; outcome text; host boolean;
begin
 select * into a from public.auctions where id=p_auction and tenant_id=p_tenant for update;
 if not found then raise exception 'AUCTION_NOT_FOUND' using errcode='P0002';end if;
 select * into e from public.facebook_webhook_events where id=p_event and page_id=a.page_id;
 if not found or e.kind<>'change' then raise exception 'AUCTION_EVENT_INVALID' using errcode='42501';end if;
 v:=e.payload->'value'; sender:=v->'from'->>'id'; cid:=v->>'comment_id';bidder:=left(v->'from'->>'name',200);
 if sender is null or cid is null or v->>'verb'<>'add' then return jsonb_build_object('status','ignored');end if;
 if not coalesce((a.live_post_id=split_part(v->>'post_id','_',array_length(string_to_array(v->>'post_id','_'),1))
   or a.live_post_id=v->>'video_id' or a.live_post_id=v->>'live_video_id'
   or v->>'post_id'=any(a.live_post_aliases)),false) then
  raise exception 'AUCTION_POST_MISMATCH' using errcode='42501';
 end if;
 select result into prior from public.auction_bids where auction_id=a.id and comment_id=cid;
 if found then return prior;end if;
 if e.created_at<a.created_at then return jsonb_build_object('status','stale');end if;
 if coalesce(v->>'created_time','') ~ '^[0-9]{10}$' and (v->>'created_time')::numeric<floor(extract(epoch from a.created_at)) then
  return jsonb_build_object('status','stale');
 end if;
 -- No worker may overtake an earlier comment even if called outside the queue loop.
 if exists(select 1 from public.facebook_webhook_events older where older.page_id=e.page_id
  and older.ordering_key=e.ordering_key and older.sequence<e.sequence and older.status in ('pending','processing')) then
  raise exception 'AUCTION_EVENT_OUT_OF_ORDER' using errcode='40001';
 end if;
 host:=sender=a.page_id or sender=any(a.host_ids);
 minimum:=case when a.leading_bidder_id is null then a.start_price else a.current_price+a.min_step end;
 if a.status<>'active' then outcome:='closed';
 elsif p_kind='HOST_CONTROL' and host then
  if p_control='close' then r:=public.finalize_live_auction(a.id,a.tenant_id,e.id);outcome:='closed';
  elsif p_control in ('1','2','3','นับขิง') then
   update public.auctions set host_count=p_control where id=a.id;outcome:='count';
  else return jsonb_build_object('status','ignored');end if;
 elsif host or p_kind not in ('OPENING_BID','STEP_BID','NUMERIC_BID') then
  return jsonb_build_object('status','ignored');
 elsif p_kind='OPENING_BID' and a.leading_bidder_id is not null then outcome:='already_opened';
 else
  amount:=case when p_kind='OPENING_BID' then a.start_price when p_kind='STEP_BID' then minimum else p_amount end;
  if amount is null or amount<minimum or amount>999999999 or amount<>round(amount,2) then outcome:='too_low';
  else
   update public.auctions set current_price=amount,leading_bidder_id=sender,
    leading_bidder_name=bidder,leading_comment_id=cid,host_count=null where id=a.id;
   outcome:='accepted';
  end if;
 end if;
 r:=coalesce(r,jsonb_build_object('status',outcome,'amount',coalesce(amount,a.current_price),
  'minimum',minimum,'name',bidder,'isOpening',p_kind='OPENING_BID'));
 insert into public.auction_bids(auction_id,event_id,comment_id,bidder_id,bidder_name,comment_text,bid_amount,is_opening,status,result)
  values(a.id,e.id,cid,sender,bidder,left(coalesce(v->>'message',''),2000),amount,p_kind='OPENING_BID',outcome,r);
 return r;
end $$$sql_87_24$;
exception when invalid_function_definition then
  -- A newer signature of process_live_auction_comment(uuid,uuid,uuid,text,numeric,text) is already installed. Its final definition below is mandatory.
  null;
end;

-- live-auctions.sql: source statement 25
execute $sql_87_25$revoke all on function public.auction_comment_ordering(),public.finalize_live_auction(uuid,uuid,uuid,boolean),public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text) from public,anon,authenticated$sql_87_25$;

-- live-auctions.sql: source statement 26
execute $sql_87_26$grant execute on function public.finalize_live_auction(uuid,uuid,uuid,boolean),public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text) to service_role$sql_87_26$;

-- live-auctions.sql: source statement 27
execute $sql_87_27$revoke all on function public.submit_auction_payment_proof(uuid,text) from public,anon,authenticated$sql_87_27$;

-- live-auctions.sql: source statement 28
execute $sql_87_28$grant execute on function public.submit_auction_payment_proof(uuid,text) to service_role$sql_87_28$;

-- live-auctions.sql: source statement 29
execute $sql_87_29$revoke all on function public.approve_auction_payment_proof(uuid,uuid,uuid) from public,anon,authenticated$sql_87_29$;

-- live-auctions.sql: source statement 30
execute $sql_87_30$grant execute on function public.approve_auction_payment_proof(uuid,uuid,uuid) to service_role$sql_87_30$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('live-auctions.sql','a9db4f872fcd501ce2a254c804e901b489440fdaf4747bda2aa7594857447aef','910202f12dfb75ce136dc66fe2d95ea645f9de96b03a69ef8e1b92b0fa89eeec');
end $migration_87$;

-- 89. customer-tabs.sql
do $migration_88$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='customer-tabs.sql';
  if found then
    if installed <> 'f5380d06acaa02ff3ed2dc6d8b2c701eed4209babf5cb21cbe7a996d5e5c71ac' then
      raise exception 'Applied migration changed: customer-tabs.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- customer-tabs.sql: source statement 2
execute $sql_88_2$create table if not exists public.live_sessions (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 page_id text not null, live_post_id text not null, ended_at timestamptz,
 reminders_enabled boolean not null default true, created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,page_id,live_post_id)
)$sql_88_2$;

-- customer-tabs.sql: source statement 3
execute $sql_88_3$create table if not exists public.customer_tabs (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 customer_id uuid not null references public.customers(id), customer_fb_id text not null,
 page_id text not null, live_session_id uuid not null references public.live_sessions(id),
 bank_account_id uuid references public.bank_accounts(id), shipping_fee numeric(12,2) not null default 0 check(shipping_fee>=0),
 total_amount numeric(14,2) not null default 0 check(total_amount>=0),
 paid_amount numeric(14,2) not null default 0 check(paid_amount>=0),
 remaining_amount numeric(14,2) generated always as (greatest(total_amount-paid_amount,0)) stored,
 credit_amount numeric(14,2) generated always as (greatest(paid_amount-total_amount,0)) stored,
 status text not null default 'open' check(status in ('open','pending_payment','fully_paid')),
 revision bigint not null default 0, created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(), unique(live_session_id,customer_id)
)$sql_88_3$;

-- customer-tabs.sql: source statement 4
execute $sql_88_4$alter table public.orders add column if not exists customer_tab_id uuid references public.customer_tabs(id)$sql_88_4$;

-- customer-tabs.sql: source statement 5
execute $sql_88_5$alter table public.orders add column if not exists live_session_id uuid references public.live_sessions(id)$sql_88_5$;

-- customer-tabs.sql: source statement 6
execute $sql_88_6$alter table public.orders add column if not exists live_post_id text$sql_88_6$;

-- customer-tabs.sql: source statement 7
execute $sql_88_7$alter table public.orders add column if not exists item_amount numeric(12,2)$sql_88_7$;

-- customer-tabs.sql: source statement 8
execute $sql_88_8$alter table public.orders add column if not exists paid_amount numeric(12,2) not null default 0$sql_88_8$;

-- customer-tabs.sql: source statement 9
execute $sql_88_9$alter table public.slips add column if not exists customer_tab_id uuid references public.customer_tabs(id)$sql_88_9$;

-- customer-tabs.sql: source statement 10
execute $sql_88_10$create table if not exists public.customer_tab_items (
 order_id uuid primary key references public.orders(id), tab_id uuid not null references public.customer_tabs(id),
 item_name text not null, variant_label text, amount numeric(12,2) not null check(amount>0),
 cancelled boolean not null default false, closed_at timestamptz not null default clock_timestamp()
)$sql_88_10$;

-- customer-tabs.sql: source statement 11
execute $sql_88_11$create table if not exists public.customer_tab_payments (
 id uuid primary key default gen_random_uuid(), tab_id uuid not null references public.customer_tabs(id),
 slip_id uuid not null unique references public.slips(id), trans_ref text not null unique,
 amount numeric(12,2) not null check(amount>0), transferred_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp()
)$sql_88_11$;

-- customer-tabs.sql: source statement 12
execute $sql_88_12$create table if not exists public.customer_tab_slip_attempts (
 slip_id uuid primary key references public.slips(id), tenant_id uuid not null references public.tenants(id),
 image_sha256 text not null, created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,image_sha256)
)$sql_88_12$;

-- customer-tabs.sql: source statement 13
execute $sql_88_13$create table if not exists public.customer_tab_reminders (
 id uuid primary key default gen_random_uuid(), tab_id uuid not null references public.customer_tabs(id),
 stage text not null, run_at timestamptz not null,
 status text not null default 'pending' check(status in ('pending','processing','sent','cancelled','blocked','requires_review')),
 claim_token uuid, started_at timestamptz, completed_at timestamptz, error_code text,
 created_at timestamptz not null default clock_timestamp(), unique(tab_id,stage)
)$sql_88_13$;

-- customer-tabs.sql: source statement 14
execute $sql_88_14$create index if not exists customer_tabs_customer on public.customer_tabs(tenant_id,customer_id,created_at desc)$sql_88_14$;

-- customer-tabs.sql: source statement 15
execute $sql_88_15$create index if not exists customer_tabs_debt on public.customer_tabs(tenant_id,remaining_amount) where remaining_amount>0$sql_88_15$;

-- customer-tabs.sql: source statement 16
execute $sql_88_16$create index if not exists customer_tab_items_tab on public.customer_tab_items(tab_id,closed_at,order_id)$sql_88_16$;

-- customer-tabs.sql: source statement 17
execute $sql_88_17$create index if not exists customer_tab_reminders_due on public.customer_tab_reminders(run_at) where status='pending'$sql_88_17$;

-- customer-tabs.sql: source statement 18
execute $sql_88_18$do $$declare t text;begin foreach t in array array['live_sessions','customer_tabs','customer_tab_items','customer_tab_payments','customer_tab_slip_attempts','customer_tab_reminders'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
end loop;end $$$sql_88_18$;

-- customer-tabs.sql: source statement 19
execute $sql_88_19$create or replace function public.refresh_customer_tab(p_tab uuid) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare t public.customer_tabs; item record; balance numeric; fee numeric; line numeric; assigned numeric; previous text;
begin
 select * into t from public.customer_tabs where id=p_tab for update;
 if not found then raise exception 'TAB_NOT_FOUND';end if;
 update public.customer_tabs set
  total_amount=(select coalesce(sum(amount),0) from public.customer_tab_items where tab_id=t.id and not cancelled)
    + case when exists(select 1 from public.customer_tab_items where tab_id=t.id and not cancelled) then shipping_fee else 0 end,
  paid_amount=(select coalesce(sum(amount),0) from public.customer_tab_payments where tab_id=t.id),
  revision=revision+1,updated_at=clock_timestamp() where id=t.id returning * into t;
 update public.customer_tabs set status=case when t.total_amount<=t.paid_amount then 'fully_paid' else 'pending_payment' end where id=t.id;
 balance:=t.paid_amount; fee:=t.shipping_fee;
 previous:=current_setting('app.refreshing_customer_tab',true);
 perform set_config('app.refreshing_customer_tab','1',true);
 for item in select * from public.customer_tab_items where tab_id=t.id and not cancelled order by closed_at,order_id loop
  line:=item.amount+fee;fee:=0;assigned:=least(balance,line);balance:=greatest(balance-line,0);
  update public.orders set amount=line,paid_amount=assigned,
   status=case when status='shipped' then status when assigned>=line then 'paid' else 'pending_payment' end,
   paid_at=case when assigned>=line then coalesce(paid_at,clock_timestamp()) else null end
   where id=item.order_id;
 end loop;
 perform set_config('app.refreshing_customer_tab',coalesce(previous,''),true);
 if t.remaining_amount=0 then update public.customer_tab_reminders set status='cancelled' where tab_id=t.id and status in ('pending','blocked');end if;
end $$$sql_88_19$;

-- customer-tabs.sql: source statement 20
begin
execute $sql_88_20$create or replace function public.attach_customer_tab_order() returns trigger
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
   shipping_fee=case when customer_tabs.shipping_fee=0 then excluded.shipping_fee else customer_tabs.shipping_fee end returning * into bill;
 new.customer_tab_id:=bill.id;new.live_session_id:=sess;new.live_post_id:=post;new.item_amount:=unit;
 new.amount:=unit+case when not exists(select 1 from public.customer_tab_items where tab_id=bill.id and not cancelled) then bill.shipping_fee else 0 end;
 return new;
end $$$sql_88_20$;
exception when invalid_function_definition then
  -- A newer signature of attach_customer_tab_order() is already installed. Its final definition below is mandatory.
  null;
end;

-- customer-tabs.sql: source statement 21
execute $sql_88_21$create or replace function public.sync_customer_tab_order() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.customer_tab_id is null or current_setting('app.refreshing_customer_tab',true)='1' then return new;end if;
 if tg_op='UPDATE' and new.amount=old.amount and new.product_name=old.product_name and new.variant_label is not distinct from old.variant_label
  and (new.status='cancelled')=(old.status='cancelled') then return new;end if;
 perform 1 from public.customer_tabs where id=new.customer_tab_id for update;
 insert into public.customer_tab_items(order_id,tab_id,item_name,variant_label,amount,cancelled,closed_at)
  values(new.id,new.customer_tab_id,new.product_name,new.variant_label,new.item_amount,new.status='cancelled',new.created_at)
  on conflict(order_id) do update set item_name=excluded.item_name,variant_label=excluded.variant_label,amount=excluded.amount,cancelled=excluded.cancelled;
 perform public.refresh_customer_tab(new.customer_tab_id);
 return new;
end $$$sql_88_21$;

-- customer-tabs.sql: source statement 22
execute $sql_88_22$drop trigger if exists customer_tab_order_guard on public.orders$sql_88_22$;

-- customer-tabs.sql: source statement 23
execute $sql_88_23$create trigger customer_tab_order_guard before insert or update on public.orders for each row execute function public.attach_customer_tab_order()$sql_88_23$;

-- customer-tabs.sql: source statement 24
execute $sql_88_24$drop trigger if exists customer_tab_order_sync on public.orders$sql_88_24$;

-- customer-tabs.sql: source statement 25
execute $sql_88_25$create trigger customer_tab_order_sync after insert or update on public.orders for each row execute function public.sync_customer_tab_order()$sql_88_25$;

-- customer-tabs.sql: source statement 26
execute $sql_88_26$create or replace function public.claim_customer_tab_slip(p_tab uuid,p_customer uuid,p_hash text,p_image text,p_message uuid default null)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare t public.customer_tabs; s public.slips; sid uuid;
begin
 select * into t from public.customer_tabs where id=p_tab and customer_id=p_customer for update;
 if not found or t.remaining_amount<=0 then raise exception 'TAB_NOT_PAYABLE';end if;
 select slip.* into s from public.slips slip join public.customer_tab_slip_attempts attempt on attempt.slip_id=slip.id
  where attempt.tenant_id=t.tenant_id and attempt.image_sha256=p_hash;
 if found then
  if s.customer_id<>p_customer or s.customer_tab_id<>t.id then raise exception 'TAB_PROOF_SCOPE';end if;
  return jsonb_build_object('claimed',false,'slipId',s.id,'imagePath',s.image_path);
 end if;
 insert into public.slips(tenant_id,customer_id,customer_tab_id,message_id,image_path,expected_amount)
  values(t.tenant_id,t.customer_id,t.id,p_message,p_image,t.remaining_amount) returning id into sid;
 insert into public.customer_tab_slip_attempts(slip_id,tenant_id,image_sha256) values(sid,t.tenant_id,p_hash);
 return jsonb_build_object('claimed',true,'slipId',sid,'imagePath',p_image);
end $$$sql_88_26$;

-- customer-tabs.sql: source statement 27
execute $sql_88_27$create or replace function public.complete_customer_tab_slip(p_slip uuid,p_tenant uuid,p_customer uuid,p_verdict text,p_amount numeric,p_ref text,p_paid_at timestamptz,p_raw jsonb,p_note text)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare s public.slips; t public.customer_tabs;
begin
 select * into s from public.slips where id=p_slip and tenant_id=p_tenant and customer_id=p_customer for update;
 if not found or s.customer_tab_id is null then raise exception 'TAB_SLIP_SCOPE';end if;
 select * into t from public.customer_tabs where id=s.customer_tab_id and tenant_id=p_tenant and customer_id=p_customer for update;
 if not found then raise exception 'TAB_SLIP_SCOPE';end if;
 if s.status='pending' then
  if p_verdict='valid' and (p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) or nullif(trim(p_ref),'') is null
   or p_paid_at is null or p_paid_at<t.created_at-interval '60 seconds' or p_paid_at>clock_timestamp()+interval '2 minutes') then
   raise exception 'TAB_PAYMENT_EVIDENCE_INVALID';
  end if;
  perform set_config('app.completing_customer_tab_slip','1',true);
  update public.slips set status=p_verdict,amount=p_amount,trans_ref=p_ref,raw=p_raw,note=p_note,verified_at=clock_timestamp() where id=s.id;
  perform set_config('app.completing_customer_tab_slip','',true);
  if p_verdict='valid' then
   insert into public.customer_tab_payments(tab_id,slip_id,trans_ref,amount,transferred_at) values(t.id,s.id,p_ref,p_amount,p_paid_at);
   perform public.refresh_customer_tab(t.id);
  end if;
 end if;
 select * into t from public.customer_tabs where id=t.id;
 return jsonb_build_object('tabId',t.id,'totalAmount',t.total_amount,'paidAmount',t.paid_amount,'remainingAmount',t.remaining_amount,'status',t.status);
end $$$sql_88_27$;

-- customer-tabs.sql: source statement 28
execute $sql_88_28$create or replace function public.guard_customer_tab_slip() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if tg_op='UPDATE' and old.customer_tab_id is not null and (new.customer_tab_id is distinct from old.customer_tab_id
  or new.customer_id is distinct from old.customer_id or new.tenant_id is distinct from old.tenant_id) then raise exception 'TAB_SLIP_SCOPE_IMMUTABLE';end if;
 if new.customer_tab_id is null then return new;end if;
 if tg_op='UPDATE' and old.status='valid' and (new.status<>old.status or new.amount is distinct from old.amount
  or new.trans_ref is distinct from old.trans_ref or new.customer_tab_id is distinct from old.customer_tab_id
  or new.customer_id is distinct from old.customer_id or new.tenant_id is distinct from old.tenant_id) then raise exception 'TAB_VERIFIED_PROOF_IMMUTABLE';end if;
 if new.status='valid' and (tg_op='INSERT' or old.status<>'valid') and coalesce(current_setting('app.completing_customer_tab_slip',true),'')<>'1' then
  raise exception 'TAB_PAYMENT_LEDGER_REQUIRED';end if;
 return new;
end $$$sql_88_28$;

-- customer-tabs.sql: source statement 29
execute $sql_88_29$drop trigger if exists customer_tab_slip_guard on public.slips$sql_88_29$;

-- customer-tabs.sql: source statement 30
execute $sql_88_30$create trigger customer_tab_slip_guard before insert or update on public.slips for each row execute function public.guard_customer_tab_slip()$sql_88_30$;

-- customer-tabs.sql: source statement 31
execute $sql_88_31$revoke all on function public.guard_customer_tab_slip() from public,anon,authenticated$sql_88_31$;

-- customer-tabs.sql: source statement 32
execute $sql_88_32$create or replace function public.end_customer_tab_live(p_session uuid,p_tenant uuid,p_reminders boolean default true)
returns void language plpgsql set search_path=pg_catalog,public as $$
declare sess public.live_sessions; ended timestamptz;
begin
 select * into sess from public.live_sessions where id=p_session and tenant_id=p_tenant for update;
 if not found then raise exception 'LIVE_SESSION_NOT_FOUND';end if;
 if exists(select 1 from public.auctions where tenant_id=p_tenant and page_id=sess.page_id and live_post_id=sess.live_post_id and status='active') then raise exception 'LIVE_AUCTION_STILL_ACTIVE';end if;
 ended:=coalesce(sess.ended_at,clock_timestamp());
 update public.live_sessions set ended_at=ended,reminders_enabled=p_reminders where id=sess.id;
 if p_reminders then
  insert into public.customer_tab_reminders(tab_id,stage,run_at)
   select id,'after_live_1h',ended+interval '1 hour' from public.customer_tabs where live_session_id=sess.id and remaining_amount>0 on conflict(tab_id,stage) do nothing;
  insert into public.customer_tab_reminders(tab_id,stage,run_at)
   select id,'next_morning',((date_trunc('day',ended at time zone 'Asia/Bangkok')+interval '1 day 9 hours') at time zone 'Asia/Bangkok')
    from public.customer_tabs where live_session_id=sess.id and remaining_amount>0 on conflict(tab_id,stage) do nothing;
 else update public.customer_tab_reminders set status='cancelled' where tab_id in(select id from public.customer_tabs where live_session_id=sess.id) and status in ('pending','blocked');end if;
end $$$sql_88_32$;

-- customer-tabs.sql: source statement 33
execute $sql_88_33$create or replace function public.queue_customer_tab_reminders(p_tenant uuid,p_customer uuid,p_request uuid) returns integer
language plpgsql set search_path=pg_catalog,public as $$
declare count_jobs integer;
begin
 if p_request is null then raise exception 'TAB_REQUEST_REQUIRED';end if;
 insert into public.customer_tab_reminders(tab_id,stage,run_at)
  select id,'manual:'||p_request::text,clock_timestamp() from public.customer_tabs
   where tenant_id=p_tenant and (p_customer is null or customer_id=p_customer) and remaining_amount>0
  on conflict(tab_id,stage) do nothing;
 get diagnostics count_jobs=row_count;return count_jobs;
end $$$sql_88_33$;

-- customer-tabs.sql: source statement 34
begin
execute $sql_88_34$create or replace function public.claim_customer_tab_reminder() returns setof public.customer_tab_reminders
language plpgsql set search_path=pg_catalog,public as $$
begin
 update public.customer_tab_reminders set status='requires_review',error_code='LEASE_EXPIRED' where status='processing' and started_at<clock_timestamp()-interval '5 minutes';
 return query with next_job as(select job.id from public.customer_tab_reminders job join public.customer_tabs bill on bill.id=job.tab_id
  where job.status='pending' and job.run_at<=clock_timestamp() and bill.remaining_amount>0 order by job.run_at,job.id for update of job skip locked limit 1)
 update public.customer_tab_reminders job set status='processing',claim_token=gen_random_uuid(),started_at=clock_timestamp()
  from next_job where job.id=next_job.id returning job.*;
end $$$sql_88_34$;
exception when invalid_function_definition then
  -- A newer signature of claim_customer_tab_reminder() is already installed. Its final definition below is mandatory.
  null;
end;

-- customer-tabs.sql: source statement 35
execute $sql_88_35$revoke all on function public.refresh_customer_tab(uuid),public.attach_customer_tab_order(),public.sync_customer_tab_order(),public.claim_customer_tab_slip(uuid,uuid,text,text,uuid),public.complete_customer_tab_slip(uuid,uuid,uuid,text,numeric,text,timestamptz,jsonb,text),public.end_customer_tab_live(uuid,uuid,boolean),public.claim_customer_tab_reminder() from public,anon,authenticated$sql_88_35$;

-- customer-tabs.sql: source statement 36
execute $sql_88_36$grant execute on function public.refresh_customer_tab(uuid),public.claim_customer_tab_slip(uuid,uuid,text,text,uuid),public.complete_customer_tab_slip(uuid,uuid,uuid,text,numeric,text,timestamptz,jsonb,text),public.end_customer_tab_live(uuid,uuid,boolean),public.claim_customer_tab_reminder() to service_role$sql_88_36$;

-- customer-tabs.sql: source statement 37
execute $sql_88_37$revoke all on function public.queue_customer_tab_reminders(uuid,uuid,uuid) from public,anon,authenticated$sql_88_37$;

-- customer-tabs.sql: source statement 38
execute $sql_88_38$grant execute on function public.queue_customer_tab_reminders(uuid,uuid,uuid) to service_role$sql_88_38$;

-- customer-tabs.sql: source statement 39
execute $sql_88_39$create or replace function public.place_cf_order(
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
 insert into public.orders(tenant_id,customer_id,product_id,product_name,amount,variant_id,variant_label,source,source_id,source_code,live_rule_id,live_bank_account_id,live_stock_deducted,live_variant_selection_required,live_post_id)
 values(p_tenant,p_customer,p.id,p.name,price,r.live_variant_id,label,'live_comment',p_comment,lower(trim(p_code)),r.id,r.live_bank_account_id,r.live_deduct_stock,r.live_customer_select_variant and exists(select 1 from public.commerce_variants where product_id=p.id and tenant_id=p_tenant and is_active),p_post) returning id into new_id;
 insert into public.commerce_audit(tenant_id,entity_id,action,detail) values(p_tenant,new_id,'live_cf_order',r.id::text);
 return query select 'created'::text,new_id,p.name,p_code,price,label;
end $$$sql_88_39$;

-- customer-tabs.sql: source statement 40
execute $sql_88_40$create or replace function public.guard_live_cf_variant_slip() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare total numeric;
begin
 if new.customer_tab_id is not null then
  if new.status='valid' and exists(select 1 from public.orders where customer_tab_id=new.customer_tab_id and status='pending_payment' and live_variant_selection_required and live_variant_confirmed_at is null) then raise exception 'LIVE_CF_VARIANT_REQUIRED';end if;
  return new;
 end if;
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
end $$$sql_88_40$;

-- customer-tabs.sql: source statement 41
execute $sql_88_41$create or replace function public.guard_live_cf_variant_payment() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare s record;total numeric;
begin
 if new.customer_tab_id is not null and current_setting('app.refreshing_customer_tab',true)='1' then
  if new.status='paid' and new.live_variant_selection_required and new.live_variant_confirmed_at is null then raise exception 'LIVE_CF_VARIANT_REQUIRED';end if;
  return new;
 end if;
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
end $$$sql_88_41$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('customer-tabs.sql','f5380d06acaa02ff3ed2dc6d8b2c701eed4209babf5cb21cbe7a996d5e5c71ac','16b91f3b78245a76dacaa59840e6b4fa966193e938a71d36d56489c3a2e2e48a');
end $migration_88$;

-- 90. auction-experience.sql
do $migration_89$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='auction-experience.sql';
  if found then
    if installed <> '2d66bde2c764bdb9e057e40aacea576bbcc73184c62cd9f7f5ccb7fdf73552c2' then
      raise exception 'Applied migration changed: auction-experience.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- auction-experience.sql: source statement 2
execute $sql_89_2$alter table public.auctions
 add column if not exists private_reply_enabled boolean not null default true,
 add column if not exists public_reply_enabled boolean not null default true,
 add column if not exists private_reply_template text not null default 'ยินดีด้วยครับ! คุณชนะประมูล {product_name} ราคา {price} บาท ยอดค้างชำระสุทธิ {total} บาท',
 add column if not exists bid_reply_template text not null default '✅ ยืนยันคุณ {bidder_name} ขึ้นนำ {product_name} ที่ {price} บาท เคาะขั้นต่ำ +{min_step} บาท',
 add column if not exists close_reply_template text not null default '❌ ปิดประมูล {product_name} ผู้ชนะ: {bidder_name} ราคา {price} บาท'$sql_89_2$;

-- auction-experience.sql: source statement 3
begin
execute $sql_89_3$create or replace function public.finalize_live_auction(p_auction uuid,p_tenant uuid,p_event uuid default null,p_cancel boolean default false)
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
end $$$sql_89_3$;
exception when invalid_function_definition then
  -- A newer signature of finalize_live_auction(uuid,uuid,uuid,boolean) is already installed. Its final definition below is mandatory.
  null;
end;

-- auction-experience.sql: source statement 4
execute $sql_89_4$create or replace function public.auction_inbox_status(p_tenant uuid,p_customers uuid[])
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
$$$sql_89_4$;

-- auction-experience.sql: source statement 5
execute $sql_89_5$revoke all on function public.finalize_live_auction(uuid,uuid,uuid,boolean),public.auction_inbox_status(uuid,uuid[]) from public,anon,authenticated$sql_89_5$;

-- auction-experience.sql: source statement 6
execute $sql_89_6$grant execute on function public.finalize_live_auction(uuid,uuid,uuid,boolean),public.auction_inbox_status(uuid,uuid[]) to service_role$sql_89_6$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('auction-experience.sql','2d66bde2c764bdb9e057e40aacea576bbcc73184c62cd9f7f5ccb7fdf73552c2','d63ebe3b3f87fa9678fdc0f92762b65f9a652a0fb15c4e36f06cd0cbe1b318f8');
end $migration_89$;

-- 91. live-session-dashboard.sql
do $migration_90$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='live-session-dashboard.sql';
  if found then
    if installed <> 'e9b938da63a13e71263210ae1dfac87007f1da4d35a20a68f4046a01f4d9231c' then
      raise exception 'Applied migration changed: live-session-dashboard.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- live-session-dashboard.sql: source statement 2
execute $sql_90_2$alter table public.live_sessions
 add column if not exists cost_amount numeric(14,2) not null default 0 check(cost_amount>=0),
 add column if not exists ad_spent numeric(14,2) not null default 0 check(ad_spent>=0),
 add column if not exists shipping_cost numeric(14,2) not null default 0 check(shipping_cost>=0),
 add column if not exists financial_revision bigint not null default 0$sql_90_2$;

-- live-session-dashboard.sql: source statement 3
execute $sql_90_3$alter table public.customer_tab_reminders
 add column if not exists message_template text,
 add column if not exists requested_by uuid references auth.users(id),
 add column if not exists send_after timestamptz$sql_90_3$;

-- live-session-dashboard.sql: source statement 4
execute $sql_90_4$alter table public.customer_tabs add column if not exists shipping_override boolean not null default false$sql_90_4$;

-- live-session-dashboard.sql: source statement 5
execute $sql_90_5$create table if not exists public.live_session_changes (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 session_id uuid not null references public.live_sessions(id),actor_id uuid not null references auth.users(id),
 request_id uuid not null,payload jsonb not null,result jsonb not null,created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,request_id)
)$sql_90_5$;

-- live-session-dashboard.sql: source statement 6
execute $sql_90_6$create table if not exists public.live_reminder_dispatch_slots (
 page_id text primary key,next_allowed_at timestamptz not null default '-infinity'
)$sql_90_6$;

-- live-session-dashboard.sql: source statement 7
execute $sql_90_7$alter table public.live_session_changes enable row level security$sql_90_7$;

-- live-session-dashboard.sql: source statement 8
execute $sql_90_8$alter table public.live_reminder_dispatch_slots enable row level security$sql_90_8$;

-- live-session-dashboard.sql: source statement 9
execute $sql_90_9$revoke all on public.live_session_changes,public.live_reminder_dispatch_slots from public,anon,authenticated$sql_90_9$;

-- live-session-dashboard.sql: source statement 10
execute $sql_90_10$grant all on public.live_session_changes,public.live_reminder_dispatch_slots to service_role$sql_90_10$;

-- live-session-dashboard.sql: source statement 11
execute $sql_90_11$create index if not exists live_session_changes_history on public.live_session_changes(session_id,created_at desc)$sql_90_11$;

-- live-session-dashboard.sql: source statement 12
execute $sql_90_12$create index if not exists auctions_session_history on public.auctions(tenant_id,page_id,live_post_id,closed_at desc)$sql_90_12$;

-- live-session-dashboard.sql: source statement 13
execute $sql_90_13$create index if not exists facebook_live_session_comments on public.facebook_webhook_events(page_id,(regexp_replace(payload->'value'->>'post_id','^.*_','')))
 where kind='change' and payload->'value'->>'verb'='add'$sql_90_13$;

-- live-session-dashboard.sql: source statement 15
execute $sql_90_15$create or replace function public.ensure_auction_live_session() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
declare ended timestamptz;
begin
 insert into public.live_sessions(tenant_id,page_id,live_post_id) values(new.tenant_id,new.page_id,new.live_post_id) on conflict do nothing;
 select ended_at into ended from public.live_sessions where tenant_id=new.tenant_id and page_id=new.page_id and live_post_id=new.live_post_id for update;
 if ended is not null then raise exception 'LIVE_SESSION_ENDED';end if;
 return new;
end $$$sql_90_15$;

-- live-session-dashboard.sql: source statement 16
execute $sql_90_16$drop trigger if exists auction_live_session on public.auctions$sql_90_16$;

-- live-session-dashboard.sql: source statement 17
execute $sql_90_17$create trigger auction_live_session before insert on public.auctions for each row execute function public.ensure_auction_live_session()$sql_90_17$;

-- live-session-dashboard.sql: source statement 18
execute $sql_90_18$alter table public.customer_tab_items add column if not exists auction_id uuid references public.auctions(id),
 add column if not exists winning_bid_id uuid references public.auction_bids(id)$sql_90_18$;

-- live-session-dashboard.sql: source statement 20
execute $sql_90_20$create or replace function public.stamp_customer_tab_proof() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.auction_id is null then
  select a.id,b.id into new.auction_id,new.winning_bid_id from public.orders o join public.auctions a on a.id::text=o.source_id and a.tenant_id=o.tenant_id
   left join public.auction_bids b on b.auction_id=a.id and b.comment_id=a.leading_comment_id where o.id=new.order_id and o.source='live_auction';
 end if;
 return new;
end $$$sql_90_20$;

-- live-session-dashboard.sql: source statement 21
execute $sql_90_21$drop trigger if exists customer_tab_proof on public.customer_tab_items$sql_90_21$;

-- live-session-dashboard.sql: source statement 22
execute $sql_90_22$create trigger customer_tab_proof before insert on public.customer_tab_items for each row execute function public.stamp_customer_tab_proof()$sql_90_22$;

-- live-session-dashboard.sql: source statement 23
execute $sql_90_23$create or replace function public.attach_customer_tab_order() returns trigger
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
end $$$sql_90_23$;

-- live-session-dashboard.sql: source statement 24
execute $sql_90_24$create or replace function public.live_comment_time(p_value jsonb,p_fallback timestamptz)
returns timestamptz language sql immutable set search_path=pg_catalog,public as $$
 select case when p_value->>'created_time' ~ '^[0-9]{10}$'
 then to_timestamp((p_value->>'created_time')::double precision) else p_fallback end
$$$sql_90_24$;

-- live-session-dashboard.sql: source statement 25
begin
execute $sql_90_25$create or replace function public.live_session_dashboard(p_tenant uuid,p_session uuid)
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
end $$$sql_90_25$;
exception when invalid_function_definition then
  -- A newer signature of live_session_dashboard(uuid,uuid) is already installed. Its final definition below is mandatory.
  null;
end;

-- live-session-dashboard.sql: source statement 26
execute $sql_90_26$create or replace function public.live_session_tab_proof(p_tenant uuid,p_session uuid,p_tab uuid)
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
end $$$sql_90_26$;

-- live-session-dashboard.sql: source statement 27
execute $sql_90_27$create or replace function public.manage_live_session(p_tenant uuid,p_session uuid,p_actor uuid,p_request uuid,p_input jsonb)
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
end $$$sql_90_27$;

-- live-session-dashboard.sql: source statement 28
execute $sql_90_28$create or replace function public.queue_live_session_reminders(p_tenant uuid,p_session uuid,p_actor uuid,p_request uuid,p_tabs uuid[],p_template text)
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
end $$$sql_90_28$;

-- live-session-dashboard.sql: source statement 29
execute $sql_90_29$create or replace function public.claim_customer_tab_reminder() returns setof public.customer_tab_reminders
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
end $$$sql_90_29$;

-- live-session-dashboard.sql: source statement 30
execute $sql_90_30$create or replace function public.finish_live_reminder_slot() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if old.status='processing' and new.status<>'processing' and old.send_after is not null then
  update public.live_reminder_dispatch_slots set next_allowed_at=greatest(next_allowed_at,clock_timestamp()+interval '5 seconds')
   where page_id=(select page_id from public.customer_tabs where id=new.tab_id);
 end if;
 return new;
end $$$sql_90_30$;

-- live-session-dashboard.sql: source statement 31
execute $sql_90_31$drop trigger if exists live_reminder_slot_finished on public.customer_tab_reminders$sql_90_31$;

-- live-session-dashboard.sql: source statement 32
execute $sql_90_32$create trigger live_reminder_slot_finished after update on public.customer_tab_reminders for each row execute function public.finish_live_reminder_slot()$sql_90_32$;

-- live-session-dashboard.sql: source statement 33
execute $sql_90_33$revoke all on function public.finish_live_reminder_slot(),public.ensure_auction_live_session(),public.stamp_customer_tab_proof(),public.live_comment_time(jsonb,timestamptz),public.live_session_dashboard(uuid,uuid),public.live_session_tab_proof(uuid,uuid,uuid),public.manage_live_session(uuid,uuid,uuid,uuid,jsonb),public.queue_live_session_reminders(uuid,uuid,uuid,uuid,uuid[],text),public.claim_customer_tab_reminder() from public,anon,authenticated$sql_90_33$;

-- live-session-dashboard.sql: source statement 34
execute $sql_90_34$grant execute on function public.live_comment_time(jsonb,timestamptz),public.live_session_dashboard(uuid,uuid),public.live_session_tab_proof(uuid,uuid,uuid),public.manage_live_session(uuid,uuid,uuid,uuid,jsonb),public.queue_live_session_reminders(uuid,uuid,uuid,uuid,uuid[],text),public.claim_customer_tab_reminder() to service_role$sql_90_34$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('live-session-dashboard.sql','e9b938da63a13e71263210ae1dfac87007f1da4d35a20a68f4046a01f4d9231c','791015cacf4a17c065f2e08dd10287f3c2366b24259aea43f17e5e8988499ee5');
end $migration_90$;

-- 92. shipping-fulfillment.sql
do $migration_91$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='shipping-fulfillment.sql';
  if found then
    if installed <> 'febe4140ce6fc95f7aef8b5475db0a9d9ff072b0fa6358ffab58a54c930a6d02' then
      raise exception 'Applied migration changed: shipping-fulfillment.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- shipping-fulfillment.sql: source statement 2
execute $sql_91_2$create table if not exists public.shipping_settings (
 tenant_id uuid primary key references public.tenants(id),sender_name text not null default '',sender_phone text not null default '',
 sender_address text not null default '',default_courier text not null default 'Bee Move',revision bigint not null default 0
)$sql_91_2$;

-- shipping-fulfillment.sql: source statement 3
execute $sql_91_3$create table if not exists public.shipping_profiles (
 tenant_id uuid not null references public.tenants(id),customer_id uuid not null references public.customers(id),
 address jsonb not null,confirmed_at timestamptz,pending_candidate_id uuid,primary key(tenant_id,customer_id)
)$sql_91_3$;

-- shipping-fulfillment.sql: source statement 4
execute $sql_91_4$create table if not exists public.shipping_shipments (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),customer_id uuid not null references public.customers(id),
 customer_tab_id uuid references public.customer_tabs(id),live_session_id uuid references public.live_sessions(id),
 recipient_name text not null default '',phone_number text not null default '',shipping_address text not null default '',
 subdistrict text not null default '',district text not null default '',province text not null default '',zipcode text not null default '',
 tracking_number text,courier_name text not null default 'Bee Move',note text not null default '',
 fulfillment_status text not null default 'pending_address' check(fulfillment_status in ('pending_address','ready_to_ship','shipped','cancelled')),
 address_confirmed_at timestamptz,label_printed_at timestamptz,label_print_count integer not null default 0,
 address_candidate_id uuid,revision bigint not null default 0,paid_amount numeric(14,2) not null default 0,
 created_at timestamptz not null default clock_timestamp(),shipped_at timestamptz
)$sql_91_4$;

-- shipping-fulfillment.sql: source statement 5
execute $sql_91_5$create unique index if not exists shipping_one_open_tab on public.shipping_shipments(customer_tab_id) where customer_tab_id is not null and fulfillment_status not in ('shipped','cancelled')$sql_91_5$;

-- shipping-fulfillment.sql: source statement 6
execute $sql_91_6$create index if not exists shipping_tenant_queue on public.shipping_shipments(tenant_id,fulfillment_status,created_at desc)$sql_91_6$;

-- shipping-fulfillment.sql: source statement 7
execute $sql_91_7$create index if not exists shipping_customer_queue on public.shipping_shipments(tenant_id,customer_id,created_at desc)$sql_91_7$;

-- shipping-fulfillment.sql: source statement 8
execute $sql_91_8$create table if not exists public.shipping_shipment_items (
 order_id uuid primary key references public.orders(id),shipment_id uuid not null references public.shipping_shipments(id),
 item_name text not null,amount numeric(12,2) not null,cancelled boolean not null default false
)$sql_91_8$;

-- shipping-fulfillment.sql: source statement 9
execute $sql_91_9$create index if not exists shipping_items_parcel on public.shipping_shipment_items(shipment_id)$sql_91_9$;

-- shipping-fulfillment.sql: source statement 10
execute $sql_91_10$create table if not exists public.shipping_address_candidates (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),customer_id uuid not null references public.customers(id),
 source_message_id uuid not null unique references public.messages(id),address jsonb not null,
 status text not null default 'pending' check(status in ('pending','confirmed','superseded')),
 notified_at timestamptz,created_at timestamptz not null default clock_timestamp(),confirmed_message_id uuid references public.messages(id)
)$sql_91_10$;

-- shipping-fulfillment.sql: source statement 11
execute $sql_91_11$create unique index if not exists shipping_one_pending_address on public.shipping_address_candidates(tenant_id,customer_id) where status='pending'$sql_91_11$;

-- shipping-fulfillment.sql: source statement 12
execute $sql_91_12$create table if not exists public.shipping_print_batches (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),actor_id uuid not null references auth.users(id),
 format text not null check(format in ('thermal','a4','csv')),sender jsonb not null,sender_revision bigint not null,shipments jsonb not null,
 created_at timestamptz not null default clock_timestamp(),opened_at timestamptz
)$sql_91_12$;

-- shipping-fulfillment.sql: source statement 13
execute $sql_91_13$create table if not exists public.shipping_action_receipts (
 tenant_id uuid not null references public.tenants(id),request_id uuid not null,actor_id uuid not null references auth.users(id),
 payload jsonb not null,result jsonb not null,created_at timestamptz not null default clock_timestamp(),primary key(tenant_id,request_id)
)$sql_91_13$;

-- shipping-fulfillment.sql: source statement 14
execute $sql_91_14$do $$declare tab text;begin
 foreach tab in array array['customer_tabs','orders'] loop
  execute format('alter table public.%I add column if not exists shipping_shipment_id uuid references public.shipping_shipments(id),
   add column if not exists recipient_name text,add column if not exists phone_number text,add column if not exists shipping_address text,
   add column if not exists tracking_number text,add column if not exists courier_name text,
   add column if not exists fulfillment_status text default ''pending_address'' check(fulfillment_status in (''pending_address'',''ready_to_ship'',''shipped'',''cancelled'')),
   add column if not exists label_printed_at timestamptz',tab);
 end loop;
 foreach tab in array array['shipping_settings','shipping_profiles','shipping_shipments','shipping_shipment_items','shipping_address_candidates','shipping_print_batches','shipping_action_receipts'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated',tab);
  execute format('grant all on public.%I to service_role',tab);
 end loop;
end $$$sql_91_14$;

-- shipping-fulfillment.sql: source statement 15
execute $sql_91_15$create or replace function public.shipping_address_valid(v jsonb) returns boolean language sql immutable set search_path=pg_catalog,public as $$
 select jsonb_typeof(v)='object' and coalesce(length(trim(v->>'recipient_name')) between 2 and 200,false)
 and coalesce(v->>'phone_number' ~ '^0[1-9][0-9]{7,8}$',false)
 and coalesce(length(trim(v->>'shipping_address')) between 10 and 1200,false)
 and coalesce(length(trim(v->>'subdistrict')) between 1 and 100,false)
 and coalesce(length(trim(v->>'district')) between 1 and 100,false)
 and coalesce(length(trim(v->>'province')) between 1 and 100,false)
 and coalesce(v->>'zipcode' ~ '^[1-9][0-9]{4}$',false)
$$$sql_91_15$;

-- shipping-fulfillment.sql: source statement 16
execute $sql_91_16$create or replace function public.shipping_payment_ready(p_shipment uuid) returns boolean language sql stable set search_path=pg_catalog,public as $$
 select coalesce((select s.fulfillment_status='shipped' or (
  exists(select 1 from public.shipping_shipment_items i join public.orders o on o.id=i.order_id where i.shipment_id=s.id and not i.cancelled and o.status='paid')
  and not exists(select 1 from public.shipping_shipment_items i join public.orders o on o.id=i.order_id where i.shipment_id=s.id and not i.cancelled and (o.status<>'paid' or o.paid_amount<o.amount and o.customer_tab_id is not null))
  and (s.customer_tab_id is null or exists(select 1 from public.customer_tabs t where t.id=s.customer_tab_id and t.total_amount>0 and t.remaining_amount=0)))
 from public.shipping_shipments s where s.id=p_shipment),false)
$$$sql_91_16$;

-- shipping-fulfillment.sql: source statement 17
execute $sql_91_17$create or replace function public.shipping_mirror_fields() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 update public.orders set shipping_shipment_id=new.id,recipient_name=new.recipient_name,phone_number=new.phone_number,shipping_address=new.shipping_address,
  tracking_number=new.tracking_number,courier_name=new.courier_name,fulfillment_status=new.fulfillment_status,label_printed_at=new.label_printed_at
  where id in(select order_id from public.shipping_shipment_items where shipment_id=new.id);
 update public.customer_tabs set recipient_name=new.recipient_name,phone_number=new.phone_number,shipping_address=new.shipping_address,
  tracking_number=new.tracking_number,courier_name=new.courier_name,fulfillment_status=new.fulfillment_status,label_printed_at=new.label_printed_at
  where id=new.customer_tab_id and shipping_shipment_id=new.id;
 return new;
end $$$sql_91_17$;

-- shipping-fulfillment.sql: source statement 18
execute $sql_91_18$drop trigger if exists shipping_mirror on public.shipping_shipments$sql_91_18$;

-- shipping-fulfillment.sql: source statement 19
execute $sql_91_19$create trigger shipping_mirror after update on public.shipping_shipments for each row execute function public.shipping_mirror_fields()$sql_91_19$;

-- shipping-fulfillment.sql: source statement 20
execute $sql_91_20$create or replace function public.reconcile_shipping(p_tab uuid,p_order uuid default null) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare t public.customer_tabs;o public.orders;s public.shipping_shipments;p public.shipping_profiles;tid uuid;cid uuid;ready boolean;cash numeric;ses uuid;changed integer:=0;added integer:=0;desired text;
begin
 if p_tab is not null then
  select * into t from public.customer_tabs where id=p_tab for update;
  if not found then return;end if;tid:=t.tenant_id;cid:=t.customer_id;ses:=t.live_session_id;cash:=t.paid_amount;ready:=t.total_amount>0 and t.remaining_amount=0;
  select * into s from public.shipping_shipments where customer_tab_id=t.id and fulfillment_status not in ('shipped','cancelled') for update;
 else
  select * into o from public.orders where id=p_order and customer_tab_id is null for update;
  if not found then return;end if;tid:=o.tenant_id;cid:=o.customer_id;cash:=case when o.status in ('paid','shipped') then o.amount else 0 end;ready:=o.status='paid';
  select parcel.* into s from public.shipping_shipments parcel join public.shipping_shipment_items i on i.shipment_id=parcel.id where i.order_id=o.id for update of parcel;
  if s.fulfillment_status in ('shipped','cancelled') then return;end if;
 end if;
 if s.id is null and ready and exists(select 1 from public.orders pending where pending.tenant_id=tid and pending.customer_id=cid and pending.status='paid'
  and (p_tab is not null and pending.customer_tab_id=p_tab or p_tab is null and pending.id=p_order)
  and not exists(select 1 from public.shipping_shipment_items assigned where assigned.order_id=pending.id)) then
  select * into p from public.shipping_profiles where tenant_id=tid and customer_id=cid;
  insert into public.shipping_shipments(tenant_id,customer_id,customer_tab_id,live_session_id,recipient_name,phone_number,shipping_address,subdistrict,district,province,zipcode,address_confirmed_at,address_candidate_id,courier_name)
   values(tid,cid,p_tab,ses,coalesce(p.address->>'recipient_name',''),coalesce(p.address->>'phone_number',''),coalesce(p.address->>'shipping_address',''),
    coalesce(p.address->>'subdistrict',''),coalesce(p.address->>'district',''),coalesce(p.address->>'province',''),coalesce(p.address->>'zipcode',''),p.confirmed_at,p.pending_candidate_id,
    coalesce((select default_courier from public.shipping_settings where tenant_id=tid),'Bee Move')) returning * into s;
  if p_tab is not null then update public.customer_tabs set shipping_shipment_id=s.id where id=p_tab;end if;
 end if;
 if s.id is null or s.fulfillment_status in ('shipped','cancelled') then return;end if;
 if ready then
  insert into public.shipping_shipment_items(order_id,shipment_id,item_name,amount)
   select pending.id,s.id,pending.product_name,coalesce(pending.item_amount,pending.amount) from public.orders pending
    where pending.tenant_id=tid and pending.customer_id=cid and pending.status='paid'
     and (p_tab is not null and pending.customer_tab_id=p_tab or p_tab is null and pending.id=p_order)
   on conflict(order_id) do nothing;
  get diagnostics added=row_count;
 end if;
 update public.shipping_shipment_items i set item_name=existing.product_name,amount=coalesce(existing.item_amount,existing.amount),cancelled=existing.status='cancelled'
  from public.orders existing where existing.id=i.order_id and i.shipment_id=s.id
   and (i.item_name,i.amount,i.cancelled) is distinct from (existing.product_name,coalesce(existing.item_amount,existing.amount),existing.status='cancelled');
 get diagnostics changed=row_count;
 desired:=case when not exists(select 1 from public.shipping_shipment_items where shipment_id=s.id and not cancelled) then 'cancelled'
   when ready and s.address_confirmed_at is not null and public.shipping_address_valid(to_jsonb(s)) then 'ready_to_ship' else 'pending_address' end;
 if changed>0 or added>0 or s.paid_amount<>cash or s.fulfillment_status<>desired then
  update public.shipping_shipments set paid_amount=cash,label_printed_at=null,revision=revision+1,fulfillment_status=desired where id=s.id;
 end if;
end $$$sql_91_20$;

-- shipping-fulfillment.sql: source statement 21
execute $sql_91_21$create or replace function public.shipping_order_changed() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op='UPDATE' then
  if new.status=old.status and new.amount=old.amount and new.paid_amount=old.paid_amount and new.product_name=old.product_name then return new;end if;
 end if;
 perform public.reconcile_shipping(new.customer_tab_id,case when new.customer_tab_id is null then new.id else null end);
 return new;
end $$$sql_91_21$;

-- shipping-fulfillment.sql: source statement 22
execute $sql_91_22$drop trigger if exists shipping_order_sync on public.orders$sql_91_22$;

-- shipping-fulfillment.sql: source statement 23
execute $sql_91_23$create trigger shipping_order_sync after insert or update of status,amount,paid_amount,product_name on public.orders for each row execute function public.shipping_order_changed()$sql_91_23$;

-- shipping-fulfillment.sql: source statement 24
execute $sql_91_24$create or replace function public.shipping_balance_changed() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.total_amount is distinct from old.total_amount or new.paid_amount is distinct from old.paid_amount then perform public.reconcile_shipping(new.id);end if;
 return new;
end $$$sql_91_24$;

-- shipping-fulfillment.sql: source statement 25
execute $sql_91_25$drop trigger if exists shipping_tab_sync on public.customer_tabs$sql_91_25$;

-- shipping-fulfillment.sql: source statement 26
execute $sql_91_26$create trigger shipping_tab_sync after update of total_amount,paid_amount on public.customer_tabs for each row execute function public.shipping_balance_changed()$sql_91_26$;

-- shipping-fulfillment.sql: source statement 27
execute $sql_91_27$create or replace function public.shipping_guard_dispatched() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if exists(select 1 from public.shipping_shipments where id=old.shipping_shipment_id and fulfillment_status='shipped') and
  (new.customer_id<>old.customer_id or new.customer_tab_id is distinct from old.customer_tab_id or new.amount<>old.amount or new.item_amount is distinct from old.item_amount
   or new.product_name<>old.product_name or new.status not in ('paid','shipped') or old.status='shipped' and new.status<>'shipped') then raise exception 'SHIPPING_ALREADY_DISPATCHED' using errcode='40001';end if;
 return new;
end $$$sql_91_27$;

-- shipping-fulfillment.sql: source statement 28
execute $sql_91_28$drop trigger if exists shipping_dispatched_order_guard on public.orders$sql_91_28$;

-- shipping-fulfillment.sql: source statement 29
execute $sql_91_29$create trigger shipping_dispatched_order_guard before update on public.orders for each row execute function public.shipping_guard_dispatched()$sql_91_29$;

-- shipping-fulfillment.sql: source statement 30
execute $sql_91_30$create or replace function public.shipping_snapshot(p_tenant uuid,p_ids uuid[] default null,p_session uuid default null) returns jsonb
language sql stable set search_path=pg_catalog,public as $$
 select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('customer_name',coalesce(nullif(c.display_name,''),c.platform_user_id),
  'payment_ready',public.shipping_payment_ready(s.id),'items',coalesce((select jsonb_agg(jsonb_build_object('order_id',i.order_id,'item_name',i.item_name,'amount',i.amount) order by i.order_id) from public.shipping_shipment_items i where i.shipment_id=s.id and not i.cancelled),'[]')) order by s.created_at desc,s.id),'[]')
 from public.shipping_shipments s join public.customers c on c.id=s.customer_id and c.tenant_id=p_tenant
 where s.tenant_id=p_tenant and (p_ids is null or s.id=any(p_ids)) and (p_session is null or s.live_session_id=p_session)
$$$sql_91_30$;

-- shipping-fulfillment.sql: source statement 31
execute $sql_91_31$create or replace function public.manage_shipping(p_tenant uuid,p_actor uuid,p_request uuid,p_input jsonb) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare old public.shipping_action_receipts;cfg public.shipping_settings;s public.shipping_shipments;b public.shipping_print_batches;
 ids uuid[];op text:=p_input->>'action';v jsonb;addr jsonb;result jsonb;batch uuid;replay boolean:=false;
begin
 if p_request is null or p_actor is null then raise exception 'SHIPPING_INPUT_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('shipping-action:'||p_tenant::text,0));
 select * into old from public.shipping_action_receipts where tenant_id=p_tenant and request_id=p_request;
 if found then
  if old.actor_id<>p_actor or old.payload<>p_input then raise exception 'SHIPPING_REQUEST_REUSED' using errcode='40001';end if;
  -- A lost HTTP response is safe to retry, but must never authorize printing/exporting
  -- an address that changed after the first request committed.
  if op in ('mark_print','prepare_print','export') then replay:=true;else return old.result;end if;
 end if;
 -- Financial CF and manual corrections take this lock before their tab/order writes.
 perform 1 from public.tenants where id=p_tenant for update;
 if not found then raise exception 'SHIPPING_TENANT_NOT_FOUND' using errcode='P0002';end if;
 if op='settings' then
  addr:=p_input->'settings';
  if length(trim(coalesce(addr->>'sender_name',''))) not between 2 and 200 or coalesce(addr->>'sender_phone','') !~ '^0[1-9][0-9]{7,8}$'
   or length(trim(coalesce(addr->>'sender_address',''))) not between 10 and 1200 or length(coalesce(addr->>'default_courier','')) not between 1 and 80 then raise exception 'SHIPPING_SETTINGS_INVALID';end if;
  insert into public.shipping_settings(tenant_id,sender_name,sender_phone,sender_address,default_courier)
   values(p_tenant,addr->>'sender_name',addr->>'sender_phone',addr->>'sender_address',addr->>'default_courier')
   on conflict(tenant_id) do update set sender_name=excluded.sender_name,sender_phone=excluded.sender_phone,sender_address=excluded.sender_address,default_courier=excluded.default_courier,revision=shipping_settings.revision+1;
 elsif op='mark_print' then
  select * into b from public.shipping_print_batches where id=(p_input->>'batchId')::uuid and tenant_id=p_tenant for update;
  if not found or b.format='csv' then raise exception 'SHIPPING_BATCH_NOT_FOUND' using errcode='P0002';end if;
  if (select revision from public.shipping_settings where tenant_id=p_tenant) is distinct from b.sender_revision then raise exception 'SHIPPING_PRINT_STALE' using errcode='40001';end if;
  select array_agg((value->>'id')::uuid) into ids from jsonb_array_elements(b.shipments);
 else
  if jsonb_typeof(p_input->'ids') is distinct from 'array' then raise exception 'SHIPPING_INPUT_INVALID';end if;
  select array_agg(value::uuid) into ids from jsonb_array_elements_text(p_input->'ids');
 end if;
 if op<>'settings' then
  if coalesce(cardinality(ids),0) not between 1 and 100 or (select count(distinct id) from unnest(ids) id)<>cardinality(ids) then raise exception 'SHIPPING_SELECTION_INVALID';end if;
  if (select count(*) from public.shipping_shipments where tenant_id=p_tenant and id=any(ids))<>cardinality(ids) then raise exception 'SHIPPING_SCOPE' using errcode='42501';end if;
  -- Match the ledger's tab -> order allocation lock order; addresses and prints cannot race payment changes.
  perform 1 from public.customer_tabs where id in(select customer_tab_id from public.shipping_shipments where id=any(ids)) order by id for update;
  perform 1 from public.orders where id in(select i.order_id from public.shipping_shipment_items i join public.shipping_shipments x on x.id=i.shipment_id where x.id=any(ids) and x.customer_tab_id is null) order by id for update;
  perform 1 from public.shipping_shipments where id=any(ids) order by id for update;
  if replay and op in ('prepare_print','export') then
   select * into b from public.shipping_print_batches where id=(old.result->>'batchId')::uuid and tenant_id=p_tenant;
   if op='prepare_print' and (select revision from public.shipping_settings where tenant_id=p_tenant) is distinct from b.sender_revision then raise exception 'SHIPPING_PRINT_STALE' using errcode='40001';end if;
   for v in select value from jsonb_array_elements(b.shipments) loop
    select * into s from public.shipping_shipments where id=(v->>'id')::uuid;
    if s.revision is distinct from (v->>'revision')::bigint or s.fulfillment_status not in ('ready_to_ship','shipped') or not public.shipping_payment_ready(s.id) then raise exception 'SHIPPING_PRINT_STALE' using errcode='40001';end if;
   end loop;
   return old.result;
  end if;
  if op='edit' then
   if cardinality(ids)<>1 then raise exception 'SHIPPING_SELECTION_INVALID';end if;
   select * into s from public.shipping_shipments where id=ids[1];addr:=p_input->'address';
   if s.revision is distinct from (p_input->>'revision')::bigint then raise exception 'SHIPPING_CHANGED' using errcode='40001';end if;
   if s.fulfillment_status in ('shipped','cancelled') then raise exception 'SHIPPING_NOT_EDITABLE';end if;
   if not public.shipping_address_valid(addr) then raise exception 'SHIPPING_ADDRESS_INVALID';end if;
   if length(trim(coalesce(p_input->>'courier',''))) not between 1 and 80 or length(coalesce(p_input->>'tracking',''))>100 or length(coalesce(p_input->>'note',''))>500 then raise exception 'SHIPPING_INPUT_INVALID';end if;
   update public.shipping_shipments set recipient_name=addr->>'recipient_name',phone_number=addr->>'phone_number',shipping_address=addr->>'shipping_address',
    subdistrict=addr->>'subdistrict',district=addr->>'district',province=addr->>'province',zipcode=addr->>'zipcode',
    tracking_number=nullif(trim(p_input->>'tracking'),''),courier_name=p_input->>'courier',note=coalesce(p_input->>'note',''),
    address_candidate_id=case when p_input->>'confirmed'='true' or not(to_jsonb(s) @> addr) then null else address_candidate_id end,
    address_confirmed_at=case when p_input->>'confirmed'='true' then clock_timestamp() else null end,
    fulfillment_status=case when p_input->>'confirmed'='true' and public.shipping_payment_ready(s.id) then 'ready_to_ship' else 'pending_address' end,
    revision=revision+1,label_printed_at=null where id=s.id;
   if p_input->>'confirmed'='true' and (s.address_confirmed_at is null or not(to_jsonb(s) @> addr))
    and not exists(select 1 from public.shipping_profiles where tenant_id=p_tenant and customer_id=s.customer_id and pending_candidate_id is not null and address=addr) then
    insert into public.shipping_profiles(tenant_id,customer_id,address,confirmed_at) values(p_tenant,s.customer_id,addr,clock_timestamp())
     on conflict(tenant_id,customer_id) do update set address=excluded.address,confirmed_at=excluded.confirmed_at,pending_candidate_id=null;
    update public.shipping_address_candidates set status='superseded' where tenant_id=p_tenant and customer_id=s.customer_id and status='pending';
   end if;
  elsif op in ('cancel','restore','dispatch') then
   for s in select * from public.shipping_shipments where id=any(ids) order by id loop
    if s.fulfillment_status='shipped' then raise exception 'SHIPPING_ALREADY_DISPATCHED' using errcode='40001';end if;
    if op='dispatch' and (s.fulfillment_status<>'ready_to_ship' or not public.shipping_payment_ready(s.id) or s.address_confirmed_at is null or not public.shipping_address_valid(to_jsonb(s))
      or coalesce(s.tracking_number,'') !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{3,99}$') then raise exception 'SHIPPING_NOT_READY';end if;
    if op='restore' and exists(select 1 from public.shipping_shipments other where other.customer_tab_id=s.customer_tab_id and other.id<>s.id and other.fulfillment_status not in ('shipped','cancelled')) then raise exception 'SHIPPING_OTHER_PARCEL_OPEN';end if;
   end loop;
   update public.shipping_shipments set fulfillment_status=case when op='cancel' then 'cancelled' when op='dispatch' then 'shipped'
    when address_confirmed_at is not null and public.shipping_address_valid(to_jsonb(shipping_shipments)) and public.shipping_payment_ready(id) then 'ready_to_ship' else 'pending_address' end,
    shipped_at=case when op='dispatch' then clock_timestamp() else null end,revision=revision+1,label_printed_at=case when op='dispatch' then label_printed_at else null end where id=any(ids);
   if op='dispatch' then update public.orders set status='shipped' where id in(select order_id from public.shipping_shipment_items where shipment_id=any(ids) and not cancelled) and status='paid';end if;
  elsif op in ('prepare_print','export') then
   for s in select * from public.shipping_shipments where id=any(ids) loop
    if s.fulfillment_status not in ('ready_to_ship','shipped') or not public.shipping_payment_ready(s.id) or s.address_confirmed_at is null or not public.shipping_address_valid(to_jsonb(s)) then raise exception 'SHIPPING_NOT_READY';end if;
   end loop;
   select * into cfg from public.shipping_settings where tenant_id=p_tenant;
   if op='prepare_print' and (cfg.tenant_id is null or cfg.sender_name='' or cfg.sender_phone='' or cfg.sender_address='') then raise exception 'SHIPPING_SENDER_REQUIRED';end if;
   if op='prepare_print' and coalesce(p_input->>'format','') not in ('thermal','a4') then raise exception 'SHIPPING_INPUT_INVALID';end if;
   insert into public.shipping_print_batches(tenant_id,actor_id,format,sender,sender_revision,shipments)
    values(p_tenant,p_actor,case when op='export' then 'csv' else p_input->>'format' end,coalesce(to_jsonb(cfg),'{}'),coalesce(cfg.revision,0),public.shipping_snapshot(p_tenant,ids)) returning id into batch;
  elsif op='mark_print' then
   for v in select value from jsonb_array_elements(b.shipments) loop
    select * into s from public.shipping_shipments where id=(v->>'id')::uuid;
    if s.revision is distinct from (v->>'revision')::bigint or s.fulfillment_status not in ('ready_to_ship','shipped') or not public.shipping_payment_ready(s.id) then raise exception 'SHIPPING_PRINT_STALE' using errcode='40001';end if;
   end loop;
   if not replay then
    update public.shipping_shipments set label_printed_at=clock_timestamp(),label_print_count=label_print_count+1 where id=any(ids);
    update public.shipping_print_batches set opened_at=clock_timestamp() where id=b.id;
   end if;
  else raise exception 'SHIPPING_ACTION_INVALID';end if;
 end if;
 result:=jsonb_build_object('ok',true,'batchId',batch);
 if replay then return old.result;end if;
 insert into public.shipping_action_receipts(tenant_id,request_id,actor_id,payload,result) values(p_tenant,p_request,p_actor,p_input,result);
 return result;
end $$$sql_91_31$;

-- shipping-fulfillment.sql: source statement 32
execute $sql_91_32$create or replace function public.capture_shipping_address(p_tenant uuid,p_customer uuid,p_message uuid,p_address jsonb)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare p public.shipping_profiles;c public.shipping_address_candidates;s public.shipping_shipments;found_ready boolean:=false;
begin
 if not public.shipping_address_valid(p_address) or not exists(select 1 from public.messages m join public.customers x on x.id=m.customer_id where m.id=p_message and m.customer_id=p_customer and x.tenant_id=p_tenant and m.sender='customer') then raise exception 'SHIPPING_ADDRESS_SCOPE' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('shipping-address:'||p_customer::text,0));
 select * into c from public.shipping_address_candidates where source_message_id=p_message;
 if found then return jsonb_build_object('candidateId',c.id,'address',c.address,'handled',true);end if;
 -- Capture only for paid, undelivered parcels. Never update an already-dispatched label.
 perform 1 from public.customer_tabs where tenant_id=p_tenant and customer_id=p_customer order by id for update;
 perform 1 from public.orders where tenant_id=p_tenant and customer_id=p_customer and customer_tab_id is null and shipping_shipment_id is not null order by id for update;
 for s in select * from public.shipping_shipments where tenant_id=p_tenant and customer_id=p_customer and fulfillment_status not in ('shipped','cancelled') order by id for update loop
  if public.shipping_payment_ready(s.id) then found_ready:=true;end if;
 end loop;
 if not found_ready then return jsonb_build_object('handled',false);end if;
 select * into p from public.shipping_profiles where tenant_id=p_tenant and customer_id=p_customer;
 if p.address=p_address then
  return jsonb_build_object('handled',true,'candidateId',p.pending_candidate_id,'address',p.address,'confirmed',p.confirmed_at is not null);
 end if;
 update public.shipping_address_candidates set status='superseded' where tenant_id=p_tenant and customer_id=p_customer and status='pending';
 insert into public.shipping_address_candidates(tenant_id,customer_id,source_message_id,address) values(p_tenant,p_customer,p_message,p_address) returning * into c;
 insert into public.shipping_profiles(tenant_id,customer_id,address,pending_candidate_id) values(p_tenant,p_customer,p_address,c.id)
  on conflict(tenant_id,customer_id) do update set address=excluded.address,pending_candidate_id=excluded.pending_candidate_id,confirmed_at=null;
 update public.shipping_shipments set recipient_name=p_address->>'recipient_name',phone_number=p_address->>'phone_number',shipping_address=p_address->>'shipping_address',
  subdistrict=p_address->>'subdistrict',district=p_address->>'district',province=p_address->>'province',zipcode=p_address->>'zipcode',
  address_confirmed_at=null,address_candidate_id=c.id,fulfillment_status='pending_address',label_printed_at=null,revision=revision+1
  where tenant_id=p_tenant and customer_id=p_customer and fulfillment_status not in ('shipped','cancelled');
 return jsonb_build_object('handled',true,'candidateId',c.id,'address',p_address);
end $$$sql_91_32$;

-- shipping-fulfillment.sql: source statement 33
execute $sql_91_33$create or replace function public.confirm_shipping_address(p_tenant uuid,p_customer uuid,p_message uuid,p_candidate uuid default null)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare p public.shipping_profiles;c public.shipping_address_candidates;msg public.messages;
begin
 select m.* into msg from public.messages m join public.customers x on x.id=m.customer_id where m.id=p_message and m.customer_id=p_customer and m.sender='customer' and x.tenant_id=p_tenant;
 if not found then raise exception 'SHIPPING_ADDRESS_SCOPE' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('shipping-address:'||p_customer::text,0));
 perform 1 from public.customer_tabs where tenant_id=p_tenant and customer_id=p_customer order by id for update;
 perform 1 from public.orders where tenant_id=p_tenant and customer_id=p_customer and customer_tab_id is null and shipping_shipment_id is not null order by id for update;
 select * into p from public.shipping_profiles where tenant_id=p_tenant and customer_id=p_customer;
 select * into c from public.shipping_address_candidates where id=coalesce(p_candidate,p.pending_candidate_id) and tenant_id=p_tenant and customer_id=p_customer;
 if c.status='confirmed' and c.confirmed_message_id=p_message then return jsonb_build_object('handled',true,'confirmed',true);end if;
 if c.id is null or c.id is distinct from p.pending_candidate_id or c.status<>'pending' or (p_candidate is null and (c.notified_at is null or msg.created_at<c.notified_at-interval '2 seconds')) then return jsonb_build_object('handled',false);end if;
 update public.shipping_address_candidates set status='confirmed',confirmed_message_id=p_message where id=c.id;
 update public.shipping_profiles set confirmed_at=clock_timestamp(),pending_candidate_id=null where tenant_id=p_tenant and customer_id=p_customer;
 update public.shipping_shipments set address_confirmed_at=clock_timestamp(),address_candidate_id=null,
  fulfillment_status=case when public.shipping_payment_ready(id) then 'ready_to_ship' else 'pending_address' end,revision=revision+1,label_printed_at=null
  where tenant_id=p_tenant and customer_id=p_customer and address_candidate_id=c.id and fulfillment_status not in ('shipped','cancelled');
 return jsonb_build_object('handled',true,'confirmed',true);
end $$$sql_91_33$;

-- shipping-fulfillment.sql: source statement 34
execute $sql_91_34$do $$declare r record;begin
 for r in select id from public.customer_tabs where total_amount>0 and remaining_amount=0 order by id loop perform public.reconcile_shipping(r.id);end loop;
 for r in select id from public.orders where customer_tab_id is null and status='paid' order by id loop perform public.reconcile_shipping(null,r.id);end loop;
end $$$sql_91_34$;

-- shipping-fulfillment.sql: source statement 35
execute $sql_91_35$revoke all on function public.shipping_address_valid(jsonb),public.shipping_payment_ready(uuid),public.shipping_mirror_fields(),public.reconcile_shipping(uuid,uuid),public.shipping_order_changed(),public.shipping_balance_changed(),public.shipping_guard_dispatched(),public.shipping_snapshot(uuid,uuid[],uuid),public.manage_shipping(uuid,uuid,uuid,jsonb),public.capture_shipping_address(uuid,uuid,uuid,jsonb),public.confirm_shipping_address(uuid,uuid,uuid,uuid) from public,anon,authenticated$sql_91_35$;

-- shipping-fulfillment.sql: source statement 36
execute $sql_91_36$grant execute on function public.shipping_address_valid(jsonb),public.shipping_payment_ready(uuid),public.reconcile_shipping(uuid,uuid),public.shipping_snapshot(uuid,uuid[],uuid),public.manage_shipping(uuid,uuid,uuid,jsonb),public.capture_shipping_address(uuid,uuid,uuid,jsonb),public.confirm_shipping_address(uuid,uuid,uuid,uuid) to service_role$sql_91_36$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('shipping-fulfillment.sql','febe4140ce6fc95f7aef8b5475db0a9d9ff072b0fa6358ffab58a54c930a6d02','abc1f380707a3baf1bb18df305b7e06f1be6dbaf3e7eb148a8e20ecfcac486fe');
end $migration_91$;

-- 93. live-order-types.sql
do $migration_92$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='live-order-types.sql';
  if found then
    if installed <> 'a5c7d2e07f62879141a4be3437291b490cda34001ef69016d0215673c74c5a15' then
      raise exception 'Applied migration changed: live-order-types.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- live-order-types.sql: source statement 2
execute $sql_92_2$alter table public.orders add column if not exists order_type text generated always as (
 case when source='live_auction' then 'auction'
 when source in ('live_comment','facebook_comment') or source_code is not null then 'cf' else null end
) stored$sql_92_2$;

-- live-order-types.sql: source statement 3
execute $sql_92_3$alter table public.customer_tab_items add column if not exists order_type text check(order_type in ('auction','cf')),
 add column if not exists source_code text$sql_92_3$;

-- live-order-types.sql: source statement 4
execute $sql_92_4$create or replace function public.stamp_live_item_type() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 select o.order_type,o.source_code into new.order_type,new.source_code from public.orders o
  join public.customer_tabs t on t.id=new.tab_id and t.tenant_id=o.tenant_id and t.customer_id=o.customer_id
  where o.id=new.order_id and o.customer_tab_id=t.id;
 if not found then raise exception 'TAB_ITEM_SCOPE' using errcode='42501';end if;
 return new;
end $$$sql_92_4$;

-- live-order-types.sql: source statement 5
execute $sql_92_5$drop trigger if exists customer_tab_item_type on public.customer_tab_items$sql_92_5$;

-- live-order-types.sql: source statement 6
execute $sql_92_6$create trigger customer_tab_item_type before insert or update on public.customer_tab_items for each row execute function public.stamp_live_item_type()$sql_92_6$;

-- live-order-types.sql: source statement 8
execute $sql_92_8$revoke all on function public.stamp_live_item_type() from public,anon,authenticated$sql_92_8$;

-- live-order-types.sql: source statement 9
execute $sql_92_9$create or replace function public.live_session_dashboard(p_tenant uuid,p_session uuid)
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
end $$$sql_92_9$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('live-order-types.sql','a5c7d2e07f62879141a4be3437291b490cda34001ef69016d0215673c74c5a15','eb6171db344172c6b92c8fe04ee96f2a71afb4d15c1af599f59dab0c57a54d01');
end $migration_92$;

-- 94. live-auction-dashboard.sql
do $migration_93$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='live-auction-dashboard.sql';
  if found then
    if installed <> '796c27727868b87ae7782c18a371dd3f5f613b4b6ed8f20764612fccb90c95e1' then
      raise exception 'Applied migration changed: live-auction-dashboard.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- live-auction-dashboard.sql: source statement 2
execute $sql_93_2$alter table public.live_sessions add column if not exists auction_settings jsonb,
 add column if not exists automation_revision integer not null default 0$sql_93_2$;

-- live-auction-dashboard.sql: source statement 3
execute $sql_93_3$alter table public.auctions add column if not exists session_automation jsonb$sql_93_3$;

-- live-auction-dashboard.sql: source statement 4
execute $sql_93_4$create index if not exists live_auction_comment_events on public.facebook_webhook_events(page_id,created_at desc)
 where kind='change' and payload->'value'->>'verb'='add' and payload->'value'->>'item' in ('comment','live_comment')$sql_93_4$;

-- live-auction-dashboard.sql: source statement 5
execute $sql_93_5$create table if not exists public.auction_session_requests (
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 request_id uuid not null, actor_id uuid not null, input jsonb not null, result jsonb not null,
 created_at timestamptz not null default clock_timestamp(), primary key(tenant_id,request_id)
)$sql_93_5$;

-- live-auction-dashboard.sql: source statement 6
execute $sql_93_6$alter table public.auction_session_requests enable row level security$sql_93_6$;

-- live-auction-dashboard.sql: source statement 7
execute $sql_93_7$revoke all on public.auction_session_requests from public,anon,authenticated$sql_93_7$;

-- live-auction-dashboard.sql: source statement 8
execute $sql_93_8$grant all on public.auction_session_requests to service_role$sql_93_8$;

-- live-auction-dashboard.sql: source statement 9
begin
execute $sql_93_9$create or replace function public.configure_auction_session(p_tenant uuid,p_actor uuid,p_request uuid,p_input jsonb)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare s public.live_sessions; prior public.auction_session_requests; settings jsonb:=p_input->'settings'; result jsonb; page text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||p_request::text,0));
 select * into prior from public.auction_session_requests where tenant_id=p_tenant and request_id=p_request;
 if found then
  if prior.actor_id<>p_actor or prior.input<>p_input then raise exception 'REQUEST_REUSED' using errcode='40001';end if;
  return prior.result;
 end if;
 if p_input->>'action' not in ('start','settings') or p_actor is null or p_request is null then raise exception 'INVALID_ACTION';end if;
 if jsonb_typeof(settings)<>'object' or jsonb_typeof(settings->'keywords')<>'array'
  or jsonb_array_length(settings->'keywords') not between 1 and 30 then raise exception 'INVALID_SETTINGS';end if;
 if exists(select 1 from jsonb_array_elements(settings->'keywords') k where jsonb_typeof(k)<>'string' or length(trim(k#>>'{}')) not between 1 and 40)
  or exists(select 1 from unnest(array['publicReply','privateReply','countEnabled','closeEnabled','heartCloses']) k where jsonb_typeof(settings->k) is distinct from 'boolean')
  or exists(select 1 from unnest(array['bidText','privateText','closeText']) k where jsonb_typeof(settings->k) is distinct from 'string' or length(settings->>k) not between 1 and 2000)
  then raise exception 'INVALID_SETTINGS';end if;
 if not exists(select 1 from public.bank_accounts where id=(settings->>'bankAccountId')::uuid and tenant_id=p_tenant and is_active)
  then raise exception 'BANK_SCOPE' using errcode='42501';end if;
 select page_id into page from public.tenants where id=p_tenant and is_active;
 if page is null then raise exception 'PAGE_SCOPE' using errcode='42501';end if;
 if p_input->>'action'='start' then
  if p_input->>'pageId' is distinct from page or coalesce(p_input->>'livePostId','') !~ '^[0-9]{1,64}$' then raise exception 'PAGE_SCOPE' using errcode='42501';end if;
  insert into public.live_sessions(tenant_id,page_id,live_post_id,auction_settings)
   values(p_tenant,page,p_input->>'livePostId',settings)
   on conflict(tenant_id,page_id,live_post_id) do nothing;
  perform 1 from public.auctions where tenant_id=p_tenant and page_id=page and live_post_id=p_input->>'livePostId' and status='active' order by id for update;
  select * into s from public.live_sessions where tenant_id=p_tenant and page_id=page and live_post_id=p_input->>'livePostId' for update;
  if s.ended_at is not null then raise exception 'SESSION_ENDED' using errcode='40001';end if;
  -- Starting an existing Session must not reset its saved automation or ledger.
  if s.auction_settings is null then
   update public.live_sessions set auction_settings=settings,automation_revision=automation_revision+1 where id=s.id returning * into s;
  end if;
 else
  select * into s from public.live_sessions where id=(p_input->>'sessionId')::uuid and tenant_id=p_tenant;
  if not found then raise exception 'SESSION_NOT_FOUND' using errcode='P0002';end if;
  -- Use auction -> session lock order, matching finalization and tab attachment.
  perform 1 from public.auctions where tenant_id=p_tenant and page_id=s.page_id and live_post_id=s.live_post_id and status='active' order by id for update;
  select * into s from public.live_sessions where id=s.id for update;
  if s.ended_at is not null then raise exception 'SESSION_ENDED' using errcode='40001';end if;
  if s.automation_revision<>(p_input->>'revision')::integer then raise exception 'SETTINGS_CHANGED' using errcode='40001';end if;
  update public.live_sessions set auction_settings=settings,automation_revision=automation_revision+1 where id=s.id returning * into s;
 end if;
 update public.auctions set session_automation=s.auction_settings,
  bank_account_id=(s.auction_settings->>'bankAccountId')::uuid,
  private_reply_enabled=(s.auction_settings->>'privateReply')::boolean,public_reply_enabled=(s.auction_settings->>'publicReply')::boolean,
  private_reply_template=s.auction_settings->>'privateText',bid_reply_template=s.auction_settings->>'bidText',close_reply_template=s.auction_settings->>'closeText'
 where tenant_id=p_tenant and page_id=s.page_id and live_post_id=s.live_post_id and status='active';
 result:=jsonb_build_object('id',s.id,'revision',s.automation_revision);
 insert into public.auction_session_requests(tenant_id,request_id,actor_id,input,result) values(p_tenant,p_request,p_actor,p_input,result);
 return result;
end $$$sql_93_9$;
exception when invalid_function_definition then
  -- A newer signature of configure_auction_session(uuid,uuid,uuid,jsonb) is already installed. Its final definition below is mandatory.
  null;
end;

-- live-auction-dashboard.sql: source statement 10
begin
execute $sql_93_10$create or replace function public.inherit_auction_session_settings() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
declare settings jsonb;
begin
 select auction_settings into settings from public.live_sessions where tenant_id=new.tenant_id and page_id=new.page_id and live_post_id=new.live_post_id;
 if settings is not null then
  new.session_automation:=settings;
  new.bank_account_id:=(settings->>'bankAccountId')::uuid;
  new.private_reply_enabled:=(settings->>'privateReply')::boolean;new.public_reply_enabled:=(settings->>'publicReply')::boolean;
  new.private_reply_template:=settings->>'privateText';new.bid_reply_template:=settings->>'bidText';new.close_reply_template:=settings->>'closeText';
 end if;
 return new;
end $$$sql_93_10$;
exception when invalid_function_definition then
  -- A newer signature of inherit_auction_session_settings() is already installed. Its final definition below is mandatory.
  null;
end;

-- live-auction-dashboard.sql: source statement 11
execute $sql_93_11$drop trigger if exists auction_session_settings on public.auctions$sql_93_11$;

-- live-auction-dashboard.sql: source statement 12
execute $sql_93_12$create trigger auction_session_settings before insert on public.auctions for each row execute function public.inherit_auction_session_settings()$sql_93_12$;

-- live-auction-dashboard.sql: source statement 13
begin
execute $sql_93_13$create or replace function public.live_auction_dashboard(p_tenant uuid,p_session uuid)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare s public.live_sessions; result jsonb; slips jsonb; commenters jsonb;
begin
 select * into s from public.live_sessions where id=p_session and tenant_id=p_tenant;
 if not found then raise exception 'SESSION_NOT_FOUND' using errcode='P0002';end if;
 result:=public.live_session_dashboard(p_tenant,p_session);
 select coalesce(jsonb_agg(row order by row->>'at' desc,row->>'id'),'[]') into slips from (
  select jsonb_build_object('id',p.slip_id,'name',coalesce(c.display_name,c.platform_user_id),'amount',p.amount,'at',p.transferred_at,'transRef',proof.trans_ref) row
  from public.customer_tab_payments p join public.customer_tabs t on t.id=p.tab_id and t.tenant_id=p_tenant
  join public.customers c on c.id=t.customer_id and c.tenant_id=p_tenant
  join public.slips proof on proof.id=p.slip_id and proof.tenant_id=p_tenant and proof.status='valid'
  where t.live_session_id=s.id order by p.transferred_at desc,p.slip_id limit 500
 ) records;
 select coalesce(jsonb_agg(row||jsonb_build_object('customerId',(select c.id from public.customers c where c.tenant_id=p_tenant and c.platform='facebook' and c.platform_user_id=row->>'fbId')) order by row->>'at' desc,row->>'fbId'),'[]') into commenters from (
  select jsonb_build_object('fbId',v->'from'->>'id',
   'name',coalesce((array_agg(v->'from'->>'name' order by created_at desc))[1],v->'from'->>'id'),'at',max(created_at),'comments',count(*)) row
  from (select e.payload->'value' v,e.created_at from public.facebook_webhook_events e
   where e.page_id=s.page_id and e.kind='change' and e.payload->'value'->>'verb'='add'
   and e.payload->'value'->>'item' in ('comment','live_comment') and (
    regexp_replace(e.payload->'value'->>'post_id','^.*_','')=s.live_post_id
    or e.payload->'value'->>'video_id'=s.live_post_id or e.payload->'value'->>'live_video_id'=s.live_post_id
    or exists(select 1 from public.auctions a where a.tenant_id=p_tenant and a.page_id=s.page_id and a.live_post_id=s.live_post_id and e.payload->'value'->>'post_id'=any(a.live_post_aliases)))) events
  where v->'from'->>'id' is not null and v->'from'->>'id'<>s.page_id
  group by v->'from'->>'id' order by max(created_at) desc limit 500
 ) records;
 return result||jsonb_build_object('slips',slips,'commenters',commenters);
end $$$sql_93_13$;
exception when invalid_function_definition then
  -- A newer signature of live_auction_dashboard(uuid,uuid) is already installed. Its final definition below is mandatory.
  null;
end;

-- live-auction-dashboard.sql: source statement 14
execute $sql_93_14$revoke all on function public.configure_auction_session(uuid,uuid,uuid,jsonb),public.inherit_auction_session_settings(),public.live_auction_dashboard(uuid,uuid) from public,anon,authenticated$sql_93_14$;

-- live-auction-dashboard.sql: source statement 15
execute $sql_93_15$grant execute on function public.configure_auction_session(uuid,uuid,uuid,jsonb),public.live_auction_dashboard(uuid,uuid) to service_role$sql_93_15$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('live-auction-dashboard.sql','796c27727868b87ae7782c18a371dd3f5f613b4b6ed8f20764612fccb90c95e1','7b17bf54411dc1c84510ecf2a204c12dafe82c56d28b960be0061e4898bb679e');
end $migration_93$;

-- 95. live-auction-instant-winners.sql
do $migration_94$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='live-auction-instant-winners.sql';
  if found then
    if installed <> '5a085d82bf4a201c0a149e2c5c3b30a95d9c8e691c6ccba76a1cdd0888c6557a' then
      raise exception 'Applied migration changed: live-auction-instant-winners.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- live-auction-instant-winners.sql: source statement 4
execute $sql_94_4$create or replace function public.live_auction_dashboard(p_tenant uuid,p_session uuid)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare s public.live_sessions; result jsonb; slips jsonb; commenters jsonb; matched_people bigint;
begin
 select * into s from public.live_sessions where id=p_session and tenant_id=p_tenant;
 if not found then raise exception 'SESSION_NOT_FOUND' using errcode='P0002';end if;
 result:=public.live_session_dashboard(p_tenant,p_session);
 select coalesce(jsonb_agg(row order by row->>'at' desc,row->>'id'),'[]') into slips from (
  select jsonb_build_object('id',p.slip_id,'name',coalesce(c.display_name,c.platform_user_id),'amount',p.amount,'at',p.transferred_at,'transRef',proof.trans_ref,
   'senderName',coalesce(nullif(proof.raw->'data'->'sender'->>'displayName',''),nullif(proof.raw->'data'->'sender'->>'name','')),
   'senderBank',nullif(proof.raw->'data'->>'sendingBank','')) row
  from public.customer_tab_payments p join public.customer_tabs t on t.id=p.tab_id and t.tenant_id=p_tenant
  join public.customers c on c.id=t.customer_id and c.tenant_id=p_tenant
  join public.slips proof on proof.id=p.slip_id and proof.tenant_id=p_tenant and proof.status='valid'
  where t.live_session_id=s.id order by p.transferred_at desc,p.slip_id limit 500
 ) records;
 select coalesce(jsonb_agg(row||jsonb_build_object('customerId',(select c.id from public.customers c where c.tenant_id=p_tenant and c.platform='facebook' and c.platform_user_id=row->>'fbId')) order by row->>'at' desc,row->>'fbId'),'[]') into commenters from (
  select jsonb_build_object('fbId',v->'from'->>'id',
   'name',coalesce((array_agg(v->'from'->>'name' order by created_at desc))[1],v->'from'->>'id'),'at',max(created_at),'comments',count(*)) row
  from (select e.payload->'value' v,e.created_at from public.facebook_webhook_events e
   where e.page_id=s.page_id and e.kind='change' and e.payload->'value'->>'verb'='add'
   and e.payload->'value'->>'item' in ('comment','live_comment') and (
    regexp_replace(e.payload->'value'->>'post_id','^.*_','')=s.live_post_id
    or e.payload->'value'->>'video_id'=s.live_post_id or e.payload->'value'->>'live_video_id'=s.live_post_id
    or exists(select 1 from public.auctions a where a.tenant_id=p_tenant and a.page_id=s.page_id and a.live_post_id=s.live_post_id and e.payload->'value'->>'post_id'=any(a.live_post_aliases)))) events
  where v->'from'->>'id' is not null and v->'from'->>'id'<>s.page_id
  group by v->'from'->>'id' order by max(created_at) desc limit 500
 ) records;
 with matched as (
  select b.bidder_id fb_id from public.auction_bids b join public.auctions a on a.id=b.auction_id
   where a.tenant_id=p_tenant and a.page_id=s.page_id and a.live_post_id=s.live_post_id and b.status in ('accepted','too_low','already_opened')
  union
  select e.payload->'value'->'from'->>'id' from public.facebook_webhook_events e join public.live_cf_webhook_receipts r
   on r.comment_id=e.payload->'value'->>'comment_id' and r.page_id=e.page_id and r.tenant_id=p_tenant
   where e.page_id=s.page_id and e.kind='change' and e.payload->'value'->>'verb'='add' and e.payload->'value'->>'item' in ('comment','live_comment') and (
    regexp_replace(e.payload->'value'->>'post_id','^.*_','')=s.live_post_id
    or e.payload->'value'->>'video_id'=s.live_post_id or e.payload->'value'->>'live_video_id'=s.live_post_id
    or exists(select 1 from public.auctions a where a.tenant_id=p_tenant and a.page_id=s.page_id and a.live_post_id=s.live_post_id and e.payload->'value'->>'post_id'=any(a.live_post_aliases)))
 ) select count(distinct fb_id) into matched_people from matched where fb_id is not null and fb_id<>s.page_id;
 result:=jsonb_set(result,'{metrics}',(result->'metrics')||jsonb_build_object('matchedPeople',matched_people));
 return result||jsonb_build_object('slips',slips,'commenters',commenters);
end $$$sql_94_4$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('live-auction-instant-winners.sql','5a085d82bf4a201c0a149e2c5c3b30a95d9c8e691c6ccba76a1cdd0888c6557a','d0788ad3f0cd0a402db298a6fedcdc6c1620e2f2e35a15f580f8153e081e7f65');
end $migration_94$;

-- 96. live-auction-customer-workspace.sql
do $migration_95$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='live-auction-customer-workspace.sql';
  if found then
    if installed <> '12a96656e8ad33ac866177ef0a5ceb8161fcc8ec1a9511706f8fa0bf59db884d' then
      raise exception 'Applied migration changed: live-auction-customer-workspace.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- live-auction-customer-workspace.sql: source statement 2
execute $sql_95_2$create table if not exists public.live_session_customer_notes (
 session_id uuid not null references public.live_sessions(id) on delete cascade,
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 fb_id text not null check(fb_id ~ '^[0-9]{1,64}$'),
 note text not null default '' check(length(note)<=500), revision integer not null default 1,
 updated_at timestamptz not null default clock_timestamp(), primary key(session_id,fb_id)
)$sql_95_2$;

-- live-auction-customer-workspace.sql: source statement 3
execute $sql_95_3$alter table public.live_session_customer_notes enable row level security$sql_95_3$;

-- live-auction-customer-workspace.sql: source statement 4
execute $sql_95_4$revoke all on public.live_session_customer_notes from public,anon,authenticated$sql_95_4$;

-- live-auction-customer-workspace.sql: source statement 5
execute $sql_95_5$grant all on public.live_session_customer_notes to service_role$sql_95_5$;

-- live-auction-customer-workspace.sql: source statement 6
execute $sql_95_6$create or replace function public.live_auction_matched_customers(p_tenant uuid,p_session uuid)
returns table(fb_id text) language sql stable set search_path=pg_catalog,public as $$
 with s as (select * from public.live_sessions where id=p_session and tenant_id=p_tenant)
 select b.bidder_id from public.auction_bids b join public.auctions a on a.id=b.auction_id join s on a.page_id=s.page_id and a.live_post_id=s.live_post_id
  where a.tenant_id=p_tenant and b.status in ('accepted','too_low','already_opened') and b.bidder_id<>s.page_id
 union
 select e.payload->'value'->'from'->>'id' from public.facebook_webhook_events e join public.live_cf_webhook_receipts r
  on r.comment_id=e.payload->'value'->>'comment_id' and r.page_id=e.page_id and r.tenant_id=p_tenant
 join s on e.page_id=s.page_id where e.kind='change' and e.payload->'value'->>'verb'='add'
 and e.payload->'value'->>'item' in ('comment','live_comment') and e.payload->'value'->'from'->>'id'<>s.page_id and (
 regexp_replace(e.payload->'value'->>'post_id','^.*_','')=s.live_post_id or e.payload->'value'->>'video_id'=s.live_post_id
 or e.payload->'value'->>'live_video_id'=s.live_post_id or exists(select 1 from public.auctions a where a.tenant_id=p_tenant
  and a.page_id=s.page_id and a.live_post_id=s.live_post_id and e.payload->'value'->>'post_id'=any(a.live_post_aliases)))
$$$sql_95_6$;

-- live-auction-customer-workspace.sql: source statement 7
execute $sql_95_7$create or replace function public.live_auction_customer_dashboard(p_tenant uuid,p_session uuid)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare result jsonb; ids text[]; tabs jsonb; people jsonb;
begin
 result:=public.live_auction_dashboard(p_tenant,p_session);
 select coalesce(array_agg(fb_id),'{}') into ids from public.live_auction_matched_customers(p_tenant,p_session);
 select coalesce(jsonb_agg(x||jsonb_build_object('fbId',t.customer_fb_id,'matched',t.customer_fb_id=any(ids),
  'note',coalesce(n.note,''),'noteRevision',coalesce(n.revision,0)) order by pos),'[]') into tabs
 from jsonb_array_elements(result->'tabs') with ordinality rows(x,pos)
 join public.customer_tabs t on t.id=(x->>'id')::uuid and t.tenant_id=p_tenant and t.live_session_id=p_session
 left join public.live_session_customer_notes n on n.session_id=p_session and n.fb_id=t.customer_fb_id and n.tenant_id=p_tenant;
 select coalesce(jsonb_agg(x||jsonb_build_object('matched',x->>'fbId'=any(ids),'note',coalesce(n.note,''),
  'noteRevision',coalesce(n.revision,0)) order by pos),'[]') into people
 from jsonb_array_elements(result->'commenters') with ordinality rows(x,pos)
 left join public.live_session_customer_notes n on n.session_id=p_session and n.fb_id=x->>'fbId' and n.tenant_id=p_tenant;
 return result||jsonb_build_object('tabs',tabs,'commenters',people);
end $$$sql_95_7$;

-- live-auction-customer-workspace.sql: source statement 8
execute $sql_95_8$create or replace function public.save_auction_customer_note(p_tenant uuid,p_session uuid,p_actor uuid,p_request uuid,p_fb_id text,p_note text,p_revision integer)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare payload jsonb; prior public.auction_session_requests; current public.live_session_customer_notes; snapshot jsonb; result jsonb;
begin
 if p_fb_id is null or p_fb_id !~ '^[0-9]{1,64}$' or p_note is null or length(p_note)>500 or p_revision is null or p_revision<0 or p_actor is null or p_request is null then raise exception 'INVALID_NOTE';end if;
 payload:=jsonb_build_object('sessionId',p_session,'fbId',p_fb_id,'note',p_note,'revision',p_revision);
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||p_request::text,0));
 select * into prior from public.auction_session_requests where tenant_id=p_tenant and request_id=p_request;
 if found then
  if prior.actor_id<>p_actor or prior.input<>payload then raise exception 'REQUEST_REUSED' using errcode='40001';end if;
  return prior.result;
 end if;
 snapshot:=public.live_auction_customer_dashboard(p_tenant,p_session);
 if not exists(select 1 from jsonb_array_elements(snapshot->'tabs') x where x->>'fbId'=p_fb_id)
  and not exists(select 1 from jsonb_array_elements(snapshot->'commenters') x where x->>'fbId'=p_fb_id)
  then raise exception 'SESSION_CUSTOMER_SCOPE' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_session::text||':'||p_fb_id,0));
 select * into current from public.live_session_customer_notes where session_id=p_session and fb_id=p_fb_id for update;
 if coalesce(current.revision,0)<>p_revision then raise exception 'NOTE_CHANGED' using errcode='40001';end if;
 insert into public.live_session_customer_notes(session_id,tenant_id,fb_id,note) values(p_session,p_tenant,p_fb_id,p_note)
  on conflict(session_id,fb_id) do update set note=excluded.note,revision=live_session_customer_notes.revision+1,updated_at=clock_timestamp()
  returning * into current;
 result:=jsonb_build_object('note',current.note,'revision',current.revision);
 insert into public.auction_session_requests(tenant_id,request_id,actor_id,input,result) values(p_tenant,p_request,p_actor,payload,result);
 return result;
end $$$sql_95_8$;

-- live-auction-customer-workspace.sql: source statement 9
begin
execute $sql_95_9$create or replace function public.collect_auction_session_customers(p_tenant uuid,p_session uuid,p_fb_ids text[])
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare snapshot jsonb; person jsonb; fb text; name text; cid uuid;
begin
 if coalesce(cardinality(p_fb_ids),0) not between 1 and 500 or exists(select 1 from unnest(p_fb_ids) id where id is null or id !~ '^[0-9]{1,64}$') then raise exception 'INVALID_CUSTOMERS';end if;
 snapshot:=public.live_auction_customer_dashboard(p_tenant,p_session);
 foreach fb in array p_fb_ids loop
  select x into person from jsonb_array_elements(snapshot->'commenters') x where x->>'fbId'=fb;
  if person is null then select x into person from jsonb_array_elements(snapshot->'tabs') x where x->>'fbId'=fb;end if;
  if person is null then raise exception 'SESSION_CUSTOMER_SCOPE' using errcode='42501';end if;
  name:=person->>'name';
  insert into public.customers(tenant_id,platform,platform_user_id,display_name) values(p_tenant,'facebook',fb,left(name,255))
   on conflict(platform,platform_user_id) do update set tenant_id=coalesce(customers.tenant_id,excluded.tenant_id),display_name=coalesce(customers.display_name,excluded.display_name)
   where customers.tenant_id is null or customers.tenant_id=p_tenant returning id into cid;
  if not found then raise exception 'CUSTOMER_TENANT_SCOPE' using errcode='42501';end if;
 end loop;
 -- Importing commenters must not manufacture a Messenger inbound window or a payment.
 return public.live_auction_customer_dashboard(p_tenant,p_session);
end $$$sql_95_9$;
exception when invalid_function_definition then
  -- A newer signature of collect_auction_session_customers(uuid,uuid,text[]) is already installed. Its final definition below is mandatory.
  null;
end;

-- live-auction-customer-workspace.sql: source statement 10
execute $sql_95_10$revoke all on function public.collect_auction_session_customers(uuid,uuid,text[]),public.live_auction_matched_customers(uuid,uuid),public.live_auction_customer_dashboard(uuid,uuid),public.save_auction_customer_note(uuid,uuid,uuid,uuid,text,text,integer) from public,anon,authenticated$sql_95_10$;

-- live-auction-customer-workspace.sql: source statement 11
execute $sql_95_11$grant execute on function public.collect_auction_session_customers(uuid,uuid,text[]) to service_role$sql_95_11$;

-- live-auction-customer-workspace.sql: source statement 12
execute $sql_95_12$grant execute on function public.live_auction_customer_dashboard(uuid,uuid),public.save_auction_customer_note(uuid,uuid,uuid,uuid,text,text,integer) to service_role$sql_95_12$;

-- live-auction-customer-workspace.sql: source statement 13
execute $sql_95_13$grant execute on function public.live_auction_matched_customers(uuid,uuid) to service_role$sql_95_13$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('live-auction-customer-workspace.sql','12a96656e8ad33ac866177ef0a5ceb8161fcc8ec1a9511706f8fa0bf59db884d','dff1722d7bd0ef6404ac4d3c9e32a516d137f13a8dac3ce8cd3c9d5ea5fd5d34');
end $migration_95$;

-- 97. live-auction-thai-workflow.sql
do $migration_96$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='live-auction-thai-workflow.sql';
  if found then
    if installed <> 'bea925f85a4da7d5e81bda3e92aa689045c3306d7e2555b9a5cc6b7f2036df0b' then
      raise exception 'Applied migration changed: live-auction-thai-workflow.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- live-auction-thai-workflow.sql: source statement 2
begin
execute $sql_96_2$create or replace function public.normalize_auction_thai_settings(settings jsonb) returns jsonb
language sql immutable returns null on null input set search_path=pg_catalog,public as $$
 select settings||jsonb_build_object(
  'keywords',case when settings->'keywords'='["1","11","111","11111","+1","+10"]'::jsonb then '["1"]'::jsonb else settings->'keywords' end,
  'closeKeywords',coalesce(settings->'closeKeywords','["ปิด","x"]'::jsonb),
  'countEnabled',false,'heartCloses',false,'closeEnabled',true,
  'bidText',case when settings ? 'closeKeywords' then settings->>'bidText' else coalesce(settings->>'closeText','ยินดีด้วยครับ คุณ {bidder_name} ชนะประมูล {product_name} ราคา {price} บาท') end,
  'closeText',case when settings ? 'closeKeywords' then settings->>'bidText' else coalesce(settings->>'closeText','ยินดีด้วยครับ คุณ {bidder_name} ชนะประมูล {product_name} ราคา {price} บาท') end)
$$$sql_96_2$;
exception when invalid_function_definition then
  -- A newer signature of normalize_auction_thai_settings(jsonb) is already installed. Its final definition below is mandatory.
  null;
end;

-- live-auction-thai-workflow.sql: source statement 5
execute $sql_96_5$create or replace function public.inherit_auction_session_settings() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
declare settings jsonb;
begin
 select public.normalize_auction_thai_settings(auction_settings) into settings from public.live_sessions where tenant_id=new.tenant_id and page_id=new.page_id and live_post_id=new.live_post_id;
 if settings is not null then
  -- The chosen bank is validated by the auction API; each round may choose its own bank.
  new.session_automation:=settings||jsonb_build_object('bankAccountId',new.bank_account_id);
  new.private_reply_enabled:=(settings->>'privateReply')::boolean;new.public_reply_enabled:=(settings->>'publicReply')::boolean;
  new.private_reply_template:=settings->>'privateText';new.bid_reply_template:=settings->>'bidText';new.close_reply_template:=settings->>'closeText';
 end if;
 return new;
end $$$sql_96_5$;

-- live-auction-thai-workflow.sql: source statement 6
begin
execute $sql_96_6$create or replace function public.live_auction_thai_dashboard(p_tenant uuid,p_session uuid) returns jsonb
language plpgsql stable set search_path=pg_catalog,public as $$
declare result jsonb; active jsonb;
begin
 result:=public.live_auction_customer_dashboard(p_tenant,p_session);
 select jsonb_build_object('id',a.id,'itemName',a.item_name) into active from public.auctions a
 join public.live_sessions s on s.id=p_session and s.tenant_id=p_tenant and s.page_id=a.page_id and s.live_post_id=a.live_post_id
 where a.tenant_id=p_tenant and a.status='active' order by a.created_at desc limit 1;
 return result||jsonb_build_object('activeAuction',active);
end $$$sql_96_6$;
exception when invalid_function_definition then
  -- A newer signature of live_auction_thai_dashboard(uuid,uuid) is already installed. Its final definition below is mandatory.
  null;
end;

-- live-auction-thai-workflow.sql: source statement 7
execute $sql_96_7$revoke all on function public.normalize_auction_thai_settings(jsonb),public.live_auction_thai_dashboard(uuid,uuid) from public,anon,authenticated$sql_96_7$;

-- live-auction-thai-workflow.sql: source statement 8
execute $sql_96_8$grant execute on function public.normalize_auction_thai_settings(jsonb),public.live_auction_thai_dashboard(uuid,uuid) to service_role$sql_96_8$;

-- live-auction-thai-workflow.sql: source statement 9
execute $sql_96_9$create or replace function public.configure_auction_session(p_tenant uuid,p_actor uuid,p_request uuid,p_input jsonb)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare s public.live_sessions; prior public.auction_session_requests; settings jsonb:=public.normalize_auction_thai_settings(p_input->'settings'); result jsonb; page text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||p_request::text,0));
 select * into prior from public.auction_session_requests where tenant_id=p_tenant and request_id=p_request;
 if found then
  if prior.actor_id<>p_actor or prior.input<>p_input then raise exception 'REQUEST_REUSED' using errcode='40001';end if;
  return prior.result;
 end if;
 if settings is null then raise exception 'INVALID_SETTINGS';end if;
 if p_input->>'action' not in ('start','settings') or p_actor is null or p_request is null then raise exception 'INVALID_ACTION';end if;
 if jsonb_typeof(settings)<>'object' or jsonb_typeof(settings->'keywords')<>'array'
  or jsonb_array_length(settings->'keywords') not between 1 and 30 then raise exception 'INVALID_SETTINGS';end if;
 if jsonb_typeof(settings->'closeKeywords') is distinct from 'array' or jsonb_array_length(settings->'closeKeywords') not between 1 and 30 then raise exception 'INVALID_CLOSE_KEYWORDS';end if;
 if exists(select 1 from jsonb_array_elements(settings->'closeKeywords') k where jsonb_typeof(k)<>'string' or length(trim(k#>>'{}')) not between 1 and 40) then raise exception 'INVALID_CLOSE_KEYWORDS';end if;
 if exists(select 1 from jsonb_array_elements(settings->'keywords') k where jsonb_typeof(k)<>'string' or length(trim(k#>>'{}')) not between 1 and 40)
  or exists(select 1 from unnest(array['publicReply','privateReply','countEnabled','closeEnabled','heartCloses']) k where jsonb_typeof(settings->k) is distinct from 'boolean')
  or exists(select 1 from unnest(array['bidText','privateText','closeText']) k where jsonb_typeof(settings->k) is distinct from 'string' or length(settings->>k) not between 1 and 2000)
  then raise exception 'INVALID_SETTINGS';end if;
 if not exists(select 1 from public.bank_accounts where id=(settings->>'bankAccountId')::uuid and tenant_id=p_tenant and is_active)
  then raise exception 'BANK_SCOPE' using errcode='42501';end if;
 select page_id into page from public.tenants where id=p_tenant and is_active;
 if page is null then raise exception 'PAGE_SCOPE' using errcode='42501';end if;
 if p_input->>'action'='start' then
  if p_input->>'pageId' is distinct from page or coalesce(p_input->>'livePostId','') !~ '^[0-9]{1,64}$' then raise exception 'PAGE_SCOPE' using errcode='42501';end if;
  insert into public.live_sessions(tenant_id,page_id,live_post_id,auction_settings)
   values(p_tenant,page,p_input->>'livePostId',settings)
   on conflict(tenant_id,page_id,live_post_id) do nothing;
  perform 1 from public.auctions where tenant_id=p_tenant and page_id=page and live_post_id=p_input->>'livePostId' and status='active' order by id for update;
  select * into s from public.live_sessions where tenant_id=p_tenant and page_id=page and live_post_id=p_input->>'livePostId' for update;
  if s.ended_at is not null then raise exception 'SESSION_ENDED' using errcode='40001';end if;
  -- Starting an existing Session must not reset its saved automation or ledger.
  if s.auction_settings is null then
   update public.live_sessions set auction_settings=settings,automation_revision=automation_revision+1 where id=s.id returning * into s;
  end if;
 else
  select * into s from public.live_sessions where id=(p_input->>'sessionId')::uuid and tenant_id=p_tenant;
  if not found then raise exception 'SESSION_NOT_FOUND' using errcode='P0002';end if;
  -- Use auction -> session lock order, matching finalization and tab attachment.
  perform 1 from public.auctions where tenant_id=p_tenant and page_id=s.page_id and live_post_id=s.live_post_id and status='active' order by id for update;
  select * into s from public.live_sessions where id=s.id for update;
  if s.ended_at is not null then raise exception 'SESSION_ENDED' using errcode='40001';end if;
  if s.automation_revision<>(p_input->>'revision')::integer then raise exception 'SETTINGS_CHANGED' using errcode='40001';end if;
  update public.live_sessions set auction_settings=settings,automation_revision=automation_revision+1 where id=s.id returning * into s;
 end if;
 update public.auctions set session_automation=s.auction_settings||jsonb_build_object('bankAccountId',bank_account_id),
  private_reply_enabled=(s.auction_settings->>'privateReply')::boolean,public_reply_enabled=(s.auction_settings->>'publicReply')::boolean,
  private_reply_template=s.auction_settings->>'privateText',bid_reply_template=s.auction_settings->>'bidText',close_reply_template=s.auction_settings->>'closeText'
 where tenant_id=p_tenant and page_id=s.page_id and live_post_id=s.live_post_id and status='active';
 result:=jsonb_build_object('id',s.id,'revision',s.automation_revision);
 insert into public.auction_session_requests(tenant_id,request_id,actor_id,input,result) values(p_tenant,p_request,p_actor,p_input,result);
 return result;
end $$$sql_96_9$;

-- live-auction-thai-workflow.sql: source statement 10
execute $sql_96_10$create or replace function public.finalize_live_auction(p_auction uuid,p_tenant uuid,p_event uuid default null,p_cancel boolean default false)
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
 if not p_cancel and a.public_reply_enabled and a.leading_bidder_id is not null and a.session_automation ? 'closeKeywords' then
  insert into public.auction_deliveries(auction_id,channel,comment_id) values(a.id,'public',a.leading_comment_id) on conflict(auction_id,channel) do nothing;
 elsif p_event is not null and not p_cancel and a.public_reply_enabled then
  insert into public.auction_deliveries(auction_id,channel,comment_id)
   select a.id,'public',payload->'value'->>'comment_id' from public.facebook_webhook_events where id=p_event;
 end if;
 return jsonb_build_object('status',case when p_cancel then 'cancelled' else 'closed' end,'orderId',oid);
end $$$sql_96_10$;

-- live-auction-thai-workflow.sql: source statement 11
execute $sql_96_11$create or replace function public.collect_auction_session_customers(p_tenant uuid,p_session uuid,p_fb_ids text[])
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare snapshot jsonb; person jsonb; fb text; name text; cid uuid;
begin
 if coalesce(cardinality(p_fb_ids),0) not between 1 and 500 or exists(select 1 from unnest(p_fb_ids) id where id is null or id !~ '^[0-9]{1,64}$') then raise exception 'INVALID_CUSTOMERS';end if;
 snapshot:=public.live_auction_customer_dashboard(p_tenant,p_session);
 foreach fb in array p_fb_ids loop
  select x into person from jsonb_array_elements(snapshot->'commenters') x where x->>'fbId'=fb;
  if person is null then select x into person from jsonb_array_elements(snapshot->'tabs') x where x->>'fbId'=fb;end if;
  if person is null then raise exception 'SESSION_CUSTOMER_SCOPE' using errcode='42501';end if;
  name:=person->>'name';
  insert into public.customers(tenant_id,platform,platform_user_id,display_name) values(p_tenant,'facebook',fb,left(name,255))
   on conflict(platform,platform_user_id) do update set tenant_id=coalesce(customers.tenant_id,excluded.tenant_id),display_name=coalesce(customers.display_name,excluded.display_name)
   where customers.tenant_id is null or customers.tenant_id=p_tenant returning id into cid;
  if not found then raise exception 'CUSTOMER_TENANT_SCOPE' using errcode='42501';end if;
 end loop;
 -- Importing commenters must not manufacture a Messenger inbound window or a payment.
 return public.live_auction_thai_dashboard(p_tenant,p_session);
end $$$sql_96_11$;

-- live-auction-thai-workflow.sql: source statement 12
begin
execute $sql_96_12$create or replace function public.process_live_auction_comment(p_auction uuid,p_tenant uuid,p_event uuid,p_kind text,p_amount numeric default null,p_control text default null)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare a public.auctions; e public.facebook_webhook_events; v jsonb; prior jsonb; r jsonb;
 sender text; cid text; bidder text; amount numeric; minimum numeric; outcome text; host boolean;
begin
 select * into a from public.auctions where id=p_auction and tenant_id=p_tenant for update;
 if not found then raise exception 'AUCTION_NOT_FOUND' using errcode='P0002';end if;
 select * into e from public.facebook_webhook_events where id=p_event and page_id=a.page_id;
 if not found or e.kind<>'change' then raise exception 'AUCTION_EVENT_INVALID' using errcode='42501';end if;
 v:=e.payload->'value'; sender:=v->'from'->>'id'; cid:=v->>'comment_id';bidder:=left(v->'from'->>'name',200);
 if sender is null or cid is null or v->>'verb'<>'add' then return jsonb_build_object('status','ignored');end if;
 if not coalesce((a.live_post_id=split_part(v->>'post_id','_',array_length(string_to_array(v->>'post_id','_'),1))
   or a.live_post_id=v->>'video_id' or a.live_post_id=v->>'live_video_id'
   or v->>'post_id'=any(a.live_post_aliases)),false) then
  raise exception 'AUCTION_POST_MISMATCH' using errcode='42501';
 end if;
 select result into prior from public.auction_bids where auction_id=a.id and comment_id=cid;
 if found then return prior;end if;
 if e.created_at<a.created_at then return jsonb_build_object('status','stale');end if;
 if coalesce(v->>'created_time','') ~ '^[0-9]{10}$' and (v->>'created_time')::numeric<floor(extract(epoch from a.created_at)) then
  return jsonb_build_object('status','stale');
 end if;
 -- No worker may overtake an earlier comment even if called outside the queue loop.
 if exists(select 1 from public.facebook_webhook_events older where older.page_id=e.page_id
  and older.ordering_key=e.ordering_key and older.sequence<e.sequence and older.status in ('pending','processing')) then
  raise exception 'AUCTION_EVENT_OUT_OF_ORDER' using errcode='40001';
 end if;
 host:=sender=a.page_id or sender=any(a.host_ids);
 if a.session_automation ? 'closeKeywords' then
  if host then
   if exists(select 1 from jsonb_array_elements_text(a.session_automation->'closeKeywords') k where k=lower(regexp_replace(normalize(trim(coalesce(v->>'message','')),NFKC),'\s+',' ','g'))) then p_kind:='HOST_CONTROL';p_control:='close';
   else return jsonb_build_object('status','ignored');end if;
  elsif exists(select 1 from jsonb_array_elements_text(a.session_automation->'keywords') k where k=lower(regexp_replace(normalize(trim(coalesce(v->>'message','')),NFKC),'\s+',' ','g'))) then p_kind:='STEP_BID';
  elsif p_kind<>'NUMERIC_BID' then return jsonb_build_object('status','ignored');end if;
 end if;

 minimum:=case when a.leading_bidder_id is null then a.start_price else a.current_price+a.min_step end;
 if a.status<>'active' then outcome:='closed';
 elsif p_kind='HOST_CONTROL' and host then
  if p_control='close' then r:=public.finalize_live_auction(a.id,a.tenant_id,e.id);outcome:='closed';
  elsif p_control in ('1','2','3','นับขิง') then
   update public.auctions set host_count=p_control where id=a.id;outcome:='count';
  else return jsonb_build_object('status','ignored');end if;
 elsif host or p_kind not in ('OPENING_BID','STEP_BID','NUMERIC_BID') then
  return jsonb_build_object('status','ignored');
 elsif p_kind='OPENING_BID' and a.leading_bidder_id is not null then outcome:='already_opened';
 else
  amount:=case when p_kind='OPENING_BID' then a.start_price when p_kind='STEP_BID' then minimum else p_amount end;
  if amount is null or amount<minimum or amount>999999999 or amount<>round(amount,2) then outcome:='too_low';
  else
   update public.auctions set current_price=amount,leading_bidder_id=sender,
    leading_bidder_name=bidder,leading_comment_id=cid,host_count=null where id=a.id;
   outcome:='accepted';
  end if;
 end if;
 r:=coalesce(r,jsonb_build_object('status',outcome,'amount',coalesce(amount,a.current_price),
  'minimum',minimum,'name',bidder,'isOpening',p_kind='OPENING_BID'));
 insert into public.auction_bids(auction_id,event_id,comment_id,bidder_id,bidder_name,comment_text,bid_amount,is_opening,status,result)
  values(a.id,e.id,cid,sender,bidder,left(coalesce(v->>'message',''),2000),amount,p_kind='OPENING_BID',outcome,r);
 return r;
end $$$sql_96_12$;
exception when invalid_function_definition then
  -- A newer signature of process_live_auction_comment(uuid,uuid,uuid,text,numeric,text) is already installed. Its final definition below is mandatory.
  null;
end;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('live-auction-thai-workflow.sql','bea925f85a4da7d5e81bda3e92aa689045c3306d7e2555b9a5cc6b7f2036df0b','8b95f7dd616abca86ccfbc4395d0e28bb4f5c880792dde5d7b589f5cc6bb50e6');
end $migration_96$;

-- 98. live-auction-customer-columns.sql
do $migration_97$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='live-auction-customer-columns.sql';
  if found then
    if installed <> '193605a75ceaaaff5d04fb3c07c00bb77fcb3e88a220e2d1faa0530464227d23' then
      raise exception 'Applied migration changed: live-auction-customer-columns.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- live-auction-customer-columns.sql: source statement 1
execute $sql_97_1$create or replace function public.live_auction_thai_dashboard(p_tenant uuid,p_session uuid) returns jsonb
language plpgsql stable set search_path=pg_catalog,public as $$
declare result jsonb; active jsonb; people jsonb; s public.live_sessions;
begin
 result:=public.live_auction_customer_dashboard(p_tenant,p_session);
 select * into strict s from public.live_sessions where id=p_session and tenant_id=p_tenant;
 select jsonb_build_object('id',a.id,'itemName',a.item_name) into active from public.auctions a
 where a.tenant_id=p_tenant and a.page_id=s.page_id and a.live_post_id=s.live_post_id
 and a.status='active' order by a.created_at desc limit 1;
 with latest as (
  select distinct on (e.payload->'value'->'from'->>'id')
   e.payload->'value'->'from'->>'id' fb_id,e.payload->'value'->>'message' message
  from public.facebook_webhook_events e
  where e.page_id=s.page_id and e.kind='change' and e.payload->'value'->>'verb'='add'
   and e.payload->'value'->>'item' in ('comment','live_comment') and (
    regexp_replace(e.payload->'value'->>'post_id','^.*_','')=s.live_post_id
    or e.payload->'value'->>'video_id'=s.live_post_id or e.payload->'value'->>'live_video_id'=s.live_post_id
    or exists(select 1 from public.auctions a where a.tenant_id=p_tenant and a.page_id=s.page_id
     and a.live_post_id=s.live_post_id and e.payload->'value'->>'post_id'=any(a.live_post_aliases)))
  order by e.payload->'value'->'from'->>'id',e.created_at desc,e.id desc
 )
 select coalesce(jsonb_agg(x||jsonb_build_object('lastText',latest.message) order by pos),'[]'::jsonb) into people
 from jsonb_array_elements(result->'commenters') with ordinality rows(x,pos)
 left join latest on latest.fb_id=x->>'fbId';
 return result||jsonb_build_object('activeAuction',active,'commenters',people);
end $$$sql_97_1$;

-- live-auction-customer-columns.sql: source statement 2
execute $sql_97_2$revoke all on function public.live_auction_thai_dashboard(uuid,uuid) from public,anon,authenticated$sql_97_2$;

-- live-auction-customer-columns.sql: source statement 3
execute $sql_97_3$grant execute on function public.live_auction_thai_dashboard(uuid,uuid) to service_role$sql_97_3$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('live-auction-customer-columns.sql','193605a75ceaaaff5d04fb3c07c00bb77fcb3e88a220e2d1faa0530464227d23','a0e96f4c674e920d1974403d19e64ed225e8b2cf2c9a3a625473e8b2767a8bc9');
end $migration_97$;

-- 99. live-auction-close-presets.sql
do $migration_98$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='live-auction-close-presets.sql';
  if found then
    if installed <> '027974180f12827afc3de9dd4bdb1a22a2936126fa8b499b53bb07c68b41a94d' then
      raise exception 'Applied migration changed: live-auction-close-presets.sql. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
-- live-auction-close-presets.sql: source statement 2
execute $sql_98_2$create or replace function public.default_auction_close_keywords() returns jsonb
language sql immutable set search_path=pg_catalog,public as $$ select '["ปิด","จบ","พอ","321","3 2 1","x","X","❌","🛑","⛔","🚫","✖️","🏁","🚩","🔨","🔔","⏰","❤️","🖤"]'::jsonb $$$sql_98_2$;

-- live-auction-close-presets.sql: source statement 3
execute $sql_98_3$create or replace function public.auction_close_keyword_matches(message text,keywords jsonb) returns boolean
language sql immutable set search_path=pg_catalog,public as $$
 select exists(select 1 from jsonb_array_elements_text(keywords) k
 where length(translate(trim(k),U&'\FE0E\FE0F',''))>0 and position(
  translate(lower(regexp_replace(normalize(trim(k),NFKC),'\s+',' ','g')),U&'\FE0E\FE0F','')
  in translate(lower(regexp_replace(normalize(trim(coalesce(message,'')),NFKC),'\s+',' ','g')),U&'\FE0E\FE0F',''))>0)
$$$sql_98_3$;

-- live-auction-close-presets.sql: source statement 4
execute $sql_98_4$create or replace function public.normalize_auction_thai_settings(settings jsonb) returns jsonb
language sql immutable returns null on null input set search_path=pg_catalog,public as $$
 select settings||jsonb_build_object(
  'keywords',case when settings->'keywords'='["1","11","111","11111","+1","+10"]'::jsonb then '["1"]'::jsonb else settings->'keywords' end,
  'closeKeywords',coalesce(settings->'closeKeywords',public.default_auction_close_keywords()),
  'closeKeywordPresetsVersion',1,'countEnabled',false,'heartCloses',false,'closeEnabled',true,
  'bidText',case when settings ? 'closeKeywords' then settings->>'bidText' else coalesce(settings->>'closeText','ยินดีด้วยครับ คุณ {bidder_name} ชนะประมูล {product_name} ราคา {price} บาท') end,
  'closeText',case when settings ? 'closeKeywords' then settings->>'bidText' else coalesce(settings->>'closeText','ยินดีด้วยครับ คุณ {bidder_name} ชนะประมูล {product_name} ราคา {price} บาท') end)
$$$sql_98_4$;

-- live-auction-close-presets.sql: source statement 7
execute $sql_98_7$create or replace function public.process_live_auction_comment(p_auction uuid,p_tenant uuid,p_event uuid,p_kind text,p_amount numeric default null,p_control text default null)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare a public.auctions; e public.facebook_webhook_events; v jsonb; prior jsonb; r jsonb;
 sender text; cid text; bidder text; amount numeric; minimum numeric; outcome text; host boolean;
begin
 select * into a from public.auctions where id=p_auction and tenant_id=p_tenant for update;
 if not found then raise exception 'AUCTION_NOT_FOUND' using errcode='P0002';end if;
 select * into e from public.facebook_webhook_events where id=p_event and page_id=a.page_id;
 if not found or e.kind<>'change' then raise exception 'AUCTION_EVENT_INVALID' using errcode='42501';end if;
 v:=e.payload->'value'; sender:=v->'from'->>'id'; cid:=v->>'comment_id';bidder:=left(v->'from'->>'name',200);
 if sender is null or cid is null or v->>'verb'<>'add' then return jsonb_build_object('status','ignored');end if;
 if not coalesce((a.live_post_id=split_part(v->>'post_id','_',array_length(string_to_array(v->>'post_id','_'),1))
   or a.live_post_id=v->>'video_id' or a.live_post_id=v->>'live_video_id'
   or v->>'post_id'=any(a.live_post_aliases)),false) then
  raise exception 'AUCTION_POST_MISMATCH' using errcode='42501';
 end if;
 select result into prior from public.auction_bids where auction_id=a.id and comment_id=cid;
 if found then return prior;end if;
 if e.created_at<a.created_at then return jsonb_build_object('status','stale');end if;
 if coalesce(v->>'created_time','') ~ '^[0-9]{10}$' and (v->>'created_time')::numeric<floor(extract(epoch from a.created_at)) then
  return jsonb_build_object('status','stale');
 end if;
 -- No worker may overtake an earlier comment even if called outside the queue loop.
 if exists(select 1 from public.facebook_webhook_events older where older.page_id=e.page_id
  and older.ordering_key=e.ordering_key and older.sequence<e.sequence and older.status in ('pending','processing')) then
  raise exception 'AUCTION_EVENT_OUT_OF_ORDER' using errcode='40001';
 end if;
 host:=sender=a.page_id or sender=any(a.host_ids);
 if a.session_automation ? 'closeKeywords' then
  if host then
   if public.auction_close_keyword_matches(v->>'message',a.session_automation->'closeKeywords') then p_kind:='HOST_CONTROL';p_control:='close';
   else return jsonb_build_object('status','ignored');end if;
  elsif exists(select 1 from jsonb_array_elements_text(a.session_automation->'keywords') k where k=lower(regexp_replace(normalize(trim(coalesce(v->>'message','')),NFKC),'\s+',' ','g'))) then p_kind:='STEP_BID';
  elsif p_kind<>'NUMERIC_BID' then return jsonb_build_object('status','ignored');end if;
 end if;

 minimum:=case when a.leading_bidder_id is null then a.start_price else a.current_price+a.min_step end;
 if a.status<>'active' then outcome:='closed';
 elsif p_kind='HOST_CONTROL' and host then
  if p_control='close' then r:=public.finalize_live_auction(a.id,a.tenant_id,e.id);outcome:='closed';
  elsif p_control in ('1','2','3','นับขิง') then
   update public.auctions set host_count=p_control where id=a.id;outcome:='count';
  else return jsonb_build_object('status','ignored');end if;
 elsif host or p_kind not in ('OPENING_BID','STEP_BID','NUMERIC_BID') then
  return jsonb_build_object('status','ignored');
 elsif p_kind='OPENING_BID' and a.leading_bidder_id is not null then outcome:='already_opened';
 else
  amount:=case when p_kind='OPENING_BID' then a.start_price when p_kind='STEP_BID' then minimum else p_amount end;
  if amount is null or amount<minimum or amount>999999999 or amount<>round(amount,2) then outcome:='too_low';
  else
   update public.auctions set current_price=amount,leading_bidder_id=sender,
    leading_bidder_name=bidder,leading_comment_id=cid,host_count=null where id=a.id;
   outcome:='accepted';
  end if;
 end if;
 r:=coalesce(r,jsonb_build_object('status',outcome,'amount',coalesce(amount,a.current_price),
  'minimum',minimum,'name',bidder,'isOpening',p_kind='OPENING_BID'));
 insert into public.auction_bids(auction_id,event_id,comment_id,bidder_id,bidder_name,comment_text,bid_amount,is_opening,status,result)
  values(a.id,e.id,cid,sender,bidder,left(coalesce(v->>'message',''),2000),amount,p_kind='OPENING_BID',outcome,r);
 return r;
end $$$sql_98_7$;

-- live-auction-close-presets.sql: source statement 8
execute $sql_98_8$revoke all on function public.default_auction_close_keywords(),public.auction_close_keyword_matches(text,jsonb),public.normalize_auction_thai_settings(jsonb) from public,anon,authenticated$sql_98_8$;

-- live-auction-close-presets.sql: source statement 9
execute $sql_98_9$grant execute on function public.default_auction_close_keywords(),public.auction_close_keyword_matches(text,jsonb),public.normalize_auction_thai_settings(jsonb) to service_role$sql_98_9$;
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('live-auction-close-presets.sql','027974180f12827afc3de9dd4bdb1a22a2936126fa8b499b53bb07c68b41a94d','e40d3d01a50c6c99c399043f94540a4368ccfdbe43a206d814338ae7666c5db3');
end $migration_98$;

notify pgrst,'reload schema';

commit;

