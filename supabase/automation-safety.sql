-- Run after security.sql and smart-inbox.sql. Additive, service-only; no provider calls or credential changes.
begin;
create table if not exists public.tenant_automation_controls (
 tenant_id uuid primary key references public.tenants(id),
 stopped boolean not null default false,
 updated_at timestamptz not null default now()
);
create table if not exists public.tenant_automation_audit (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 actor_id uuid not null references auth.users(id), stopped boolean not null,
 reason text not null check(length(trim(reason)) between 1 and 500), created_at timestamptz not null default now()
);
alter table public.tenant_automation_controls enable row level security;
alter table public.tenant_automation_audit enable row level security;
revoke all on public.tenant_automation_controls,public.tenant_automation_audit from public,anon,authenticated;
grant select,insert,update on public.tenant_automation_controls to service_role;
grant select,insert on public.tenant_automation_audit to service_role;
create or replace function public.set_tenant_automation_stop(p_tenant uuid,p_actor uuid,p_stopped boolean,p_reason text) returns void
language plpgsql set search_path=pg_catalog,public as $$
begin
 if not exists(select 1 from public.tenants where id=p_tenant and is_active) or not (
  exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner')
  or exists(select 1 from public.platform_admins where user_id=p_actor)
 ) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_stopped is null or p_reason is null or length(trim(p_reason)) not between 1 and 500 then raise exception 'Invalid stop request' using errcode='22023';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 insert into public.tenant_automation_controls(tenant_id,stopped) values(p_tenant,p_stopped)
 on conflict(tenant_id) do update set stopped=excluded.stopped,updated_at=now();
 insert into public.tenant_automation_audit(tenant_id,actor_id,stopped,reason) values(p_tenant,p_actor,p_stopped,trim(p_reason));
end $$;
revoke all on function public.set_tenant_automation_stop(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.set_tenant_automation_stop(uuid,uuid,boolean,text) to service_role;
-- Human reply takes ownership and the delivery lease in ONE transaction before sending.
-- Another assigned admin, stale version or in-flight delivery is a conflict, never silently stolen.
create or replace function public.claim_and_start_inbox_reply(p_customer uuid,p_actor uuid,p_version integer) returns uuid
language plpgsql set search_path=pg_catalog,public as $$
declare c public.customers;
begin
 select * into c from public.customers where id=p_customer for update;
 if not found then raise exception 'Conversation unavailable' using errcode='40001';end if;
 if not public.has_tenant_feature(c.tenant_id,'customer_management') or not (
  exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_actor)
  or exists(select 1 from public.platform_admins where user_id=p_actor)
 ) then raise exception 'Forbidden' using errcode='42501';end if;
 if c.conversation_version is distinct from p_version or c.conversation_status='closed' or (c.assigned_user_id is not null and c.assigned_user_id<>p_actor) then raise exception 'Conversation changed' using errcode='40001';end if;
 if c.bot_enabled or c.assigned_user_id is null then
  perform public.manage_inbox_conversation(p_customer,p_actor,'claim',p_version);
 end if;
 return public.start_inbox_delivery(p_customer,p_actor);
end $$;
revoke all on function public.claim_and_start_inbox_reply(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_and_start_inbox_reply(uuid,uuid,integer) to service_role;
notify pgrst,'reload schema';
commit;
