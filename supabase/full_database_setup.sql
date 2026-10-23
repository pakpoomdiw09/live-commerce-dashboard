-- GENERATED: node scripts/build-full-database-setup.cjs
-- Target: a NEW Supabase database only; run as postgres before connecting the app.
-- Not a production upgrade and not a restore/backup. Guard refuses existing application tables.
-- Keep required storage/plan lookup seeds; omit tenant/customer/message/ledger backfills.
-- Runtime function DML, authorization and proof/idempotency guards are intentionally retained.
-- Temporary Full Access is excluded. See full_database_setup-manifest.md for every input/exclusion.
-- Source order follows dependencies; security helpers must exist before later policies/functions.
-- No global BEGIN/COMMIT, explicit LOCK TABLE, trigger-disable backfill or historical data scans.
-- Each source uses its own transaction with lock_timeout=2s; DDL still acquires PostgreSQL locks.
-- Prerequisites: Supabase auth/storage schemas, anon/authenticated/service_role, supabase_realtime.
-- For psql: psql -X -v ON_ERROR_STOP=1 "$DIRECT_URL" -f supabase/full_database_setup.sql

do $fresh_database_only$
declare existing text;
begin
  if to_regclass('auth.users') is null or to_regclass('storage.buckets') is null
    or to_regclass('storage.objects') is null
    or not exists(select 1 from pg_publication where pubname='supabase_realtime')
    or (select count(*) from pg_roles where rolname in ('anon','authenticated','service_role')) <> 3 then
    raise exception 'Supabase platform prerequisites missing (auth/storage/roles/Realtime). No application DDL has run.';
  end if;
  select string_agg(name, ', ' order by name) into existing
  from (values ('public.customers'),
    ('public.messages'),
    ('public.comments'),
    ('public.slips'),
    ('public.tenants'),
    ('public.comment_rules'),
    ('public.products'),
    ('public.orders'),
    ('public.bot_settings'),
    ('public.chat_rules'),
    ('public.follow_up_jobs'),
    ('public.broadcasts'),
    ('public.billing_requests'),
    ('public.platform_admins'),
    ('public.tenant_members'),
    ('public.facebook_pages'),
    ('public.payment_sessions'),
    ('public.payment_receipts'),
    ('public.payment_transfer_ledger'),
    ('public.platform_tenant_audit'),
    ('public.payment_image_ledger'),
    ('public.billing_payment_receipts'),
    ('public.bank_accounts'),
    ('public.image_response_rules'),
    ('public.plan_features'),
    ('public.conversation_reads'),
    ('public.conversation_events'),
    ('public.inbox_media'),
    ('public.inbox_action_receipts'),
    ('public.inbox_internal_notes'),
    ('public.inbox_stars'),
    ('public.inbox_workspace_requests'),
    ('public.inbox_follow_up_flags'),
    ('public.inbox_quick_replies'),
    ('public.tenant_automation_controls'),
    ('public.tenant_automation_audit'),
    ('public.follow_up_policies'),
    ('public.follow_up_workflows'),
    ('public.order_delivery_events'),
    ('public.follow_up_execution_logs'),
    ('public.agent_control_settings'),
    ('public.agent_knowledge_sources'),
    ('public.agent_prompt_versions'),
    ('public.agent_message_jobs'),
    ('public.agent_ai_monthly_usage'),
    ('public.agent_ai_usage'),
    ('public.agent_control_audit'),
    ('public.vision_plan_limits'),
    ('public.vision_settings'),
    ('public.vision_usage'),
    ('public.vision_jobs'),
    ('public.vision_audit_logs'),
    ('public.commerce_limits'),
    ('public.commerce_stores'),
    ('public.commerce_categories'),
    ('public.commerce_variants'),
    ('public.commerce_pages'),
    ('public.commerce_customers'),
    ('public.commerce_orders'),
    ('public.commerce_order_items'),
    ('public.commerce_audit'),
    ('public.commerce_rate'),
    ('public.payment_pro_settings'),
    ('public.payment_pro_attempts'),
    ('public.payment_pro_audit'),
    ('public.bank_account_audit'),
    ('public.payment_receiving_codes'),
    ('public.payment_receiving_audit'),
    ('public.bank_qr_designs'),
    ('public.facebook_webhook_payloads'),
    ('public.facebook_webhook_events'),
    ('public.facebook_webhook_steps'),
    ('public.broadcast_messaging_events'),
    ('public.broadcast_runs'),
    ('public.broadcast_deliveries')) expected(name)
  where to_regclass(name) is not null;
  if existing is not null then
    raise exception 'Fresh database only. Existing application tables: %', existing
      using hint = 'Do not use this bundle as a production upgrade or rerun after a partial install. Use individual migrations.';
  end if;
end $fresh_database_only$;

-- ============================================================================
-- 01. schema.sql | Core schema and initial tenant security
-- SHA256: 6e212f1732cf6b5fe4e1b7d5f4e1d56c6cdcc7f6ccc950e71bc0446fd12454bc
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 1
create extension if not exists pgcrypto;

-- Source statement 2
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  platform text not null default 'facebook',
  platform_user_id text not null,
  display_name text,
  bot_enabled boolean not null default true,      
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  unique (platform, platform_user_id)
);

-- Source statement 3
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  external_id text unique,                        
  sender text not null check (sender in ('customer', 'bot', 'agent')),
  body text,
  attachments jsonb not null default '[]',
  created_at timestamptz not null default now()
);

-- Source statement 4
create index if not exists messages_customer_created on messages (customer_id, created_at);

-- Source statement 5
create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete set null,
  external_id text not null unique,               
  post_id text,
  author_name text,
  body text,
  created_at timestamptz not null default now()
);

-- Source statement 6
create index if not exists comments_created on comments (created_at desc);

-- Source statement 7
create table if not exists slips (
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
);

-- Source statement 8
create index if not exists slips_created on slips (created_at desc);

-- Source statement 9
create unique index if not exists slips_one_valid_per_ref on slips (trans_ref) where status = 'valid';

-- Source statement 10
alter table customers enable row level security;

-- Source statement 11
alter table messages  enable row level security;

-- Source statement 12
alter table comments  enable row level security;

-- Source statement 13
alter table slips     enable row level security;

-- Source statement 14
do $$ begin alter publication supabase_realtime add table customers; exception when duplicate_object then null; end $$;

-- Source statement 15
do $$ begin alter publication supabase_realtime add table messages;  exception when duplicate_object then null; end $$;

-- Source statement 16
do $$ begin alter publication supabase_realtime add table comments;  exception when duplicate_object then null; end $$;

-- Source statement 17
do $$ begin alter publication supabase_realtime add table slips;     exception when duplicate_object then null; end $$;

-- Source statement 18
insert into storage.buckets (id, name, public) values ('slips', 'slips', false) on conflict do nothing;

commit;
-- ============================================================================
-- 02. tenants.sql | Core schema and initial tenant security
-- SHA256: a21e1e3b29b2c68df7fcd1d388ec93aeab63f22140a3cb4546dc50195e23b0e7
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 1
create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  bank_code text not null,                        
  account_number text not null
    check (account_number ~ '^[0-9]+$'),          
  created_at timestamptz not null default now()
);

-- Source statement 2
alter table slips add column if not exists tenant_id uuid references tenants(id) on delete set null;

-- Source statement 3
create index if not exists slips_tenant on slips (tenant_id, created_at desc);

-- Source statement 4
alter table tenants enable row level security;

commit;
-- ============================================================================
-- 03. comment-rules.sql | Core schema and initial tenant security
-- SHA256: f694088e9cbb3a8249df863d4d73715d56a9b427c61f832ad69b859f82740aa8
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 1
create table if not exists comment_rules (
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
);

-- Source statement 2
create index if not exists comment_rules_pages on comment_rules using gin (page_ids);

-- Source statement 3
alter table comments add column if not exists rule_id uuid references comment_rules(id) on delete set null;

-- Source statement 4
create index if not exists comments_rule on comments (rule_id);

-- Source statement 5
alter table comment_rules enable row level security;

-- Source statement 6
insert into storage.buckets (id, name, public) values ('comment-media', 'comment-media', true) on conflict do nothing;

-- Source statement 7
drop policy if exists staff_upload_comment_media on storage.objects;

-- Source statement 8
create policy staff_upload_comment_media on storage.objects
  for insert to authenticated with check (bucket_id = 'comment-media');

commit;
-- ============================================================================
-- 04. platform.sql | Core schema and initial tenant security
-- SHA256: 4c2c2632ae8de14a33ff67902756d6abac54df6718bb892b2affddbb2d70f8d3
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 1
alter table tenants add column if not exists account_name text;

-- Source statement 2
alter table tenants add column if not exists page_id text unique;

-- Source statement 3
alter table tenants add column if not exists expected_amount numeric(12,2)
  check (expected_amount is null or expected_amount > 0);

-- Source statement 4
alter table tenants add column if not exists auto_reply_enabled boolean not null default true;

-- Source statement 5
alter table tenants add column if not exists auto_verify_enabled boolean not null default true;

-- Source statement 6
alter table tenants add column if not exists slip_quota integer not null default 500 check (slip_quota >= 0);

-- Source statement 7
alter table tenants add column if not exists slip_used integer not null default 0 check (slip_used >= 0);

-- Source statement 8
alter table customers add column if not exists tenant_id uuid references tenants(id) on delete set null;

-- Source statement 9
alter table customers add column if not exists phone text;

-- Source statement 10
alter table customers add column if not exists address text;

-- Source statement 11
alter table customers add column if not exists tags text[] not null default '{}';

-- Source statement 12
alter table customers add column if not exists notes text;

-- Source statement 13
alter table customers add column if not exists order_status text not null default 'new';

-- Source statement 14
alter table customers add column if not exists last_interaction_at timestamptz;

-- Source statement 15
do $$ begin
  alter table customers add constraint customers_order_status_check
    check (order_status in ('new', 'pending_review', 'paid', 'approved', 'shipped'));
exception when duplicate_object then null; end $$;

-- Source statement 16
create index if not exists customers_tenant on customers (tenant_id, last_message_at desc);

-- Source statement 17
alter table slips add column if not exists message_id uuid references messages(id) on delete set null;

-- Source statement 18
alter table slips add column if not exists approved_at timestamptz;

-- Source statement 19
alter table slips add column if not exists approved_by uuid references auth.users(id) on delete set null;

-- Source statement 20
alter table slips add column if not exists confirmed_at timestamptz;

-- Source statement 21
create index if not exists slips_customer on slips (customer_id, created_at desc);

-- Source statement 22
create index if not exists slips_message on slips (message_id);

-- Source statement 23
create or replace function consume_slip_credit(p_tenant uuid) returns boolean
language sql as $$
  with taken as (
    update tenants set slip_used = slip_used + 1
    where id = p_tenant and slip_used < slip_quota
    returning 1
  )
  select exists (select 1 from taken)
$$;

-- Source statement 24
revoke execute on function consume_slip_credit(uuid) from public, anon, authenticated;

-- Source statement 25
create or replace function refund_slip_credit(p_tenant uuid) returns void
language sql as $$
  update tenants set slip_used = slip_used - 1 where id = p_tenant and slip_used > 0
$$;

-- Source statement 26
revoke execute on function refund_slip_credit(uuid) from public, anon, authenticated;

-- Source statement 27
alter table tenants add column if not exists page_access_token text;

-- Source statement 28
alter table tenants add column if not exists page_token_set boolean
  generated always as (page_access_token is not null) stored;

commit;
-- ============================================================================
-- 05. schema_patch.sql | Core schema and initial tenant security
-- SHA256: 85060b3c689c124f0b44a262f39519e4c70b9f9b82500cd3450a2e70ffb46c29
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
alter table comments
  add column if not exists tenant_id uuid references tenants(id) on delete set null;

-- Source statement 3
create index if not exists comments_tenant on comments (tenant_id, created_at desc);

-- Source statement 4
alter table comment_rules
  add column if not exists tenant_id uuid references tenants(id) on delete cascade;

-- Source statement 5
create index if not exists comment_rules_tenant on comment_rules (tenant_id);

commit;
-- ============================================================================
-- 06. orders.sql | Core schema and initial tenant security
-- SHA256: b8d76d6e4dbb3539beb41a4eb89dab77e49b3bf3c111b3c3e30832151a0c6964
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 1
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

-- Source statement 2
create unique index if not exists products_tenant_code on products (tenant_id, lower(code));

-- Source statement 3
create table if not exists orders (
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
);

-- Source statement 4
create index if not exists orders_tenant on orders (tenant_id, created_at desc);

-- Source statement 5
create index if not exists orders_customer_pending on orders (customer_id) where status = 'pending_payment';

-- Source statement 6
create unique index if not exists orders_one_per_message on orders (message_id);

-- Source statement 7
alter table products enable row level security;

-- Source statement 8
alter table orders enable row level security;

-- Source statement 9
do $$ begin alter publication supabase_realtime add table orders; exception when duplicate_object then null; end $$;

-- Source statement 10
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

-- Source statement 11
revoke execute on function place_cf_order(uuid, uuid, uuid, text) from public, anon, authenticated;

commit;
-- ============================================================================
-- 07. automation.sql | Core schema and initial tenant security
-- SHA256: 665ac41c61ec4bf4320da06f06112304abec0cb72d5174d732bdc99863fdca8e
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 1
create table if not exists bot_settings (
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
);

-- Source statement 2
create table if not exists chat_rules (
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
);

-- Source statement 3
create index if not exists chat_rules_tenant on chat_rules (tenant_id, is_active, priority desc);

-- Source statement 4
create or replace function bump_chat_rule(p_rule uuid) returns void
language sql as $$ update chat_rules set hit_count = hit_count + 1 where id = p_rule $$;

-- Source statement 5
revoke execute on function bump_chat_rule(uuid) from public, anon, authenticated;

-- Source statement 6
alter table customers add column if not exists handover_at timestamptz;

-- Source statement 7
create index if not exists customers_handover on customers (tenant_id, handover_at) where handover_at is not null;

-- Source statement 8
create or replace function clear_handover() returns trigger language plpgsql as $$
begin
  if new.bot_enabled and not old.bot_enabled then new.handover_at := null; end if;
  return new;
end $$;

-- Source statement 9
drop trigger if exists customers_clear_handover on customers;

-- Source statement 10
create trigger customers_clear_handover before update of bot_enabled on customers
  for each row execute function clear_handover();

-- Source statement 11
create table if not exists follow_up_jobs (
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
);

-- Source statement 12
create index if not exists follow_up_jobs_due on follow_up_jobs (run_at) where status = 'scheduled';

-- Source statement 13
create index if not exists follow_up_jobs_tenant on follow_up_jobs (tenant_id, created_at desc);

-- Source statement 14
create index if not exists follow_up_jobs_customer on follow_up_jobs (customer_id) where status = 'scheduled';

-- Source statement 15
create or replace function schedule_follow_ups() returns trigger
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
end $$;

-- Source statement 16
drop trigger if exists orders_schedule_follow_ups on orders;

-- Source statement 17
create trigger orders_schedule_follow_ups after insert on orders
  for each row execute function schedule_follow_ups();

-- Source statement 18
create or replace function on_order_status() returns trigger
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
end $$;

-- Source statement 19
drop trigger if exists orders_status_change on orders;

-- Source statement 20
create trigger orders_status_change before update of status on orders
  for each row execute function on_order_status();

-- Source statement 21
create or replace function cancel_paid_follow_ups() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'pending_payment' and new.status <> 'pending_payment' and not exists (
    select 1 from orders where customer_id = new.customer_id and status = 'pending_payment'
  ) then
    update follow_up_jobs set status = 'cancelled', reason = case when new.status = 'cancelled' then 'order_cancelled' else 'paid' end
    where customer_id = new.customer_id and status = 'scheduled';
  end if;
  return null;
end $$;

-- Source statement 22
drop trigger if exists orders_cancel_follow_ups on orders;

-- Source statement 23
create trigger orders_cancel_follow_ups after update of status on orders
  for each row execute function cancel_paid_follow_ups();

-- Source statement 24
create table if not exists broadcasts (
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
);

-- Source statement 25
alter table broadcasts add column if not exists audience_window text not null default 'within_24h';

-- Source statement 26
alter table broadcasts add column if not exists message_tag text;

-- Source statement 27
alter table broadcasts add column if not exists last_error text;

-- Source statement 28
alter table broadcasts drop constraint if exists broadcasts_audience_window_check;

-- Source statement 29
alter table broadcasts add constraint broadcasts_audience_window_check check (audience_window in ('within_24h', 'outside_24h'));

-- Source statement 30
alter table broadcasts drop constraint if exists broadcasts_message_tag_check;

-- Source statement 31
alter table broadcasts add constraint broadcasts_message_tag_check check (
  (audience_window = 'within_24h' and message_tag is null)
  or (audience_window = 'outside_24h' and message_tag in ('POST_PURCHASE_UPDATE', 'CONFIRMED_EVENT_UPDATE', 'ACCOUNT_UPDATE', 'HUMAN_AGENT'))
);

-- Source statement 32
create index if not exists broadcasts_tenant on broadcasts (tenant_id, created_at desc);

-- Source statement 33
create index if not exists customers_tags on customers using gin (tags);

-- Source statement 34
create index if not exists messages_broadcast_ref on messages (external_id text_pattern_ops) where external_id like 'bc:%';

-- Source statement 35
alter table products add column if not exists description text check (length(description) <= 2000);

-- Source statement 36
alter table products add column if not exists image_url text;

-- Source statement 37
create index if not exists orders_status on orders (tenant_id, status);

-- Source statement 38
alter table bot_settings enable row level security;

-- Source statement 39
alter table chat_rules enable row level security;

-- Source statement 40
alter table follow_up_jobs enable row level security;

-- Source statement 41
alter table broadcasts enable row level security;

-- Source statement 42
do $$ begin alter publication supabase_realtime add table follow_up_jobs; exception when duplicate_object then null; end $$;

-- Source statement 43
do $$ begin alter publication supabase_realtime add table broadcasts; exception when duplicate_object then null; end $$;

-- Source statement 44
do $$ begin alter publication supabase_realtime add table products; exception when duplicate_object then null; end $$;

commit;
-- ============================================================================
-- 08. billing.sql | Core schema and initial tenant security
-- SHA256: 29ce43034a42142b202f01c31dab5e0ccb598aa8aac0ebcd115e32238df75fb6
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 1
alter table tenants add column if not exists plan text not null default 'free';

-- Source statement 2
alter table tenants drop constraint if exists tenants_plan_check;

-- Source statement 3
alter table tenants add constraint tenants_plan_check check (plan in ('free', 'starter', 'pro'));

-- Source statement 4
alter table tenants add column if not exists plan_expires_at timestamptz;

-- Source statement 5
alter table tenants add column if not exists broadcast_allowance integer not null default 100 check (broadcast_allowance >= 0);

-- Source statement 6
alter table tenants add column if not exists broadcast_credits integer not null default 100 check (broadcast_credits >= 0);

-- Source statement 7
alter table tenants add column if not exists broadcast_topup_credits integer not null default 0 check (broadcast_topup_credits >= 0);

-- Source statement 8
alter table tenants add column if not exists slip_quota_credits integer not null default 0 check (slip_quota_credits >= 0);

-- Source statement 9
alter table tenants add column if not exists broadcast_period text not null
  default to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM');

-- Source statement 10
create or replace function refresh_broadcast_credits(p_tenant uuid) returns void
language plpgsql as $$
declare
  this_month text := to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM');
begin
  update tenants set plan = 'free', plan_expires_at = null, broadcast_allowance = 100,
                     broadcast_credits = least(broadcast_credits, 100)
  where id = p_tenant and plan <> 'free' and plan_expires_at is not null and plan_expires_at <= now();
  update tenants set broadcast_credits = broadcast_allowance, broadcast_period = this_month
  where id = p_tenant and broadcast_period <> this_month;
end $$;

-- Source statement 11
create or replace function reserve_broadcast_credits(p_tenant uuid, p_count integer)
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
end $$;

-- Source statement 12
create or replace function refund_broadcast_credits(p_tenant uuid, p_monthly integer, p_topup integer) returns void
language sql as $$
  update tenants
  set broadcast_credits = least(broadcast_allowance, broadcast_credits + greatest(p_monthly, 0)),
      broadcast_topup_credits = broadcast_topup_credits + greatest(p_topup, 0)
  where id = p_tenant
$$;

-- Source statement 13
revoke execute on function refresh_broadcast_credits(uuid) from public, anon, authenticated;

-- Source statement 14
revoke execute on function reserve_broadcast_credits(uuid, integer) from public, anon, authenticated;

-- Source statement 15
revoke execute on function refund_broadcast_credits(uuid, integer, integer) from public, anon, authenticated;

-- Source statement 16
create table if not exists billing_requests (
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
);

-- Source statement 17
create index if not exists billing_requests_tenant on billing_requests (tenant_id, created_at desc);

-- Source statement 18
alter table billing_requests drop constraint if exists billing_requests_item_check;

-- Source statement 19
alter table billing_requests add constraint billing_requests_item_check
  check (item in ('starter', 'pro', 'topup_s', 'topup_m', 'topup_l', 'slip_topup_s', 'slip_topup_m', 'slip_topup_l'));

-- Source statement 20
create index if not exists billing_requests_pending on billing_requests (created_at) where status = 'pending';

-- Source statement 21
create unique index if not exists billing_requests_one_pending on billing_requests (tenant_id, item) where status = 'pending';

-- Source statement 22
create or replace function approve_billing_request(p_request uuid, p_admin uuid) returns text
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
end $$;

-- Source statement 23
revoke execute on function approve_billing_request(uuid, uuid) from public, anon, authenticated;

-- Source statement 24
alter table billing_requests enable row level security;

-- Source statement 25
do $$ begin alter publication supabase_realtime add table billing_requests; exception when duplicate_object then null; end $$;

commit;
-- ============================================================================
-- 09. security.sql | Core schema and initial tenant security
-- SHA256: ec1491b21dc305b4531e12ddb0a92ecdd38ead50b22408e211a7d9aa5326fe8c
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 1
create table if not exists platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Source statement 2
create table if not exists tenant_members (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

-- Source statement 3
create index if not exists tenant_members_user on tenant_members (user_id);

-- Source statement 4
alter table public.tenants add column if not exists is_active boolean not null default true;

-- Source statement 5
alter table platform_admins enable row level security;

-- Source statement 6
alter table tenant_members enable row level security;

-- Source statement 7
create or replace function is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid())
$$;

-- Source statement 8
create or replace function can_access_tenant(p_tenant uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_platform_admin()
      or (p_tenant is not null
          and exists (select 1 from tenants where id = p_tenant and is_active)
          and exists (select 1 from tenant_members where tenant_id = p_tenant and user_id = auth.uid()))
$$;

-- Source statement 9
revoke execute on function is_platform_admin() from public, anon;

-- Source statement 10
revoke execute on function can_access_tenant(uuid) from public, anon;

-- Source statement 11
grant execute on function is_platform_admin() to authenticated;

-- Source statement 12
grant execute on function can_access_tenant(uuid) to authenticated;

-- Source statement 13
drop policy if exists staff_read   on customers;

-- Source statement 14
drop policy if exists staff_toggle on customers;

-- Source statement 15
drop policy if exists staff_read   on messages;

-- Source statement 16
drop policy if exists staff_read   on comments;

-- Source statement 17
drop policy if exists staff_read   on slips;

-- Source statement 18
drop policy if exists staff_read   on tenants;

-- Source statement 19
drop policy if exists staff_all    on comment_rules;

-- Source statement 20
drop policy if exists own_row on platform_admins;

-- Source statement 21
create policy own_row on platform_admins for select to authenticated using (user_id = auth.uid());

-- Source statement 22
drop policy if exists member_read on tenant_members;

-- Source statement 23
create policy member_read on tenant_members for select to authenticated
  using (user_id = auth.uid() or can_access_tenant(tenant_id));

-- Source statement 24
drop policy if exists member_read on tenants;

-- Source statement 25
create policy member_read on tenants for select to authenticated using (can_access_tenant(id));

-- Source statement 26
revoke all on tenants from anon, authenticated;

-- Source statement 27
grant select (id, name, account_name, bank_code, page_id, expected_amount,
              auto_reply_enabled, auto_verify_enabled, slip_quota, slip_used, is_active, page_token_set, created_at)
  on tenants to authenticated;

-- Source statement 28
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenants' and column_name = 'page_name') then
    grant select (page_name) on public.tenants to authenticated;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenants' and column_name = 'slip_quota_credits') then
    grant select (slip_quota_credits) on public.tenants to authenticated;
  end if;
end $$;

-- Source statement 29
drop policy if exists member_read on customers;

-- Source statement 30
create policy member_read on customers for select to authenticated using (can_access_tenant(tenant_id));

-- Source statement 31
drop policy if exists member_toggle on customers;

-- Source statement 32
create policy member_toggle on customers for update to authenticated
  using (can_access_tenant(tenant_id)) with check (can_access_tenant(tenant_id));

-- Source statement 33
revoke insert, update, delete on customers from anon, authenticated;

-- Source statement 34
do $$ begin
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='customers' and column_name='conversation_version') then
    revoke update(bot_enabled) on public.customers from authenticated;
  else
    grant update(bot_enabled) on public.customers to authenticated;
  end if;
end $$;

-- Source statement 35
drop policy if exists member_read on messages;

-- Source statement 36
create policy member_read on messages for select to authenticated
  using (exists (select 1 from customers c where c.id = messages.customer_id and can_access_tenant(c.tenant_id)));

