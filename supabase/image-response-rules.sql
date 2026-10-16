-- Run after security.sql/platform-dashboard.sql. Safe to rerun.
begin;
create table if not exists public.image_response_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check(length(trim(name)) between 1 and 100),
  trigger_type text not null check(trigger_type in ('slip','general','product')),
  response_text text check(length(response_text)<=2000),
  media_url text check(media_url is null or (length(media_url)<=2048 and media_url ~ '^https?://[^[:space:]]+$')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(nullif(trim(response_text),'') is not null or nullif(trim(media_url),'') is not null)
);
create index if not exists image_response_rules_tenant on public.image_response_rules(tenant_id,created_at desc);
alter table public.image_response_rules enable row level security;

create or replace function public.can_manage_image_rules(p_tenant uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
  select public.is_platform_admin() or (public.can_access_tenant(p_tenant) and exists(
    select 1 from public.tenant_members where tenant_id=p_tenant and user_id=auth.uid() and role='owner'
  ))
$$;
revoke all on function public.can_manage_image_rules(uuid) from public,anon;
grant execute on function public.can_manage_image_rules(uuid) to authenticated;
drop policy if exists member_read on public.image_response_rules;
create policy member_read on public.image_response_rules for select to authenticated using(public.can_access_tenant(tenant_id));
drop policy if exists owner_insert on public.image_response_rules;
create policy owner_insert on public.image_response_rules for insert to authenticated with check(public.can_manage_image_rules(tenant_id));
drop policy if exists owner_update on public.image_response_rules;
create policy owner_update on public.image_response_rules for update to authenticated using(public.can_manage_image_rules(tenant_id)) with check(public.can_manage_image_rules(tenant_id));
drop policy if exists owner_delete on public.image_response_rules;
create policy owner_delete on public.image_response_rules for delete to authenticated using(public.can_manage_image_rules(tenant_id));
grant select,insert,update,delete on public.image_response_rules to authenticated,service_role;
revoke all on public.image_response_rules from anon;

create or replace function public.touch_image_response_rule() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin new.updated_at=now(); new.created_at=old.created_at; return new; end $$;
drop trigger if exists image_response_rules_updated on public.image_response_rules;
create trigger image_response_rules_updated before update on public.image_response_rules
for each row execute function public.touch_image_response_rule();
revoke all on function public.touch_image_response_rule() from public,anon,authenticated;
-- Attachments reuse the existing public comment-media bucket and uploader.
commit;
