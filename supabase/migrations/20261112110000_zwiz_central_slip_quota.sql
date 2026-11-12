begin;

-- Keep local tenant credits for explicitly selected SlipOK verification, while
-- allowing ZWIZ (which meters at the provider account) to proceed without them.
drop function if exists public.start_payment_pro_provider(uuid, uuid);

create function public.start_payment_pro_provider(
  p_attempt uuid,
  p_claim uuid,
  p_metered boolean default true
) returns boolean
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  attempt public.payment_pro_attempts;
begin
  select * into attempt
  from public.payment_pro_attempts
  where id = p_attempt;
  if not found then return false; end if;

  perform 1 from public.tenants where id = attempt.tenant_id for update;
  select * into attempt
  from public.payment_pro_attempts
  where id = p_attempt
  for update;

  if attempt.status <> 'VERIFYING'
    or attempt.claim_token is distinct from p_claim
    or attempt.claim_until <= clock_timestamp()
    or attempt.provider_started_at is not null then
    return false;
  end if;

  if not public.has_tenant_feature(attempt.tenant_id, 'slip_auto_pilot')
    or not exists (
      select 1 from public.payment_pro_settings
      where tenant_id = attempt.tenant_id
        and enabled
        and flags->'riskEngine' = 'true'::jsonb
    ) then
    update public.payment_pro_attempts
    set status = 'REVIEW_REQUIRED', reason = 'FEATURE_DISABLED'
    where id = attempt.id;
    update public.slips
    set status = 'error', note = 'Payment Pro ถูกปิดหรือแพ็กเกจหมดอายุ', verified_at = now()
    where id = attempt.slip_id;
    return false;
  end if;

  if p_metered and not public.consume_slip_credit(attempt.tenant_id) then
    update public.payment_pro_attempts
    set status = 'REVIEW_REQUIRED', reason = 'INSUFFICIENT_CREDITS'
    where id = attempt.id;
    update public.slips
    set status = 'error', note = 'เครดิตตรวจสลิปหมด กรุณาเติมเครดิต', verified_at = now()
    where id = attempt.slip_id;
    return false;
  end if;

  update public.payment_pro_attempts
  set provider_started_at = clock_timestamp(), credit_charged = p_metered
  where id = attempt.id;
  return true;
end;
$$;

revoke all on function public.start_payment_pro_provider(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.start_payment_pro_provider(uuid, uuid, boolean)
  to service_role;

-- Vision dispatch previously rejected VERIFY_SLIP jobs when the tenant's local
-- slip meter was empty. Keep feature/auto-verify checks; the selected provider
-- is charged by its own account for ZWIZ, and standalone verification meters
-- only when the explicitly selected provider is SlipOK.
create or replace function public.begin_vision_dispatch(p_job uuid, p_claim uuid)
returns boolean
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  job public.vision_jobs;
  customer public.customers;
begin
  select * into job from public.vision_jobs where id = p_job;
  if not found or job.customer_id is null then return false; end if;

  select * into customer
  from public.customers
  where id = job.customer_id and tenant_id = job.tenant_id
  for update;
  select * into job from public.vision_jobs where id = p_job for update;

  if job.source <> 'messenger'
    or job.status <> 'processing'
    or job.claim_token is distinct from p_claim
    or job.claim_until <= clock_timestamp()
    or job.dispatch_started_at is not null
    or not public.has_tenant_feature(job.tenant_id, 'image_assistant')
    or not exists (select 1 from public.vision_settings where tenant_id = job.tenant_id and enabled)
    or not exists (select 1 from public.tenants where id = job.tenant_id and auto_reply_enabled)
    or customer.id is null
    or not customer.bot_enabled
    or customer.assigned_user_id is not null
    or customer.conversation_status = 'closed'
    or customer.last_message_at is null
    or customer.last_message_at < clock_timestamp() - interval '24 hours'
    or customer.outbound_lock_until > clock_timestamp() then
    return false;
  end if;

  if job.decision->>'action' = 'PRODUCT_SEARCH'
    and (not public.has_tenant_feature(job.tenant_id, 'ai_agent')
      or not exists (
        select 1
        from public.tenants t
        join public.vision_plan_limits l on l.plan = t.plan
        join public.vision_settings s on s.tenant_id = t.id
        where t.id = job.tenant_id and l.product_search and s.mode = 'catalog'
      )) then
    return false;
  end if;

  if job.decision->>'action' = 'VERIFY_SLIP'
    and (not public.has_tenant_feature(job.tenant_id, 'slip_auto_pilot')
      or not exists (
        select 1 from public.tenants
        where id = job.tenant_id and auto_verify_enabled
      )) then
    return false;
  end if;

  update public.vision_jobs set dispatch_started_at = clock_timestamp() where id = job.id;
  return true;
end;
$$;

revoke all on function public.begin_vision_dispatch(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.begin_vision_dispatch(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
commit;
