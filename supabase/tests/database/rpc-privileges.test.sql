begin;

create temporary table rpc_privilege_allowlist (
  ordinal integer primary key,
  signature text not null unique
) on commit drop;

insert into rpc_privilege_allowlist (ordinal, signature) values
  (1, 'public.is_platform_admin()'),
  (2, 'public.can_access_tenant(uuid)'),
  (3, 'public.can_manage_bank_accounts(uuid)'),
  (4, 'public.can_manage_image_rules(uuid)'),
  (5, 'public.has_tenant_feature(uuid,text)'),
  (6, 'public.valid_fallback_messages(text[])'),
  (7, 'public.valid_handover_messages(text[])'),
  (8, 'public.bank_registry_code_valid(text)'),
  (9, 'public.refresh_customer_tab(uuid)'),
  (10, 'public.assert_valid_store_rules(text)'),
  (11, 'public.shipping_address_valid(jsonb)'),
  (12, 'public.shipping_payment_ready(uuid)'),
  (13, 'public.normalize_auction_settings_before_split(jsonb)'),
  (14, 'public.default_auction_close_keywords()'),
  (15, 'public.auction_close_keyword_matches(text,jsonb)'),
  (16, 'public.auction_numeric_price(text)'),
  (17, 'public.normalize_auction_thai_settings(jsonb)'),
  (18, 'public.normalize_auction_tag(text)'),
  (19, 'public.auction_comment_tags(jsonb,text,text)'),
  (20, 'public.resolve_facebook_comment_settings(jsonb,jsonb)'),
  (21, 'public.first_configured_facebook_comment_tags(jsonb)'),
  (22, 'public.live_comment_time(jsonb,timestamp with time zone)');

create temporary table rpc_privilege_critical (
  ordinal integer primary key,
  signature text not null unique
) on commit drop;

insert into rpc_privilege_critical (ordinal, signature) values
  (1, 'public.commerce_checkout(text,jsonb)'),
  (2, 'public.commerce_move_order(uuid,uuid,uuid,text,text)'),
  (3, 'public.place_cf_order(uuid,text,text,text,text)'),
  (4, 'public.place_cf_order(uuid,uuid,uuid,text,text,text,text)'),
  (5, 'public.place_cf_order(uuid,uuid,uuid,text)'),
  (6, 'public.place_live_cf_order(uuid,uuid,uuid,text,text,text,text)'),
  (7, 'public.place_facebook_catalog_order(uuid,uuid,text,text,text,text)'),
  (8, 'public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text)'),
  (9, 'public.claim_auction_bill_delivery(uuid,bigint)');

select plan(78);

-- 1-3: expected database roles exist.
select ok(exists (select 1 from pg_roles where rolname = 'anon'), 'anon role exists');
select ok(exists (select 1 from pg_roles where rolname = 'authenticated'), 'authenticated role exists');
select ok(exists (select 1 from pg_roles where rolname = 'service_role'), 'service_role role exists');

-- 4-25: all exact allow-list signatures exist.
select ok(to_regprocedure(signature) is not null, signature || ' exists')
from rpc_privilege_allowlist
order by ordinal;

-- 26-47: authenticated can execute each allow-listed function.
select ok(
  has_function_privilege('authenticated', to_regprocedure(signature), 'EXECUTE'),
  signature || ' is executable by authenticated'
)
from rpc_privilege_allowlist
order by ordinal;

-- 48-69: anon cannot execute any allow-listed function.
select ok(
  not has_function_privilege('anon', to_regprocedure(signature), 'EXECUTE'),
  signature || ' is not executable by anon'
)
from rpc_privilege_allowlist
order by ordinal;

-- 70: anon execution is limited to trigger-returning or extension-owned functions.
select ok(not exists (
  select 1
  from pg_proc as procedure
  join pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.prokind <> 'p'
    and procedure.prorettype <> 'trigger'::regtype
    and not exists (
      select 1
      from pg_depend as dependency
      where dependency.classid = 'pg_proc'::regclass
        and dependency.objid = procedure.oid
        and dependency.refclassid = 'pg_extension'::regclass
        and dependency.deptype = 'e'
    )
    and has_function_privilege('anon', procedure.oid, 'EXECUTE')
), 'anon cannot execute non-trigger, non-extension public functions');

