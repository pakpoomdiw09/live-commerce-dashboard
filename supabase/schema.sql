-- Core tables. Run in the Supabase SQL editor first.
-- Safe to re-run. Row level security is switched on here with no policies (nothing is readable
-- through the anon/authenticated keys); supabase/security.sql adds the per-tenant policies.
create extension if not exists pgcrypto;

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  platform text not null default 'facebook',
  platform_user_id text not null,
  display_name text,
  bot_enabled boolean not null default true,      -- per-customer bot switch
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  unique (platform, platform_user_id)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  external_id text unique,                        -- Meta message id: makes webhook retries idempotent
  sender text not null check (sender in ('customer', 'bot', 'agent')),
  body text,
  attachments jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index if not exists messages_customer_created on messages (customer_id, created_at);

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete set null,
  external_id text not null unique,               -- Meta comment id
  post_id text,
  author_name text,
  body text,
  created_at timestamptz not null default now()
);
create index if not exists comments_created on comments (created_at desc);

create table if not exists slips (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete set null,
  image_path text,                                -- path inside the private 'slips' bucket
  expected_amount numeric(12,2),
  amount numeric(12,2),
  trans_ref text,                                 -- bank transaction reference
  status text not null default 'pending'
    check (status in ('pending', 'valid', 'amount_mismatch', 'duplicate', 'fake', 'wrong_receiver', 'error')),
  note text,
  raw jsonb,                                      -- full provider response, for audits
  created_at timestamptz not null default now(),
  verified_at timestamptz
);
create index if not exists slips_created on slips (created_at desc);
-- A transfer can be accepted once, even if the provider's own duplicate check misses it.
-- Partial on purpose: only 'valid' rows compete, so rows saved as 'duplicate' may repeat a trans_ref.
create unique index if not exists slips_one_valid_per_ref on slips (trans_ref) where status = 'valid';

alter table customers enable row level security;
alter table messages  enable row level security;
alter table comments  enable row level security;
alter table slips     enable row level security;

-- Realtime (adding a table twice raises duplicate_object)
do $$ begin alter publication supabase_realtime add table customers; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table messages;  exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table comments;  exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table slips;     exception when duplicate_object then null; end $$;

-- Private bucket for slip images (the dashboard gets short-lived signed URLs from the server)
insert into storage.buckets (id, name, public) values ('slips', 'slips', false) on conflict do nothing;
