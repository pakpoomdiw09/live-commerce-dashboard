-- Chatbot automation, payment follow-ups, broadcasts and sale pages.
-- Run after orders.sql, then run security.sql again (it holds the policies). Safe to re-run.

-- ── chatbot settings: one row per tenant ──
create table if not exists bot_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  reply_mode text not null default 'keyword' check (reply_mode in ('keyword', 'ai')),
  ai_instructions text check (length(ai_instructions) <= 8000),   -- shop facts, tone, policies for the AI Agent
  fallback_text text check (length(fallback_text) <= 2000),       -- nothing matched (null = stay silent)
  handover_keywords text[] not null default '{แอดมิน,คุยกับแอดมิน,ติดต่อแอดมิน,ขอคุยกับคน}',
  handover_text text check (length(handover_text) <= 2000)
    default 'รับทราบค่ะ แอดมินจะเข้ามาตอบโดยเร็วที่สุดนะคะ 🙏',
  followup_enabled boolean not null default false,
  -- [{ "delay_minutes": 15, "text": "..." }]; Meta only allows messages within 24 h of the customer's last one
  followup_steps jsonb not null default '[
    {"delay_minutes": 15, "text": "คุณ {ชื่อลูกค้า} ยังไม่ได้ส่งสลิปสำหรับยอด {ยอดเงิน} บาทนะคะ โอนแล้วส่งสลิปในแชทนี้ได้เลยค่ะ"},
    {"delay_minutes": 60, "text": "แจ้งเตือนอีกครั้งค่ะ ออเดอร์ยอด {ยอดเงิน} บาท ยังรอการชำระเงิน หากต้องการยกเลิกแจ้งแอดมินได้เลยนะคะ"}
  ]'::jsonb
    check (jsonb_typeof(followup_steps) = 'array' and jsonb_array_length(followup_steps) <= 5),
  updated_at timestamptz not null default now()
);

-- ── keyword auto-reply rules for Messenger chats ──
create table if not exists chat_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  match_type text not null default 'keyword' check (match_type in ('exact', 'keyword')),
  keywords text[] not null default '{}',
  reply_type text not null default 'text' check (reply_type in ('text', 'image')),
  reply_text text check (length(reply_text) <= 2000),
  image_url text,                                   -- public URL (Meta downloads it)
  quick_replies text[] not null default '{}'        -- button titles; Meta allows 13, 20 characters each
    check (cardinality(quick_replies) <= 13),
  priority integer not null default 0,              -- higher runs first
  is_active boolean not null default true,
  hit_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists chat_rules_tenant on chat_rules (tenant_id, is_active, priority desc);

/** Usage counter; the webhook (service role) calls it after a rule answered. */
create or replace function bump_chat_rule(p_rule uuid) returns void
language sql as $$ update chat_rules set hit_count = hit_count + 1 where id = p_rule $$;
revoke execute on function bump_chat_rule(uuid) from public, anon, authenticated;

-- ── handover: the customer asked for a person, so the bot stops answering this chat ──
alter table customers add column if not exists handover_at timestamptz;
create index if not exists customers_handover on customers (tenant_id, handover_at) where handover_at is not null;

-- turning the bot back on for a chat ends the handover
create or replace function clear_handover() returns trigger language plpgsql as $$
begin
  if new.bot_enabled and not old.bot_enabled then new.handover_at := null; end if;
  return new;
end $$;
drop trigger if exists customers_clear_handover on customers;
create trigger customers_clear_handover before update of bot_enabled on customers
  for each row execute function clear_handover();

-- ── payment follow-ups: reminders to send a slip, scheduled when a CF order is placed ──
create table if not exists follow_up_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  step smallint not null,
  text text not null,
  run_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'sent', 'cancelled', 'failed')),
  reason text,                                      -- why it was cancelled / failed
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (order_id, step)
);
create index if not exists follow_up_jobs_due on follow_up_jobs (run_at) where status = 'scheduled';
create index if not exists follow_up_jobs_tenant on follow_up_jobs (tenant_id, created_at desc);
create index if not exists follow_up_jobs_customer on follow_up_jobs (customer_id) where status = 'scheduled';