-- Source statement 37
revoke insert, update, delete on messages from anon, authenticated;

-- Source statement 38
drop policy if exists member_read on comments;

-- Source statement 39
create policy member_read on comments for select to authenticated using (can_access_tenant(tenant_id));

-- Source statement 40
revoke insert, update, delete on comments from anon, authenticated;

-- Source statement 41
drop policy if exists member_read on slips;

-- Source statement 42
create policy member_read on slips for select to authenticated using (can_access_tenant(tenant_id));

-- Source statement 43
revoke insert, update, delete on slips from anon, authenticated;

-- Source statement 44
drop policy if exists member_all on comment_rules;

-- Source statement 45
create policy member_all on comment_rules for all to authenticated
  using (can_access_tenant(tenant_id))
  with check (tenant_id is not null and can_access_tenant(tenant_id));

-- Source statement 46
drop policy if exists member_all on products;

-- Source statement 47
create policy member_all on products for all to authenticated
  using (can_access_tenant(tenant_id)) with check (can_access_tenant(tenant_id));

-- Source statement 48
drop policy if exists member_read on orders;

-- Source statement 49
create policy member_read on orders for select to authenticated using (can_access_tenant(tenant_id));

-- Source statement 50
drop policy if exists member_update on orders;

-- Source statement 51
create policy member_update on orders for update to authenticated
  using (can_access_tenant(tenant_id)) with check (can_access_tenant(tenant_id));

-- Source statement 52
revoke insert, delete on orders from anon, authenticated;

-- Source statement 53
revoke update on orders from anon, authenticated;

-- Source statement 54
grant update (status) on orders to authenticated;

-- Source statement 55
drop policy if exists member_all on bot_settings;

-- Source statement 56
create policy member_all on bot_settings for all to authenticated
  using (can_access_tenant(tenant_id)) with check (can_access_tenant(tenant_id));

-- Source statement 57
drop policy if exists member_all on chat_rules;

-- Source statement 58
create policy member_all on chat_rules for all to authenticated
  using (can_access_tenant(tenant_id)) with check (can_access_tenant(tenant_id));

-- Source statement 59
drop policy if exists member_read on follow_up_jobs;

-- Source statement 60
create policy member_read on follow_up_jobs for select to authenticated using (can_access_tenant(tenant_id));

-- Source statement 61
drop policy if exists member_cancel on follow_up_jobs;

-- Source statement 62
create policy member_cancel on follow_up_jobs for update to authenticated
  using (can_access_tenant(tenant_id) and status = 'scheduled')
  with check (can_access_tenant(tenant_id) and status = 'cancelled');

-- Source statement 63
revoke insert, update, delete on follow_up_jobs from anon, authenticated;

-- Source statement 64
grant update (status, reason) on follow_up_jobs to authenticated;

-- Source statement 65
drop policy if exists member_read on broadcasts;

-- Source statement 66
create policy member_read on broadcasts for select to authenticated using (can_access_tenant(tenant_id));

-- Source statement 67
drop policy if exists member_draft on broadcasts;

-- Source statement 68
create policy member_draft on broadcasts for insert to authenticated
  with check (can_access_tenant(tenant_id) and status = 'draft');

-- Source statement 69
drop policy if exists member_edit_draft on broadcasts;

-- Source statement 70
create policy member_edit_draft on broadcasts for update to authenticated
  using (can_access_tenant(tenant_id) and status = 'draft') with check (can_access_tenant(tenant_id) and status = 'draft');

-- Source statement 71
drop policy if exists member_delete_draft on broadcasts;

-- Source statement 72
create policy member_delete_draft on broadcasts for delete to authenticated
  using (can_access_tenant(tenant_id) and status = 'draft');

-- Source statement 73
revoke insert, update, delete on broadcasts from anon, authenticated;

-- Source statement 74
grant insert (tenant_id, name, message, audience_segment, audience_tags, audience_window, message_tag, created_by) on broadcasts to authenticated;

-- Source statement 75
grant update (name, message, audience_segment, audience_tags, audience_window, message_tag) on broadcasts to authenticated;

-- Source statement 76
grant delete on broadcasts to authenticated;

-- Source statement 77
do $$ begin
  if to_regclass('public.billing_requests') is not null then
    drop policy if exists member_read on billing_requests;
    create policy member_read on billing_requests for select to authenticated using (can_access_tenant(tenant_id));
    revoke insert, update, delete on billing_requests from anon, authenticated;
  end if;
end $$;

commit;
-- ============================================================================
-- 10. facebook-connect.sql | Facebook, billing, bank accounts and feature security
-- SHA256: bb849ab652fa428cdd6afd02599e666856bf8ede3ee122269988c9cf10433feb
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 1
create table if not exists facebook_pages (
  user_id uuid not null references auth.users(id) on delete cascade,
  page_id text not null,
  name text not null,
  picture text,
  access_token text not null,                   
  connected_at timestamptz not null default now(),
  primary key (user_id, page_id)
);

-- Source statement 2
alter table facebook_pages enable row level security;

-- Source statement 3
revoke all on facebook_pages from anon, authenticated;

commit;
-- ============================================================================
-- 11. facebook-tenants.sql | Facebook, billing, bank accounts and feature security
-- SHA256: 6d97183c5a95c2341b0795c7c185615a25d68f4127c02db9836e62b9a599c9f0
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
do $$ begin
  if to_regclass('public.tenants') is null or to_regclass('public.tenant_members') is null
     or to_regclass('public.platform_admins') is null
     or to_regprocedure('public.can_access_tenant(uuid)') is null then
    raise exception 'Run tenants.sql, platform.sql and security.sql before facebook-tenants.sql';
  end if;
end $$;

-- Source statement 3
alter table public.tenants alter column bank_code drop not null;

-- Source statement 4
alter table public.tenants alter column account_number drop not null;

-- Source statement 5
alter table public.tenants add column if not exists page_name text;

-- Source statement 6
do $$ begin
  if not exists (
    select 1 from pg_catalog.pg_index i
    join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attname = 'page_id'
    where i.indrelid = 'public.tenants'::regclass and i.indisunique and i.indisvalid
      and i.indpred is null and i.indexprs is null and i.indnkeyatts = 1 and i.indkey[0] = a.attnum
  ) then
    create unique index tenants_page_id_oauth_key on public.tenants (page_id);
  end if;
end $$;

-- Source statement 7
alter table public.tenants enable row level security;

-- Source statement 8
alter table public.tenant_members enable row level security;

-- Source statement 9
drop policy if exists member_read on public.tenants;

-- Source statement 10
create policy member_read on public.tenants for select to authenticated using (public.can_access_tenant(id));

-- Source statement 11
drop policy if exists member_read on public.tenant_members;

-- Source statement 12
create policy member_read on public.tenant_members for select to authenticated
  using (user_id = auth.uid() or public.can_access_tenant(tenant_id));

-- Source statement 13
revoke all on public.tenants from anon, authenticated;

-- Source statement 14
revoke select (page_access_token) on public.tenants from anon, authenticated;

-- Source statement 15
grant select (id, name, account_name, bank_code, page_id, page_name, expected_amount,
              auto_reply_enabled, auto_verify_enabled, slip_quota, slip_used, page_token_set, created_at)
  on public.tenants to authenticated;

-- Source statement 16
grant select on public.tenant_members to authenticated;

-- Source statement 17
create or replace function public.sync_facebook_tenants(p_user_id uuid, p_pages jsonb)


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
$$;

-- Source statement 18
alter function public.sync_facebook_tenants(uuid, jsonb) owner to postgres;

-- Source statement 19
revoke all on function public.sync_facebook_tenants(uuid, jsonb) from public, anon, authenticated;

-- Source statement 20
grant execute on function public.sync_facebook_tenants(uuid, jsonb) to service_role;

-- Source statement 21
notify pgrst, 'reload schema';

commit;
-- ============================================================================
-- 12. facebook-multi-admin.sql | Facebook, billing, bank accounts and feature security
-- SHA256: 9dffbc3d72cea2d237cbfc85dba2869abab1ab147f1766a8ce33b6fff5e8b644
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create or replace function public.sync_facebook_tenants(p_user_id uuid, p_pages jsonb)


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
$$;

-- Source statement 3
alter function public.sync_facebook_tenants(uuid, jsonb) owner to postgres;

-- Source statement 4
revoke all on function public.sync_facebook_tenants(uuid, jsonb) from public, anon, authenticated;

-- Source statement 5
grant execute on function public.sync_facebook_tenants(uuid, jsonb) to service_role;

-- Source statement 6
notify pgrst, 'reload schema';

commit;
-- ============================================================================
-- 13. customer-profiles.sql | Facebook, billing, bank accounts and feature security
-- SHA256: 5f997557ed4cca29fece1b20d74c0abd48e3a13df57f3489fe17204165c0b4fa
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
alter table public.customers add column if not exists avatar_url text;

-- Source statement 3
grant select (avatar_url) on public.customers to authenticated;

-- Source statement 4
grant update (avatar_url) on public.customers to service_role;

commit;
-- ============================================================================
-- 14. customer-gender.sql | Facebook, billing, bank accounts and feature security
-- SHA256: 4c43982b49d3f2b104be17c39077de05a56ffd69724e17ded105a755d2cea757
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
alter table public.customers add column if not exists gender text;

-- Source statement 3
comment on column public.customers.gender is 'Customer-provided gender: male / female; NULL or other values are unspecified in overview. Never infer from name or avatar.';

commit;
-- ============================================================================
-- 15. payments.sql | Facebook, billing, bank accounts and feature security
-- SHA256: beed8aa96a89ed77807a78f3c4ccc78a47f8bfaa5c19c585cf6d8552fa7a8fb8
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
alter table public.tenants add column if not exists broadcast_credit_mode text not null
  default 'calendar' check (broadcast_credit_mode in ('calendar', 'purchased'));

-- Source statement 3
create table if not exists public.payment_sessions (
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
);

-- Source statement 4
create index if not exists payment_sessions_tenant on public.payment_sessions (tenant_id, created_at desc);

-- Source statement 5
create table if not exists public.payment_receipts (
  session_id uuid primary key references public.payment_sessions(id) on delete restrict,
  trans_ref text not null unique check (length(trim(trans_ref)) between 1 and 200 and trans_ref = trim(trans_ref)),
  image_sha256 text not null unique check (image_sha256 ~ '^[0-9a-f]{64}$'),
  amount numeric(12,2) not null check (amount > 0),
  paid_at timestamptz not null,
  verified_at timestamptz not null default now(),
  applied_at timestamptz
);

-- Source statement 6
create table if not exists public.payment_transfer_ledger (
  trans_ref text primary key,
  source text not null check (source in ('package', 'sale')),
  source_id uuid not null,
  created_at timestamptz not null default now(),
  unique (source, source_id)
);

