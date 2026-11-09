-- Restrict direct EXECUTE access to public-schema functions.
-- Trigger-returning and extension-owned functions are left unchanged.
-- Existing service_role grants are not modified.
begin;

set local lock_timeout = '2s';
set local statement_timeout = '60s';

-- The global revoke is needed because schema-specific default ACLs cannot
-- override a global EXECUTE grant. Scope it to the migration creator role.
alter default privileges for role postgres
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

do $hardening$
declare
  function_record record;
begin
  for function_record in
    select
      namespace.nspname,
      procedure.proname,
      pg_get_function_identity_arguments(procedure.oid) as identity_arguments
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
  loop
    execute format(
      'revoke all privileges on function %I.%I(%s) from public, anon, authenticated',
      function_record.nspname,
      function_record.proname,
      function_record.identity_arguments
    );
  end loop;
end;
$hardening$;

-- The complete authenticated allow-list: five RLS helpers and seventeen
-- stateless utility, parser, validation, and trigger-dependency functions.
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.can_access_tenant(uuid) to authenticated;
grant execute on function public.can_manage_bank_accounts(uuid) to authenticated;
grant execute on function public.can_manage_image_rules(uuid) to authenticated;
grant execute on function public.has_tenant_feature(uuid, text) to authenticated;
grant execute on function public.valid_fallback_messages(text[]) to authenticated;
grant execute on function public.valid_handover_messages(text[]) to authenticated;
grant execute on function public.bank_registry_code_valid(text) to authenticated;
grant execute on function public.refresh_customer_tab(uuid) to authenticated;
grant execute on function public.assert_valid_store_rules(text) to authenticated;
grant execute on function public.shipping_address_valid(jsonb) to authenticated;
grant execute on function public.shipping_payment_ready(uuid) to authenticated;
grant execute on function public.normalize_auction_settings_before_split(jsonb) to authenticated;
grant execute on function public.default_auction_close_keywords() to authenticated;
grant execute on function public.auction_close_keyword_matches(text, jsonb) to authenticated;
grant execute on function public.auction_numeric_price(text) to authenticated;
grant execute on function public.normalize_auction_thai_settings(jsonb) to authenticated;
grant execute on function public.normalize_auction_tag(text) to authenticated;
grant execute on function public.auction_comment_tags(jsonb, text, text) to authenticated;
grant execute on function public.resolve_facebook_comment_settings(jsonb, jsonb) to authenticated;
grant execute on function public.first_configured_facebook_comment_tags(jsonb) to authenticated;
grant execute on function public.live_comment_time(jsonb, timestamp with time zone) to authenticated;

commit;
