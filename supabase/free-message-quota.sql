-- Run LAST after feature-access.sql. Safe to rerun; preserves purchased top-ups.
begin;
alter table public.tenants alter column broadcast_allowance set default 100;
alter table public.tenants alter column broadcast_credits set default 100;
update public.tenants set broadcast_credits=case when broadcast_period<>to_char(now() at time zone 'Asia/Bangkok','YYYY-MM') then 100 else least(100,greatest(0,broadcast_credits-greatest(0,broadcast_allowance-100))) end, broadcast_allowance=100,broadcast_credit_mode='calendar',broadcast_period=to_char(now() at time zone 'Asia/Bangkok','YYYY-MM') where plan='free' and (broadcast_allowance<>100 or broadcast_credits>100 or broadcast_credit_mode<>'calendar');
create or replace function public.refresh_broadcast_credits(p_tenant uuid) returns void
language plpgsql set search_path = pg_catalog, public as $$
declare t public.tenants; this_month text := to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM');
begin
  select * into t from public.tenants where id = p_tenant for update;
  if not found then return; end if;
  if t.plan <> 'free' and t.plan_expires_at is not null and t.plan_expires_at <= now() then
    update public.tenants set plan = 'free', plan_expires_at = null, broadcast_allowance = 100,
      broadcast_credits = least(broadcast_credits, 100), broadcast_credit_mode = 'calendar'
    where id = p_tenant;
    t.broadcast_credit_mode := 'calendar';
  end if;
  if t.broadcast_credit_mode = 'calendar' and t.broadcast_period <> this_month then
    update public.tenants set broadcast_credits = broadcast_allowance, broadcast_period = this_month
    where id = p_tenant;
  end if;
end $$;

create or replace function public.reserve_broadcast_credits(p_tenant uuid, p_count integer)
returns table (monthly integer, topup integer)
language plpgsql set search_path = pg_catalog, public as $$
declare t public.tenants; m integer; u integer;
begin
  if p_count is null or p_count <= 0 then return query select 0, 0; return; end if;
  perform public.refresh_broadcast_credits(p_tenant);
  select * into t from public.tenants where id = p_tenant for update;
  if not found or not t.is_active then return query select 0, 0; return; end if;
  m := least(p_count, t.broadcast_credits);
  u := least(p_count - m, t.broadcast_topup_credits);
  update public.tenants set broadcast_credits = broadcast_credits - m,
    broadcast_topup_credits = broadcast_topup_credits - u where id = p_tenant;
  return query select m, u;
end $$;

create or replace function public.refund_broadcast_credits(p_tenant uuid, p_monthly integer, p_topup integer)
returns void language plpgsql set search_path = pg_catalog, public as $$
begin
  perform public.refresh_broadcast_credits(p_tenant);
  update public.tenants set
    broadcast_credits = case when broadcast_credit_mode = 'purchased'
      then broadcast_credits + greatest(coalesce(p_monthly, 0), 0)
      else least(broadcast_allowance, broadcast_credits + greatest(coalesce(p_monthly, 0), 0)) end,
    broadcast_topup_credits = broadcast_topup_credits + greatest(coalesce(p_topup, 0), 0)
  where id = p_tenant;
end $$;
create or replace function public.platform_update_tenant(
  p_tenant uuid, p_admin uuid, p_plan text default null, p_active boolean default null
) returns void
language plpgsql set search_path = pg_catalog, public as $$
declare t public.tenants; updated public.tenants; allowance integer;
begin
  if not exists (select 1 from public.platform_admins where user_id = p_admin) then
    raise exception 'Only platform admins may manage tenants' using errcode = '42501';
  end if;
  if p_plan is not null and p_plan not in ('free', 'starter', 'pro') then
    raise exception 'Unknown plan' using errcode = '22023';
  end if;
  if p_plan is null and p_active is null then raise exception 'No changes supplied' using errcode = '22023'; end if;
  select * into t from public.tenants where id = p_tenant for update;
  if not found then raise exception 'Tenant not found' using errcode = 'P0002'; end if;
  if p_plan is not null then
    allowance := case p_plan when 'free' then 100 when 'starter' then 1500 when 'pro' then 7500 end;
    update public.tenants set plan = p_plan,
      plan_expires_at = case when p_plan = 'free' then null else now() + interval '30 days' end,
      broadcast_allowance = allowance, broadcast_credits = allowance,
      broadcast_credit_mode = case when p_plan = 'free' then 'calendar' else 'purchased' end,
      broadcast_period = to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM')
    where id = p_tenant;
  end if;
  if p_active is not null then update public.tenants set is_active = p_active where id = p_tenant; end if;
  select * into updated from public.tenants where id = p_tenant;
  insert into public.platform_tenant_audit(tenant_id,admin_id,before_state,after_state)
    values(p_tenant,p_admin,
      jsonb_build_object('plan',t.plan,'expiresAt',t.plan_expires_at,'active',t.is_active,'broadcastCredits',t.broadcast_credits),
      jsonb_build_object('plan',updated.plan,'expiresAt',updated.plan_expires_at,'active',updated.is_active,'broadcastCredits',updated.broadcast_credits));
end $$;
alter table public.plan_features drop constraint if exists plan_features_feature_check;
alter table public.plan_features add constraint plan_features_feature_check check(feature in ('ai_agent','image_assistant','customer_management','slip_auto_pilot','customer_follow_up'));
insert into public.plan_features(plan,feature,enabled) values('starter','customer_follow_up',true),('pro','customer_follow_up',true) on conflict do nothing;
create or replace function public.guard_followup_plan() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$ begin if new.followup_enabled and not public.has_tenant_feature(new.tenant_id,'customer_follow_up') then raise exception 'FEATURE_LOCKED: customer_follow_up' using errcode='42501'; end if;return new;end $$;
drop trigger if exists bot_settings_followup_plan_gate on public.bot_settings;
create trigger bot_settings_followup_plan_gate before insert or update on public.bot_settings for each row execute function public.guard_followup_plan();
revoke all on function public.guard_followup_plan() from public,anon,authenticated,service_role;
drop policy if exists followup_feature_access on public.follow_up_jobs;
create policy followup_feature_access on public.follow_up_jobs as restrictive for all to authenticated using(public.has_tenant_feature(tenant_id,'customer_follow_up')) with check(public.has_tenant_feature(tenant_id,'customer_follow_up'));
revoke all on function public.refresh_broadcast_credits(uuid) from public,anon,authenticated;
grant execute on function public.refresh_broadcast_credits(uuid) to service_role;
revoke all on function public.reserve_broadcast_credits(uuid,integer) from public,anon,authenticated;
grant execute on function public.reserve_broadcast_credits(uuid,integer) to service_role;
revoke all on function public.refund_broadcast_credits(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.refund_broadcast_credits(uuid,integer,integer) to service_role;
revoke all on function public.platform_update_tenant(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.platform_update_tenant(uuid,uuid,text,boolean) to service_role;
notify pgrst, 'reload schema';
commit;
