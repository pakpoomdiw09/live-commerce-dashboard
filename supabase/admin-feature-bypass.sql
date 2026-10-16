-- Run LAST, after security.sql, platform.sql, billing.sql, payments.sql, ai-agent-gate.sql.
-- Re-run this file after re-running any of those migrations. No user_metadata privileges.
-- Background service requests are exempt ONLY for tenants with an admin OWNER.
begin;

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated, service_role;

create or replace function public.tenant_has_feature_bypass(p_tenant uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1 from public.tenant_members m
    join public.platform_admins a on a.user_id = m.user_id
    where m.tenant_id = p_tenant and m.role = 'owner'
  )
$$;
revoke all on function public.tenant_has_feature_bypass(uuid) from public, anon, authenticated;
grant execute on function public.tenant_has_feature_bypass(uuid) to service_role;

-- Keep the current atomic implementations (including purchased credits) behind wrappers.
-- Reruns detect existing wrappers; reruns after upstream SQL recapture its implementations.
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

create or replace function public.consume_slip_credit(p_tenant uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if public.is_platform_admin() or public.tenant_has_feature_bypass(p_tenant) then return true; end if;
  return public.consume_slip_credit_metered(p_tenant);
end $$;
create or replace function public.refund_slip_credit(p_tenant uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if public.is_platform_admin() or public.tenant_has_feature_bypass(p_tenant) then return; end if;
  perform public.refund_slip_credit_metered(p_tenant);
end $$;
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
create or replace function public.refund_broadcast_credits(p_tenant uuid, p_monthly integer, p_topup integer)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if public.is_platform_admin() or public.tenant_has_feature_bypass(p_tenant) then return; end if;
  perform public.refund_broadcast_credits_metered(p_tenant, p_monthly, p_topup);
end $$;

revoke all on function public.consume_slip_credit_metered(uuid), public.refund_slip_credit_metered(uuid),
  public.reserve_broadcast_credits_metered(uuid, integer), public.refund_broadcast_credits_metered(uuid, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.consume_slip_credit(uuid), public.refund_slip_credit(uuid),
  public.reserve_broadcast_credits(uuid, integer), public.refund_broadcast_credits(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_slip_credit(uuid), public.refund_slip_credit(uuid),
  public.reserve_broadcast_credits(uuid, integer), public.refund_broadcast_credits(uuid, integer, integer)
  to service_role;

create or replace function public.guard_ai_agent_plan() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  return new;
end $$;
revoke all on function public.guard_ai_agent_plan() from public, anon, authenticated, service_role;

-- Preserve the legacy approval flow while exempting admins from its Free-plan top-up gate.
do $$ declare definition text; begin
  definition := pg_get_functiondef('public.approve_billing_request(uuid,uuid)'::regprocedure);
  definition := replace(definition, 'if t.plan = ''free'' then',
    'if t.plan = ''free'' and not public.is_platform_admin() and not public.tenant_has_feature_bypass(r.tenant_id) then');
  execute definition;
end $$;
commit;