-- Source statement 11
create or replace function public.claim_payment_transfer(p_ref text, p_source text, p_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  insert into public.payment_transfer_ledger (trans_ref, source, source_id)
  values (p_ref, p_source, p_id) on conflict do nothing;
  if not exists (select 1 from public.payment_transfer_ledger
                 where trans_ref = p_ref and source = p_source and source_id = p_id) then
    raise exception 'Transfer already accepted' using errcode = '23505';
  end if;
end $$;

-- Source statement 12
create or replace function public.guard_payment_receipt() returns trigger
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
end $$;

-- Source statement 13
drop trigger if exists payment_receipts_guard on public.payment_receipts;

-- Source statement 14
create trigger payment_receipts_guard before insert or update on public.payment_receipts
for each row execute function public.guard_payment_receipt();

-- Source statement 15
create or replace function public.guard_sale_payment_transfer() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.status = 'valid' then
    if new.trans_ref is null or length(trim(new.trans_ref)) = 0 then
      raise exception 'Accepted slip requires a bank transaction reference';
    end if;
    perform public.claim_payment_transfer(new.trans_ref, 'sale', new.id);
  end if;
  return new;
end $$;

-- Source statement 16
drop trigger if exists slips_payment_transfer_guard on public.slips;

-- Source statement 17
create trigger slips_payment_transfer_guard before insert or update on public.slips
for each row execute function public.guard_sale_payment_transfer();

-- Source statement 18
create or replace function public.refresh_broadcast_credits(p_tenant uuid) returns void
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
end $$;

-- Source statement 19
create or replace function public.reserve_broadcast_credits(p_tenant uuid, p_count integer)
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
end $$;

-- Source statement 20
create or replace function public.refund_broadcast_credits(p_tenant uuid, p_monthly integer, p_topup integer)
returns void language plpgsql set search_path = pg_catalog, public as $$
begin
  perform public.refresh_broadcast_credits(p_tenant);
  update public.tenants set
    broadcast_credits = case when broadcast_credit_mode = 'purchased'
      then broadcast_credits + greatest(coalesce(p_monthly, 0), 0)
      else least(broadcast_allowance, broadcast_credits + greatest(coalesce(p_monthly, 0), 0)) end,
    broadcast_topup_credits = broadcast_topup_credits + greatest(coalesce(p_topup, 0), 0)
  where id = p_tenant;
end $$;

-- Source statement 21
create or replace function public.activate_payment(p_session uuid) returns jsonb
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
end $$;

-- Source statement 22
create or replace function public.payment_legacy_credit_mode() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.status = 'approved' and old.status <> 'approved' and new.item in ('starter', 'pro') then
    update public.tenants set broadcast_credit_mode = 'purchased' where id = new.tenant_id;
  end if;
  return new;
end $$;

-- Source statement 23
drop trigger if exists billing_requests_credit_mode on public.billing_requests;

-- Source statement 24
create trigger billing_requests_credit_mode after update on public.billing_requests
for each row execute function public.payment_legacy_credit_mode();

-- Source statement 25
alter table public.payment_sessions enable row level security;

-- Source statement 26
alter table public.payment_receipts enable row level security;

-- Source statement 27
alter table public.payment_transfer_ledger enable row level security;

-- Source statement 28
revoke all on public.payment_sessions, public.payment_receipts, public.payment_transfer_ledger from public, anon, authenticated, service_role;

-- Source statement 29
grant select, insert, update on public.payment_sessions to service_role;

-- Source statement 30
grant select, insert on public.payment_receipts to service_role;

-- Source statement 31
grant update (applied_at) on public.payment_receipts to service_role;

-- Source statement 32
grant select on public.payment_transfer_ledger to service_role;

-- Source statement 33
revoke all on function public.claim_payment_transfer(text, text, uuid),
  public.guard_payment_receipt(), public.guard_sale_payment_transfer(), public.payment_legacy_credit_mode()
  from public, anon, authenticated, service_role;

-- Source statement 34
revoke all on function public.activate_payment(uuid), public.refresh_broadcast_credits(uuid),
  public.reserve_broadcast_credits(uuid, integer), public.refund_broadcast_credits(uuid, integer, integer)
  from public, anon, authenticated;

-- Source statement 35
grant execute on function public.activate_payment(uuid), public.refresh_broadcast_credits(uuid),
  public.reserve_broadcast_credits(uuid, integer), public.refund_broadcast_credits(uuid, integer, integer)
  to service_role;

commit;
-- ============================================================================
-- 16. ai-agent-gate.sql | Facebook, billing, bank accounts and feature security
-- SHA256: 98a7375726bbe02bb525cf6db18f3acf81860ae1e6da1304345c1395265a5387
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create or replace function public.guard_ai_agent_plan() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  return new;
end $$;

-- Source statement 3
revoke all on function public.guard_ai_agent_plan() from public, anon, authenticated, service_role;

-- Source statement 4
drop trigger if exists bot_settings_ai_plan_gate on public.bot_settings;

-- Source statement 5
create trigger bot_settings_ai_plan_gate before insert or update on public.bot_settings
for each row execute function public.guard_ai_agent_plan();

commit;
-- ============================================================================
-- 17. admin-feature-bypass.sql | Facebook, billing, bank accounts and feature security
-- SHA256: 505b9b486b51a29042e87df33caec70510921bad9f9b9a58fa3f4cc7eaee9c94
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

-- Source statement 3
revoke all on function public.is_platform_admin() from public, anon;

-- Source statement 4
grant execute on function public.is_platform_admin() to authenticated, service_role;

-- Source statement 5
create or replace function public.tenant_has_feature_bypass(p_tenant uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1 from public.tenant_members m
    join public.platform_admins a on a.user_id = m.user_id
    where m.tenant_id = p_tenant and m.role = 'owner'
  )
$$;

-- Source statement 6
revoke all on function public.tenant_has_feature_bypass(uuid) from public, anon, authenticated;

-- Source statement 7
grant execute on function public.tenant_has_feature_bypass(uuid) to service_role;

-- Source statement 8
do $$
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
end $$;

-- Source statement 9
create or replace function public.consume_slip_credit(p_tenant uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if public.is_platform_admin() or public.tenant_has_feature_bypass(p_tenant) then return true; end if;
  return public.consume_slip_credit_metered(p_tenant);
end $$;

-- Source statement 10
create or replace function public.refund_slip_credit(p_tenant uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if public.is_platform_admin() or public.tenant_has_feature_bypass(p_tenant) then return; end if;
  perform public.refund_slip_credit_metered(p_tenant);
end $$;

-- Source statement 11
create or replace function public.reserve_broadcast_credits(p_tenant uuid, p_count integer)
returns table(monthly integer, topup integer)
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if public.is_platform_admin() or public.tenant_has_feature_bypass(p_tenant) then
    return query select greatest(coalesce(p_count, 0), 0), 0;
    return;
  end if;
  return query select * from public.reserve_broadcast_credits_metered(p_tenant, p_count);
end $$;

-- Source statement 12
create or replace function public.refund_broadcast_credits(p_tenant uuid, p_monthly integer, p_topup integer)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if public.is_platform_admin() or public.tenant_has_feature_bypass(p_tenant) then return; end if;
  perform public.refund_broadcast_credits_metered(p_tenant, p_monthly, p_topup);
end $$;

-- Source statement 13
revoke all on function public.consume_slip_credit_metered(uuid), public.refund_slip_credit_metered(uuid),
  public.reserve_broadcast_credits_metered(uuid, integer), public.refund_broadcast_credits_metered(uuid, integer, integer)
  from public, anon, authenticated, service_role;

-- Source statement 14
revoke all on function public.consume_slip_credit(uuid), public.refund_slip_credit(uuid),
  public.reserve_broadcast_credits(uuid, integer), public.refund_broadcast_credits(uuid, integer, integer)
  from public, anon, authenticated;

-- Source statement 15
grant execute on function public.consume_slip_credit(uuid), public.refund_slip_credit(uuid),
  public.reserve_broadcast_credits(uuid, integer), public.refund_broadcast_credits(uuid, integer, integer)
  to service_role;

-- Source statement 16
create or replace function public.guard_ai_agent_plan() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  return new;
end $$;

-- Source statement 17
revoke all on function public.guard_ai_agent_plan() from public, anon, authenticated, service_role;

-- Source statement 18
do $$ declare definition text; begin
  definition := pg_get_functiondef('public.approve_billing_request(uuid,uuid)'::regprocedure);
  definition := replace(definition, 'if t.plan = ''free'' then',
    'if t.plan = ''free'' and not public.is_platform_admin() and not public.tenant_has_feature_bypass(r.tenant_id) then');
  execute definition;
end $$;

commit;
-- ============================================================================
-- 18. billing-slip-topups.sql | Facebook, billing, bank accounts and feature security
-- SHA256: eec994d75fd515114f9425e463de7983a59a66c13b04ec742f958fb821f2da27
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
alter table public.tenants add column if not exists slip_quota_credits integer not null default 0
  check (slip_quota_credits >= 0);

-- Source statement 3
alter table public.billing_requests drop constraint if exists billing_requests_item_check;

-- Source statement 4
alter table public.billing_requests add constraint billing_requests_item_check
  check (item in ('starter', 'pro', 'topup_s', 'topup_m', 'topup_l', 'slip_topup_s', 'slip_topup_m', 'slip_topup_l'));

-- Source statement 5
grant select (slip_quota_credits) on public.tenants to authenticated;

-- Source statement 6
do $$
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
end $$;

-- Source statement 7
do $$
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
end $$;

-- Source statement 8
revoke all on function public.approve_billing_request(uuid, uuid) from public, anon, authenticated;

-- Source statement 9
grant execute on function public.approve_billing_request(uuid, uuid) to service_role;

commit;
-- ============================================================================
-- 19. platform-dashboard.sql | Facebook, billing, bank accounts and feature security
-- SHA256: 115e3a8815ed8c6dfb15d25ccce5f4568e89fdcdc28dccedc3fde06364dd01ce
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
alter table public.tenants add column if not exists is_active boolean not null default true;

-- Source statement 3
alter table public.billing_requests add column if not exists proof_path text;

-- Source statement 4
alter table public.billing_requests add column if not exists proof_uploaded_at timestamptz;

-- Source statement 5
grant select (is_active) on public.tenants to authenticated;

-- Source statement 6
create table if not exists public.platform_tenant_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete set null,
  admin_id uuid references auth.users(id) on delete set null,
  before_state jsonb not null,
  after_state jsonb not null,
  created_at timestamptz not null default now()
);

-- Source statement 7
alter table public.platform_tenant_audit enable row level security;

-- Source statement 8
revoke all on public.platform_tenant_audit from anon, authenticated;

-- Source statement 9
grant select, insert on public.platform_tenant_audit to service_role;

-- Source statement 10
create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

-- Source statement 11
revoke all on function public.is_platform_admin() from public, anon;

-- Source statement 12
grant execute on function public.is_platform_admin() to authenticated, service_role;

-- Source statement 13
create or replace function public.can_access_tenant(p_tenant uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select public.is_platform_admin() or (
    p_tenant is not null
    and exists (select 1 from public.tenants where id = p_tenant and is_active)
    and exists (select 1 from public.tenant_members where tenant_id = p_tenant and user_id = auth.uid())
  )
$$;

-- Source statement 14
revoke all on function public.can_access_tenant(uuid) from public, anon;

-- Source statement 15
grant execute on function public.can_access_tenant(uuid) to authenticated;

-- Source statement 16
create or replace function public.platform_dashboard_overview() returns jsonb
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
$$;

-- Source statement 17
revoke all on function public.platform_dashboard_overview() from public, anon, authenticated;

-- Source statement 18
grant execute on function public.platform_dashboard_overview() to service_role;

-- Source statement 19
create or replace function public.platform_update_tenant(
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
end $$;

-- Source statement 20
revoke all on function public.platform_update_tenant(uuid,uuid,text,boolean) from public, anon, authenticated;

-- Source statement 21
grant execute on function public.platform_update_tenant(uuid,uuid,text,boolean) to service_role;

-- Source statement 22
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('billing-proofs','billing-proofs',false,5242880,array['image/jpeg','image/png','image/webp'])
  on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;

commit;
-- ============================================================================
-- 20. platform-admin-db-only.sql | Facebook, billing, bank accounts and feature security
-- SHA256: 560dbeeb0cab3c2302461257f01e139c0826b1d4f693d8a9def7801d9b529236
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

-- Source statement 3
create or replace function public.tenant_has_feature_bypass(p_tenant uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1 from public.tenant_members m
    join public.platform_admins a on a.user_id = m.user_id
    where m.tenant_id = p_tenant and m.role = 'owner'
  )
$$;

-- Source statement 4
create or replace function public.platform_update_tenant(
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
end $$;

-- Source statement 5
revoke all on function public.is_platform_admin() from public, anon;

-- Source statement 6
grant execute on function public.is_platform_admin() to authenticated, service_role;

-- Source statement 7
revoke all on function public.tenant_has_feature_bypass(uuid), public.platform_update_tenant(uuid,uuid,text,boolean) from public, anon, authenticated;

-- Source statement 8
grant execute on function public.tenant_has_feature_bypass(uuid), public.platform_update_tenant(uuid,uuid,text,boolean) to service_role;

-- Source statement 9
notify pgrst, 'reload schema';

commit;
-- ============================================================================
-- 21. billing-auto-approval.sql | Facebook, billing, bank accounts and feature security
-- SHA256: a4ca6ff4e6b74ae24d0a8dd45b66bcd3805e880cff8c9c389de9929dc6d78181
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
alter table public.billing_requests add column if not exists receiver_promptpay_id text;

-- Source statement 3
alter table public.billing_requests add column if not exists receiver_account_no text;

-- Source statement 4
alter table public.billing_requests add column if not exists receiver_bank_code text;

-- Source statement 5
alter table public.billing_requests add column if not exists verification_status text not null default 'pending'
  check (verification_status in ('pending','failed','verified'));

-- Source statement 6
alter table public.billing_requests add column if not exists verification_error text;

-- Source statement 7
alter table public.billing_requests add column if not exists proof_sha256 text check (proof_sha256 ~ '^[0-9a-f]{64}$');

-- Source statement 8
alter table public.payment_transfer_ledger drop constraint if exists payment_transfer_ledger_source_check;

-- Source statement 9
alter table public.payment_transfer_ledger add constraint payment_transfer_ledger_source_check
  check (source in ('package','sale','billing'));

-- Source statement 10
create table if not exists public.payment_image_ledger (
  image_sha256 text primary key check (image_sha256 ~ '^[0-9a-f]{64}$'),
  source text not null check (source in ('package','billing')),
  source_id uuid not null,
  created_at timestamptz not null default now()
);

-- Source statement 11
alter table public.payment_image_ledger enable row level security;

-- Source statement 12
revoke all on public.payment_image_ledger from anon,authenticated;

-- Source statement 13
grant select,insert on public.payment_image_ledger to service_role;

-- Source statement 17
create or replace function public.claim_payment_image(p_hash text,p_source text,p_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog,public as $$
begin
  insert into public.payment_image_ledger(image_sha256,source,source_id) values(p_hash,p_source,p_id) on conflict do nothing;
  if not exists(select 1 from public.payment_image_ledger where image_sha256=p_hash and source=p_source and source_id=p_id) then
    raise exception 'Image already accepted' using errcode='23505';
  end if;
end $$;

-- Source statement 18
create or replace function public.guard_package_payment_image() returns trigger
language plpgsql security definer set search_path = pg_catalog,public as $$
begin
  perform public.claim_payment_image(new.image_sha256,'package',new.session_id);
  return new;
end $$;

-- Source statement 19
drop trigger if exists payment_receipts_image_guard on public.payment_receipts;

-- Source statement 20
create trigger payment_receipts_image_guard before insert on public.payment_receipts
for each row execute function public.guard_package_payment_image();

-- Source statement 21
do $$ declare definition text; begin
  definition := pg_get_functiondef('public.guard_payment_receipt()'::regprocedure);
  execute replace(definition,'new.amount <> s.price_baht','new.amount < s.price_baht');
  definition := pg_get_functiondef('public.activate_payment(uuid)'::regprocedure);
  execute replace(definition,'r.amount <> s.price_baht','r.amount < s.price_baht');
end $$;

-- Source statement 22
create table if not exists public.billing_payment_receipts (
  request_id uuid primary key references public.billing_requests(id) on delete restrict,
  trans_ref text not null unique check (length(trim(trans_ref)) between 1 and 200 and trans_ref=trim(trans_ref)),
  image_sha256 text not null unique check (image_sha256 ~ '^[0-9a-f]{64}$'),
  amount numeric(12,2) not null check (amount>0),
  paid_at timestamptz not null,
  verified_at timestamptz not null default now(),
  applied_at timestamptz
);

-- Source statement 23
alter table public.billing_payment_receipts enable row level security;

-- Source statement 24
revoke all on public.billing_payment_receipts from anon,authenticated;

-- Source statement 25
grant select,insert,update on public.billing_payment_receipts to service_role;

-- Source statement 26
create or replace function public.guard_billing_payment_receipt() returns trigger
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
end $$;

-- Source statement 27
drop trigger if exists billing_payment_receipts_guard on public.billing_payment_receipts;

-- Source statement 28
create trigger billing_payment_receipts_guard before insert or update on public.billing_payment_receipts
for each row execute function public.guard_billing_payment_receipt();

-- Source statement 29
create or replace function public.guard_billing_approved_image() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.status='approved' and old.status<>'approved' and new.proof_sha256 is not null then
    perform public.claim_payment_image(new.proof_sha256,'billing',new.id);
  end if;
  return new;
end $$;

-- Source statement 30
drop trigger if exists billing_requests_approved_image_guard on public.billing_requests;

-- Source statement 31
create trigger billing_requests_approved_image_guard before update on public.billing_requests
for each row execute function public.guard_billing_approved_image();

-- Source statement 32
create or replace function public.activate_billing_payment(p_request uuid) returns boolean
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
end $$;

-- Source statement 33
revoke all on function public.activate_billing_payment(uuid),public.claim_payment_image(text,text,uuid),
  public.guard_package_payment_image(),public.guard_billing_payment_receipt(),public.guard_billing_approved_image() from public,anon,authenticated;

-- Source statement 34
grant execute on function public.activate_billing_payment(uuid) to service_role;

commit;
-- ============================================================================
-- 22. bank-accounts.sql | Facebook, billing, bank accounts and feature security
-- SHA256: 9c383587c7273304231ed76384c0222584dd69c03088a3ce5ac29f8bfcdbf540
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
alter table public.tenants alter column bank_code drop not null;

-- Source statement 3
alter table public.tenants alter column account_number drop not null;

-- Source statement 4
create table if not exists public.bank_accounts (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
 bank_code text not null check(bank_code in ('KBANK','SCB','BBL','KTB','BAY','TTB','GSB','PROMPTPAY')),
 account_name text not null check(length(trim(account_name)) between 1 and 120),
 account_number text not null check(account_number ~ '^[0-9]{10,15}$'),
 is_active boolean not null default true, created_at timestamptz not null default now(),
 unique(tenant_id,bank_code,account_number)
);

-- Source statement 5
alter table public.bank_accounts enable row level security;

-- Source statement 6
create index if not exists bank_accounts_active on public.bank_accounts(tenant_id,is_active);

-- Source statement 7
create or replace function public.can_manage_bank_accounts(p_tenant uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select public.is_platform_admin() or (public.can_access_tenant(p_tenant) and exists(
 select 1 from public.tenant_members where tenant_id=p_tenant and user_id=auth.uid() and role='owner'))
$$;

-- Source statement 8
revoke all on function public.can_manage_bank_accounts(uuid) from public,anon;

-- Source statement 9
grant execute on function public.can_manage_bank_accounts(uuid) to authenticated;

-- Source statement 10
drop policy if exists member_read on public.bank_accounts;

-- Source statement 11
create policy member_read on public.bank_accounts for select to authenticated using(public.can_access_tenant(tenant_id));

-- Source statement 12
drop policy if exists owner_write on public.bank_accounts;

-- Source statement 13
create policy owner_write on public.bank_accounts for all to authenticated using(public.can_manage_bank_accounts(tenant_id)) with check(public.can_manage_bank_accounts(tenant_id));

-- Source statement 14
revoke all on public.bank_accounts from anon;

-- Source statement 15
grant select,insert,update,delete on public.bank_accounts to authenticated,service_role;

-- Source statement 16
alter table public.tenants add column if not exists bank_accounts_migrated boolean not null default false;

-- Source statement 19
create or replace function public.sync_primary_bank_account() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare target uuid; selected public.bank_accounts;
begin
 target:=case when tg_op='DELETE' then old.tenant_id else new.tenant_id end;
 if tg_op='UPDATE' and new.tenant_id<>old.tenant_id then raise exception 'Cannot move bank accounts between shops'; end if;
 perform 1 from public.tenants where id=target for update;
 select * into selected from public.bank_accounts where tenant_id=target and is_active order by created_at,id limit 1;
 update public.tenants set bank_code=selected.bank_code,account_name=selected.account_name,account_number=selected.account_number where id=target;
 return null;
end $$;

-- Source statement 20
drop trigger if exists bank_accounts_primary on public.bank_accounts;

-- Source statement 21
create trigger bank_accounts_primary after insert or update or delete on public.bank_accounts for each row execute function public.sync_primary_bank_account();

-- Source statement 22
create or replace function public.seed_tenant_bank_account() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 update public.tenants set bank_accounts_migrated=true where id=new.id;
 if new.bank_code in ('KBANK','SCB','BBL','KTB','BAY','TTB','GSB','PROMPTPAY') and new.account_number ~ '^[0-9]{10,15}$' then
 insert into public.bank_accounts(tenant_id,bank_code,account_name,account_number) values(new.id,new.bank_code,coalesce(nullif(trim(new.account_name),''),new.name),new.account_number) on conflict do nothing;
 end if;
 return null;
end $$;

-- Source statement 23
drop trigger if exists tenants_seed_bank_account on public.tenants;

-- Source statement 24
create trigger tenants_seed_bank_account after insert on public.tenants for each row execute function public.seed_tenant_bank_account();

-- Source statement 25
revoke all on function public.sync_primary_bank_account(),public.seed_tenant_bank_account() from public,anon,authenticated;

commit;
-- ============================================================================
-- 23. image-response-rules.sql | Facebook, billing, bank accounts and feature security
-- SHA256: 6ac37623854295af127243c2f8d21167f01de236a6c9eeeb6d8cf751347a93fe
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create table if not exists public.image_response_rules (
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
);

-- Source statement 3
create index if not exists image_response_rules_tenant on public.image_response_rules(tenant_id,created_at desc);

-- Source statement 4
alter table public.image_response_rules enable row level security;

-- Source statement 5
create or replace function public.can_manage_image_rules(p_tenant uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
  select public.is_platform_admin() or (public.can_access_tenant(p_tenant) and exists(
    select 1 from public.tenant_members where tenant_id=p_tenant and user_id=auth.uid() and role='owner'
  ))
$$;

-- Source statement 6
revoke all on function public.can_manage_image_rules(uuid) from public,anon;

-- Source statement 7
grant execute on function public.can_manage_image_rules(uuid) to authenticated;

-- Source statement 8
drop policy if exists member_read on public.image_response_rules;

-- Source statement 9
create policy member_read on public.image_response_rules for select to authenticated using(public.can_access_tenant(tenant_id));

-- Source statement 10
drop policy if exists owner_insert on public.image_response_rules;

-- Source statement 11
create policy owner_insert on public.image_response_rules for insert to authenticated with check(public.can_manage_image_rules(tenant_id));

-- Source statement 12
drop policy if exists owner_update on public.image_response_rules;

-- Source statement 13
create policy owner_update on public.image_response_rules for update to authenticated using(public.can_manage_image_rules(tenant_id)) with check(public.can_manage_image_rules(tenant_id));

-- Source statement 14
drop policy if exists owner_delete on public.image_response_rules;

-- Source statement 15
create policy owner_delete on public.image_response_rules for delete to authenticated using(public.can_manage_image_rules(tenant_id));

-- Source statement 16
grant select,insert,update,delete on public.image_response_rules to authenticated,service_role;

-- Source statement 17
revoke all on public.image_response_rules from anon;

-- Source statement 18
create or replace function public.touch_image_response_rule() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin new.updated_at=now(); new.created_at=old.created_at; return new; end $$;

-- Source statement 19
drop trigger if exists image_response_rules_updated on public.image_response_rules;

-- Source statement 20
create trigger image_response_rules_updated before update on public.image_response_rules
for each row execute function public.touch_image_response_rule();

-- Source statement 21
revoke all on function public.touch_image_response_rule() from public,anon,authenticated;

commit;
-- ============================================================================
-- 24. followup-plan-gate.sql | Facebook, billing, bank accounts and feature security
-- SHA256: 8722938e430e15924bae4bb6bb40330ff247996564aa94ba803b01b59296f96f
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create or replace function public.guard_followup_plan() returns trigger
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
end $$;

-- Source statement 3
revoke all on function public.guard_followup_plan() from public, anon, authenticated, service_role;

-- Source statement 4
drop trigger if exists bot_settings_followup_plan_gate on public.bot_settings;

-- Source statement 5
create trigger bot_settings_followup_plan_gate before insert or update of followup_enabled, followup_steps
on public.bot_settings for each row execute function public.guard_followup_plan();

commit;
-- ============================================================================
-- 25. package-access.sql | Facebook, billing, bank accounts and feature security
-- SHA256: 31174caa94e6407b3cf95e13f96ca1264d826309acc529310a5df06f75bcf16b
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create or replace function public.approve_billing_request(p_request uuid, p_admin uuid) returns text
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
end $$;

-- Source statement 3
create or replace function public.payment_legacy_credit_mode() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.status = 'approved' and old.status <> 'approved' and new.item in ('starter', 'pro') then
    update public.tenants set broadcast_credit_mode = 'purchased' where id = new.tenant_id;
  end if;
  return new;
end $$;

-- Source statement 4
create or replace function public.guard_ai_agent_plan() returns trigger language plpgsql set search_path=pg_catalog,public as $$ begin return new; end $$;

-- Source statement 5
revoke all on function public.approve_billing_request(uuid,uuid) from public,anon,authenticated;

-- Source statement 6
grant execute on function public.approve_billing_request(uuid,uuid) to service_role;

-- Source statement 7
revoke all on function public.guard_ai_agent_plan() from public,anon,authenticated,service_role;

commit;
-- ============================================================================
-- 26. feature-access.sql | Facebook, billing, bank accounts and feature security
-- SHA256: dc491c46c80669e9f8f62230d1d822fb0c67d9605e2dc2fc22154f4616444ff7
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create table if not exists public.plan_features (
  plan text not null check (plan in ('starter','pro')),
  feature text not null check (feature in ('ai_agent','image_assistant','customer_management','slip_auto_pilot','customer_follow_up')),
  enabled boolean not null default false,
  primary key(plan,feature)
);

-- Source statement 3
alter table public.plan_features enable row level security;

-- Source statement 4
alter table public.plan_features drop constraint if exists plan_features_feature_check;

-- Source statement 5
alter table public.plan_features add constraint plan_features_feature_check check(feature in ('ai_agent','image_assistant','customer_management','slip_auto_pilot','customer_follow_up'));

-- Source statement 6
revoke all on public.plan_features from public,anon,authenticated;

-- Source statement 7
grant select,insert,update,delete on public.plan_features to service_role;

-- Source statement 8
insert into public.plan_features(plan,feature,enabled) values
 ('pro','ai_agent',true),('starter','slip_auto_pilot',true),('pro','slip_auto_pilot',true),
 ('starter','image_assistant',true),('pro','image_assistant',true),
 ('starter','customer_management',true),('pro','customer_management',true),
 ('starter','customer_follow_up',true),('pro','customer_follow_up',true)
on conflict(plan,feature) do nothing;

-- Source statement 9
create or replace function public.has_tenant_feature(p_tenant uuid,p_feature text) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.tenants t join public.plan_features f on f.plan=t.plan
   where t.id=p_tenant and t.is_active and t.plan<>'free'
     and t.plan_expires_at>now() and f.feature=p_feature and f.enabled)
$$;

-- Source statement 10
revoke all on function public.has_tenant_feature(uuid,text) from public,anon;

-- Source statement 11
grant execute on function public.has_tenant_feature(uuid,text) to authenticated,service_role;

-- Source statement 12
create or replace function public.guard_ai_agent_plan() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if (new.reply_mode='ai' or (tg_op='INSERT' and nullif(trim(new.ai_instructions),'') is not null)
   or (tg_op='UPDATE' and new.ai_instructions is distinct from old.ai_instructions))
   and not public.has_tenant_feature(new.tenant_id,'ai_agent') then
   raise exception 'FEATURE_LOCKED: ai_agent' using errcode='42501';
 end if;
 return new;
end $$;

-- Source statement 13
drop trigger if exists bot_settings_ai_plan_gate on public.bot_settings;

-- Source statement 14
create trigger bot_settings_ai_plan_gate before insert or update on public.bot_settings
for each row execute function public.guard_ai_agent_plan();

-- Source statement 15
revoke all on function public.guard_ai_agent_plan() from public,anon,authenticated,service_role;

-- Source statement 16
drop policy if exists image_feature_access on public.image_response_rules;

-- Source statement 17
create policy image_feature_access on public.image_response_rules as restrictive for all to authenticated
 using(public.has_tenant_feature(tenant_id,'image_assistant'))
 with check(public.has_tenant_feature(tenant_id,'image_assistant'));

-- Source statement 18
drop policy if exists customer_feature_access on public.customers;

-- Source statement 19
create policy customer_feature_access on public.customers as restrictive for all to authenticated
 using(public.has_tenant_feature(tenant_id,'customer_management'))
 with check(public.has_tenant_feature(tenant_id,'customer_management'));

-- Source statement 20
drop policy if exists message_feature_access on public.messages;

-- Source statement 21
create policy message_feature_access on public.messages as restrictive for select to authenticated
 using(exists(select 1 from public.customers c where c.id=customer_id and public.has_tenant_feature(c.tenant_id,'customer_management')));

-- Source statement 22
drop policy if exists comment_feature_access on public.comments;

-- Source statement 23
create policy comment_feature_access on public.comments as restrictive for select to authenticated
 using(public.has_tenant_feature(tenant_id,'customer_management'));

-- Source statement 24
drop policy if exists order_feature_access on public.orders;

-- Source statement 25
create policy order_feature_access on public.orders as restrictive for all to authenticated
 using(public.has_tenant_feature(tenant_id,'customer_management'))
 with check(public.has_tenant_feature(tenant_id,'customer_management'));

-- Source statement 26
drop policy if exists slip_feature_read on public.slips;

-- Source statement 27
create policy slip_feature_read on public.slips as restrictive for select to authenticated
 using(public.has_tenant_feature(tenant_id,'slip_auto_pilot'));

-- Source statement 28
create or replace function public.consume_slip_credit(p_tenant uuid) returns boolean
language sql set search_path=pg_catalog,public as $$
 with taken as(update public.tenants set slip_used=slip_used+1
   where id=p_tenant and public.has_tenant_feature(id,'slip_auto_pilot')
   and slip_used::bigint<slip_quota::bigint+slip_quota_credits::bigint returning 1)
 select exists(select 1 from taken)
$$;

-- Source statement 29
revoke all on function public.consume_slip_credit(uuid) from public,anon,authenticated;

-- Source statement 30
grant execute on function public.consume_slip_credit(uuid) to service_role;

-- Source statement 31
create or replace function public.refund_slip_credit(p_tenant uuid) returns void
language sql set search_path=pg_catalog,public as $$
 update public.tenants set slip_used=slip_used-1 where id=p_tenant and slip_used>0
$$;

-- Source statement 32
revoke all on function public.refund_slip_credit(uuid) from public,anon,authenticated;

-- Source statement 33
grant execute on function public.refund_slip_credit(uuid) to service_role;

commit;
-- ============================================================================
-- 27. free-message-quota.sql | Facebook, billing, bank accounts and feature security
-- SHA256: 6c43832ecc28fe37a753487ea001174d0c724f028f45249f3275893f0b6e99a5
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
alter table public.tenants alter column broadcast_allowance set default 100;

-- Source statement 3
alter table public.tenants alter column broadcast_credits set default 100;

-- Source statement 5
create or replace function public.refresh_broadcast_credits(p_tenant uuid) returns void
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
end $$;

-- Source statement 6
create or replace function public.reserve_broadcast_credits(p_tenant uuid, p_count integer)
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
end $$;

-- Source statement 7
create or replace function public.refund_broadcast_credits(p_tenant uuid, p_monthly integer, p_topup integer)
returns void language plpgsql set search_path = pg_catalog, public as $$
begin
  perform public.refresh_broadcast_credits(p_tenant);
  update public.tenants set
    broadcast_credits = case when broadcast_credit_mode = 'purchased'
      then broadcast_credits + greatest(coalesce(p_monthly, 0), 0)
      else least(broadcast_allowance, broadcast_credits + greatest(coalesce(p_monthly, 0), 0)) end,
    broadcast_topup_credits = broadcast_topup_credits + greatest(coalesce(p_topup, 0), 0)
  where id = p_tenant;
end $$;

-- Source statement 8
create or replace function public.platform_update_tenant(
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
end $$;

-- Source statement 9
alter table public.plan_features drop constraint if exists plan_features_feature_check;

-- Source statement 10
alter table public.plan_features add constraint plan_features_feature_check check(feature in ('ai_agent','image_assistant','customer_management','slip_auto_pilot','customer_follow_up'));

-- Source statement 11
insert into public.plan_features(plan,feature,enabled) values('starter','customer_follow_up',true),('pro','customer_follow_up',true) on conflict do nothing;

-- Source statement 12
create or replace function public.guard_followup_plan() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$ begin if new.followup_enabled and not public.has_tenant_feature(new.tenant_id,'customer_follow_up') then raise exception 'FEATURE_LOCKED: customer_follow_up' using errcode='42501'; end if;return new;end $$;

-- Source statement 13
drop trigger if exists bot_settings_followup_plan_gate on public.bot_settings;

-- Source statement 14
create trigger bot_settings_followup_plan_gate before insert or update on public.bot_settings for each row execute function public.guard_followup_plan();

-- Source statement 15
revoke all on function public.guard_followup_plan() from public,anon,authenticated,service_role;

-- Source statement 16
drop policy if exists followup_feature_access on public.follow_up_jobs;

-- Source statement 17
create policy followup_feature_access on public.follow_up_jobs as restrictive for all to authenticated using(public.has_tenant_feature(tenant_id,'customer_follow_up')) with check(public.has_tenant_feature(tenant_id,'customer_follow_up'));

-- Source statement 18
revoke all on function public.refresh_broadcast_credits(uuid) from public,anon,authenticated;

-- Source statement 19
grant execute on function public.refresh_broadcast_credits(uuid) to service_role;

-- Source statement 20
revoke all on function public.reserve_broadcast_credits(uuid,integer) from public,anon,authenticated;

-- Source statement 21
grant execute on function public.reserve_broadcast_credits(uuid,integer) to service_role;

-- Source statement 22
revoke all on function public.refund_broadcast_credits(uuid,integer,integer) from public,anon,authenticated;

-- Source statement 23
grant execute on function public.refund_broadcast_credits(uuid,integer,integer) to service_role;

-- Source statement 24
revoke all on function public.platform_update_tenant(uuid,uuid,text,boolean) from public,anon,authenticated;

-- Source statement 25
grant execute on function public.platform_update_tenant(uuid,uuid,text,boolean) to service_role;

-- Source statement 26
notify pgrst, 'reload schema';

commit;
-- ============================================================================
-- 28. keyword-reply-limits.sql | Facebook, billing, bank accounts and feature security
-- SHA256: 331db8ee61d4e12356f6f883c08403717d136abaa29190bfa71940aa693d9c34
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create or replace function public.guard_keyword_reply_limit() returns trigger
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
end $$;

-- Source statement 3
revoke all on function public.guard_keyword_reply_limit() from public,anon,authenticated,service_role;

-- Source statement 4
drop trigger if exists keyword_reply_limit on public.chat_rules;

-- Source statement 5
create trigger keyword_reply_limit before insert or update of tenant_id on public.chat_rules
for each row execute function public.guard_keyword_reply_limit();

commit;
-- ============================================================================
-- 29. fallback-messages.sql | Facebook, billing, bank accounts and feature security
-- SHA256: b3a22811de461dac12dca9e85b8f5fd9ed5f5e0130547607eaced5c2ed1ba28b
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
alter table public.bot_settings add column if not exists fallback_messages text[] not null default '{}';

-- Source statement 3
create or replace function public.valid_fallback_messages(messages text[]) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select coalesce(cardinality(messages) <= 20 and not exists (
    select 1 from unnest(messages) message where message is null or length(message) > 2000
  ), false)
$$;

-- Source statement 4
alter table public.bot_settings drop constraint if exists bot_settings_fallback_messages_check;

-- Source statement 5
alter table public.bot_settings add constraint bot_settings_fallback_messages_check
  check (public.valid_fallback_messages(fallback_messages));

commit;
-- ============================================================================
-- 30. handover-messages.sql | Facebook, billing, bank accounts and feature security
-- SHA256: 47c4af183d56f18eb06929dab7daacf713eb30f77d4b080deb0fe9c9fd99742e
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
alter table public.bot_settings add column if not exists handover_messages text[] not null default '{}';

-- Source statement 3
create or replace function public.valid_handover_messages(messages text[]) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select coalesce(cardinality(messages) <= 20 and not exists (
    select 1 from unnest(messages) message where message is null or length(message) > 2000
  ), false)
$$;

-- Source statement 4
alter table public.bot_settings drop constraint if exists bot_settings_handover_messages_check;

-- Source statement 5
alter table public.bot_settings add constraint bot_settings_handover_messages_check
  check (public.valid_handover_messages(handover_messages));

commit;
-- ============================================================================
-- 31. followup-message-defaults.sql | Facebook, billing, bank accounts and feature security
-- SHA256: 1615ee171cacdcd867738276d1f676168275c34067e7067495851c9a34964562
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 1
alter table public.bot_settings alter column followup_steps set default '[
  {"delay_minutes": 15, "text": "คุณ {ชื่อลูกค้า} ยังไม่ได้ส่งสลิปสำหรับยอด {ยอดเงิน} บาทนะคะ โอนแล้วส่งสลิปในแชทนี้ได้เลยค่ะ"},
  {"delay_minutes": 60, "text": "แจ้งเตือนอีกครั้งค่ะ ออเดอร์ยอด {ยอดเงิน} บาท ยังรอการชำระเงิน หากต้องการยกเลิกแจ้งแอดมินได้เลยนะคะ"}
]'::jsonb;

commit;
-- ============================================================================
-- 32. smart-inbox.sql | Inbox, automation and commerce functions/triggers
-- SHA256: 2ccfb610d36a3a3acce7138038b3197b8e1203128daa627780d82bc5722ad505
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
alter table public.customers add column if not exists assigned_user_id uuid references auth.users(id) on delete set null;

-- Source statement 3
alter table public.customers add column if not exists conversation_status text not null default 'open' check(conversation_status in ('open','closed'));

-- Source statement 4
alter table public.customers add column if not exists conversation_version integer not null default 0;

-- Source statement 5
alter table public.customers add column if not exists inbound_seq bigint not null default 0;

-- Source statement 6
alter table public.customers add column if not exists outbound_lock uuid;

-- Source statement 7
alter table public.customers add column if not exists outbound_lock_until timestamptz;

-- Source statement 8
alter table public.messages add column if not exists inbound_seq bigint;

-- Source statement 9
alter table public.messages add column if not exists provider_message_id text;

-- Source statement 10
alter table public.messages add column if not exists delivery_status text check(delivery_status in ('pending','sent','delivered','read','failed','unknown'));

-- Source statement 11
create index if not exists messages_provider_id on public.messages(provider_message_id) where provider_message_id is not null;

-- Source statement 12
grant select(assigned_user_id,conversation_status,conversation_version,inbound_seq) on public.customers to authenticated;

-- Source statement 15
create table if not exists public.conversation_reads(
 customer_id uuid not null references public.customers(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 read_seq bigint not null default 0, primary key(customer_id,user_id)
);

-- Source statement 16
create table if not exists public.conversation_events(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,
 customer_id uuid not null references public.customers(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,action text not null,
 previous_assignee uuid,next_assignee uuid,created_at timestamptz not null default now()
);

-- Source statement 17
alter table public.conversation_reads enable row level security;

-- Source statement 18
alter table public.conversation_events enable row level security;

-- Source statement 19
revoke all on public.conversation_reads,public.conversation_events from public,anon,authenticated;

-- Source statement 20
grant select on public.conversation_reads,public.conversation_events to authenticated;

-- Source statement 21
grant all on public.conversation_reads,public.conversation_events to service_role;

-- Source statement 22
drop policy if exists own_read on public.conversation_reads;

-- Source statement 23
create policy own_read on public.conversation_reads for select to authenticated using(user_id=auth.uid() and exists(select 1 from public.customers c where c.id=customer_id and public.can_access_tenant(c.tenant_id) and public.has_tenant_feature(c.tenant_id,'customer_management')));

-- Source statement 24
drop policy if exists member_read on public.conversation_events;

-- Source statement 25
create policy member_read on public.conversation_events for select to authenticated using(public.can_access_tenant(tenant_id) and public.has_tenant_feature(tenant_id,'customer_management'));

-- Source statement 26
create or replace function public.inbox_incoming_message() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.sender='customer' then
  update public.customers set inbound_seq=inbound_seq+1,conversation_status='open',conversation_version=conversation_version+1,
    last_message_at=case when platform='facebook' then last_message_at
      else greatest(coalesce(last_message_at,new.created_at),new.created_at) end
    where id=new.customer_id returning inbound_seq into new.inbound_seq;
 end if;
 return new;
end $$;

-- Source statement 27
drop trigger if exists inbox_message_counter on public.messages;

-- Source statement 28
create trigger inbox_message_counter before insert on public.messages for each row execute function public.inbox_incoming_message();

-- Source statement 29
create or replace function public.manage_inbox_conversation(p_customer uuid,p_actor uuid,p_action text,p_version integer,p_assignee uuid default null) returns jsonb
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
end $$;

-- Source statement 30
create or replace function public.mark_inbox_read(p_customer uuid,p_actor uuid,p_message uuid) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare c public.customers;seq bigint;
begin
 select * into c from public.customers where id=p_customer;
 if not found or not public.has_tenant_feature(c.tenant_id,'customer_management') or not(exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_actor) or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Forbidden' using errcode='42501';end if;
 select inbound_seq into seq from public.messages where id=p_message and customer_id=p_customer and sender='customer';
 if seq is null then return;end if;
 insert into public.conversation_reads(customer_id,user_id,read_seq) values(p_customer,p_actor,seq)
 on conflict(customer_id,user_id) do update set read_seq=greatest(conversation_reads.read_seq,excluded.read_seq);
end $$;

-- Source statement 31
create or replace function public.start_inbox_delivery(p_customer uuid,p_actor uuid default null) returns uuid
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
end $$;

-- Source statement 32
create or replace function public.end_inbox_delivery(p_customer uuid,p_lease uuid) returns void
language sql set search_path=pg_catalog,public as $$update public.customers set outbound_lock=null,outbound_lock_until=null where id=p_customer and outbound_lock=p_lease$$;

-- Source statement 33
create or replace function public.start_inbox_handover(p_customer uuid) returns uuid
language plpgsql set search_path=pg_catalog,public as $$
declare lease uuid;target uuid;
begin
 lease:=public.start_inbox_delivery(p_customer,null);
 update public.customers set bot_enabled=false,handover_at=now(),conversation_version=conversation_version+1 where id=p_customer returning tenant_id into target;
 insert into public.conversation_events(tenant_id,customer_id,action) values(target,p_customer,'handover');
 return lease;
end $$;

-- Source statement 34
revoke update(bot_enabled) on public.customers from authenticated;

-- Source statement 35
revoke all on function public.manage_inbox_conversation(uuid,uuid,text,integer,uuid),public.mark_inbox_read(uuid,uuid,uuid),public.start_inbox_delivery(uuid,uuid),public.end_inbox_delivery(uuid,uuid),public.inbox_incoming_message() from public,anon,authenticated;

-- Source statement 36
grant execute on function public.manage_inbox_conversation(uuid,uuid,text,integer,uuid),public.mark_inbox_read(uuid,uuid,uuid),public.start_inbox_delivery(uuid,uuid),public.end_inbox_delivery(uuid,uuid) to service_role;

-- Source statement 37
revoke all on function public.start_inbox_handover(uuid) from public,anon,authenticated;

-- Source statement 38
grant execute on function public.start_inbox_handover(uuid) to service_role;

-- Source statement 39
create table if not exists public.inbox_media(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,uploaded_by uuid not null references auth.users(id),path text not null unique,name text not null,mime text not null,kind text not null check(kind in ('image','file')),created_at timestamptz not null default now());

-- Source statement 40
alter table public.inbox_media enable row level security;

-- Source statement 41
revoke all on public.inbox_media from public,anon,authenticated;

-- Source statement 42
grant select,insert,delete on public.inbox_media to service_role;

-- Source statement 43
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('inbox-media','inbox-media',false,8388608,array['image/jpeg','image/png','image/gif','image/webp','application/pdf']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- Source statement 44
do $$begin alter publication supabase_realtime add table public.conversation_reads;exception when duplicate_object then null;end $$;

commit;
-- ============================================================================
-- 33. smart-inbox-pro.sql | Inbox, automation and commerce functions/triggers
-- SHA256: e5aeb9d94cce891b6ddcfbac736c4db5985f98146a5f582bc4551b5dbaccba6f
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
alter table public.customers add column if not exists inbox_stage text;

-- Source statement 3
alter table public.customers add column if not exists closed_at timestamptz;

-- Source statement 4
alter table public.customers add column if not exists closed_by uuid references auth.users(id);

-- Source statement 5
alter table public.customers add column if not exists close_reason text;

-- Source statement 7
alter table public.customers alter column inbox_stage set default 'UNASSIGNED';

-- Source statement 8
alter table public.customers alter column inbox_stage set not null;

-- Source statement 9
do $$begin if not exists(select 1 from pg_constraint where conname='customers_inbox_stage_check' and conrelid='public.customers'::regclass) then
 alter table public.customers add constraint customers_inbox_stage_check check(inbox_stage in ('UNASSIGNED','ASSIGNED','IN_PROGRESS','RESOLVED','CLOSED'));
end if;end $$;

-- Source statement 10
alter table public.conversation_events add column if not exists reason text;

-- Source statement 11
alter table public.conversation_events add column if not exists request_id uuid;

-- Source statement 12
grant select(inbox_stage,closed_at,closed_by,close_reason) on public.customers to authenticated;

-- Source statement 13
create table if not exists public.inbox_action_receipts(
 tenant_id uuid not null references public.tenants(id),actor_id uuid not null references auth.users(id),request_id uuid not null,
 customer_id uuid not null references public.customers(id),payload jsonb not null,result jsonb not null,
 created_at timestamptz not null default now(),primary key(tenant_id,actor_id,request_id)
);

-- Source statement 14
create index if not exists inbox_action_rate on public.inbox_action_receipts(tenant_id,actor_id,created_at);

-- Source statement 15
create index if not exists customers_inbox_pro_queue on public.customers(tenant_id,inbox_stage,last_message_at);

-- Source statement 16
create index if not exists messages_inbox_pro_reply on public.messages(customer_id,created_at,id) where sender='agent' and delivery_status in ('sent','delivered','read');

-- Source statement 17
alter table public.inbox_action_receipts enable row level security;

-- Source statement 18
revoke all on public.inbox_action_receipts from public,anon,authenticated;

-- Source statement 19
grant select,insert on public.inbox_action_receipts to service_role;

-- Source statement 20
create or replace function public.sync_inbox_pro_stage() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.conversation_status='closed' then new.inbox_stage:='CLOSED';
 elsif tg_op='INSERT' then new.inbox_stage:=case when new.assigned_user_id is null then 'UNASSIGNED' else 'ASSIGNED' end;
 elsif new.assigned_user_id is distinct from old.assigned_user_id or new.conversation_status is distinct from old.conversation_status or new.bot_enabled and not old.bot_enabled then
  new.inbox_stage:=case when new.assigned_user_id is null then 'UNASSIGNED' else 'ASSIGNED' end;
 end if;
 if new.conversation_status<>'closed' then new.closed_at:=null;new.closed_by:=null;new.close_reason:=null;end if;
 return new;
end $$;

-- Source statement 21
drop trigger if exists customers_inbox_pro_stage on public.customers;

-- Source statement 22
create trigger customers_inbox_pro_stage before insert or update on public.customers for each row execute function public.sync_inbox_pro_stage();

-- Source statement 23
create or replace function public.manage_inbox_pro(p_customer uuid,p_actor uuid,p_action text,p_version integer,p_key uuid,p_reason text default null,p_assignee uuid default null) returns jsonb
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
end $$;

-- Source statement 24
revoke all on function public.manage_inbox_pro(uuid,uuid,text,integer,uuid,text,uuid),public.sync_inbox_pro_stage() from public,anon,authenticated;

-- Source statement 25
grant execute on function public.manage_inbox_pro(uuid,uuid,text,integer,uuid,text,uuid) to service_role;

-- Source statement 26
create or replace function public.inbox_pro_message_progress() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.sender='agent' then
  update public.customers set inbox_stage='IN_PROGRESS',conversation_version=conversation_version+1 where id=new.customer_id and assigned_user_id is not null and conversation_status='open' and inbox_stage in ('ASSIGNED','RESOLVED');
 elsif new.sender='customer' then
  update public.customers set inbox_stage=case when assigned_user_id is null then 'UNASSIGNED' else 'IN_PROGRESS' end,conversation_version=conversation_version+1 where id=new.customer_id and inbox_stage='RESOLVED';
 end if;
 return null;
end $$;

-- Source statement 27
drop trigger if exists messages_inbox_pro_progress on public.messages;

-- Source statement 28
create trigger messages_inbox_pro_progress after insert on public.messages for each row execute function public.inbox_pro_message_progress();

-- Source statement 29
revoke all on function public.inbox_pro_message_progress() from public,anon,authenticated;

-- Source statement 30
create or replace function public.inbox_pro_overview(p_tenant uuid) returns jsonb language sql stable set search_path=pg_catalog,public as $$
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
$$;

-- Source statement 31
revoke all on function public.inbox_pro_overview(uuid) from public,anon,authenticated;

-- Source statement 32
grant execute on function public.inbox_pro_overview(uuid) to service_role;

-- Source statement 33
notify pgrst,'reload schema';

commit;
-- ============================================================================
-- 34. smart-inbox-v2.sql | Inbox, automation and commerce functions/triggers
-- SHA256: c554817c3a8c16bd2dc68d725938bc9aef2bba2b63bc8762618157a19584521e
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create table if not exists public.inbox_internal_notes (
 id uuid primary key, tenant_id uuid not null references public.tenants(id) on delete cascade,
 customer_id uuid not null references public.customers(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,
 body text not null check(length(body) between 1 and 2000), created_at timestamptz not null default now()
);

-- Source statement 3
create index if not exists inbox_internal_notes_customer on public.inbox_internal_notes(tenant_id,customer_id,created_at desc);

-- Source statement 4
create table if not exists public.inbox_stars (
 customer_id uuid not null references public.customers(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 primary key(customer_id,user_id)
);

-- Source statement 5
create table if not exists public.inbox_workspace_requests (
 actor_id uuid not null references auth.users(id) on delete cascade, request_id uuid not null,
 customer_id uuid not null references public.customers(id) on delete cascade,
 action text not null, body text, created_at timestamptz not null default now(), primary key(actor_id,request_id)
);

-- Source statement 6
create index if not exists inbox_workspace_rate on public.inbox_workspace_requests(actor_id,created_at);

-- Source statement 7
alter table public.inbox_internal_notes enable row level security;

-- Source statement 8
alter table public.inbox_stars enable row level security;

-- Source statement 9
alter table public.inbox_workspace_requests enable row level security;

-- Source statement 10
revoke all on public.inbox_internal_notes,public.inbox_stars,public.inbox_workspace_requests from public,anon,authenticated;

-- Source statement 11
grant all on public.inbox_internal_notes,public.inbox_stars,public.inbox_workspace_requests to service_role;

-- Source statement 12
create or replace function public.manage_inbox_workspace(p_customer uuid,p_actor uuid,p_action text,p_key uuid,p_body text default null)
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
end $$;

-- Source statement 13
revoke all on function public.manage_inbox_workspace(uuid,uuid,text,uuid,text) from public,anon,authenticated;

-- Source statement 14
grant execute on function public.manage_inbox_workspace(uuid,uuid,text,uuid,text) to service_role;

commit;
-- ============================================================================
-- 35. inbox-follow-up-flags.sql | Inbox, automation and commerce functions/triggers
-- SHA256: bdf113d9341ecb5c831a278c0624b0c04ce95ac2aee3a8b0509078099358365d
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create table if not exists public.inbox_follow_up_flags (
 customer_id uuid not null references public.customers(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(customer_id,user_id)
);

-- Source statement 3
create index if not exists inbox_follow_up_flags_user on public.inbox_follow_up_flags(tenant_id,user_id,created_at desc);

-- Source statement 4
alter table public.inbox_follow_up_flags enable row level security;

-- Source statement 5
revoke all on public.inbox_follow_up_flags from public,anon,authenticated;

-- Source statement 6
grant all on public.inbox_follow_up_flags to service_role;

-- Source statement 7
create or replace function public.set_inbox_follow_up_flag(p_customer uuid,p_actor uuid,p_enabled boolean,p_key uuid)
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
end $$;

-- Source statement 8
revoke all on function public.set_inbox_follow_up_flag(uuid,uuid,boolean,uuid) from public,anon,authenticated;

-- Source statement 9
grant execute on function public.set_inbox_follow_up_flag(uuid,uuid,boolean,uuid) to service_role;

-- Source statement 10
notify pgrst,'reload schema';

commit;
-- ============================================================================
-- 36. inbox-quick-replies.sql | Inbox, automation and commerce functions/triggers
-- SHA256: 832f7002fc6a45f2a5054583c19e03942ecb451423afa4b3d168510206f0e6eb
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create table if not exists public.inbox_quick_replies (
 id uuid primary key,tenant_id uuid not null references public.tenants(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,
 body text not null check(length(trim(body)) between 1 and 2000),created_at timestamptz not null default now()
);

-- Source statement 3
alter table public.inbox_quick_replies add column if not exists shortcut text not null default '' check(length(shortcut)<=60);

-- Source statement 4
create index if not exists inbox_quick_replies_tenant on public.inbox_quick_replies(tenant_id,created_at);

-- Source statement 5
alter table public.inbox_quick_replies enable row level security;

-- Source statement 6
revoke all on public.inbox_quick_replies from public,anon,authenticated;

-- Source statement 7
grant all on public.inbox_quick_replies to service_role;

-- Source statement 8
create or replace function public.save_inbox_quick_reply(p_tenant uuid,p_actor uuid,p_key uuid,p_body text,p_shortcut text)
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
end $$;

-- Source statement 9
revoke all on function public.save_inbox_quick_reply(uuid,uuid,uuid,text,text) from public,anon,authenticated;

-- Source statement 10
grant execute on function public.save_inbox_quick_reply(uuid,uuid,uuid,text,text) to service_role;

-- Source statement 11
create or replace function public.save_inbox_quick_reply(p_tenant uuid,p_actor uuid,p_key uuid,p_body text)
returns jsonb language sql set search_path=pg_catalog,public as $$
 select public.save_inbox_quick_reply(p_tenant,p_actor,p_key,p_body,'');
$$;

-- Source statement 12
revoke all on function public.save_inbox_quick_reply(uuid,uuid,uuid,text) from public,anon,authenticated;

-- Source statement 13
grant execute on function public.save_inbox_quick_reply(uuid,uuid,uuid,text) to service_role;

commit;
-- ============================================================================
-- 37. inbox-actions.sql | Inbox, automation and commerce functions/triggers
-- SHA256: e5f91c58531dd16ff25556e42e3223c0781abe615846f407773143e4d5dd5590
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create or replace function public.manage_inbox_conversation(p_customer uuid,p_actor uuid,p_action text,p_version integer,p_assignee uuid default null) returns jsonb
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
end $$;

-- Source statement 3
revoke all on function public.manage_inbox_conversation(uuid,uuid,text,integer,uuid) from public,anon,authenticated;

-- Source statement 4
grant execute on function public.manage_inbox_conversation(uuid,uuid,text,integer,uuid) to service_role;

commit;
-- ============================================================================
-- 38. automation-safety.sql | Inbox, automation and commerce functions/triggers
-- SHA256: 86b4d84d2db794a379520b40c3ff268143107c2a12501c72c90b32445a668096
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create table if not exists public.tenant_automation_controls (
 tenant_id uuid primary key references public.tenants(id),
 stopped boolean not null default false,
 updated_at timestamptz not null default now()
);

-- Source statement 3
create table if not exists public.tenant_automation_audit (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 actor_id uuid not null references auth.users(id), stopped boolean not null,
 reason text not null check(length(trim(reason)) between 1 and 500), created_at timestamptz not null default now()
);

-- Source statement 4
alter table public.tenant_automation_controls enable row level security;

-- Source statement 5
alter table public.tenant_automation_audit enable row level security;

-- Source statement 6
revoke all on public.tenant_automation_controls,public.tenant_automation_audit from public,anon,authenticated;

-- Source statement 7
grant select,insert,update on public.tenant_automation_controls to service_role;

-- Source statement 8
grant select,insert on public.tenant_automation_audit to service_role;

-- Source statement 9
create or replace function public.set_tenant_automation_stop(p_tenant uuid,p_actor uuid,p_stopped boolean,p_reason text) returns void
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
end $$;

-- Source statement 10
revoke all on function public.set_tenant_automation_stop(uuid,uuid,boolean,text) from public,anon,authenticated;

-- Source statement 11
grant execute on function public.set_tenant_automation_stop(uuid,uuid,boolean,text) to service_role;

-- Source statement 12
create or replace function public.claim_and_start_inbox_reply(p_customer uuid,p_actor uuid,p_version integer) returns uuid
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
end $$;

-- Source statement 13
revoke all on function public.claim_and_start_inbox_reply(uuid,uuid,integer) from public,anon,authenticated;

-- Source statement 14
grant execute on function public.claim_and_start_inbox_reply(uuid,uuid,integer) to service_role;

-- Source statement 15
notify pgrst,'reload schema';

commit;
-- ============================================================================
-- 39. smart-follow-ups.sql | Inbox, automation and commerce functions/triggers
-- SHA256: 1a1337af816ff8cb005eb12a2753e1595f0857de717cfe955736cf0769898db1
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
alter table public.customers add column if not exists followup_opted_out boolean not null default false;

-- Source statement 3
alter table public.customers add column if not exists followup_opted_out_at timestamptz;

-- Source statement 4
alter table public.customers add column if not exists contact_suspended boolean not null default false;

-- Source statement 5
alter table public.orders add column if not exists confirmed_at timestamptz;

-- Source statement 7
create table if not exists public.follow_up_policies(
 tenant_id uuid primary key references public.tenants(id) on delete cascade,enabled boolean not null default false,
 timezone text not null default 'Asia/Bangkok',quiet_enabled boolean not null default false,
 quiet_start integer not null default 1320 check(quiet_start between 0 and 1439),quiet_end integer not null default 480 check(quiet_end between 0 and 1439),
 max_per_customer integer not null default 3 check(max_per_customer between 1 and 20),max_per_order integer not null default 3 check(max_per_order between 1 and 10)
);

-- Source statement 8
create table if not exists public.follow_up_workflows(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,
 kind text not null check(kind in ('payment','interested','after_sales')),enabled boolean not null default false,
 use_ai boolean not null default false,stop_on_reply boolean not null default true,version integer not null default 1,
 steps jsonb not null check(jsonb_typeof(steps)='array' and jsonb_array_length(steps) between 1 and 3),unique(tenant_id,kind)
);

-- Source statement 9
create table if not exists public.order_delivery_events(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),order_id uuid not null unique references public.orders(id),
 customer_id uuid not null references public.customers(id),confirmed_by uuid not null references auth.users(id),
 evidence text not null check(length(trim(evidence)) between 5 and 1000),delivered_at timestamptz not null,created_at timestamptz not null default now()
);

-- Source statement 10
alter table public.follow_up_jobs alter column order_id drop not null;

-- Source statement 11
alter table public.follow_up_jobs drop constraint if exists follow_up_jobs_order_id_step_key;

-- Source statement 12
alter table public.follow_up_jobs drop constraint if exists follow_up_jobs_status_check;

-- Source statement 13
alter table public.follow_up_jobs add constraint follow_up_jobs_status_check check(status in ('scheduled','pending','processing','sent','failed','cancelled','skipped','requires_review'));

-- Source statement 14
alter table public.follow_up_jobs alter column status set default 'pending';

-- Source statement 15
alter table public.follow_up_jobs add column if not exists kind text not null default 'payment' check(kind in ('payment','interested','after_sales'));

-- Source statement 16
alter table public.follow_up_jobs add column if not exists workflow_id uuid references public.follow_up_workflows(id);

-- Source statement 17
alter table public.follow_up_jobs add column if not exists workflow_version integer not null default 1;

-- Source statement 18
alter table public.follow_up_jobs add column if not exists source_message_id uuid references public.messages(id);

-- Source statement 19
alter table public.follow_up_jobs add column if not exists product_id uuid references public.products(id);

-- Source statement 20
alter table public.follow_up_jobs add column if not exists source_seq bigint not null default 0;

-- Source statement 21
alter table public.follow_up_jobs add column if not exists anchor_at timestamptz not null default now();

-- Source statement 22
alter table public.follow_up_jobs add column if not exists claim_token uuid;

-- Source statement 23
alter table public.follow_up_jobs add column if not exists claim_until timestamptz;

-- Source statement 24
alter table public.follow_up_jobs add column if not exists attempts integer not null default 0;

-- Source statement 25
alter table public.follow_up_jobs add column if not exists dispatch_started_at timestamptz;

-- Source statement 26
alter table public.follow_up_jobs add column if not exists message_id uuid references public.messages(id);

-- Source statement 27
alter table public.follow_up_jobs add column if not exists provider_message_id text;

-- Source statement 28
alter table public.follow_up_jobs add column if not exists reserved_monthly integer not null default 0;

-- Source statement 29
alter table public.follow_up_jobs add column if not exists reserved_topup integer not null default 0;

-- Source statement 30
alter table public.follow_up_jobs add column if not exists delivery_lease uuid;

-- Source statement 31
alter table public.follow_up_jobs add column if not exists responded_at timestamptz;

-- Source statement 32
alter table public.follow_up_jobs add column if not exists ai_approved boolean not null default false;

-- Source statement 33
create unique index if not exists follow_up_order_step on public.follow_up_jobs(order_id,kind,step) where order_id is not null;

-- Source statement 34
create unique index if not exists follow_up_interest_step on public.follow_up_jobs(source_message_id,step) where kind='interested';

-- Source statement 35
create index if not exists follow_up_pending_due on public.follow_up_jobs(run_at,id) where status='pending';

-- Source statement 36
create index if not exists follow_up_processing_lease on public.follow_up_jobs(claim_until) where status='processing';

-- Source statement 37
create index if not exists follow_up_contact_rate on public.follow_up_jobs(customer_id,dispatch_started_at desc) where dispatch_started_at is not null;

-- Source statement 38
create table if not exists public.follow_up_execution_logs(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),job_id uuid not null references public.follow_up_jobs(id),
 status text not null,reason text,actor_id uuid references auth.users(id),created_at timestamptz not null default now()
);

-- Source statement 39
create index if not exists follow_up_logs_tenant on public.follow_up_execution_logs(tenant_id,created_at desc);

-- Source statement 46
do $$declare tab text;begin
 foreach tab in array array['follow_up_policies','follow_up_workflows','order_delivery_events','follow_up_execution_logs'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated',tab);
  execute format('grant select on public.%I to authenticated',tab);
  execute format('grant all on public.%I to service_role',tab);
  execute format('drop policy if exists tenant_read on public.%I',tab);
  execute format('create policy tenant_read on public.%I for select to authenticated using(public.can_access_tenant(tenant_id) and public.has_tenant_feature(tenant_id,''customer_follow_up''))',tab);
 end loop;
end $$;

-- Source statement 47
revoke update(status,reason) on public.follow_up_jobs from authenticated;

-- Source statement 48
revoke insert,update,delete on public.follow_up_jobs from authenticated,anon;

-- Source statement 49
grant select(followup_opted_out,followup_opted_out_at,contact_suspended) on public.customers to authenticated;

-- Source statement 50
grant select(confirmed_at) on public.orders to authenticated;

-- Source statement 51
create or replace function public.log_follow_up_state() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op='INSERT' or new.status is distinct from old.status or new.reason is distinct from old.reason then
  insert into public.follow_up_execution_logs(tenant_id,job_id,status,reason) values(new.tenant_id,new.id,new.status,new.reason);
 end if;return new;
end $$;

-- Source statement 52
drop trigger if exists follow_up_state_log on public.follow_up_jobs;

-- Source statement 53
create trigger follow_up_state_log after insert or update on public.follow_up_jobs for each row execute function public.log_follow_up_state();

-- Source statement 54
create or replace function public.enqueue_follow_up(p_tenant uuid,p_customer uuid,p_kind text,p_order uuid default null,p_source uuid default null,p_product uuid default null) returns void
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
end $$;

-- Source statement 55
create or replace function public.schedule_follow_ups() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 update public.follow_up_jobs set status='cancelled',reason='new_order' where customer_id=new.customer_id and tenant_id=new.tenant_id and kind='interested' and (status in ('pending','requires_review') or status='processing' and dispatch_started_at is null);
 if new.status='pending_payment' then perform public.enqueue_follow_up(new.tenant_id,new.customer_id,'payment',new.id);end if;
 return new;
end $$;

-- Source statement 56
create or replace function public.confirm_cf_order() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.message_id is not null and exists(select 1 from public.messages m where m.id=new.message_id and m.customer_id=new.customer_id and m.sender='customer') then new.confirmed_at:=coalesce(new.confirmed_at,now());end if;
 return new;
end $$;

-- Source statement 57
drop trigger if exists orders_confirm_cf on public.orders;

-- Source statement 58
create trigger orders_confirm_cf before insert on public.orders for each row execute function public.confirm_cf_order();

-- Source statement 59
create or replace function public.cancel_paid_follow_ups() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.status<>old.status and new.status in ('paid','shipped','cancelled') then
  update public.follow_up_jobs set status='cancelled',reason=case when new.status='cancelled' then 'order_cancelled' else 'paid' end
  where order_id=new.id and (kind='payment' or new.status='cancelled') and (status in ('pending','requires_review') or status='processing' and dispatch_started_at is null);
 end if;return null;
end $$;

-- Source statement 60
create or replace function public.on_follow_up_customer() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.followup_opted_out or new.contact_suspended or not new.bot_enabled or new.assigned_user_id is not null or new.conversation_status='closed' then
  update public.follow_up_jobs set status='cancelled',reason=case when new.followup_opted_out then 'opt_out' when new.contact_suspended then 'contact_suspended' else 'handover' end
  where customer_id=new.id and (status in ('pending','requires_review') or status='processing' and dispatch_started_at is null);
 end if;return null;
end $$;

-- Source statement 61
drop trigger if exists customers_follow_up_stop on public.customers;

-- Source statement 62
create trigger customers_follow_up_stop after update of followup_opted_out,contact_suspended,bot_enabled,assigned_user_id,conversation_status on public.customers for each row execute function public.on_follow_up_customer();

-- Source statement 63
create or replace function public.on_follow_up_message() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
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
end $$;

-- Source statement 64
drop trigger if exists messages_follow_up_stop on public.messages;

-- Source statement 65
create trigger messages_follow_up_stop after insert on public.messages for each row execute function public.on_follow_up_message();

-- Source statement 66
create or replace function public.on_follow_up_delivery() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if not exists(select 1 from public.orders where id=new.order_id and tenant_id=new.tenant_id and customer_id=new.customer_id and status='shipped' and created_at<=new.delivered_at)
  or new.delivered_at>clock_timestamp()+interval '2 minutes' then raise exception 'Actual shipped order and delivery evidence required' using errcode='22023';end if;
 perform public.enqueue_follow_up(new.tenant_id,new.customer_id,'after_sales',new.order_id);
 return null;
end $$;

-- Source statement 67
drop trigger if exists delivery_schedule_follow_up on public.order_delivery_events;

-- Source statement 68
create trigger delivery_schedule_follow_up after insert on public.order_delivery_events for each row execute function public.on_follow_up_delivery();

-- Source statement 69
create or replace function public.claim_follow_up_jobs(p_tenant uuid default null,p_limit integer default 5) returns setof public.follow_up_jobs
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
end $$;

-- Source statement 70
create or replace function public.render_smart_follow_up(p_template text,p_name text,p_product text,p_total numeric) returns text
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
end $$;

-- Source statement 71
revoke all on function public.render_smart_follow_up(text,text,text,numeric) from public,anon,authenticated;

-- Source statement 72
grant execute on function public.render_smart_follow_up(text,text,text,numeric) to service_role;

-- Source statement 73
create or replace function public.prepare_follow_up(p_job uuid,p_claim uuid) returns jsonb
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
end $$;

-- Source statement 74
create or replace function public.complete_follow_up(p_job uuid,p_claim uuid,p_result text,p_provider text default null,p_reason text default null) returns boolean
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
end $$;

-- Source statement 75
create or replace function public.follow_up_overview(p_tenant uuid) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('pending',count(*) filter(where status='pending'),'processing',count(*) filter(where status='processing'),'sent',count(*) filter(where status='sent'),'requires_review',count(*) filter(where status='requires_review'),'cancelled',count(*) filter(where status in ('cancelled','skipped')),'failed',count(*) filter(where status='failed'),'responded',count(distinct customer_id) filter(where responded_at is not null)) from public.follow_up_jobs where tenant_id=p_tenant and created_at>now()-interval '30 days'
$$;

-- Source statement 76
create or replace function public.save_smart_follow_up(p_tenant uuid,p_actor uuid,p_policy jsonb,p_workflows jsonb) returns void
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
end $$;

-- Source statement 77
create or replace function public.act_follow_up_job(p_job uuid,p_tenant uuid,p_actor uuid,p_action text,p_text text default null) returns void
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
end $$;

-- Source statement 78
create or replace function public.confirm_follow_up_order(p_order uuid,p_tenant uuid,p_actor uuid) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare c uuid;
begin
 if not public.has_tenant_feature(p_tenant,'customer_follow_up') or not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Forbidden' using errcode='42501';end if;
 update public.orders set confirmed_at=coalesce(confirmed_at,now()) where id=p_order and tenant_id=p_tenant and status='pending_payment' returning customer_id into c;
 if c is null then raise exception 'Pending order not found' using errcode='P0002';end if;
 perform public.enqueue_follow_up(p_tenant,c,'payment',p_order);
end $$;

-- Source statement 79
revoke all on function public.confirm_follow_up_order(uuid,uuid,uuid) from public,anon,authenticated;

-- Source statement 80
grant execute on function public.confirm_follow_up_order(uuid,uuid,uuid) to service_role;

-- Source statement 81
revoke all on function public.save_smart_follow_up(uuid,uuid,jsonb,jsonb),public.act_follow_up_job(uuid,uuid,uuid,text,text) from public,anon,authenticated;

-- Source statement 82
grant execute on function public.save_smart_follow_up(uuid,uuid,jsonb,jsonb),public.act_follow_up_job(uuid,uuid,uuid,text,text) to service_role;

-- Source statement 83
revoke all on function public.enqueue_follow_up(uuid,uuid,text,uuid,uuid,uuid),public.claim_follow_up_jobs(uuid,integer),public.prepare_follow_up(uuid,uuid),public.complete_follow_up(uuid,uuid,text,text,text),public.follow_up_overview(uuid),public.log_follow_up_state(),public.confirm_cf_order(),public.on_follow_up_customer(),public.on_follow_up_message(),public.on_follow_up_delivery() from public,anon,authenticated;

-- Source statement 84
grant execute on function public.enqueue_follow_up(uuid,uuid,text,uuid,uuid,uuid),public.claim_follow_up_jobs(uuid,integer),public.prepare_follow_up(uuid,uuid),public.complete_follow_up(uuid,uuid,text,text,text),public.follow_up_overview(uuid) to service_role;

-- Source statement 85
do $$declare tab text;begin
 foreach tab in array array['follow_up_workflows','follow_up_policies'] loop
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=tab) then execute format('alter publication supabase_realtime add table public.%I',tab);end if;
 end loop;
end $$;

-- Source statement 86
notify pgrst,'reload schema';

commit;
-- ============================================================================
-- 40. agent-control.sql | Inbox, automation and commerce functions/triggers
-- SHA256: 462a262220a863bbc2ceae0a130173530d9de25285a66423eff8aeb67a436cf2
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
alter table public.customers add column if not exists agent_opted_out boolean not null default false;

-- Source statement 3
create table if not exists public.agent_control_settings(
 tenant_id uuid primary key references public.tenants(id),flags jsonb not null default '{}' check(jsonb_typeof(flags)='object'),
 ai_monthly_limit integer not null default 0 check(ai_monthly_limit between 0 and 1000000),requests_per_minute integer not null default 10 check(requests_per_minute between 1 and 100)
);

-- Source statement 4
create table if not exists public.agent_knowledge_sources(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 kind text not null check(kind in ('shop','shipping','warranty','returns','faq','forbidden','handoff')),title text not null check(length(trim(title)) between 1 and 100),
 content text not null check(length(trim(content)) between 1 and 2000),is_active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);

-- Source statement 5
create table if not exists public.agent_prompt_versions(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),version integer not null,instructions text,
 actor_id uuid references auth.users(id),created_at timestamptz not null default now(),unique(tenant_id,version)
);

-- Source statement 6
create table if not exists public.agent_message_jobs(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),customer_id uuid not null references public.customers(id),message_id uuid not null unique references public.messages(id),
 inbound_seq bigint not null,status text not null default 'processing' check(status in ('processing','draft','sent','review','skipped','failed')),route text,reason text,
 claim_token uuid,claim_until timestamptz,dispatch_started_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);

-- Source statement 7
create table if not exists public.agent_ai_monthly_usage(tenant_id uuid not null references public.tenants(id),month date not null,used integer not null default 0 check(used>=0),primary key(tenant_id,month));

-- Source statement 8
create table if not exists public.agent_ai_usage(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),customer_id uuid references public.customers(id),job_id uuid unique references public.agent_message_jobs(id),
 invocation_key uuid not null unique,status text not null default 'started' check(status in ('started','completed','review','provider_error')),
 input_tokens integer,output_tokens integer,cost_baht numeric,source_ids jsonb not null default '[]',reason text,created_at timestamptz not null default now(),completed_at timestamptz
);

-- Source statement 9
create table if not exists public.agent_control_audit(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),actor_id uuid references auth.users(id),event text not null,subject_id uuid,detail text,created_at timestamptz not null default now());

-- Source statement 10
create index if not exists agent_jobs_tenant on public.agent_message_jobs(tenant_id,created_at desc);

-- Source statement 11
create index if not exists agent_usage_rate on public.agent_ai_usage(tenant_id,created_at desc);

-- Source statement 12
create index if not exists agent_knowledge_tenant on public.agent_knowledge_sources(tenant_id,is_active);

-- Source statement 13
create index if not exists agent_audit_tenant on public.agent_control_audit(tenant_id,created_at desc);

-- Source statement 14
do $$declare tab text;begin
 foreach tab in array array['agent_control_settings','agent_knowledge_sources','agent_prompt_versions','agent_message_jobs','agent_ai_monthly_usage','agent_ai_usage','agent_control_audit'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated',tab);
  execute format('grant select on public.%I to authenticated',tab);
  execute format('grant all on public.%I to service_role',tab);
  execute format('drop policy if exists tenant_read on public.%I',tab);
  execute format('create policy tenant_read on public.%I for select to authenticated using(public.can_access_tenant(tenant_id) and public.has_tenant_feature(tenant_id,''ai_agent''))',tab);
 end loop;
end $$;

-- Source statement 15
grant select(agent_opted_out) on public.customers to authenticated;

-- Source statement 16
revoke select on public.agent_message_jobs,public.agent_ai_usage,public.agent_prompt_versions from authenticated;

-- Source statement 17
grant select(id,tenant_id,status,route,reason,created_at,updated_at) on public.agent_message_jobs to authenticated;

-- Source statement 18
grant select(id,tenant_id,status,input_tokens,output_tokens,cost_baht,source_ids,reason,created_at,completed_at) on public.agent_ai_usage to authenticated;

-- Source statement 19
grant select(id,tenant_id,version,actor_id,created_at) on public.agent_prompt_versions to authenticated;

-- Source statement 21
create or replace function public.record_agent_prompt() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare revision integer;actor uuid:=coalesce(auth.uid(),nullif(current_setting('snapbot.agent_actor',true),'')::uuid);
begin
 if tg_op='INSERT' or new.ai_instructions is distinct from old.ai_instructions then
  select coalesce(max(version),0)+1 into revision from public.agent_prompt_versions where tenant_id=new.tenant_id;
  insert into public.agent_prompt_versions(tenant_id,version,instructions,actor_id) values(new.tenant_id,revision,new.ai_instructions,actor);
  insert into public.agent_control_audit(tenant_id,actor_id,event,detail) values(new.tenant_id,actor,'prompt_version',revision::text);
 end if;return null;
end $$;

-- Source statement 22
drop trigger if exists bot_settings_agent_version on public.bot_settings;

-- Source statement 23
create trigger bot_settings_agent_version after insert or update of ai_instructions on public.bot_settings for each row execute function public.record_agent_prompt();

-- Source statement 24
create or replace function public.agent_customer_consent() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
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
end $$;

-- Source statement 25
drop trigger if exists messages_agent_consent on public.messages;

-- Source statement 26
create trigger messages_agent_consent after insert on public.messages for each row execute function public.agent_customer_consent();

-- Source statement 27
create or replace function public.guard_agent_consent() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.bot_enabled and new.agent_opted_out then raise exception 'Customer opted out' using errcode='42501';end if;return new;
end $$;

-- Source statement 28
drop trigger if exists customers_agent_consent_guard on public.customers;

-- Source statement 29
create trigger customers_agent_consent_guard before update of bot_enabled on public.customers for each row execute function public.guard_agent_consent();

-- Source statement 30
create or replace function public.claim_agent_message(p_tenant uuid,p_customer uuid,p_message uuid) returns setof public.agent_message_jobs language plpgsql set search_path=pg_catalog,public as $$
declare c public.customers;m public.messages;
begin
 perform 1 from public.tenants where id=p_tenant and is_active and auto_reply_enabled for update;
 if not found or not exists(select 1 from public.agent_control_settings where tenant_id=p_tenant and flags->'agent_orchestrator_enabled'='true'::jsonb) then return;end if;
 select * into c from public.customers where id=p_customer and tenant_id=p_tenant for update;
 if not found or c.id is null or c.last_message_at is null or c.last_message_at>clock_timestamp()+interval '2 minutes' or c.agent_opted_out or not c.bot_enabled or c.assigned_user_id is not null or c.conversation_status='closed' then return;end if;
 select * into m from public.messages where id=p_message and customer_id=c.id and sender='customer' and inbound_seq=c.inbound_seq;
 if not found or exists(select 1 from public.messages where external_id in ('reply:'||p_message::text,'handover:reply:'||p_message::text)) then return;end if;
 return query insert into public.agent_message_jobs(tenant_id,customer_id,message_id,inbound_seq,claim_token,claim_until) values(p_tenant,c.id,m.id,c.inbound_seq,gen_random_uuid(),clock_timestamp()+interval '3 minutes') on conflict do nothing returning *;
end $$;

-- Source statement 31
create or replace function public.start_agent_ai_call(p_tenant uuid,p_key uuid,p_customer uuid default null,p_job uuid default null,p_claim uuid default null) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
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
end $$;

-- Source statement 32
create or replace function public.begin_agent_dispatch(p_job uuid,p_claim uuid) returns boolean language plpgsql set search_path=pg_catalog,public as $$
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
end $$;

-- Source statement 33
create or replace function public.recover_agent_jobs() returns integer language plpgsql set search_path=pg_catalog,public as $$
declare n integer;
begin
 update public.agent_ai_usage u set status='review',reason='WORKER_RESTARTED',completed_at=now() from public.agent_message_jobs j where u.job_id=j.id and u.status='started' and j.status='processing' and j.claim_until<clock_timestamp();
 update public.agent_message_jobs set status='review',reason='WORKER_RESTARTED',claim_token=null,claim_until=null,updated_at=now() where status='processing' and claim_until<clock_timestamp();get diagnostics n=row_count;return n;
end $$;

-- Source statement 34
create or replace function public.agent_job_audit() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op='INSERT' or new.status is distinct from old.status then insert into public.agent_control_audit(tenant_id,event,subject_id,detail) values(new.tenant_id,'job_'||new.status,new.id,new.reason);end if;return null;
end $$;

-- Source statement 35
drop trigger if exists agent_job_audit on public.agent_message_jobs;

-- Source statement 36
create trigger agent_job_audit after insert or update on public.agent_message_jobs for each row execute function public.agent_job_audit();

-- Source statement 37
create or replace function public.save_agent_prompt(p_tenant uuid,p_actor uuid,p_instructions text) returns void language plpgsql set search_path=pg_catalog,public as $$
begin
 if not public.has_tenant_feature(p_tenant,'ai_agent') or not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Owner required' using errcode='42501';end if;
 if length(p_instructions)>8000 then raise exception 'Prompt too long' using errcode='22023';end if;
 perform set_config('snapbot.agent_actor',p_actor::text,true);
 insert into public.bot_settings(tenant_id,ai_instructions) values(p_tenant,p_instructions) on conflict(tenant_id) do update set ai_instructions=excluded.ai_instructions;
 insert into public.agent_control_audit(tenant_id,actor_id,event) values(p_tenant,p_actor,'prompt_saved');
end $$;

-- Source statement 38
create or replace function public.manage_agent_knowledge(p_tenant uuid,p_actor uuid,p_action text,p_id uuid,p_data jsonb) returns uuid language plpgsql set search_path=pg_catalog,public as $$
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
end $$;

-- Source statement 39
create or replace function public.restore_agent_prompt(p_tenant uuid,p_actor uuid,p_version integer) returns boolean language plpgsql set search_path=pg_catalog,public as $$
declare content text;
begin
 if not public.has_tenant_feature(p_tenant,'ai_agent') or not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Owner required' using errcode='42501';end if;
 select instructions into content from public.agent_prompt_versions where tenant_id=p_tenant and version=p_version;
 if not found then return false;end if;
 perform public.save_agent_prompt(p_tenant,p_actor,content);
 insert into public.agent_control_audit(tenant_id,actor_id,event,detail) values(p_tenant,p_actor,'prompt_restored',p_version::text);return true;
end $$;

-- Source statement 40
create or replace function public.agent_control_overview(p_tenant uuid) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('jobs',count(*),'sent',count(*) filter(where status='sent'),'draft',count(*) filter(where status='draft'),'review',count(*) filter(where status='review'),'handoffs',count(*) filter(where route='ADMIN'),'ai',count(*) filter(where route='AI'),'keyword',count(*) filter(where route='KEYWORD')) from public.agent_message_jobs where tenant_id=p_tenant and created_at>now()-interval '30 days'
$$;

-- Source statement 41
do $$declare fn record;begin
 for fn in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('record_agent_prompt','agent_customer_consent','guard_agent_consent','claim_agent_message','start_agent_ai_call','begin_agent_dispatch','recover_agent_jobs','agent_job_audit','restore_agent_prompt','save_agent_prompt','manage_agent_knowledge','agent_control_overview') loop
  execute format('revoke all on function %s from public,anon,authenticated',fn.signature);execute format('grant execute on function %s to service_role',fn.signature);
 end loop;
end $$;

-- Source statement 42
notify pgrst,'reload schema';

commit;
-- ============================================================================
-- 41. agent-overview.sql | Inbox, automation and commerce functions/triggers
-- SHA256: bbd87d3b0f164c778eb52983b7862d8d8cd61dfd1bf029bc68be6af164bac819
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create or replace function public.set_agent_overview_capability(p_tenant uuid,p_actor uuid,p_capability text,p_enabled boolean)
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
end $$;

-- Source statement 3
revoke all on function public.set_agent_overview_capability(uuid,uuid,text,boolean) from public,anon,authenticated;

-- Source statement 4
grant execute on function public.set_agent_overview_capability(uuid,uuid,text,boolean) to service_role;

commit;
-- ============================================================================
-- 42. ai-paid-access.sql | Inbox, automation and commerce functions/triggers
-- SHA256: 42f6eb4cf373dca787fecb745fb5089f19c610c519768fc6c63e2994dc88ade2
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create or replace function public.tenant_has_paid_ai_access(p_tenant uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.tenants t where t.id=p_tenant and t.is_active
   and t.plan in ('starter','pro') and t.plan_expires_at>now()
   and exists(select 1 from public.billing_requests r where r.tenant_id=t.id
     and r.item=t.plan and r.status='approved' and r.price_baht>0));
$$;

-- Source statement 3
revoke all on function public.tenant_has_paid_ai_access(uuid) from public,anon,authenticated;

-- Source statement 4
grant execute on function public.tenant_has_paid_ai_access(uuid) to service_role;

-- Source statement 5
insert into public.plan_features(plan,feature,enabled) values('starter','ai_agent',true),('pro','ai_agent',true)
on conflict(plan,feature) do update set enabled=true;

-- Source statement 6
create or replace function public.has_tenant_feature(p_tenant uuid,p_feature text) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.tenants t join public.plan_features f on f.plan=t.plan
   where t.id=p_tenant and t.is_active and t.plan in ('starter','pro') and t.plan_expires_at>now()
   and f.feature=p_feature and f.enabled
   and (p_feature not in ('ai_agent','image_assistant') or public.tenant_has_paid_ai_access(t.id)));
$$;

-- Source statement 7
create or replace function public.normalize_paid_ai_settings() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if public.has_tenant_feature(new.tenant_id,'ai_agent') then
   new.flags := '{"agent_control_center_enabled":true,"agent_knowledge_base_enabled":true,"agent_playground_enabled":true,"agent_analytics_enabled":true,"agent_advanced_guardrails_enabled":true}'::jsonb
     ||coalesce(new.flags,'{}'::jsonb)||jsonb_build_object('agent_control_center_enabled',true,'agent_orchestrator_enabled',new.ai_monthly_limit>0);
 end if;
 return new;
end $$;

-- Source statement 8
drop trigger if exists paid_ai_settings_ready on public.agent_control_settings;

-- Source statement 9
create trigger paid_ai_settings_ready before insert or update of ai_monthly_limit on public.agent_control_settings
for each row execute function public.normalize_paid_ai_settings();

-- Source statement 10
create or replace function public.prepare_paid_ai_purchase() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.status='approved' and new.item in ('starter','pro') and public.has_tenant_feature(new.tenant_id,'ai_agent') then
   insert into public.agent_control_settings(tenant_id) values(new.tenant_id)
   on conflict(tenant_id) do update set ai_monthly_limit=public.agent_control_settings.ai_monthly_limit;
 end if;
 return new;
end $$;

-- Source statement 11
drop trigger if exists paid_ai_purchase_ready on public.billing_requests;

-- Source statement 12
create trigger paid_ai_purchase_ready after insert or update of status on public.billing_requests
for each row execute function public.prepare_paid_ai_purchase();

-- Source statement 14
create or replace function public.start_agent_ai_call(p_tenant uuid,p_key uuid,p_customer uuid default null,p_job uuid default null,p_claim uuid default null)
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
end $$;

-- Source statement 15
revoke all on function public.start_agent_ai_call(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;

-- Source statement 16
grant execute on function public.start_agent_ai_call(uuid,uuid,uuid,uuid,uuid) to service_role;

-- Source statement 17
revoke all on function public.normalize_paid_ai_settings(),public.prepare_paid_ai_purchase() from public,anon,authenticated,service_role;

commit;
-- ============================================================================
-- 43. ai-vision.sql | Inbox, automation and commerce functions/triggers
-- SHA256: ea63d4c520548a1f13923b62491f7eff31ac55ebef4e1f51e63ae64ee7309301
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
alter table public.image_response_rules add column if not exists priority integer not null default 0 check(priority between 0 and 1000);

-- Source statement 3
create table if not exists public.vision_plan_limits(
 plan text primary key check(plan in ('free','starter','pro')),monthly_images integer not null check(monthly_images>=0),product_search boolean not null default false
);

-- Source statement 4
insert into public.vision_plan_limits values('free',0,false),('starter',100,false),('pro',1000,true) on conflict do nothing;

-- Source statement 5
alter table public.vision_plan_limits enable row level security;

-- Source statement 6
revoke all on public.vision_plan_limits from public,anon,authenticated;

-- Source statement 7
grant all on public.vision_plan_limits to service_role;

-- Source statement 8
create table if not exists public.vision_settings(
 tenant_id uuid primary key references public.tenants(id) on delete cascade,enabled boolean not null default false,
 mode text not null default 'rules' check(mode in ('rules','catalog')),confidence_threshold numeric not null default 0.8 check(confidence_threshold between 0.8 and 1),handoff_enabled boolean not null default true
);

-- Source statement 9
create table if not exists public.vision_usage(
 tenant_id uuid not null references public.tenants(id) on delete cascade,month date not null,used integer not null default 0 check(used>=0),primary key(tenant_id,month)
);

-- Source statement 10
create table if not exists public.vision_jobs(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),customer_id uuid references public.customers(id),message_id uuid references public.messages(id),
 source text not null check(source in ('test','messenger')),idempotency_key text not null check(length(idempotency_key) between 1 and 200),
 image_path text not null,mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp')),
 status text not null default 'pending' check(status in ('pending','processing','completed','failed','requires_review','cancelled')),
 claim_token uuid,claim_until timestamptz,analysis_started_at timestamptz,dispatch_started_at timestamptz,
 ai_request_started_at timestamptz,usage_month date,quota_reserved boolean not null default false,attempts integer not null default 0,
 result jsonb,decision jsonb,reason text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(tenant_id,source,idempotency_key),check((source='test' and customer_id is null and message_id is null) or (source='messenger' and customer_id is not null and message_id is not null))
);

-- Source statement 11
create index if not exists vision_jobs_pending on public.vision_jobs(created_at) where status='pending';

-- Source statement 12
create table if not exists public.vision_audit_logs(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),job_id uuid references public.vision_jobs(id),actor_id uuid references auth.users(id),event text not null,detail text,created_at timestamptz not null default now()
);

-- Source statement 13
do $$declare tab text;begin
 foreach tab in array array['vision_settings','vision_usage','vision_jobs','vision_audit_logs'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated',tab);
  execute format('grant select on public.%I to authenticated',tab);
  execute format('grant all on public.%I to service_role',tab);
  execute format('drop policy if exists tenant_read on public.%I',tab);
  execute format('create policy tenant_read on public.%I for select to authenticated using(public.can_access_tenant(tenant_id) and public.has_tenant_feature(tenant_id,''image_assistant''))',tab);
 end loop;
end $$;

-- Source statement 14
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('vision-images','vision-images',false,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;

-- Source statement 15
update storage.buckets set public=false,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'] where id='vision-images';

-- Source statement 16
create or replace function public.vision_job_audit() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op='INSERT' or new.status is distinct from old.status then
  insert into public.vision_audit_logs(tenant_id,job_id,event,detail) values(new.tenant_id,new.id,new.status,new.reason);
 end if;return new;
end $$;

-- Source statement 17
create or replace function public.retry_unstarted_vision(p_job uuid,p_tenant uuid,p_actor uuid) returns boolean
language plpgsql set search_path=pg_catalog,public as $$
declare changed uuid;
begin
 if not public.has_tenant_feature(p_tenant,'image_assistant') or not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Forbidden' using errcode='42501';end if;
 -- Only a request which has NEVER reached the provider is safe to automatically retry.
 update public.vision_jobs set status='pending',reason=null where id=p_job and tenant_id=p_tenant and status in ('requires_review','cancelled') and ai_request_started_at is null and dispatch_started_at is null and not quota_reserved and attempts<3 returning id into changed;
 if changed is not null then insert into public.vision_audit_logs(tenant_id,job_id,actor_id,event) values(p_tenant,p_job,p_actor,'safe_retry');end if;
 return changed is not null;
end $$;

-- Source statement 18
revoke all on function public.retry_unstarted_vision(uuid,uuid,uuid) from public,anon,authenticated;

-- Source statement 19
grant execute on function public.retry_unstarted_vision(uuid,uuid,uuid) to service_role;

-- Source statement 20
drop trigger if exists vision_job_audit on public.vision_jobs;

-- Source statement 21
create trigger vision_job_audit after insert or update on public.vision_jobs for each row execute function public.vision_job_audit();

-- Source statement 22
create or replace function public.claim_vision_job(p_job uuid default null) returns setof public.vision_jobs
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
end $$;

-- Source statement 23
create or replace function public.start_vision_analysis(p_job uuid,p_claim uuid) returns boolean
language plpgsql set search_path=pg_catalog,public as $$
declare j public.vision_jobs;
begin
 select * into j from public.vision_jobs where id=p_job for update;
 if not found or j.status<>'processing' or j.claim_token is distinct from p_claim or j.claim_until<=clock_timestamp() or j.ai_request_started_at is not null or not j.quota_reserved then return false;end if;
 if not public.has_tenant_feature(j.tenant_id,'image_assistant') then return false;end if;
 if j.source='messenger' and (not exists(select 1 from public.vision_settings where tenant_id=j.tenant_id and enabled) or not exists(select 1 from public.customers c join public.tenants t on t.id=c.tenant_id where c.id=j.customer_id and c.tenant_id=j.tenant_id and c.bot_enabled and c.assigned_user_id is null and c.conversation_status<>'closed' and t.auto_reply_enabled)) then return false;end if;
 update public.vision_jobs set ai_request_started_at=clock_timestamp() where id=j.id;return true;
end $$;

-- Source statement 24
create or replace function public.refund_unstarted_vision(p_job uuid,p_claim uuid) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare j public.vision_jobs;
begin
 select * into j from public.vision_jobs where id=p_job for update;
 if found and j.status='processing' and j.claim_token=p_claim and j.ai_request_started_at is null and j.quota_reserved then
  update public.vision_usage set used=greatest(0,used-1) where tenant_id=j.tenant_id and month=j.usage_month;
  update public.vision_jobs set quota_reserved=false where id=j.id;
 end if;
end $$;

-- Source statement 25
revoke all on function public.start_vision_analysis(uuid,uuid),public.refund_unstarted_vision(uuid,uuid) from public,anon,authenticated;

-- Source statement 26
grant execute on function public.start_vision_analysis(uuid,uuid),public.refund_unstarted_vision(uuid,uuid) to service_role;

-- Source statement 27
create or replace function public.begin_vision_dispatch(p_job uuid,p_claim uuid) returns boolean
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
end $$;

-- Source statement 28
create or replace function public.save_vision_settings(p_tenant uuid,p_actor uuid,p_enabled boolean,p_mode text,p_confidence numeric,p_handoff boolean) returns void
language plpgsql set search_path=pg_catalog,public as $$
begin
 if not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or exists(select 1 from public.platform_admins where user_id=p_actor)) or not public.has_tenant_feature(p_tenant,'image_assistant') then raise exception 'FEATURE_LOCKED' using errcode='42501';end if;
 if p_mode='catalog' and (not public.has_tenant_feature(p_tenant,'ai_agent') or not exists(select 1 from public.tenants t join public.vision_plan_limits l on l.plan=t.plan where t.id=p_tenant and l.product_search)) then raise exception 'FEATURE_LOCKED: product_search' using errcode='42501';end if;
 insert into public.vision_settings(tenant_id,enabled,mode,confidence_threshold,handoff_enabled) values(p_tenant,p_enabled,p_mode,p_confidence,p_handoff)
 on conflict(tenant_id) do update set enabled=excluded.enabled,mode=excluded.mode,confidence_threshold=excluded.confidence_threshold,handoff_enabled=excluded.handoff_enabled;
 insert into public.vision_audit_logs(tenant_id,actor_id,event,detail) values(p_tenant,p_actor,'settings_updated',case when p_enabled then 'enabled' else 'disabled' end);
end $$;

-- Source statement 29
create or replace function public.audit_image_rule_change() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 insert into public.vision_audit_logs(tenant_id,actor_id,event,detail) values(case when tg_op='DELETE' then old.tenant_id else new.tenant_id end,auth.uid(),'rule_'||lower(tg_op),case when tg_op='DELETE' then old.id::text else new.id::text end);
 return null;
end $$;

-- Source statement 30
drop trigger if exists image_rule_vision_audit on public.image_response_rules;

-- Source statement 31
create trigger image_rule_vision_audit after insert or update or delete on public.image_response_rules for each row execute function public.audit_image_rule_change();

-- Source statement 32
revoke all on function public.begin_vision_dispatch(uuid,uuid),public.save_vision_settings(uuid,uuid,boolean,text,numeric,boolean),public.audit_image_rule_change() from public,anon,authenticated;

-- Source statement 33
grant execute on function public.begin_vision_dispatch(uuid,uuid),public.save_vision_settings(uuid,uuid,boolean,text,numeric,boolean) to service_role;

-- Source statement 34
revoke all on function public.claim_vision_job(uuid),public.vision_job_audit() from public,anon,authenticated;

-- Source statement 35
grant execute on function public.claim_vision_job(uuid) to service_role;

-- Source statement 36
notify pgrst,'reload schema';

commit;
-- ============================================================================
-- 44. commerce-v2.sql | Inbox, automation and commerce functions/triggers
-- SHA256: 40a75be6ce40169b82de51925d8b2fa5232cba8bc4fe1a985a5f2e9ec32b409a
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create table if not exists commerce_limits (
 plan text primary key, max_products integer check(max_products>=0), max_pages integer not null default 1 check(max_pages>=0),
 checkout boolean not null default false, reports boolean not null default false, advanced_templates boolean not null default false
);

-- Source statement 3
insert into commerce_limits values('free',null,1,false,false,false),('starter',null,3,true,true,false),('pro',null,10,true,true,true) on conflict do nothing;

-- Source statement 4
create table if not exists commerce_stores (
 tenant_id uuid primary key references tenants(id), slug text not null unique check(slug~'^[a-z0-9]+(-[a-z0-9]+)*$'),
 name text not null, description text not null default '', logo text not null default '', banner text not null default '', contact text not null default '',
 is_open boolean not null default false, updated_at timestamptz not null default now()
);

-- Source statement 5
create table if not exists commerce_categories (id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),name text not null check(length(trim(name)) between 1 and 80),unique(tenant_id,name));

-- Source statement 6
alter table products add column if not exists commerce_category_id uuid references commerce_categories(id);

-- Source statement 7
alter table products add column if not exists commerce_images jsonb not null default '[]';

-- Source statement 8
alter table products add column if not exists commerce_compare_price numeric(12,2);

-- Source statement 9
alter table products add column if not exists commerce_cost numeric(12,2);

-- Source statement 10
alter table products add column if not exists commerce_featured boolean not null default false;

-- Source statement 11
alter table products add column if not exists commerce_archived boolean not null default false;

-- Source statement 12
drop index if exists public.products_tenant_code;

-- Source statement 13
create unique index products_tenant_code on public.products(tenant_id,lower(code)) where not commerce_archived;

-- Source statement 14
alter table products add column if not exists commerce_version integer not null default 0;

-- Source statement 15
create table if not exists commerce_variants (id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),product_id uuid not null references products(id),label text not null,price numeric(12,2) not null check(price>0),stock integer not null check(stock>=0),is_active boolean not null default true);

-- Source statement 16
create index if not exists commerce_variant_product on commerce_variants(tenant_id,product_id);

-- Source statement 17
create table if not exists commerce_pages (id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),slug text not null,name text not null,draft jsonb not null,published jsonb,published_at timestamptz,version integer not null default 0,unique(tenant_id,slug));

-- Source statement 18
create table if not exists commerce_customers (id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),name text not null,phone text not null,address text not null,crm_customer_id uuid references customers(id),created_at timestamptz not null default now(),unique(tenant_id,phone));

-- Source statement 19
create table if not exists commerce_orders (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),customer_id uuid not null references commerce_customers(id),
 request_key uuid not null,payload jsonb not null,number text not null unique default ('SB-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,16))),
 status text not null default 'pending_payment' check(status in ('pending_payment','payment_review','paid','preparing','shipped','completed','cancelled')),
 total numeric(12,2) not null default 0,shipping jsonb not null,tracking text,created_at timestamptz not null default now(),paid_at timestamptz,unique(tenant_id,request_key)
);

-- Source statement 20
create table if not exists commerce_order_items (id uuid primary key default gen_random_uuid(),order_id uuid not null references commerce_orders(id),tenant_id uuid not null references tenants(id),product_id uuid not null references products(id),variant_id uuid references commerce_variants(id),name text not null,variant_label text,qty integer not null check(qty between 1 and 99),price numeric(12,2) not null check(price>0));

-- Source statement 21
create table if not exists commerce_audit (id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),actor_id uuid,entity_id uuid,action text not null,detail text not null default '',created_at timestamptz not null default now());

-- Source statement 22
create table if not exists commerce_rate (bucket text not null,period bigint not null,hits integer not null default 1,primary key(bucket,period));

-- Source statement 23
create index if not exists commerce_orders_recent on commerce_orders(tenant_id,created_at desc);

-- Source statement 24
create index if not exists commerce_orders_customer on commerce_orders(tenant_id,customer_id);

-- Source statement 25
create index if not exists commerce_items_order on commerce_order_items(order_id,product_id,variant_id);

-- Source statement 26
create index if not exists commerce_audit_recent on commerce_audit(tenant_id,created_at desc);

-- Source statement 27
create index if not exists commerce_rate_expiry on commerce_rate(period);

-- Source statement 28
create index if not exists commerce_products_category on products(tenant_id,commerce_category_id) where not commerce_archived;

-- Source statement 29
do $$declare t text;begin foreach t in array array['commerce_limits','commerce_stores','commerce_categories','commerce_variants','commerce_pages','commerce_customers','commerce_orders','commerce_order_items','commerce_audit','commerce_rate'] loop
 execute format('alter table %I enable row level security',t);execute format('revoke all on %I from public,anon,authenticated',t);execute format('grant all on %I to service_role',t);end loop;end$$;

-- Source statement 30
create or replace function commerce_access(p_tenant uuid,p_actor uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$begin
 if not exists(select 1 from tenants where id=p_tenant and is_active) or not (exists(select 1 from tenant_members where tenant_id=p_tenant and user_id=p_actor and role in ('owner','admin')) or exists(select 1 from platform_admins where user_id=p_actor)) then raise exception 'COMMERCE_FORBIDDEN' using errcode='42501';end if;
end$$;

-- Source statement 31
create or replace function commerce_plan(p_tenant uuid) returns commerce_limits language sql stable security definer set search_path=pg_catalog,public as $$
 select l.* from tenants t join commerce_limits l on l.plan=case when t.plan in ('starter','pro') and t.plan_expires_at>now() then t.plan else 'free' end where t.id=p_tenant and t.is_active
$$;

-- Source statement 32
create or replace function commerce_rate_limit(p_bucket text,p_max integer) returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$declare n integer;window_period bigint:=floor(extract(epoch from clock_timestamp())/60);begin
 delete from commerce_rate where commerce_rate.period<window_period-10;
 insert into commerce_rate(bucket,period) values(p_bucket,window_period) on conflict(bucket,period) do update set hits=commerce_rate.hits+1 returning hits into n;return n<=p_max;
end$$;

-- Source statement 33
create or replace function commerce_product_version() returns trigger language plpgsql set search_path=pg_catalog,public as $$begin new.commerce_version:=old.commerce_version+1;return new;end$$;

-- Source statement 34
drop trigger if exists commerce_product_version on products;

-- Source statement 35
create trigger commerce_product_version before update on products for each row execute function commerce_product_version();

-- Source statement 36
create or replace function commerce_product_quota() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$declare l commerce_limits;begin
 perform 1 from tenants where id=new.tenant_id for update;l:=commerce_plan(new.tenant_id);
 if l.max_products is not null and (select count(*) from products where tenant_id=new.tenant_id and not commerce_archived)>=l.max_products then raise exception 'COMMERCE_LIMIT' using errcode='42501';end if;return new;
end$$;

-- Source statement 37
drop trigger if exists commerce_product_quota on products;

-- Source statement 38
create trigger commerce_product_quota before insert on products for each row execute function commerce_product_quota();

-- Source statement 39
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

-- Source statement 40
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

-- Source statement 41
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

-- Source statement 42
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

-- Source statement 43
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

-- Source statement 44
revoke execute on function place_cf_order(uuid,uuid,uuid,text) from public,anon,authenticated;

-- Source statement 45
grant execute on function place_cf_order(uuid,uuid,uuid,text) to service_role;

-- Source statement 46
do $$declare r record;begin for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('commerce_access','commerce_plan','commerce_rate_limit','commerce_save_product','commerce_checkout','commerce_move_order','commerce_manage') loop
 execute format('revoke all on function %s from public,anon,authenticated',r.signature);execute format('grant execute on function %s to service_role',r.signature);end loop;end$$;

commit;
-- ============================================================================
-- 45. product-sku-reuse.sql | Inbox, automation and commerce functions/triggers
-- SHA256: 158567cbd1962b8e6c75c72a9f5aaa52aceb26c84b9fc2c7bb4a7f24c41c41f4
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- No additional statements: current schema already contains this patch.

commit;
-- ============================================================================
-- 46. payment-pro.sql | Inbox, automation and commerce functions/triggers
-- SHA256: aa6343641fb6d1c026a0913c81d79d990c295c23e9de63e41bfd42d3cdb7e148
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create table if not exists public.payment_pro_settings(
 tenant_id uuid primary key references public.tenants(id),enabled boolean not null default false,
 flags jsonb not null default '{}' check(jsonb_typeof(flags)='object')
);

-- Source statement 3
create table if not exists public.payment_pro_attempts(
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
);

-- Source statement 4
create table if not exists public.payment_pro_audit(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),attempt_id uuid references public.payment_pro_attempts(id),
 actor_id uuid references auth.users(id),event text not null,reason text,created_at timestamptz not null default now()
);

-- Source statement 5
create index if not exists payment_pro_review_queue on public.payment_pro_attempts(tenant_id,created_at desc) where status='REVIEW_REQUIRED';

-- Source statement 6
create index if not exists payment_pro_recovery on public.payment_pro_attempts(claim_until) where status='VERIFYING';

-- Source statement 7
do $$declare tab text;begin
 foreach tab in array array['payment_pro_settings','payment_pro_attempts','payment_pro_audit'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated',tab);
  execute format('grant select on public.%I to authenticated',tab);
  execute format('grant all on public.%I to service_role',tab);
  execute format('drop policy if exists tenant_read on public.%I',tab);
  execute format('create policy tenant_read on public.%I for select to authenticated using(public.can_access_tenant(tenant_id) and public.has_tenant_feature(tenant_id,''slip_auto_pilot''))',tab);
 end loop;
end $$;

-- Source statement 8
revoke select on public.payment_pro_attempts from authenticated;

-- Source statement 9
grant select(id,tenant_id,customer_id,slip_id,message_id,status,reason,expected_satang,eligible,credit_charged,credit_refunded,provider_started_at,created_at,updated_at) on public.payment_pro_attempts to authenticated;

-- Source statement 10
alter table public.payment_image_ledger drop constraint if exists payment_image_ledger_source_check;

-- Source statement 11
alter table public.payment_image_ledger add constraint payment_image_ledger_source_check check(source in ('package','billing','sale_pro'));

-- Source statement 12
create or replace function public.payment_pro_state_guard() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.status<>old.status and not (
  old.status='PENDING' and new.status in ('VERIFYING','CANCELLED') or
  old.status='VERIFYING' and new.status in ('VERIFIED','REVIEW_REQUIRED','REJECTED') or
  old.status='REVIEW_REQUIRED' and new.status in ('VERIFYING','VERIFIED','REJECTED','CANCELLED')) then
  raise exception 'Invalid payment transition' using errcode='40001';end if;
 if new.tenant_id<>old.tenant_id or new.slip_id<>old.slip_id or new.proof_sha256<>old.proof_sha256 or new.customer_id is distinct from old.customer_id then raise exception 'Payment identity immutable';end if;
 new.updated_at:=now();return new;
end $$;

-- Source statement 13
drop trigger if exists payment_pro_state_guard on public.payment_pro_attempts;

-- Source statement 14
create trigger payment_pro_state_guard before update on public.payment_pro_attempts for each row execute function public.payment_pro_state_guard();

-- Source statement 15
create or replace function public.payment_pro_audit_state() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op='INSERT' or new.status is distinct from old.status or new.reason is distinct from old.reason then
  insert into public.payment_pro_audit(tenant_id,attempt_id,event,reason) values(new.tenant_id,new.id,new.status,new.reason);
 end if;return null;
end $$;

-- Source statement 16
drop trigger if exists payment_pro_audit_state on public.payment_pro_attempts;

-- Source statement 17
create trigger payment_pro_audit_state after insert or update on public.payment_pro_attempts for each row execute function public.payment_pro_audit_state();

-- Source statement 18
create or replace function public.payment_pro_bank(p_bank text) returns text language sql immutable set search_path=pg_catalog,public as $$
 select case upper(trim(p_bank)) when 'KBANK' then '004' when 'SCB' then '014' when 'BBL' then '002' when 'KTB' then '006' when 'BAY' then '025' when 'TTB' then '011' when 'TMB' then '011' when 'TTBNK' then '011' when 'GSB' then '030' else case when trim(p_bank)~'^[0-9]{1,3}$' then lpad(trim(p_bank),3,'0') else upper(trim(p_bank)) end end
$$;

-- Source statement 19
create or replace function public.payment_pro_account(p_full text,p_mask text) returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
declare full_no text:=regexp_replace(coalesce(p_full,''),'[^0-9]','','g');masked text:=lower(regexp_replace(replace(coalesce(p_mask,''),'*','x'),'[^0-9xX]','','g'));i integer;parts text[];
begin
 if length(regexp_replace(masked,'x','','g'))<3 or full_no='' then return false;end if;
 if length(full_no)=length(masked) then
  for i in 1..length(masked) loop if substr(masked,i,1)<>'x' and substr(masked,i,1)<>substr(full_no,i,1) then return false;end if;end loop;return true;
 end if;
 parts:=regexp_match(masked,'^([0-9]*)x+([0-9]*)$');
 return coalesce(parts is not null and length(parts[1])+length(parts[2])<=length(full_no) and starts_with(full_no,parts[1]) and right(full_no,length(parts[2]))=parts[2],false);
end $$;

-- Source statement 20
create or replace function public.payment_pro_receiver(p_tenant uuid,p_bank text,p_account text,p_proxy text) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.bank_accounts b where b.tenant_id=p_tenant and b.is_active and
  case when b.bank_code='PROMPTPAY' then public.payment_pro_account(b.account_number,regexp_replace(regexp_replace(coalesce(p_proxy,''),'[[:space:]-]','','g'),'^(\+?66|0066)(?=[0-9xX*]{9}$)','0'))
  else public.payment_pro_bank(b.bank_code)=public.payment_pro_bank(p_bank) and public.payment_pro_account(b.account_number,p_account) end)
$$;

-- Source statement 21
create or replace function public.claim_payment_pro(p_tenant uuid,p_customer uuid,p_message uuid,p_hash text,p_image text,p_kind text) returns jsonb
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
end $$;

-- Source statement 22
create or replace function public.start_payment_pro_provider(p_attempt uuid,p_claim uuid) returns boolean language plpgsql set search_path=pg_catalog,public as $$
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
end $$;

-- Source statement 23
create or replace function public.apply_payment_pro(p_attempt uuid,p_actor uuid default null) returns boolean language plpgsql set search_path=pg_catalog,public as $$
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
end $$;

-- Source statement 24
create or replace function public.complete_payment_pro(p_attempt uuid,p_claim uuid,p_evidence jsonb) returns void language plpgsql set search_path=pg_catalog,public as $$
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
end $$;

-- Source statement 25
create or replace function public.review_payment_pro_failure(p_attempt uuid,p_claim uuid) returns void language plpgsql set search_path=pg_catalog,public as $$
declare a public.payment_pro_attempts;
begin
 select * into a from public.payment_pro_attempts where id=p_attempt for update;
 if found and a.status='VERIFYING' and a.claim_token=p_claim then
  update public.payment_pro_attempts set status='REVIEW_REQUIRED',reason=case when provider_started_at is null then 'PROCESSING_FAILED_BEFORE_PROVIDER' else 'PROVIDER_RESULT_UNKNOWN' end,claim_token=null,claim_until=null where id=a.id;
  update public.slips set status='error',note='รอตรวจสอบเพิ่มเติม ระบบไม่ลองเรียก Provider ซ้ำอัตโนมัติ',verified_at=now() where id=a.slip_id;
 end if;
end $$;

-- Source statement 26
create or replace function public.recover_payment_pro() returns integer language plpgsql set search_path=pg_catalog,public as $$
declare a public.payment_pro_attempts;n integer:=0;
begin
 for a in select * from public.payment_pro_attempts where status='VERIFYING' and claim_until<clock_timestamp() for update skip locked loop
  perform public.review_payment_pro_failure(a.id,a.claim_token);n:=n+1;
 end loop;return n;
end $$;

-- Source statement 27
create or replace function public.act_payment_pro(p_attempt uuid,p_tenant uuid,p_actor uuid,p_action text,p_reason text) returns boolean language plpgsql set search_path=pg_catalog,public as $$
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
end $$;

-- Source statement 28
create or replace function public.payment_pro_overview(p_tenant uuid) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('total',count(*),'verified',count(*) filter(where status='VERIFIED'),'review',count(*) filter(where status='REVIEW_REQUIRED'),
 'duplicates',count(*) filter(where reason='DUPLICATE_TRANSACTION'),'amountMismatch',count(*) filter(where reason='AMOUNT_MISMATCH'),
 'receiverMismatch',count(*) filter(where reason in ('RECEIVER_NOT_CONFIRMED','RECEIVER_CHANGED')),
 'charged',count(*) filter(where credit_charged),'refunded',count(*) filter(where credit_refunded),
 'verifiedSatang',coalesce(sum(expected_satang) filter(where status='VERIFIED'),0))
 from public.payment_pro_attempts where tenant_id=p_tenant and created_at>now()-interval '30 days'
$$;

-- Source statement 29
create or replace function public.guard_payment_pro_slip() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if (new.status='valid' or new.approved_at is not null) and exists(select 1 from public.payment_pro_attempts where slip_id=new.id and status<>'VERIFIED') then raise exception 'Payment Pro proof approval required' using errcode='42501';end if;return new;
end $$;

-- Source statement 30
drop trigger if exists slips_payment_pro_guard on public.slips;

-- Source statement 31
create trigger slips_payment_pro_guard before update on public.slips for each row execute function public.guard_payment_pro_slip();

-- Source statement 32
create or replace function public.guard_payment_pro_order() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.status='paid' and (old.status is distinct from new.status or old.slip_id is distinct from new.slip_id) and exists(select 1 from public.payment_pro_attempts where slip_id=new.slip_id) and not exists(select 1 from public.payment_pro_attempts a where a.slip_id=new.slip_id and a.status='VERIFIED' and a.tenant_id=new.tenant_id and a.customer_id=new.customer_id and new.id=any(a.order_ids)) then
  raise exception 'Payment Pro order snapshot required' using errcode='42501';end if;return new;
end $$;

-- Source statement 33
drop trigger if exists orders_payment_pro_guard on public.orders;

-- Source statement 34
create trigger orders_payment_pro_guard before update of status,slip_id on public.orders for each row execute function public.guard_payment_pro_order();

-- Source statement 35
do $$declare fn record;begin
 for fn in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like '%payment_pro%' or p.proname in ('payment_pro_bank','payment_pro_account','payment_pro_receiver')) loop
  execute format('revoke all on function %s from public,anon,authenticated',fn.signature);
  execute format('grant execute on function %s to service_role',fn.signature);
 end loop;
end $$;

-- Source statement 36
notify pgrst,'reload schema';

commit;
-- ============================================================================
-- 47. payment-pro-dashboard.sql | Inbox, automation and commerce functions/triggers
-- SHA256: 8d4e52e0d834ca8ce7cab97c2b78209535263726b7c5d1796ba4398b7ae54b7b
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create or replace function public.payment_pro_dashboard_report(p_tenant uuid,p_from timestamptz,p_to timestamptz,p_query text default '') returns jsonb
language sql stable set search_path=pg_catalog,public as $$
 with scoped as(select * from public.payment_pro_attempts where tenant_id=p_tenant and created_at>=p_from and created_at<p_to),
 matched as(select * from scoped where coalesce(p_query,'')='' or strpos(lower(coalesce(reason,'')),lower(p_query))>0),
 daily as(select (created_at at time zone 'Asia/Bangkok')::date bucket,count(*) total,count(*) filter(where status='VERIFIED') verified,coalesce(sum(expected_satang) filter(where status='VERIFIED'),0) satang from scoped group by 1),
 days as(select generate_series((p_from at time zone 'Asia/Bangkok')::date,(p_to at time zone 'Asia/Bangkok')::date,interval '1 day')::date bucket)
 select jsonb_build_object('attempts',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from(select id,slip_id,customer_id,status,reason,expected_satang,eligible,credit_charged,credit_refunded,provider_started_at,created_at,updated_at from matched order by created_at desc,id limit 500)r),
 'stats',(select jsonb_build_object('total',count(*),'verified',count(*) filter(where status='VERIFIED'),'review',count(*) filter(where status in ('PENDING','VERIFYING','REVIEW_REQUIRED')),'rejected',count(*) filter(where status='REJECTED'),'cancelled',count(*) filter(where status='CANCELLED'),'duplicates',count(*) filter(where reason='DUPLICATE_TRANSACTION'),'amountMismatch',count(*) filter(where reason='AMOUNT_MISMATCH'),'receiverMismatch',count(*) filter(where reason in ('RECEIVER_NOT_CONFIRMED','RECEIVER_CHANGED')),'charged',count(*) filter(where credit_charged),'refunded',count(*) filter(where credit_refunded),'verifiedSatang',coalesce(sum(expected_satang) filter(where status='VERIFIED'),0)) from scoped),
 'series',(select jsonb_agg(jsonb_build_object('day',d.bucket,'amount',coalesce(r.satang,0)/100.0,'count',coalesce(r.total,0)) order by d.bucket) from days d left join daily r using(bucket)))
$$;

-- Source statement 3
revoke all on function public.payment_pro_dashboard_report(uuid,timestamptz,timestamptz,text) from public,anon,authenticated;

-- Source statement 4
grant execute on function public.payment_pro_dashboard_report(uuid,timestamptz,timestamptz,text) to service_role;

-- Source statement 5
notify pgrst,'reload schema';

commit;
-- ============================================================================
-- 48. slip-bank-controls.sql | Inbox, automation and commerce functions/triggers
-- SHA256: 08d19ff46fa0d05b9a42f710ea11f212756e4a95fea9440d221bce1b808f98e3
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
alter table public.bank_accounts add column if not exists is_primary boolean not null default false;

-- Source statement 4
create unique index if not exists bank_accounts_one_primary on public.bank_accounts(tenant_id) where is_primary;

-- Source statement 5
create table if not exists public.bank_account_audit(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),account_id uuid,actor_id uuid references auth.users(id),action text not null,last_four text,created_at timestamptz not null default now());

