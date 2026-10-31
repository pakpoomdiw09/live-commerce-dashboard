-- Run after platform-dashboard.sql. Additive and safe to rerun; existing templates are preserved.
begin;
create table if not exists public.slip_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  slip_confirmation_template text check (length(slip_confirmation_template) <= 2000),
  updated_at timestamptz not null default now()
);
alter table public.slip_settings enable row level security;
drop policy if exists member_read on public.slip_settings;
create policy member_read on public.slip_settings for select to authenticated
  using (public.can_access_tenant(tenant_id));
-- Writes go through the authenticated, owner-authorized API using the service role.
revoke all on public.slip_settings from public, anon, authenticated;
grant select on public.slip_settings to authenticated;
grant select, insert, update, delete on public.slip_settings to service_role;
notify pgrst, 'reload schema';
commit;
