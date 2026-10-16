-- Run after billing.sql and automation.sql. Safe to re-run.
-- Browser settings writes use Supabase directly, so enforce the gate in the database.
begin;
create or replace function public.guard_ai_agent_plan() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  return new;
end $$;
revoke all on function public.guard_ai_agent_plan() from public, anon, authenticated, service_role;
drop trigger if exists bot_settings_ai_plan_gate on public.bot_settings;
create trigger bot_settings_ai_plan_gate before insert or update on public.bot_settings
for each row execute function public.guard_ai_agent_plan();
commit;
