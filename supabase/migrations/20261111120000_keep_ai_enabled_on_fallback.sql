begin;

-- Quota fallbacks and Messenger window expiry must not overwrite a merchant's
-- per-customer AI toggle. Keep these RPCs for compatibility with older workers.
create or replace function public.start_inbox_handover(p_customer uuid)
returns uuid
language sql
set search_path = pg_catalog, public
as $$
  select public.start_inbox_delivery(p_customer, null);
$$;

create or replace function public.handover_tenant_ai_quota(
  p_tenant uuid,
  p_customer uuid,
  p_message uuid
) returns boolean
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  target_customer public.customers;
begin
  perform 1
  from public.tenants
  where id = p_tenant and is_active
  for update;
  if not found then return false; end if;

  select * into target_customer
  from public.customers
  where id = p_customer and tenant_id = p_tenant
  for update;
  if not found or not exists (
    select 1
    from public.messages
    where id = p_message
      and customer_id = target_customer.id
      and sender = 'customer'
  ) then
    return false;
  end if;

  return true;
end;
$$;

create or replace function public.expire_inbox_automation(p_customer uuid)
returns boolean
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  return false;
end;
$$;

create or replace function public.expire_inbox_automation_windows(p_limit integer default 200)
returns integer
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'Invalid batch limit' using errcode = '22023';
  end if;
  return 0;
end;
$$;

create or replace function public.handover_vision_job(
  p_job uuid,
  p_claim uuid,
  p_reason text
) returns boolean
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  job public.vision_jobs;
  target_customer public.customers;
begin
  select * into job from public.vision_jobs where id = p_job;
  if not found or job.source <> 'messenger' or job.customer_id is null then
    return false;
  end if;

  perform 1 from public.tenants where id = job.tenant_id and is_active for update;
  if not found then return false; end if;

  select * into target_customer
  from public.customers
  where id = job.customer_id and tenant_id = job.tenant_id
  for update;
  select * into job from public.vision_jobs where id = p_job for update;

  if job.status <> 'processing'
    or p_claim is null
    or job.claim_token is distinct from p_claim
    or target_customer.id is null
    or not exists (
      select 1 from public.vision_settings
      where tenant_id = job.tenant_id and enabled
    )
    or not exists (
      select 1 from public.messages
      where id = job.message_id
        and customer_id = target_customer.id
        and sender = 'customer'
    ) then
    return false;
  end if;

  update public.vision_jobs
  set status = 'requires_review',
      reason = left(coalesce(nullif(p_reason, ''), 'VISION_ANALYSIS_FAILED'), 200),
      claim_token = null,
      claim_until = null,
      updated_at = clock_timestamp()
  where id = job.id;
  return true;
end;
$$;

commit;
