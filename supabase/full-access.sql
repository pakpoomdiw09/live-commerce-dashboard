-- Apply LAST in the production SQL Editor, after the existing feature/AI/vision migrations.
-- Temporary package bypass for all ACTIVE tenants. Does not grant tenant membership,
-- change billing records, enable automation, or remove provider/window/rate protections.
-- Saves installed function definitions so full-access-rollback.sql restores them exactly.
begin;

create table if not exists public.full_access_function_backup (
  signature text primary key,
  definition text not null,
  saved_at timestamptz not null default now()
);
alter table public.full_access_function_backup enable row level security;
revoke all on public.full_access_function_backup from public, anon, authenticated, service_role;

-- Fail rather than silently replacing an unfamiliar implementation.
create or replace function pg_temp.full_access_replace(body text, old_text text, new_text text)
returns text language plpgsql as $$
begin
  if strpos(body, old_text) = 0 then
    raise exception 'Full Access: unexpected installed function; missing expression: %', old_text;
  end if;
  return replace(body, old_text, new_text);
end $$;

do $migration$
declare target_signature text; body text;
begin
  foreach target_signature in array array[
    'public.has_tenant_feature(uuid,text)',
    'public.tenant_has_paid_ai_access(uuid)',
    'public.consume_slip_credit(uuid)',
    'public.refund_slip_credit(uuid)',
    'public.reserve_broadcast_credits(uuid,integer)',
    'public.refund_broadcast_credits(uuid,integer,integer)',
    'public.start_agent_ai_call(uuid,uuid,uuid,uuid,uuid)',
    'public.set_agent_overview_capability(uuid,uuid,text,boolean)',
    'public.guard_keyword_reply_limit()',
    'public.guard_followup_plan()',
    'public.commerce_plan(uuid)',
    'public.claim_vision_job(uuid)',
    'public.begin_vision_dispatch(uuid,uuid)',
    'public.save_vision_settings(uuid,uuid,boolean,text,numeric,boolean)'
  ] loop
    if to_regprocedure(target_signature) is null then
      raise exception 'Full Access prerequisite missing: %', target_signature;
    end if;
    insert into public.full_access_function_backup(signature, definition)
    values(target_signature, pg_get_functiondef(target_signature::regprocedure)) on conflict do nothing;
  end loop;

  select definition into body from public.full_access_function_backup
    where signature='public.start_agent_ai_call(uuid,uuid,uuid,uuid,uuid)';
  body := pg_temp.full_access_replace(body, 'not found or s.ai_monthly_limit<=0', 'not found');
  body := pg_temp.full_access_replace(body, 'and used<s.ai_monthly_limit', '');
  execute body;

  select definition into body from public.full_access_function_backup
    where signature='public.set_agent_overview_capability(uuid,uuid,text,boolean)';
  body := pg_temp.full_access_replace(body, 'settings.ai_monthly_limit<=coalesce(used_count,0)', 'false');
  body := pg_temp.full_access_replace(body, 'slip_remaining<=0', 'false');
  execute body;

  select definition into body from public.full_access_function_backup where signature='public.guard_keyword_reply_limit()';
  body := pg_temp.full_access_replace(body, 'used>=allowed', 'false');
  execute body;
  select definition into body from public.full_access_function_backup where signature='public.guard_followup_plan()';
  body := pg_temp.full_access_replace(body, 'if new.followup_enabled', 'if false and new.followup_enabled');
  execute body;

  select definition into body from public.full_access_function_backup where signature='public.claim_vision_job(uuid)';
  body := pg_temp.full_access_replace(body, 'and used<coalesce(limit_images,0)', '');
  execute body;
  foreach target_signature in array array[
    'public.begin_vision_dispatch(uuid,uuid)',
    'public.save_vision_settings(uuid,uuid,boolean,text,numeric,boolean)'
  ] loop
    select definition into body from public.full_access_function_backup b where b.signature=target_signature;
    body := pg_temp.full_access_replace(body, 'l.product_search', 'true');
    execute body;
  end loop;
end $migration$;

-- Retain active-tenant checks; membership continues to be enforced by routes and RLS.
create or replace function public.has_tenant_feature(p_tenant uuid,p_feature text) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
  select p_feature in ('ai_agent','image_assistant','customer_management','slip_auto_pilot','customer_follow_up')
    and exists(select 1 from public.tenants where id=p_tenant and is_active)
$$;
create or replace function public.tenant_has_paid_ai_access(p_tenant uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
  select exists(select 1 from public.tenants where id=p_tenant and is_active)
$$;
create or replace function public.consume_slip_credit(p_tenant uuid) returns boolean
language sql set search_path=pg_catalog,public as $$
  with used as (
    update public.tenants set slip_used=slip_used+1 where id=p_tenant and is_active returning id
  ) select exists(select 1 from used)
$$;
-- Slip refunds still reverse actual usage; preserve the installed refund implementation.
create or replace function public.reserve_broadcast_credits(p_tenant uuid,p_count integer)
returns table(monthly integer,topup integer)
language sql set search_path=pg_catalog,public as $$
  select greatest(coalesce(p_count,0),0),0
  where exists(select 1 from public.tenants where id=p_tenant and is_active)
$$;
-- No balance was deducted by the temporary reservation: never mint refund credits.
create or replace function public.refund_broadcast_credits(p_tenant uuid,p_monthly integer,p_topup integer)
returns void language plpgsql set search_path=pg_catalog,public as $$ begin return; end $$;
create or replace function public.commerce_plan(p_tenant uuid) returns public.commerce_limits
language sql stable security definer set search_path=pg_catalog,public as $$
  select 'pro'::text,null::integer,2147483647,true,true,true
  from public.tenants where id=p_tenant and is_active
$$;

-- CREATE OR REPLACE retains the original execution grants and function OIDs.
-- No change to customer ownership, authentication, opt-outs, bank validation or AI rate limits.
commit;