-- Source statement 6
alter table public.bank_account_audit enable row level security;

-- Source statement 7
revoke all on public.bank_account_audit from public,anon,authenticated;

-- Source statement 8
grant select,insert on public.bank_account_audit to service_role;

-- Source statement 9
create or replace function public.sync_primary_bank_account() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare target uuid;selected public.bank_accounts;
begin
 target:=case when tg_op='DELETE' then old.tenant_id else new.tenant_id end;
 if tg_op='UPDATE' and new.tenant_id<>old.tenant_id then raise exception 'Cannot move bank accounts between shops';end if;
 perform 1 from public.tenants where id=target for update;
 select * into selected from public.bank_accounts where tenant_id=target and is_active order by is_primary desc,created_at,id limit 1;
 update public.tenants set bank_code=selected.bank_code,account_name=selected.account_name,account_number=selected.account_number where id=target;
 return null;
end $$;

-- Source statement 10
revoke insert,update,delete on public.bank_accounts from authenticated;

-- Source statement 11
drop policy if exists member_read on public.bank_accounts;

-- Source statement 12
drop policy if exists owner_write on public.bank_accounts;

-- Source statement 13
drop policy if exists owner_read on public.bank_accounts;

-- Source statement 14
create policy owner_read on public.bank_accounts for select to authenticated using(public.can_manage_bank_accounts(tenant_id));

