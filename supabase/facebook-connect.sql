-- Pages a user connected with "เชื่อมต่อเพจด้วย Facebook", waiting to be linked to a tenant.
-- Run after tenants.sql. Safe to re-run.
--
-- A tenant needs a bank account before it can exist, so the OAuth callback can't create one:
-- it keeps each Page here, and creating a tenant with that page_id picks the token up.
-- Pages already linked to a tenant get their tenants.page_access_token refreshed directly.

create table if not exists facebook_pages (
  user_id uuid not null references auth.users(id) on delete cascade,
  page_id text not null,
  name text not null,
  picture text,
  access_token text not null,                   -- secret: service role only
  connected_at timestamptz not null default now(),
  primary key (user_id, page_id)
);

-- no policies: only the API (service role) reads or writes this table
alter table facebook_pages enable row level security;
revoke all on facebook_pages from anon, authenticated;