/**
 * A new unpaid order replaces the customer's earlier reminders (one reminder series per customer,
 * covering everything they still owe), using the tenant's current steps.
 */
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
drop trigger if exists orders_schedule_follow_ups on orders;
create trigger orders_schedule_follow_ups after insert on orders
  for each row execute function schedule_follow_ups();

/**
 * Order status changes:
 *  - cancelled: the item goes back into stock (place_cf_order took it)
 *  - a cancelled order stays cancelled, so stock is never returned twice
 */
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
drop trigger if exists orders_status_change on orders;
create trigger orders_status_change before update of status on orders
  for each row execute function on_order_status();

-- AFTER: a slip that pays several orders in one update sees all of them already paid
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
drop trigger if exists orders_cancel_follow_ups on orders;
create trigger orders_cancel_follow_ups after update of status on orders
  for each row execute function cancel_paid_follow_ups();

-- ── broadcasts ──
create table if not exists broadcasts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  message text not null check (length(trim(message)) between 1 and 2000),
  -- all = every chat; pending_payment = owes money; paid_before = has a paid order (returning customer)
  audience_segment text not null default 'all' check (audience_segment in ('all', 'pending_payment', 'paid_before')),
  audience_tags text[] not null default '{}',       -- customer tags, any of them (empty = no tag filter)
  status text not null default 'draft' check (status in ('draft', 'sending', 'sent', 'failed')),
  total integer not null default 0,                 -- matched the audience
  sent integer not null default 0,
  failed integer not null default 0,
  skipped integer not null default 0,               -- outside Meta's 24-hour window
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
-- within_24h = customers inside Meta's 24-hour window (UPDATE); outside_24h = customers past it, sent with a message tag
alter table broadcasts add column if not exists audience_window text not null default 'within_24h';
alter table broadcasts add column if not exists message_tag text;
alter table broadcasts add column if not exists last_error text; -- why sends failed (outside the window, tag refused, ...)
alter table broadcasts drop constraint if exists broadcasts_audience_window_check;
alter table broadcasts add constraint broadcasts_audience_window_check check (audience_window in ('within_24h', 'outside_24h'));
alter table broadcasts drop constraint if exists broadcasts_message_tag_check;
alter table broadcasts add constraint broadcasts_message_tag_check check (
  (audience_window = 'within_24h' and message_tag is null)
  or (audience_window = 'outside_24h' and message_tag in ('POST_PURCHASE_UPDATE', 'CONFIRMED_EVENT_UPDATE', 'ACCOUNT_UPDATE', 'HUMAN_AGENT'))
);
create index if not exists broadcasts_tenant on broadcasts (tenant_id, created_at desc);
create index if not exists customers_tags on customers using gin (tags);
-- broadcast messages are claimed as "bc:<broadcast>:<customer>"; the send route counts them by prefix
create index if not exists messages_broadcast_ref on messages (external_id text_pattern_ops) where external_id like 'bc:%';

-- ── shop: sale page fields on products ──
alter table products add column if not exists description text check (length(description) <= 2000);
alter table products add column if not exists image_url text;
create index if not exists orders_status on orders (tenant_id, status);

-- policies: supabase/security.sql
alter table bot_settings enable row level security;
alter table chat_rules enable row level security;
alter table follow_up_jobs enable row level security;
alter table broadcasts enable row level security;

do $$ begin alter publication supabase_realtime add table follow_up_jobs; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table broadcasts; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table products; exception when duplicate_object then null; end $$;

-- ── optional: run the follow-up worker every minute from Supabase ──
-- Needs the pg_cron and pg_net extensions (Database > Extensions). Replace the URL and the secret
-- (CRON_SECRET, or INTERNAL_API_SECRET, from .env.local), then run this block once.
--
-- select cron.schedule('follow-ups', '* * * * *', $cron$
--   select net.http_post(
--     url := 'https://your-app.vercel.app/api/cron/follow-ups',
--     headers := '{"Authorization": "Bearer YOUR_CRON_SECRET", "Content-Type": "application/json"}'::jsonb,
--     body := '{}'::jsonb
--   )
-- $cron$);