-- Source statement 15
revoke select(account_number) on public.tenants from authenticated;

-- Source statement 16
create or replace function public.manage_slip_bank_account(p_tenant uuid,p_actor uuid,p_action text,p_id uuid default null,p_data jsonb default '{}',p_confirmed boolean default false) returns uuid
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
end $$;

-- Source statement 17
revoke all on function public.manage_slip_bank_account(uuid,uuid,text,uuid,jsonb,boolean) from public,anon,authenticated;

-- Source statement 18
grant execute on function public.manage_slip_bank_account(uuid,uuid,text,uuid,jsonb,boolean) to service_role;

-- Source statement 19
create or replace function public.seed_tenant_bank_account() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 update public.tenants set bank_accounts_migrated=true where id=new.id;
 if new.bank_code in ('KBANK','SCB','BBL','KTB','BAY','TTB','GSB','PROMPTPAY') and new.account_number ~ '^[0-9]{10,15}$' then
  insert into public.bank_accounts(tenant_id,bank_code,account_name,account_number,is_primary)
  values(new.id,new.bank_code,coalesce(nullif(trim(new.account_name),''),new.name),new.account_number,true) on conflict do nothing;
 end if;
 return null;
end $$;

-- Source statement 20
revoke all on function public.seed_tenant_bank_account() from public,anon,authenticated;

