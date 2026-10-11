-- Multi-tenant access control. Run LAST (after schema, tenants, comment-rules, platform, orders).
-- Safe to re-run: every policy is dropped and recreated, so this file is the single source of truth.
--
-- Who sees what:
--   platform admin (platform_admins)  every tenant, plus rows not yet linked to a tenant
--   tenant member  (tenant_members)   only the rows of their own tenants
--   anyone else                       nothing
-- The webhook and API routes use the service role (bypasses RLS) and check membership in code (lib/auth.ts).
--
-- After the first run, make yourself platform admin (replace the email):
--   insert into platform_admins (user_id) select id from auth.users where email = 'you@example.com' on conflict do nothing;
-- Give a shop owner or staff member access to one tenant:
--   insert into tenant_members (tenant_id, user_id, role)
--   select '<tenant uuid>', id, 'owner' from auth.users where email = 'owner@shop.com' on conflict do nothing;
-- Also turn off Authentication > Sign In / Providers > "Allow new users to sign up": accounts are created by the admin.

create table if not exists platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists tenant_members (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index if not exists tenant_members_user on tenant_members (user_id);

alter table platform_admins enable row level security;
alter table tenant_members enable row level security;

-- security definer: the policies below call these, and they must read the membership tables
-- without recursing into those tables' own policies
create or replace function is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid())
$$;

create or replace function can_access_tenant(p_tenant uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_platform_admin()
      or (p_tenant is not null
          and exists (select 1 from tenant_members where tenant_id = p_tenant and user_id = auth.uid()))
$$;

revoke execute on function is_platform_admin() from public, anon;
revoke execute on function can_access_tenant(uuid) from public, anon;
grant execute on function is_platform_admin() to authenticated;
grant execute on function can_access_tenant(uuid) to authenticated;

-- ── drop the old "any signed-in user" policies ──
drop policy if exists staff_read   on customers;
drop policy if exists staff_toggle on customers;
drop policy if exists staff_read   on messages;
drop policy if exists staff_read   on comments;
drop policy if exists staff_read   on slips;
drop policy if exists staff_read   on tenants;
drop policy if exists staff_all    on comment_rules;

-- ── membership ──
drop policy if exists own_row on platform_admins;
create policy own_row on platform_admins for select to authenticated using (user_id = auth.uid());

drop policy if exists member_read on tenant_members;
create policy member_read on tenant_members for select to authenticated
  using (user_id = auth.uid() or can_access_tenant(tenant_id));

-- ── tenants: read only, and never the Page token ──
drop policy if exists member_read on tenants;
create policy member_read on tenants for select to authenticated using (can_access_tenant(id));
revoke all on tenants from anon, authenticated;
-- column list: add new non-secret columns here when tenants grows
grant select (id, name, account_name, account_number, bank_code, page_id, expected_amount,
              auto_reply_enabled, auto_verify_enabled, slip_quota, slip_used, page_token_set, created_at)
  on tenants to authenticated;

-- ── customers: read, and flip the per-chat bot switch ──
drop policy if exists member_read on customers;
create policy member_read on customers for select to authenticated using (can_access_tenant(tenant_id));
drop policy if exists member_toggle on customers;
create policy member_toggle on customers for update to authenticated
  using (can_access_tenant(tenant_id)) with check (can_access_tenant(tenant_id));
revoke insert, update, delete on customers from anon, authenticated;
grant update (bot_enabled) on customers to authenticated;

-- ── messages: through the customer's tenant ──
drop policy if exists member_read on messages;
create policy member_read on messages for select to authenticated
  using (exists (select 1 from customers c where c.id = messages.customer_id and can_access_tenant(c.tenant_id)));
revoke insert, update, delete on messages from anon, authenticated;

-- ── comments, slips ──
drop policy if exists member_read on comments;
create policy member_read on comments for select to authenticated using (can_access_tenant(tenant_id));
revoke insert, update, delete on comments from anon, authenticated;

drop policy if exists member_read on slips;
create policy member_read on slips for select to authenticated using (can_access_tenant(tenant_id));
revoke insert, update, delete on slips from anon, authenticated;

-- ── comment rules: managed from the dashboard, always inside one tenant ──
drop policy if exists member_all on comment_rules;
create policy member_all on comment_rules for all to authenticated
  using (can_access_tenant(tenant_id))
  with check (tenant_id is not null and can_access_tenant(tenant_id));

-- ── products (managed by members), orders (members read and move them along) ──
drop policy if exists member_all on products;
create policy member_all on products for all to authenticated
  using (can_access_tenant(tenant_id)) with check (can_access_tenant(tenant_id));

drop policy if exists member_read on orders;
create policy member_read on orders for select to authenticated using (can_access_tenant(tenant_id));
drop policy if exists member_update on orders;
create policy member_update on orders for update to authenticated
  using (can_access_tenant(tenant_id)) with check (can_access_tenant(tenant_id));
revoke insert, delete on orders from anon, authenticated;
revoke update on orders from anon, authenticated;
grant update (status) on orders to authenticated;
