-- Run after billing.sql and payments.sql. Safe to rerun, including after admin-feature-bypass.sql.
-- Existing balances and pending broadcast orders are preserved.
begin;
alter table public.tenants add column if not exists slip_quota_credits integer not null default 0
  check (slip_quota_credits >= 0);
alter table public.billing_requests drop constraint if exists billing_requests_item_check;
alter table public.billing_requests add constraint billing_requests_item_check
  check (item in ('starter', 'pro', 'topup_s', 'topup_m', 'topup_l', 'slip_topup_s', 'slip_topup_m', 'slip_topup_l'));
grant select (slip_quota_credits) on public.tenants to authenticated;

-- Extend the installed approval function, retaining existing admin exemptions and plan behavior.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.approve_billing_request(uuid,uuid)'::regprocedure);
  if position('slip_quota_credits' in definition) = 0 then
    if position('update tenants set broadcast_topup_credits = broadcast_topup_credits + r.credits where id = r.tenant_id;' in definition) = 0 then
      raise exception 'Unsupported approve_billing_request definition; apply the updated billing.sql first';
    end if;
    definition := replace(definition,
      'update tenants set broadcast_topup_credits = broadcast_topup_credits + r.credits where id = r.tenant_id;',
      'if r.item in (''slip_topup_s'', ''slip_topup_m'', ''slip_topup_l'') then
         update tenants set slip_quota_credits = slip_quota_credits + r.credits where id = r.tenant_id;
       elsif r.item in (''topup_s'', ''topup_m'', ''topup_l'') then
         update tenants set broadcast_topup_credits = broadcast_topup_credits + r.credits where id = r.tenant_id;
       else return ''ไม่พบแพ็กเกจเติมเงินนี้'';
       end if;');
    execute definition;
  end if;
end $$;

-- Update the metered implementation if the admin wrapper is installed; keep its bypass intact.
do $$
declare target text;
begin
  target := case when position('consume_slip_credit_metered(' in
    pg_get_functiondef('public.consume_slip_credit(uuid)'::regprocedure)) > 0
    then 'consume_slip_credit_metered' else 'consume_slip_credit' end;
  execute format('create or replace function public.%I(p_tenant uuid) returns boolean
    language sql set search_path = pg_catalog, public as $body$
      with taken as (
        update public.tenants set slip_used = slip_used + 1
        where id = p_tenant and slip_used::bigint < slip_quota::bigint + slip_quota_credits::bigint
        returning 1
      ) select exists (select 1 from taken)
    $body$', target);
  execute format('revoke all on function public.%I(uuid) from public, anon, authenticated', target);
  if target = 'consume_slip_credit' then
    grant execute on function public.consume_slip_credit(uuid) to service_role;
  else
    revoke all on function public.consume_slip_credit_metered(uuid) from service_role;
  end if;
end $$;
revoke all on function public.approve_billing_request(uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_billing_request(uuid, uuid) to service_role;
commit;