-- Source statement 21
notify pgrst,'reload schema';

commit;
-- ============================================================================
-- 49. bank-registry.sql | Inbox, automation and commerce functions/triggers
-- SHA256: 9552aa3856ddf0c584f98f7ac722bc877e9a1a89617d0dd0c2dd5a1d7914b4d0
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create or replace function public.bank_registry_code_valid(p_code text) returns boolean
language sql immutable set search_path=pg_catalog,public as $$
 select coalesce(p_code in ('KBANK','SCB','KTB','BBL','BAY','KKP','CLICX','JPM','CITI','CIMB','SMTB','SMBC','DB','TTB','TISCO','TCRB','BNP','PROMPTPAY','SME','BAAC','EXIM','MHCB','MEGA','UOB','LH','SCBT','BOC','BOFA','GSB','GHB','RHB','IOB','IBANK','OCBC','ICBC','HSBC'),false)
$$;

-- Source statement 3
alter table public.bank_accounts drop constraint if exists bank_accounts_bank_code_check;

-- Source statement 4
alter table public.bank_accounts drop constraint if exists bank_accounts_bank_code_registry_check;

-- Source statement 5
alter table public.bank_accounts add constraint bank_accounts_bank_code_registry_check check(public.bank_registry_code_valid(bank_code));

