-- Run after automation.sql, billing.sql, security.sql and admin-feature-bypass.sql.
-- Paid Starter/Pro plans and trusted administrators may enable follow-ups.
begin;
create or replace function public.guard_followup_plan() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.followup_enabled and not public.is_platform_admin()
    and not public.tenant_has_feature_bypass(new.tenant_id) and not exists (
      select 1 from public.tenants where id = new.tenant_id and plan in ('starter', 'pro')
        and (plan_expires_at is null or plan_expires_at > now())
    ) then
    raise exception 'กรุณาอัปเกรดแพ็กเกจเพื่อใช้ผู้ช่วยติดตามลูกค้า' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_followup_plan() from public, anon, authenticated, service_role;
drop trigger if exists bot_settings_followup_plan_gate on public.bot_settings;
create trigger bot_settings_followup_plan_gate before insert or update of followup_enabled, followup_steps
on public.bot_settings for each row execute function public.guard_followup_plan();
commit;
