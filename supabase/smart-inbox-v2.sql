-- Additive; run after smart-inbox.sql and smart-inbox-pro.sql. No message backfill.
begin;
create table if not exists public.inbox_internal_notes (
 id uuid primary key, tenant_id uuid not null references public.tenants(id) on delete cascade,
 customer_id uuid not null references public.customers(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,
 body text not null check(length(body) between 1 and 2000), created_at timestamptz not null default now()
);
create index if not exists inbox_internal_notes_customer on public.inbox_internal_notes(tenant_id,customer_id,created_at desc);
create table if not exists public.inbox_stars (
 customer_id uuid not null references public.customers(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 primary key(customer_id,user_id)
);
-- Durable request IDs also serialize retries of star/unstar operations.
create table if not exists public.inbox_workspace_requests (
 actor_id uuid not null references auth.users(id) on delete cascade, request_id uuid not null,
 customer_id uuid not null references public.customers(id) on delete cascade,
 action text not null, body text, created_at timestamptz not null default now(), primary key(actor_id,request_id)
);
create index if not exists inbox_workspace_rate on public.inbox_workspace_requests(actor_id,created_at);
alter table public.inbox_internal_notes enable row level security;
alter table public.inbox_stars enable row level security;
alter table public.inbox_workspace_requests enable row level security;
revoke all on public.inbox_internal_notes,public.inbox_stars,public.inbox_workspace_requests from public,anon,authenticated;
grant all on public.inbox_internal_notes,public.inbox_stars,public.inbox_workspace_requests to service_role;
create or replace function public.manage_inbox_workspace(p_customer uuid,p_actor uuid,p_action text,p_key uuid,p_body text default null)
returns void language plpgsql set search_path=pg_catalog,public as $$
declare c public.customers; old public.inbox_workspace_requests;
begin
 select * into c from public.customers where id=p_customer for share;
 if not found or not(exists(select 1 from public.tenant_members where tenant_id=c.tenant_id and user_id=p_actor)
 or exists(select 1 from public.platform_admins where user_id=p_actor))
 or not public.has_tenant_feature(c.tenant_id,'customer_management') then raise exception 'Forbidden' using errcode='42501'; end if;
 if p_key is null or p_action not in ('note','star','unstar') or p_action is null
 or p_action='note' and (p_body is null or length(trim(p_body))=0 or length(p_body)>2000) then raise exception 'Invalid input' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text,0));
 select * into old from public.inbox_workspace_requests where actor_id=p_actor and request_id=p_key;
 if found then
   if old.customer_id<>p_customer or old.action<>p_action or old.body is distinct from p_body then raise exception 'Request ID reused' using errcode='22023';end if;
   return;
 end if;
 if (select count(*) from public.inbox_workspace_requests where actor_id=p_actor and created_at>clock_timestamp()-interval '1 minute')>=30 then raise exception 'Rate limited' using errcode='P0429';end if;
 if p_action='note' then
   insert into public.inbox_internal_notes(id,tenant_id,customer_id,actor_id,body) values(p_key,c.tenant_id,p_customer,p_actor,p_body);
 elsif p_action='star' then insert into public.inbox_stars values(p_customer,p_actor) on conflict do nothing;
 else delete from public.inbox_stars where customer_id=p_customer and user_id=p_actor;end if;
 insert into public.inbox_workspace_requests(actor_id,request_id,customer_id,action,body) values(p_actor,p_key,p_customer,p_action,p_body);
end $$;
revoke all on function public.manage_inbox_workspace(uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.manage_inbox_workspace(uuid,uuid,text,uuid,text) to service_role;
commit;