-- Source statement 6
create or replace function public.seed_tenant_bank_account() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 update public.tenants set bank_accounts_migrated=true where id=new.id;
 if public.bank_registry_code_valid(new.bank_code) and new.account_number ~ '^[0-9]{10,15}$' then
  insert into public.bank_accounts(tenant_id,bank_code,account_name,account_number,is_primary)
  values(new.id,new.bank_code,coalesce(nullif(trim(new.account_name),''),new.name),new.account_number,true) on conflict do nothing;
 end if;
 return null;
end $$;

-- Source statement 7
revoke all on function public.seed_tenant_bank_account() from public,anon,authenticated;

-- Source statement 8
notify pgrst,'reload schema';

commit;
-- ============================================================================
-- 50. payment-receiving-codes.sql | Inbox, automation and commerce functions/triggers
-- SHA256: 69d202f61858dbf27aaffa6a93e201b0fe43cb15e22fc579fbe82d1bca342826
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create table if not exists public.payment_receiving_codes(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 account_id uuid not null references public.bank_accounts(id),actor_id uuid not null references auth.users(id),
 request_id uuid not null,label text not null check(length(trim(label)) between 1 and 100),
 payload text not null check(length(payload) between 20 and 1024),
 recipient_snapshot text not null,amount_satang bigint check(amount_satang between 1 and 9999999999),
 order_id uuid references public.orders(id),source text not null check(source in ('generated','imported')),
 is_active boolean not null default true,created_at timestamptz not null default now(),
 unique(tenant_id,actor_id,request_id)
);

-- Source statement 3
create index if not exists receiving_codes_shop on public.payment_receiving_codes(tenant_id,created_at desc);

-- Source statement 4
create table if not exists public.payment_receiving_audit(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 code_id uuid not null references public.payment_receiving_codes(id),actor_id uuid not null references auth.users(id),
 action text not null,created_at timestamptz not null default now()
);

-- Source statement 5
alter table public.payment_receiving_codes enable row level security;

-- Source statement 6
alter table public.payment_receiving_audit enable row level security;

-- Source statement 7
revoke all on public.payment_receiving_codes,public.payment_receiving_audit from public,anon,authenticated;

-- Source statement 8
grant select,insert,update on public.payment_receiving_codes to service_role;

-- Source statement 9
grant select,insert on public.payment_receiving_audit to service_role;

-- Source statement 10
create or replace function public.save_payment_receiving_code(p_tenant uuid,p_actor uuid,p_key uuid,p_account uuid,p_label text,p_payload text,p_recipient text,p_amount bigint,p_order uuid default null,p_source text default 'generated') returns uuid
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
end $$;

-- Source statement 11
create or replace function public.set_payment_receiving_code_active(p_tenant uuid,p_actor uuid,p_id uuid,p_active boolean) returns void
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
end $$;

-- Source statement 12
revoke all on function public.save_payment_receiving_code(uuid,uuid,uuid,uuid,text,text,text,bigint,uuid,text),public.set_payment_receiving_code_active(uuid,uuid,uuid,boolean) from public,anon,authenticated;

-- Source statement 13
grant execute on function public.save_payment_receiving_code(uuid,uuid,uuid,uuid,text,text,text,bigint,uuid,text),public.set_payment_receiving_code_active(uuid,uuid,uuid,boolean) to service_role;

-- Source statement 14
notify pgrst,'reload schema';

