-- Manual full reset: run in the Supabase SQL Editor as postgres.
-- This deletes every shop, including bank settings, quotas and Page tokens.
-- According to the project foreign keys, deleting tenants also deletes:
--   tenant_members (ALL roles), products, orders and comment_rules.
-- customers, slips and comments remain, but their tenant_id becomes NULL.
-- A DELETE of owner memberships afterwards is unnecessary: they already cascade.
-- This is a data reset, not a schema migration; run only when a full reset is intended.

begin;
delete from public.tenants;
commit;
