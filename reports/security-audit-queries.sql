-- Read-only Supabase security diagnostics. Every statement is SELECT-only.

-- Row-level security status for auction and order-processing tables.
with core_tables(table_name) as (
  values
    ('auctions'),
    ('auction_bids'),
    ('auction_deliveries'),
    ('auction_poll_cursors'),
    ('auction_winner_claims'),
    ('customer_tabs'),
    ('customers'),
    ('facebook_webhook_events'),
    ('live_sessions'),
    ('messages'),
    ('orders')
)
select
  core_tables.table_name,
  coalesce(c.relrowsecurity, false) as rls_enabled,
  coalesce(c.relforcerowsecurity, false) as rls_forced,
  c.relkind as relation_kind
from core_tables
left join pg_catalog.pg_class c on c.relname = core_tables.table_name
left join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
where c.oid is null or n.oid is not null
order by core_tables.table_name;

-- Policies, including target roles and both policy predicates.
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename = any(array[
    'auctions',
    'auction_bids',
    'auction_deliveries',
    'auction_poll_cursors',
    'auction_winner_claims',
    'customer_tabs',
    'customers',
    'facebook_webhook_events',
    'live_sessions',
    'messages',
    'orders'
  ])
order by tablename, policyname;

-- Effective EXECUTE privileges for auction functions by API role.
select
  p.oid::regprocedure as function_signature,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = any(array[
    'finalize_live_auction',
    'finalize_live_auction_highest_bid',
    'normalize_auction_settings_before_split',
    'process_live_auction_comment',
    'process_live_auction_highest_bid',
    'advance_live_auction',
    'expire_live_auctions',
    'expire_live_auctions_report',
    'close_due_live_auction',
    'start_legacy_auction_timer'
  ])
order by p.proname, p.oid::regprocedure::text;