commit;
-- ============================================================================
-- 51. qr-payment-designer.sql | Inbox, automation and commerce functions/triggers
-- SHA256: 791010165b6065afb641c311106260bb7f574a3624530ee8d9df966d2bee8cd3
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('payment-qr-assets','payment-qr-assets',false,5242880,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- Source statement 3
drop policy if exists payment_qr_assets_private on storage.objects;

-- Source statement 4
create policy payment_qr_assets_private on storage.objects as restrictive for all to anon,authenticated
using(bucket_id<>'payment-qr-assets') with check(bucket_id<>'payment-qr-assets');

-- Source statement 5
create table if not exists public.bank_qr_designs(
 account_id uuid primary key references public.bank_accounts(id),
 tenant_id uuid not null references public.tenants(id),
 payload text not null,recipient_snapshot text not null,
 amount_satang bigint check(amount_satang between 1 and 9999999999),
 qr_type text not null default 'promptpay' check(qr_type='promptpay'),
 original_path text,logo_path text,design jsonb not null,
 version integer not null default 1,updated_at timestamptz not null default now(),
 updated_by uuid not null references auth.users(id)
);

-- Source statement 6
alter table public.bank_qr_designs enable row level security;

-- Source statement 7
revoke all on public.bank_qr_designs from public,anon,authenticated;

-- Source statement 8
grant select,insert,update on public.bank_qr_designs to service_role;

-- Source statement 9
create or replace function public.save_bank_qr_design(p_tenant uuid,p_actor uuid,p_account uuid,p_recipient text,p_payload text,p_amount bigint,p_original text,p_logo text,p_design jsonb,p_version integer) returns void
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
end $$;

-- Source statement 10
revoke all on function public.save_bank_qr_design(uuid,uuid,uuid,text,text,bigint,text,text,jsonb,integer) from public,anon,authenticated;

-- Source statement 11
grant execute on function public.save_bank_qr_design(uuid,uuid,uuid,text,text,bigint,text,text,jsonb,integer) to service_role;

-- Source statement 12
notify pgrst,'reload schema';

commit;
-- ============================================================================
-- 52. store-rules.sql | Inbox, automation and commerce functions/triggers
-- SHA256: ea6f24e091470f5d88369563d5f012c9500370aaa7536d84d3bf33c986daaee9
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
alter table public.bot_settings drop constraint if exists bot_settings_ai_instructions_check;

-- Source statement 3
alter table public.bot_settings add constraint bot_settings_ai_instructions_check check(length(ai_instructions)<=50000);

-- Source statement 4
create or replace function public.save_agent_prompt(p_tenant uuid,p_actor uuid,p_instructions text) returns void
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
end $$;

-- Source statement 5
revoke all on function public.save_agent_prompt(uuid,uuid,text) from public,anon,authenticated;

-- Source statement 6
grant execute on function public.save_agent_prompt(uuid,uuid,text) to service_role;

-- Source statement 7
revoke all on function public.manage_agent_knowledge(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;

-- Source statement 8
notify pgrst,'reload schema';

commit;
-- ============================================================================
-- 53. store-rule-items.sql | Inbox, automation and commerce functions/triggers
-- SHA256: 7f10a22e7c4ad118a193af3e28a5105070e4eeff33b9fee5d95d836fc9664a41
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create or replace function public.save_store_rule_items(p_tenant uuid,p_actor uuid,p_expected text,p_instructions text)
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
end $$;

-- Source statement 3
revoke all on function public.save_store_rule_items(uuid,uuid,text,text) from public,anon,authenticated;

-- Source statement 4
grant execute on function public.save_store_rule_items(uuid,uuid,text,text) to service_role;

-- Source statement 5
notify pgrst,'reload schema';

commit;
-- ============================================================================
-- 54. store-rules-validation.sql | Inbox, automation and commerce functions/triggers
-- SHA256: f8cbdf12cd3851025951edbf50d831548032211d73e43f12b011c1aa51df4883
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create or replace function public.assert_valid_store_rules(p_instructions text) returns void
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
end $$;

-- Source statement 3
create or replace function public.guard_store_rules_validation() returns trigger
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
end $$;

-- Source statement 4
drop trigger if exists bot_settings_store_rules_validation on public.bot_settings;

-- Source statement 5
create trigger bot_settings_store_rules_validation before insert or update of ai_instructions on public.bot_settings for each row execute function public.guard_store_rules_validation();

-- Source statement 6
create or replace function public.save_validated_store_rules(p_tenant uuid,p_actor uuid,p_expected text,p_instructions text) returns void
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
end $$;

-- Source statement 7
revoke all on function public.save_validated_store_rules(uuid,uuid,text,text) from public,anon,authenticated;

-- Source statement 8
grant execute on function public.save_validated_store_rules(uuid,uuid,text,text) to service_role;

-- Source statement 9
revoke all on function public.assert_valid_store_rules(text) from public,anon;

-- Source statement 10
grant execute on function public.assert_valid_store_rules(text) to authenticated,service_role;

-- Source statement 11
revoke all on function public.guard_store_rules_validation() from public,anon,authenticated,service_role;

-- Source statement 12
notify pgrst,'reload schema';

commit;
-- ============================================================================
-- 55. facebook-webhook-queue.sql | Latest delivery safety, reporting and index patches
-- SHA256: f860709ad67ac9cebdaaf4ac9e6307b31f70cbf20b2289ec99ba36ec9755a374
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
alter table public.customers add column if not exists last_interaction_at timestamptz;

-- Source statement 3
create table if not exists public.facebook_webhook_payloads (
 id uuid primary key default gen_random_uuid(), payload_sha256 text not null unique check(payload_sha256 ~ '^[a-f0-9]{64}$'),
 raw_payload text not null check(octet_length(raw_payload)<=2097152), received_at timestamptz not null default clock_timestamp(),
 last_received_at timestamptz not null default clock_timestamp(), delivery_count integer not null default 1
);

-- Source statement 4
create table if not exists public.facebook_webhook_events (
 id uuid primary key default gen_random_uuid(), payload_id uuid not null references public.facebook_webhook_payloads(id),
 sequence bigint generated always as identity unique, page_id text not null, event_key text not null, ordering_key text not null,
 kind text not null check(kind in ('message','change')), payload jsonb not null,
 status text not null default 'pending' check(status in ('pending','processing','completed','dead','requires_review')),
 attempts integer not null default 0, available_at timestamptz not null default clock_timestamp(),
 claim_token uuid, lease_until timestamptz, last_error text, created_at timestamptz not null default clock_timestamp(), completed_at timestamptz,
 unique(page_id,event_key)
);

-- Source statement 5
create index if not exists facebook_webhook_due on public.facebook_webhook_events(available_at,sequence) where status='pending';

-- Source statement 6
create index if not exists facebook_webhook_ordering on public.facebook_webhook_events(page_id,ordering_key,sequence) where status in ('pending','processing','requires_review','dead');

-- Source statement 7
create index if not exists facebook_webhook_leases on public.facebook_webhook_events(lease_until) where status='processing';

-- Source statement 8
create table if not exists public.facebook_webhook_steps (
 event_id uuid not null references public.facebook_webhook_events(id), name text not null check(length(name) between 1 and 120),
 status text not null check(status in ('started','completed')), result jsonb, started_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz, primary key(event_id,name)
);

-- Source statement 9
alter table public.facebook_webhook_payloads enable row level security;

-- Source statement 10
alter table public.facebook_webhook_events enable row level security;

-- Source statement 11
alter table public.facebook_webhook_steps enable row level security;

-- Source statement 12
revoke all on public.facebook_webhook_payloads,public.facebook_webhook_events,public.facebook_webhook_steps from public,anon,authenticated;

-- Source statement 13
grant select,insert,update,delete on public.facebook_webhook_payloads,public.facebook_webhook_events,public.facebook_webhook_steps to service_role;

-- Source statement 14
grant usage,select on sequence public.facebook_webhook_events_sequence_seq to service_role;

-- Source statement 15
create or replace function public.enqueue_facebook_webhook(p_raw text,p_hash text,p_events jsonb) returns jsonb
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
end $$;

-- Source statement 16
create or replace function public.claim_facebook_webhook(p_lease_seconds integer default 120) returns setof public.facebook_webhook_events
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
end $$;

-- Source statement 17
create or replace function public.heartbeat_facebook_webhook(p_event uuid,p_claim uuid) returns boolean
language plpgsql set search_path=pg_catalog,public as $$
begin
 update public.facebook_webhook_events set lease_until=clock_timestamp()+interval '120 seconds'
 where id=p_event and claim_token=p_claim and status='processing' and lease_until>clock_timestamp();return found;
end $$;

-- Source statement 18
create or replace function public.begin_facebook_webhook_step(p_event uuid,p_claim uuid,p_name text) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare step public.facebook_webhook_steps;
begin
 perform 1 from public.facebook_webhook_events where id=p_event and claim_token=p_claim and status='processing' and lease_until>clock_timestamp() for update;
 if not found then raise exception 'Webhook lease lost' using errcode='40001';end if;
 select * into step from public.facebook_webhook_steps where event_id=p_event and name=p_name;
 if found then return jsonb_build_object('status',step.status,'result',step.result);end if;
 insert into public.facebook_webhook_steps(event_id,name,status) values(p_event,p_name,'started');
 return jsonb_build_object('status','new');
end $$;

-- Source statement 19
create or replace function public.complete_facebook_webhook_step(p_event uuid,p_claim uuid,p_name text,p_result jsonb) returns boolean
language plpgsql set search_path=pg_catalog,public as $$
begin
 perform 1 from public.facebook_webhook_events where id=p_event and claim_token=p_claim and status='processing' and lease_until>clock_timestamp() for update;
 if not found then return false;end if;
 update public.facebook_webhook_steps set status='completed',result=p_result,completed_at=clock_timestamp() where event_id=p_event and name=p_name and status='started';return found;
end $$;

-- Source statement 20
create or replace function public.finish_facebook_webhook(p_event uuid,p_claim uuid,p_outcome text,p_error text default null) returns text
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
end $$;

-- Source statement 21
create or replace function public.facebook_inbound_message_at(p_payload jsonb,p_page text,p_received_at timestamptz) returns timestamptz
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
end $$;

-- Source statement 22
revoke all on function public.facebook_inbound_message_at(jsonb,text,timestamptz) from public,anon,authenticated;

-- Source statement 23
grant execute on function public.facebook_inbound_message_at(jsonb,text,timestamptz) to service_role;

-- Source statement 24
create or replace function public.inbox_incoming_message() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.sender='customer' then
  -- Facebook timestamps are applied after a real insert by persist_facebook_webhook_record.
  update public.customers set inbound_seq=inbound_seq+1,conversation_status='open',conversation_version=conversation_version+1,
   last_message_at=case when platform='facebook' then last_message_at else greatest(coalesce(last_message_at,new.created_at),new.created_at) end
   where id=new.customer_id returning inbound_seq into new.inbound_seq;
 end if;
 return new;
end $$;

-- Source statement 25
create or replace function public.persist_facebook_webhook_record(p_event uuid,p_claim uuid,p_tenant uuid) returns jsonb
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
    last_interaction_at=greatest(coalesce(last_interaction_at,event_time),event_time)
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
end $$;

-- Source statement 26
revoke all on function public.persist_facebook_webhook_record(uuid,uuid,uuid) from public,anon,authenticated;

-- Source statement 27
grant execute on function public.persist_facebook_webhook_record(uuid,uuid,uuid) to service_role;

-- Source statement 28
revoke all on function public.enqueue_facebook_webhook(text,text,jsonb),public.claim_facebook_webhook(integer),public.heartbeat_facebook_webhook(uuid,uuid),public.begin_facebook_webhook_step(uuid,uuid,text),public.complete_facebook_webhook_step(uuid,uuid,text,jsonb),public.finish_facebook_webhook(uuid,uuid,text,text) from public,anon,authenticated;

-- Source statement 29
grant execute on function public.enqueue_facebook_webhook(text,text,jsonb),public.claim_facebook_webhook(integer),public.heartbeat_facebook_webhook(uuid,uuid),public.begin_facebook_webhook_step(uuid,uuid,text),public.complete_facebook_webhook_step(uuid,uuid,text,jsonb),public.finish_facebook_webhook(uuid,uuid,text,text) to service_role;

-- Source statement 30
notify pgrst,'reload schema';

commit;
-- ============================================================================
-- 56. facebook-webhook-nonblocking.sql | Latest delivery safety, reporting and index patches
-- SHA256: 0cfe5319ef9b061c353b80a57463e06e1a97ff1424be84ecefb4a7ecb10baf4d
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create or replace function public.claim_facebook_webhook(p_lease_seconds integer default 120) returns setof public.facebook_webhook_events
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
end $$;

-- Source statement 3
create or replace function public.finish_facebook_webhook(p_event uuid,p_claim uuid,p_outcome text,p_error text default null) returns text
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
end $$;

commit;
-- ============================================================================
-- 57. facebook-message-window.sql | Latest delivery safety, reporting and index patches
-- SHA256: 78ed4b175f56e2a324553f4cdc8c23e6b1aa526fd7112fbda778cb2fc32c11de
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
alter table public.customers add column if not exists last_interaction_at timestamptz;

-- Source statement 3
create or replace function public.facebook_inbound_message_at(p_payload jsonb,p_page text,p_received_at timestamptz) returns timestamptz
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
end $$;

-- Source statement 4
revoke all on function public.facebook_inbound_message_at(jsonb,text,timestamptz) from public,anon,authenticated;

-- Source statement 5
grant execute on function public.facebook_inbound_message_at(jsonb,text,timestamptz) to service_role;

-- Source statement 6
create or replace function public.inbox_incoming_message() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.sender='customer' then
  -- Facebook timestamps are applied after a real insert by persist_facebook_webhook_record.
  update public.customers set inbound_seq=inbound_seq+1,conversation_status='open',conversation_version=conversation_version+1,
   last_message_at=case when platform='facebook' then last_message_at else greatest(coalesce(last_message_at,new.created_at),new.created_at) end
   where id=new.customer_id returning inbound_seq into new.inbound_seq;
 end if;
 return new;
end $$;

-- Source statement 7
create or replace function public.persist_facebook_webhook_record(p_event uuid,p_claim uuid,p_tenant uuid) returns jsonb
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
    last_interaction_at=greatest(coalesce(last_interaction_at,event_time),event_time)
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
end $$;

-- Source statement 8
revoke all on function public.persist_facebook_webhook_record(uuid,uuid,uuid) from public,anon,authenticated;

-- Source statement 9
grant execute on function public.persist_facebook_webhook_record(uuid,uuid,uuid) to service_role;

-- Source statement 10
notify pgrst,'reload schema';

commit;
-- ============================================================================
-- 58. broadcast-policy.sql | Latest delivery safety, reporting and index patches
-- SHA256: a45cf7c24ef5f6d31ef31868029bd3e9216370bc5c582b911b80a4ed74071233
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create table if not exists public.broadcast_messaging_events (
 tenant_id uuid not null references public.tenants(id), customer_id uuid not null references public.customers(id),
 event_id text not null, page_id text not null, kind text not null check(kind='inbound_message'),
 interacted_at timestamptz not null, received_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,event_id), check(interacted_at<=received_at)
);

-- Source statement 3
create index if not exists broadcast_events_latest on public.broadcast_messaging_events(tenant_id,customer_id,interacted_at desc);

-- Source statement 4
create table if not exists public.broadcast_runs (
 broadcast_id uuid primary key references public.broadcasts(id), lease uuid not null,
 locked_until timestamptz not null, actor_id uuid not null, updated_at timestamptz not null default clock_timestamp()
);

-- Source statement 5
create table if not exists public.broadcast_deliveries (
 broadcast_id uuid not null references public.broadcasts(id), customer_id uuid not null references public.customers(id), tenant_id uuid not null references public.tenants(id),
 status text not null check(status in ('claimed','accepted','delivered','read','failed','unknown','skipped')),
 reason text, provider_message_id text, lease uuid not null, monthly integer not null default 0, topup integer not null default 0,
 transport_started_at timestamptz, accepted_at timestamptz, created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 primary key(broadcast_id,customer_id), check(monthly>=0 and topup>=0)
);

-- Source statement 6
create unique index if not exists broadcast_provider_receipt on public.broadcast_deliveries(provider_message_id) where provider_message_id is not null;

-- Source statement 7
alter table public.broadcast_messaging_events enable row level security;

-- Source statement 8
alter table public.broadcast_runs enable row level security;

-- Source statement 9
alter table public.broadcast_deliveries enable row level security;

-- Source statement 10
revoke all on public.broadcast_messaging_events,public.broadcast_runs,public.broadcast_deliveries from public,anon,authenticated;

-- Source statement 11
grant all on public.broadcast_messaging_events,public.broadcast_runs,public.broadcast_deliveries to service_role;

-- Source statement 12
create or replace function public.freeze_broadcast_content() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if old.status<>'draft' and (new.tenant_id,new.name,new.message,new.audience_segment,new.audience_tags,new.audience_window,new.message_tag)
  is distinct from (old.tenant_id,old.name,old.message,old.audience_segment,old.audience_tags,old.audience_window,old.message_tag) then
  raise exception 'Started campaign content is immutable' using errcode='40001';
 end if;
 return new;
end $$;

-- Source statement 13
drop trigger if exists freeze_broadcast_content on public.broadcasts;

-- Source statement 14
create trigger freeze_broadcast_content before update on public.broadcasts for each row execute function public.freeze_broadcast_content();

-- Source statement 15
create or replace function public.claim_broadcast_run(p_broadcast uuid,p_actor uuid) returns uuid
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
end $$;

-- Source statement 16
create or replace function public.broadcast_recipient_reason(p_broadcast uuid,p_customer uuid) returns text
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
end $$;

-- Source statement 17
create or replace function public.claim_broadcast_recipient(p_broadcast uuid,p_customer uuid,p_lease uuid) returns text
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
end $$;

-- Source statement 18
create or replace function public.settle_broadcast_recipient(p_broadcast uuid,p_customer uuid,p_lease uuid,p_result text,p_reason text default null,p_receipt text default null) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.broadcast_deliveries;
begin
 if p_result not in ('accepted','failed','unknown','skipped') or (p_result='accepted' and nullif(trim(p_receipt),'') is null) then raise exception 'Invalid result';end if;
 select * into d from public.broadcast_deliveries where broadcast_id=p_broadcast and customer_id=p_customer for update;
 if not found or d.lease<>p_lease or d.status<>'claimed' then return;end if;
 if p_result in ('failed','skipped') then perform public.refund_broadcast_credits(d.tenant_id,d.monthly,d.topup);end if;
 update public.broadcast_deliveries set status=p_result,reason=p_reason,provider_message_id=p_receipt,
  accepted_at=case when p_result='accepted' then clock_timestamp() else null end,updated_at=clock_timestamp() where broadcast_id=p_broadcast and customer_id=p_customer;
end $$;

-- Source statement 19
create or replace function public.begin_broadcast_transport(p_broadcast uuid,p_customer uuid,p_lease uuid) returns boolean
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
end $$;

-- Source statement 20
revoke all on function public.claim_broadcast_run(uuid,uuid),public.broadcast_recipient_reason(uuid,uuid),public.claim_broadcast_recipient(uuid,uuid,uuid),public.settle_broadcast_recipient(uuid,uuid,uuid,text,text,text),public.begin_broadcast_transport(uuid,uuid,uuid) from public,anon,authenticated;

-- Source statement 21
grant execute on function public.claim_broadcast_run(uuid,uuid),public.broadcast_recipient_reason(uuid,uuid),public.claim_broadcast_recipient(uuid,uuid,uuid),public.settle_broadcast_recipient(uuid,uuid,uuid,text,text,text),public.begin_broadcast_transport(uuid,uuid,uuid) to service_role;

-- Source statement 22
notify pgrst,'reload schema';

commit;
-- ============================================================================
-- 59. broadcast-recipient-eligibility.sql | Latest delivery safety, reporting and index patches
-- SHA256: 6ea5e1f9044db876fc8d0f07d8da52668f9897fa684851092eab347710e4a74c
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create or replace function public.broadcast_recipient_reason(p_broadcast uuid,p_customer uuid) returns text
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
end $$;

-- Source statement 3
revoke execute on function public.broadcast_recipient_reason(uuid,uuid) from public,anon,authenticated;

-- Source statement 4
grant execute on function public.broadcast_recipient_reason(uuid,uuid) to service_role;

commit;
-- ============================================================================
-- 60. broadcast-recipient-selection.sql | Latest delivery safety, reporting and index patches
-- SHA256: bdd1581c239a6ebc20048d32d342e6697d98ada245dd01260feacde8fe44278f
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
alter table public.broadcasts add column if not exists selected_customer_ids uuid[];

-- Source statement 3
create or replace function public.guard_broadcast_selection() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if old.status<>'draft' and new.selected_customer_ids is distinct from old.selected_customer_ids then
  raise exception 'Started campaign recipients are immutable' using errcode='40001';
 end if;
 return new;
end $$;

-- Source statement 4
drop trigger if exists broadcast_selection_immutable on public.broadcasts;

-- Source statement 5
create trigger broadcast_selection_immutable before update on public.broadcasts
for each row execute function public.guard_broadcast_selection();

-- Source statement 6
notify pgrst,'reload schema';

commit;
-- ============================================================================
-- 61. broadcast-inbound-sync.sql | Latest delivery safety, reporting and index patches
-- SHA256: 074351e109ac3b2191bc1eece9356c5ea28a58cb5b165a078e63413ad876beba
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create index if not exists facebook_webhook_message_id_lookup on public.facebook_webhook_events
 (page_id,((payload->'message')->>'mid')) where kind='message';

-- Source statement 3
create or replace function public.sync_broadcast_inbound_message() returns trigger
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
end $$;

-- Source statement 4
revoke all on function public.sync_broadcast_inbound_message() from public,anon,authenticated,service_role;

-- Source statement 5
drop trigger if exists broadcast_inbound_message_sync on public.messages;

-- Source statement 6
create trigger broadcast_inbound_message_sync after insert on public.messages
for each row execute function public.sync_broadcast_inbound_message();

commit;
-- ============================================================================
-- 62. inbox-messenger-window.sql | Latest delivery safety, reporting and index patches
-- SHA256: 4ebe59d252e016e5d62eb28617e9a08d27847550f925f0273d18cc456c43e77e
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create or replace function public.inbox_verified_inbound_at(p_tenant uuid,p_customer uuid)
returns timestamptz language sql stable set search_path=pg_catalog,public as $$
 select max(e.interacted_at) from public.broadcast_messaging_events e
 join public.tenants t on t.id=e.tenant_id and t.page_id=e.page_id
 where e.tenant_id=p_tenant and e.customer_id=p_customer and e.kind='inbound_message'
 and e.interacted_at<=statement_timestamp();
$$;

-- Source statement 3
create or replace function public.start_inbox_delivery(p_customer uuid,p_actor uuid default null) returns uuid
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
end $$;

-- Source statement 4
create or replace function public.guard_inbox_automation_window() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare inbound_at timestamptz;
begin
 if new.bot_enabled and not old.bot_enabled and new.platform='facebook' then
  inbound_at:=public.inbox_verified_inbound_at(new.tenant_id,new.id);
  if inbound_at is null or inbound_at<=clock_timestamp()-interval '24 hours' then raise exception 'Messaging window closed' using errcode='P0424';end if;
 end if;
 return new;
end $$;

-- Source statement 5
drop trigger if exists inbox_automation_window on public.customers;

-- Source statement 6
create trigger inbox_automation_window before update of bot_enabled on public.customers for each row execute function public.guard_inbox_automation_window();

-- Source statement 7
create or replace function public.guard_agent_dispatch_window() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare inbound_at timestamptz;
begin
 if new.dispatch_started_at is not null and old.dispatch_started_at is null
 and exists(select 1 from public.customers where id=new.customer_id and tenant_id=new.tenant_id and platform='facebook') then
  inbound_at:=public.inbox_verified_inbound_at(new.tenant_id,new.customer_id);
  if inbound_at is null or inbound_at<=clock_timestamp()-interval '24 hours' then raise exception 'Messaging window closed' using errcode='P0424';end if;
 end if;
 return new;
end $$;

-- Source statement 8
drop trigger if exists agent_dispatch_window on public.agent_message_jobs;

-- Source statement 9
create trigger agent_dispatch_window before update of dispatch_started_at on public.agent_message_jobs for each row execute function public.guard_agent_dispatch_window();

-- Source statement 10
revoke all on function public.inbox_verified_inbound_at(uuid,uuid),public.start_inbox_delivery(uuid,uuid),public.guard_inbox_automation_window(),public.guard_agent_dispatch_window() from public,anon,authenticated;

-- Source statement 11
grant execute on function public.inbox_verified_inbound_at(uuid,uuid),public.start_inbox_delivery(uuid,uuid) to service_role;

-- Source statement 12
notify pgrst,'reload schema';

-- Source statement 13
create index if not exists inbox_automation_expiry on public.customers(last_message_at,id) where platform='facebook' and bot_enabled;

-- Source statement 14
create or replace function public.inbox_automation_window_open(p_customer uuid,p_tenant uuid default null)
returns boolean language sql stable set search_path=pg_catalog,public as $$
 select exists(select 1 from public.customers c join public.tenants t on t.id=c.tenant_id and t.is_active
 where c.id=p_customer and (p_tenant is null or c.tenant_id=p_tenant)
 and (c.platform<>'facebook' or public.inbox_verified_inbound_at(c.tenant_id,c.id)>statement_timestamp()-interval '24 hours'));
$$;

-- Source statement 15
create or replace function public.expire_inbox_automation(p_customer uuid) returns boolean
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
end $$;

-- Source statement 16
create or replace function public.expire_inbox_automation_windows(p_limit integer default 200) returns integer
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
end $$;

-- Source statement 17
revoke all on function public.inbox_automation_window_open(uuid,uuid),public.expire_inbox_automation(uuid),public.expire_inbox_automation_windows(integer) from public,anon,authenticated;

-- Source statement 18
grant execute on function public.inbox_automation_window_open(uuid,uuid),public.expire_inbox_automation(uuid),public.expire_inbox_automation_windows(integer) to service_role;

commit;
-- ============================================================================
-- 63. smart-follow-up-presend.sql | Latest delivery safety, reporting and index patches
-- SHA256: 978fd4adf4cb9e1f16c8a1f21783ab4c7c43dedb66d7c11c7df20fe6ad36f9e4
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
alter table public.follow_up_jobs add column if not exists send_authorized_at timestamptz;

-- Source statement 3
create index if not exists slips_followup_presend on public.slips(tenant_id,customer_id,created_at);

-- Source statement 4
create or replace function public.sync_payment_follow_up_switch() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 update public.follow_up_workflows set enabled=new.enabled,version=version+1
 where tenant_id=new.tenant_id and kind='payment' and enabled is distinct from new.enabled;
 return new;
end $$;

-- Source statement 5
drop trigger if exists payment_follow_up_master_switch on public.follow_up_policies;

-- Source statement 6
create trigger payment_follow_up_master_switch after insert or update of enabled on public.follow_up_policies
for each row execute function public.sync_payment_follow_up_switch();

-- Source statement 8
create or replace function public.hold_payment_follow_up_for_slip() returns trigger
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
end $$;

-- Source statement 9
drop trigger if exists slips_hold_payment_follow_up on public.slips;

-- Source statement 10
create trigger slips_hold_payment_follow_up after insert on public.slips
for each row execute function public.hold_payment_follow_up_for_slip();

-- Source statement 11
create or replace function public.authorize_follow_up_dispatch(p_job uuid,p_claim uuid) returns jsonb
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
end $$;

-- Source statement 12
revoke all on function public.authorize_follow_up_dispatch(uuid,uuid) from public,anon,authenticated;

-- Source statement 13
grant execute on function public.authorize_follow_up_dispatch(uuid,uuid) to service_role;

-- Source statement 14
revoke all on function public.sync_payment_follow_up_switch(),public.hold_payment_follow_up_for_slip() from public,anon,authenticated,service_role;

-- Source statement 15
create or replace function public.prepare_follow_up(p_job uuid,p_claim uuid) returns jsonb
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
end $$;

-- Source statement 16
notify pgrst,'reload schema';

commit;
-- ============================================================================
-- 64. manual-follow-ups.sql | Latest delivery safety, reporting and index patches
-- SHA256: 34d34f06c0a32579c6dc4a80583c4c15040b1919b8f2bd7e6638848adb06e165
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
alter table public.follow_up_jobs add column if not exists manual_without_order boolean not null default false;

-- Source statement 3
create unique index if not exists follow_up_manual_open_step
 on public.follow_up_jobs(tenant_id,customer_id,kind,step)
 where manual_without_order and status in ('pending','processing','requires_review');

-- Source statement 4
create or replace function public.add_manual_follow_up(p_tenant uuid,p_actor uuid,p_customer uuid,p_kind text,p_reference uuid default null)
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
end $$;

-- Source statement 5
revoke all on function public.add_manual_follow_up(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;

-- Source statement 6
grant execute on function public.add_manual_follow_up(uuid,uuid,uuid,text,uuid) to service_role;

-- Source statement 7
do $$
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
end $$;

commit;
-- ============================================================================
-- 65. follow-up-simplified.sql | Latest delivery safety, reporting and index patches
-- SHA256: d425f213aab29a30c164cf201815925add5d76840f82fecb89cfae2aefb679fa
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create or replace function public.follow_up_window_open(p_tenant uuid,p_customer uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.customers c join public.tenants t on t.id=c.tenant_id
 where c.id=p_customer and c.tenant_id=p_tenant and t.is_active and
 (c.platform<>'facebook' or (select max(e.interacted_at) from public.broadcast_messaging_events e
 where e.tenant_id=t.id and e.customer_id=c.id and e.page_id=t.page_id and e.kind='inbound_message')
 >statement_timestamp()-interval '24 hours' and (select max(e.interacted_at) from public.broadcast_messaging_events e
 where e.tenant_id=t.id and e.customer_id=c.id and e.page_id=t.page_id and e.kind='inbound_message')<=statement_timestamp()))
$$;

-- Source statement 3
revoke all on function public.follow_up_window_open(uuid,uuid) from public,anon,authenticated;

-- Source statement 4
grant execute on function public.follow_up_window_open(uuid,uuid) to service_role;

-- Source statement 5
create or replace function public.prepare_follow_up(p_job uuid,p_claim uuid) returns jsonb
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
 elsif (not w.enabled and not j.manual_without_order) or not t.auto_reply_enabled then reason:='disabled';
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
end $$;

-- Source statement 6
create or replace function public.authorize_follow_up_dispatch(p_job uuid,p_claim uuid) returns jsonb
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
 elsif (not w.enabled and not j.manual_without_order) or not t.auto_reply_enabled then block_reason:='disabled';
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
end $$;

-- Source statement 7
create or replace function public.add_manual_follow_up(p_tenant uuid,p_actor uuid,p_customer uuid,p_kind text,p_reference uuid default null)
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
end $$;

-- Source statement 8
create or replace function public.enqueue_follow_up(p_tenant uuid,p_customer uuid,p_kind text,p_order uuid default null,p_source uuid default null,p_product uuid default null) returns void
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
end $$;

commit;
-- ============================================================================
-- 66. follow-up-step-settings.sql | Latest delivery safety, reporting and index patches
-- SHA256: 96bedcb1959a8d864b018de761fb35e8d989b42450060ca784c2f7143af13a0e
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create or replace function public.save_follow_up_workflow(p_tenant uuid,p_actor uuid,p_kind text,p_version integer,p_index integer,p_steps jsonb,p_config jsonb) returns jsonb
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
end $$;

-- Source statement 3
revoke all on function public.save_follow_up_workflow(uuid,uuid,text,integer,integer,jsonb,jsonb) from public,anon,authenticated;

-- Source statement 4
grant execute on function public.save_follow_up_workflow(uuid,uuid,text,integer,integer,jsonb,jsonb) to service_role;

commit;
-- ============================================================================
-- 67. dashboard-performance.sql | Latest delivery safety, reporting and index patches
-- SHA256: 87871cb3623b3153a08fd585394dda0fbd296c4fb670e50791ee09527b2c29c5
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create index if not exists overview_slips_time on public.slips(tenant_id,created_at desc,id);

-- Source statement 3
create index if not exists overview_customers_time on public.customers(tenant_id,last_message_at desc,id);

-- Source statement 4
create index if not exists overview_messages_latest on public.messages(customer_id,created_at desc,id desc) include(sender);

-- Source statement 5
create index if not exists overview_messages_inbound on public.messages(customer_id,created_at) where sender='customer';

-- Source statement 6
create index if not exists overview_agent_time on public.agent_message_jobs(tenant_id,created_at) include(route,status,customer_id);

-- Source statement 7
create index if not exists commerce_products_page on public.products(tenant_id,created_at desc,id) where not commerce_archived;

-- Source statement 8
create index if not exists commerce_products_low_stock on public.products(tenant_id,stock,id) where not commerce_archived and is_active and stock<=3;

-- Source statement 9
create index if not exists commerce_orders_page on public.commerce_orders(tenant_id,created_at desc,id);

-- Source statement 10
create index if not exists commerce_orders_status_page on public.commerce_orders(tenant_id,status,created_at desc,id);

-- Source statement 11
create index if not exists commerce_orders_paid_time on public.commerce_orders(tenant_id,paid_at) include(total,status);

-- Source statement 12
create index if not exists commerce_customers_page on public.commerce_customers(tenant_id,created_at desc,id);

-- Source statement 13
create index if not exists commerce_items_tenant_order on public.commerce_order_items(tenant_id,order_id);

-- Source statement 14
create index if not exists commerce_audit_entity on public.commerce_audit(tenant_id,entity_id,created_at desc,id);

-- Source statement 15
create index if not exists commerce_categories_page on public.commerce_categories(tenant_id,name,id);

-- Source statement 16
create index if not exists commerce_pages_page on public.commerce_pages(tenant_id,id);

-- Source statement 17
create or replace function public.overview_dashboard_stats(p_tenant uuid,p_from timestamptz,p_to timestamptz,p_previous timestamptz,p_page integer,p_query text)
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
end $$;

-- Source statement 18
create or replace function public.commerce_dashboard_stats(p_tenant uuid)
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
end $$;

-- Source statement 19
create or replace function public.commerce_dashboard_page(p_tenant uuid,p_product_page integer default 1,p_order_page integer default 1,p_customer_page integer default 1,p_category_page integer default 1,p_page_page integer default 1,p_query text default '',p_category uuid default null,p_sort text default 'new',p_status text default 'all')
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
end $$;

-- Source statement 20
revoke all on function public.overview_dashboard_stats(uuid,timestamptz,timestamptz,timestamptz,integer,text),public.commerce_dashboard_stats(uuid),public.commerce_dashboard_page(uuid,integer,integer,integer,integer,integer,text,uuid,text,text) from public,anon,authenticated;

-- Source statement 21
grant execute on function public.overview_dashboard_stats(uuid,timestamptz,timestamptz,timestamptz,integer,text),public.commerce_dashboard_stats(uuid),public.commerce_dashboard_page(uuid,integer,integer,integer,integer,integer,text,uuid,text,text) to service_role;

-- Source statement 22
notify pgrst,'reload schema';

commit;
-- ============================================================================
-- 68. dashboard-read-models.sql | Latest delivery safety, reporting and index patches
-- SHA256: daca680061c44493d8ec6c139716a5a7e58aca1c20cddab9231ce59f94cf72cf
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create index if not exists inbox_customers_recent on public.customers(tenant_id,last_message_at desc nulls last,id desc);

-- Source statement 3
create index if not exists dashboard_valid_customer_slips on public.slips(tenant_id,customer_id) include(amount) where status='valid';

-- Source statement 4
create index if not exists overview_slips_time on public.slips(tenant_id,created_at desc,id);

-- Source statement 5
create index if not exists dashboard_agent_period on public.agent_message_jobs(tenant_id,created_at desc,id) include(route,status,customer_id,updated_at);

-- Source statement 6
create index if not exists dashboard_agent_lifetime on public.agent_message_jobs(tenant_id,customer_id) where route='AI' and status='sent';

-- Source statement 7
create or replace function public.customer_directory(
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
end $$;

-- Source statement 8
create or replace function public.agent_overview_stats(
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
end $$;

-- Source statement 9
create or replace function public.basic_overview_stats(p_tenant uuid, p_now timestamptz)
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
end $$;

-- Source statement 10
revoke all on function public.customer_directory(uuid,integer,text,text,text),public.agent_overview_stats(uuid,integer,timestamptz),public.basic_overview_stats(uuid,timestamptz) from public,anon,authenticated;

-- Source statement 11
grant execute on function public.customer_directory(uuid,integer,text,text,text),public.agent_overview_stats(uuid,integer,timestamptz),public.basic_overview_stats(uuid,timestamptz) to service_role;

commit;
-- ============================================================================
-- 69. premium-overview.sql | Latest delivery safety, reporting and index patches
-- SHA256: 19d97393eda4ebd1de925886ce3add41af56164a2541e8e4e0b6f377f861f273
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
create or replace function public.premium_overview_summary(
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
end $$;

-- Source statement 3
revoke all on function public.premium_overview_summary(uuid,timestamptz,timestamptz,timestamptz,integer,text) from public,anon,authenticated;

-- Source statement 4
grant execute on function public.premium_overview_summary(uuid,timestamptz,timestamptz,timestamptz,integer,text) to service_role;

-- Source statement 5
create index if not exists slips_tenant on public.slips(tenant_id,created_at desc);

-- Source statement 6
create index if not exists customers_tenant on public.customers(tenant_id,last_message_at desc);

-- Source statement 7
notify pgrst,'reload schema';

commit;
-- ============================================================================
-- 70. inbox-realtime.sql | Latest delivery safety, reporting and index patches
-- SHA256: a7dc1d4c93f7995e27731bd59a078c4430650c0b627c9f4c14a80c5357d607f7
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 2
do $$
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
end $$;

commit;
-- ============================================================================
-- 71. inbox-load-indexes.sql | Latest delivery safety, reporting and index patches
-- SHA256: cee506871122e657bfbf6b2a12533272fee5b44607176d4c29298b0aaf404e42
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

-- Source statement 1
create index if not exists inbox_customers_recent on public.customers
 (tenant_id,last_message_at desc nulls last,id desc);

-- Source statement 2
create index if not exists overview_messages_latest on public.messages
 (customer_id,created_at desc,id desc) include(sender);

-- Source statement 3
create index if not exists inbox_recent_inbound on public.messages
 (created_at desc,id desc) where sender='customer';

-- Source statement 4
create index if not exists inbox_slips_recent on public.slips
 (tenant_id,customer_id,created_at desc);

-- Source statement 5
create index if not exists inbox_comments_recent on public.comments
 (tenant_id,created_at desc);

-- Source statement 6
create index if not exists inbox_reads_by_user on public.conversation_reads
 (user_id,customer_id) include(read_seq);

-- Source statement 7
create index if not exists broadcast_page_recent on public.broadcast_messaging_events
 (tenant_id,page_id,kind,interacted_at desc,event_id);

-- Source statement 8
create index if not exists broadcast_customer_recent on public.broadcast_messaging_events
 (tenant_id,page_id,customer_id,kind,interacted_at desc,event_id);

-- Source statement 9
create index if not exists facebook_webhook_message_id_lookup on public.facebook_webhook_events
 (page_id,((payload->'message')->>'mid')) where kind='message';

commit;

notify pgrst, 'reload schema';
