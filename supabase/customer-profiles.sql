-- Run before deploying customer profile fetching. Existing tenant RLS stays in force.
begin;
alter table public.customers add column if not exists avatar_url text;
grant select (avatar_url) on public.customers to authenticated;
grant update (avatar_url) on public.customers to service_role;
commit;
