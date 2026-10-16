-- Run LAST after package-access.sql and the existing security/AI/image/slip migrations.
begin;
create table if not exists public.plan_features (
  plan text not null check (plan in ('starter','pro')),
  feature text not null check (feature in ('ai_agent','image_assistant','customer_management','slip_auto_pilot','customer_follow_up')),
  enabled boolean not null default false,
  primary key(plan,feature)
);
alter table public.plan_features enable row level security;
alter table public.plan_features drop constraint if exists plan_features_feature_check;
alter table public.plan_features add constraint plan_features_feature_check check(feature in ('ai_agent','image_assistant','customer_management','slip_auto_pilot','customer_follow_up'));
revoke all on public.plan_features from public,anon,authenticated;
grant select,insert,update,delete on public.plan_features to service_role;
-- Confirmed historic entitlements. Unspecified entitlements remain denied until configured.
insert into public.plan_features(plan,feature,enabled) values
 ('pro','ai_agent',true),('starter','slip_auto_pilot',true),('pro','slip_auto_pilot',true),
 ('starter','image_assistant',true),('pro','image_assistant',true),
 ('starter','customer_management',true),('pro','customer_management',true),
 ('starter','customer_follow_up',true),('pro','customer_follow_up',true)
on conflict(plan,feature) do nothing;

create or replace function public.has_tenant_feature(p_tenant uuid,p_feature text) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.tenants t join public.plan_features f on f.plan=t.plan
   where t.id=p_tenant and t.is_active and t.plan<>'free'
     and t.plan_expires_at>now() and f.feature=p_feature and f.enabled)
$$;
revoke all on function public.has_tenant_feature(uuid,text) from public,anon;
grant execute on function public.has_tenant_feature(uuid,text) to authenticated,service_role;

create or replace function public.guard_ai_agent_plan() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if (new.reply_mode='ai' or (tg_op='INSERT' and nullif(trim(new.ai_instructions),'') is not null)
   or (tg_op='UPDATE' and new.ai_instructions is distinct from old.ai_instructions))
   and not public.has_tenant_feature(new.tenant_id,'ai_agent') then
   raise exception 'FEATURE_LOCKED: ai_agent' using errcode='42501';
 end if;
 return new;
end $$;
drop trigger if exists bot_settings_ai_plan_gate on public.bot_settings;
create trigger bot_settings_ai_plan_gate before insert or update on public.bot_settings
for each row execute function public.guard_ai_agent_plan();
revoke all on function public.guard_ai_agent_plan() from public,anon,authenticated,service_role;

-- Restrictive policies also constrain older permissive owner/member policies.
drop policy if exists image_feature_access on public.image_response_rules;
create policy image_feature_access on public.image_response_rules as restrictive for all to authenticated
 using(public.has_tenant_feature(tenant_id,'image_assistant'))
 with check(public.has_tenant_feature(tenant_id,'image_assistant'));
drop policy if exists customer_feature_access on public.customers;
create policy customer_feature_access on public.customers as restrictive for all to authenticated
 using(public.has_tenant_feature(tenant_id,'customer_management'))
 with check(public.has_tenant_feature(tenant_id,'customer_management'));
drop policy if exists message_feature_access on public.messages;
create policy message_feature_access on public.messages as restrictive for select to authenticated
 using(exists(select 1 from public.customers c where c.id=customer_id and public.has_tenant_feature(c.tenant_id,'customer_management')));
drop policy if exists comment_feature_access on public.comments;
create policy comment_feature_access on public.comments as restrictive for select to authenticated
 using(public.has_tenant_feature(tenant_id,'customer_management'));
drop policy if exists order_feature_access on public.orders;
create policy order_feature_access on public.orders as restrictive for all to authenticated
 using(public.has_tenant_feature(tenant_id,'customer_management'))
 with check(public.has_tenant_feature(tenant_id,'customer_management'));
drop policy if exists slip_feature_read on public.slips;
create policy slip_feature_read on public.slips as restrictive for select to authenticated
 using(public.has_tenant_feature(tenant_id,'slip_auto_pilot'));
-- Service callers cannot bypass package/credit checks when consuming slip credits.
create or replace function public.consume_slip_credit(p_tenant uuid) returns boolean
language sql set search_path=pg_catalog,public as $$
 with taken as(update public.tenants set slip_used=slip_used+1
   where id=p_tenant and public.has_tenant_feature(id,'slip_auto_pilot')
   and slip_used::bigint<slip_quota::bigint+slip_quota_credits::bigint returning 1)
 select exists(select 1 from taken)
$$;
revoke all on function public.consume_slip_credit(uuid) from public,anon,authenticated;
grant execute on function public.consume_slip_credit(uuid) to service_role;
create or replace function public.refund_slip_credit(p_tenant uuid) returns void
language sql set search_path=pg_catalog,public as $$
 update public.tenants set slip_used=slip_used-1 where id=p_tenant and slip_used>0
$$;
revoke all on function public.refund_slip_credit(uuid) from public,anon,authenticated;
grant execute on function public.refund_slip_credit(uuid) to service_role;
commit;