-- 71: no other non-trigger, non-extension public function is executable by authenticated.
select ok(not exists (
  select 1
  from pg_proc as procedure
  join pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.prokind <> 'p'
    and procedure.prorettype <> 'trigger'::regtype
    and not exists (
      select 1
      from pg_depend as dependency
      where dependency.classid = 'pg_proc'::regclass
        and dependency.objid = procedure.oid
        and dependency.refclassid = 'pg_extension'::regclass
        and dependency.deptype = 'e'
    )
    and has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
    and not exists (
      select 1
      from rpc_privilege_allowlist as allowlist
      where to_regprocedure(allowlist.signature) = procedure.oid
    )
), 'authenticated has no non-allow-listed non-trigger function access');

-- 72: authenticated has exactly the 22 intended non-trigger function grants.
select is((
  select count(*)::integer
  from pg_proc as procedure
  join pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.prokind <> 'p'
    and procedure.prorettype <> 'trigger'::regtype
    and not exists (
      select 1
      from pg_depend as dependency
      where dependency.classid = 'pg_proc'::regclass
        and dependency.objid = procedure.oid
        and dependency.refclassid = 'pg_extension'::regclass
        and dependency.deptype = 'e'
    )
    and has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
), 22, 'authenticated has exactly 22 non-trigger allow-list functions');

-- 73: PUBLIC has no direct EXECUTE ACL on non-trigger, non-extension functions.
select ok(not exists (
  select 1
  from pg_proc as procedure
  join pg_namespace as namespace on namespace.oid = procedure.pronamespace
  cross join lateral aclexplode(
    coalesce(procedure.proacl, acldefault('f', procedure.proowner))
  ) as privilege
  where namespace.nspname = 'public'
    and procedure.prokind <> 'p'
    and procedure.prorettype <> 'trigger'::regtype
    and not exists (
      select 1
      from pg_depend as dependency
      where dependency.classid = 'pg_proc'::regclass
        and dependency.objid = procedure.oid
        and dependency.refclassid = 'pg_extension'::regclass
        and dependency.deptype = 'e'
    )
    and privilege.grantee = 0
    and privilege.privilege_type = 'EXECUTE'
), 'PUBLIC has no EXECUTE ACL on non-trigger, non-extension functions');

-- 74-76: critical RPC signatures exist and are unavailable to anon/authenticated.
select ok(bool_and(to_regprocedure(signature) is not null), 'all critical RPC signatures exist')
from rpc_privilege_critical;
select ok(bool_and(not has_function_privilege('anon', to_regprocedure(signature), 'EXECUTE')),
  'anon cannot execute critical RPCs')
from rpc_privilege_critical;
select ok(bool_and(not has_function_privilege('authenticated', to_regprocedure(signature), 'EXECUTE')),
  'authenticated cannot execute critical RPCs')
from rpc_privilege_critical;

-- Create a function after the migration to probe creator-role default privileges.
create or replace function public._rpc_privilege_default_probe()
returns integer
language sql
immutable
as $$ select 1 $$;

-- 77-78: future public functions are not opened to PUBLIC, anon, or authenticated.
select ok(not exists (
  select 1
  from aclexplode(coalesce(
    (select procedure.proacl from pg_proc as procedure
     where procedure.oid = 'public._rpc_privilege_default_probe()'::regprocedure),
    acldefault('f', (select procedure.proowner from pg_proc as procedure
                     where procedure.oid = 'public._rpc_privilege_default_probe()'::regprocedure))
  )) as privilege
  where privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
), 'new public function has no PUBLIC EXECUTE grant');
select ok(
  not has_function_privilege('anon', 'public._rpc_privilege_default_probe()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public._rpc_privilege_default_probe()', 'EXECUTE'),
  'new public function is not executable by anon or authenticated'
);

select * from finish();
rollback;
