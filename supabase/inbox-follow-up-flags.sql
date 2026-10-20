-- Run after smart-inbox-v2.sql. Personal markers only; does not schedule or send messages.
begin;
create table if not exists public.inbox_follow_up_flags (
 customer_id uuid not null references public.customers(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(customer_id,user_id)
);
create index if not exists inbox_follow_up_flags_user on public.inbox_follow_up_flags(tenant_id,user_id,created_at desc);
alter table public.inbox_follow_up_flags enable row level security;
revoke all on public.inbox_follow_up_flags from public,anon,authenticated;
grant all on public.inbox_follow_up_flags to service_role;

create or replace function public.set_inbox_follow_up_flag(p_customer uuid,p_actor uuid,p_enabled boolean,p_key uuid)
returns void language plpgsql set search_path=pg_catalog,public as $$
declare c public.customers; previous public.inbox_workspace_requests; requested_action text;
begin
 select * into c from public.customers where id=p_customer for share;
 if not found or not exists(select 1 from public.tenants where id=c.tenant_id and is_active)
 or not(exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_actor)
 or exists(select 1 from public.platform_admins where user_id=p_actor))
 or not public.has_tenant_feature(c.tenant_id,'customer_management') then
  raise exception 'Forbidden' using errcode='42501';
 end if;
 if p_enabled is null or p_key is null then raise exception 'Invalid input' using errcode='22023';end if;
 requested_action:=case when p_enabled then 'followup' else 'unfollowup' end;
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text,0));
 select * into previous from public.inbox_workspace_requests where actor_id=p_actor and request_id=p_key;
 if found then
  if previous.customer_id<>p_customer or previous.action<>requested_action or previous.body is not null then
   raise exception 'Request ID reused' using errcode='22023';
  end if;
  return;
 end if;
 if (select count(*) from public.inbox_workspace_requests where actor_id=p_actor and created_at>clock_timestamp()-interval '1 minute')>=30 then
  raise exception 'Rate limited' using errcode='P0429';
 end if;
 if p_enabled then
  insert into public.inbox_follow_up_flags(customer_id,user_id,tenant_id) values(c.id,p_actor,c.tenant_id) on conflict do nothing;
 else
  delete from public.inbox_follow_up_flags where customer_id=c.id and user_id=p_actor and tenant_id=c.tenant_id;
 end if;
 insert into public.inbox_workspace_requests(actor_id,request_id,customer_id,action) values(p_actor,p_key,c.id,requested_action);
end $$;
revoke all on function public.set_inbox_follow_up_flag(uuid,uuid,boolean,uuid) from public,anon,authenticated;
grant execute on function public.set_inbox_follow_up_flag(uuid,uuid,boolean,uuid) to service_role;
notify pgrst,'reload schema';
commit;
