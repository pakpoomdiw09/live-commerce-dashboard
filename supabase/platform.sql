-- Multi-tenant platform: tenant settings, CRM fields, slip workflow, credit quota.
-- Run in the Supabase SQL editor after schema.sql, tenants.sql and comment-rules.sql.
-- Then run orders.sql and security.sql.
-- Safe to re-run: every change is guarded with "if not exists".

-- ── tenants: bank account, Facebook Page and automation settings ──
alter table tenants add column if not exists account_name text;
alter table tenants add column if not exists page_id text unique;                 -- Facebook Page id (webhook entry.id)
alter table tenants add column if not exists expected_amount numeric(12,2)
  check (expected_amount is null or expected_amount > 0);                          -- default amount the slip must match
alter table tenants add column if not exists auto_reply_enabled boolean not null default true;
alter table tenants add column if not exists auto_verify_enabled boolean not null default true;
alter table tenants add column if not exists slip_quota integer not null default 500 check (slip_quota >= 0);
alter table tenants add column if not exists slip_used integer not null default 0 check (slip_used >= 0);

-- ── customers: tenant + CRM fields ──
alter table customers add column if not exists tenant_id uuid references tenants(id) on delete set null;
alter table customers add column if not exists phone text;
alter table customers add column if not exists address text;
alter table customers add column if not exists tags text[] not null default '{}';
alter table customers add column if not exists notes text;
alter table customers add column if not exists order_status text not null default 'new';
alter table customers add column if not exists last_interaction_at timestamptz;
do $$ begin
  alter table customers add constraint customers_order_status_check
    check (order_status in ('new', 'pending_review', 'paid', 'approved', 'shipped'));
exception when duplicate_object then null; end $$;
create index if not exists customers_tenant on customers (tenant_id, last_message_at desc);

-- ── slips: link to the chat message, approval and confirmation ──
alter table slips add column if not exists message_id uuid references messages(id) on delete set null;
alter table slips add column if not exists approved_at timestamptz;
alter table slips add column if not exists approved_by uuid references auth.users(id) on delete set null;
alter table slips add column if not exists confirmed_at timestamptz;          -- confirmation sent to the customer
create index if not exists slips_customer on slips (customer_id, created_at desc);
create index if not exists slips_message on slips (message_id);
-- Cross-tenant duplicate protection is the existing global partial index slips_one_valid_per_ref
-- (trans_ref where status = 'valid'): it has no tenant_id on purpose.

-- ── credits: one per SlipOK call, taken atomically ──
create or replace function consume_slip_credit(p_tenant uuid) returns boolean
language sql as $$
  with taken as (
    update tenants set slip_used = slip_used + 1
    where id = p_tenant and slip_used < slip_quota
    returning 1
  )
  select exists (select 1 from taken)
$$;
-- only the service role (webhook / API) may spend credits
revoke execute on function consume_slip_credit(uuid) from public, anon, authenticated;

-- give a credit back when the check failed for a reason that wasn't the slip's (timeout, SlipOK outage)
create or replace function refund_slip_credit(p_tenant uuid) returns void
language sql as $$
  update tenants set slip_used = slip_used - 1 where id = p_tenant and slip_used > 0
$$;
revoke execute on function refund_slip_credit(uuid) from public, anon, authenticated;

-- ── per-tenant Facebook Page token ──
-- Secret: security.sql hides this column from dashboard users; only the service role reads it.
alter table tenants add column if not exists page_access_token text;
-- what the dashboard may see instead: whether a token is saved
alter table tenants add column if not exists page_token_set boolean
  generated always as (page_access_token is not null) stored;

-- ── comments and comment rules belong to a tenant ──
alter table comments add column if not exists tenant_id uuid references tenants(id) on delete set null;
create index if not exists comments_tenant on comments (tenant_id, created_at desc);
alter table comment_rules add column if not exists tenant_id uuid references tenants(id) on delete cascade;
create index if not exists comment_rules_tenant on comment_rules (tenant_id);

-- backfill: Meta post ids are "<page id>_<post id>"; rules belong to the tenant of a Page they target
update comments c set tenant_id = t.id
  from tenants t
  where c.tenant_id is null and t.page_id is not null and c.post_id like t.page_id || '\_%';
update comment_rules r set tenant_id = t.id
  from tenants t
  where r.tenant_id is null and t.page_id = any (r.page_ids);
