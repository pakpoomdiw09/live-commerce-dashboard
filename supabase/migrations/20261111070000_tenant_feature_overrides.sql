begin;

-- Tenant-scoped entitlement overrides. Service-role only; plan_features remains unchanged.
create table if not exists public.tenant_feature_overrides (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  feature text not null check (feature in ('ai_agent','image_assistant','customer_management','slip_auto_pilot','customer_follow_up')),
  enabled boolean not null,
  reason text not null check (length(trim(reason)) between 1 and 500),
  expires_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id,feature)
);
alter table public.tenant_feature_overrides enable row level security;
revoke all on public.tenant_feature_overrides from public,anon,authenticated;
grant select,insert,update,delete on public.tenant_feature_overrides to service_role;

create or replace function public.has_tenant_feature(p_tenant uuid,p_feature text) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(
   select 1 from public.tenants t
   where t.id=p_tenant and t.is_active
     and coalesce(
       (select case when o.expires_at is not null and o.expires_at<=now() then null else o.enabled end
        from public.tenant_feature_overrides o
        where o.tenant_id=t.id and o.feature=p_feature),
       (t.plan<>'free' and t.plan_expires_at>now() and exists(
         select 1 from public.plan_features f
         where f.plan=t.plan and f.feature=p_feature and f.enabled
       ))
     )
 );
$$;
revoke all on function public.has_tenant_feature(uuid,text) from public,anon;
grant execute on function public.has_tenant_feature(uuid,text) to authenticated,service_role;

commit;
