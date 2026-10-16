-- Run LAST after billing/payment/AI migrations. Safe to rerun; preserves balances.
begin;
create or replace function public.approve_billing_request(p_request uuid, p_admin uuid) returns text
language plpgsql set search_path = pg_catalog, public as $$
declare
  r billing_requests;
  t tenants;
  this_month text := to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM');
begin
  select * into r from billing_requests where id = p_request for update;
  if not found then return 'ไม่พบคำขอนี้'; end if;
  if r.status = 'approved' then return null; end if;
  if r.status <> 'pending' then return 'คำขอนี้ถูกดำเนินการไปแล้ว'; end if;
  perform refresh_broadcast_credits(r.tenant_id);
  select * into t from tenants where id = r.tenant_id for update;

  if r.item in ('starter', 'pro') then
    update tenants set
      plan = r.item,
      plan_expires_at = (case when t.plan = r.item and t.plan_expires_at > now() then t.plan_expires_at else now() end) + interval '30 days',
      broadcast_allowance = r.credits,
      broadcast_credits = broadcast_credits + r.credits,
      broadcast_period = this_month
    where id = r.tenant_id;
  else
    if r.item in ('slip_topup_s', 'slip_topup_m', 'slip_topup_l') then
      update tenants set slip_quota_credits = slip_quota_credits + r.credits where id = r.tenant_id;
    elsif r.item in ('topup_s', 'topup_m', 'topup_l') then
      -- Keep purchased broadcast credits in their non-expiring bucket.
      update tenants set broadcast_topup_credits = broadcast_topup_credits + r.credits where id = r.tenant_id;
    else
      return 'ไม่พบแพ็กเกจเติมเงินนี้';
    end if;
  end if;

  update billing_requests set status = 'approved', decided_by = p_admin, decided_at = now() where id = p_request;
  return null;
end $$;
create or replace function public.payment_legacy_credit_mode() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.status = 'approved' and old.status <> 'approved' and new.item in ('starter', 'pro') then
    update public.tenants set broadcast_credit_mode = 'purchased' where id = new.tenant_id;
  end if;
  return new;
end $$;
create or replace function public.guard_ai_agent_plan() returns trigger language plpgsql set search_path=pg_catalog,public as $$ begin return new; end $$;
revoke all on function public.approve_billing_request(uuid,uuid) from public,anon,authenticated;
grant execute on function public.approve_billing_request(uuid,uuid) to service_role;
revoke all on function public.guard_ai_agent_plan() from public,anon,authenticated,service_role;
commit;
