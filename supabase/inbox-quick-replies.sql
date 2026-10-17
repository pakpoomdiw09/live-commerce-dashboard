-- Additive, run after smart-inbox.sql. Does not create bot rules or send messages.
begin;
create table if not exists public.inbox_quick_replies (
 id uuid primary key,tenant_id uuid not null references public.tenants(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,
 body text not null check(length(trim(body)) between 1 and 2000),created_at timestamptz not null default now()
);
alter table public.inbox_quick_replies add column if not exists shortcut text not null default '' check(length(shortcut)<=60);
create index if not exists inbox_quick_replies_tenant on public.inbox_quick_replies(tenant_id,created_at);
alter table public.inbox_quick_replies enable row level security;
revoke all on public.inbox_quick_replies from public,anon,authenticated;
grant all on public.inbox_quick_replies to service_role;
create or replace function public.save_inbox_quick_reply(p_tenant uuid,p_actor uuid,p_key uuid,p_body text,p_shortcut text)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare old public.inbox_quick_replies; row public.inbox_quick_replies;
begin
 if not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor)
 or exists(select 1 from public.platform_admins where user_id=p_actor)) or not public.has_tenant_feature(p_tenant,'customer_management') then raise exception 'Forbidden' using errcode='42501';end if;
 if p_shortcut is null or length(p_shortcut)>60 or p_key is null or p_body is null or length(trim(p_body))=0 or length(p_body)>2000 then raise exception 'Invalid input' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text||':quick-replies-actor',0));
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':quick-replies',0));
 select * into old from public.inbox_quick_replies where id=p_key;
 if found then
  if old.tenant_id<>p_tenant or old.actor_id is distinct from p_actor or old.body<>p_body or old.shortcut<>p_shortcut then raise exception 'Request ID reused' using errcode='22023';end if;
  return jsonb_build_object('id',old.id,'body',old.body,'shortcut',old.shortcut);
 end if;
 if (select count(*) from public.inbox_quick_replies where actor_id=p_actor and created_at>clock_timestamp()-interval '1 minute')>=30 then raise exception 'Rate limited' using errcode='P0429';end if;
 if (select count(*) from public.inbox_quick_replies where tenant_id=p_tenant)>=100 then raise exception 'Store supports up to 100 quick replies' using errcode='22023';end if;
 insert into public.inbox_quick_replies(id,tenant_id,actor_id,body,shortcut) values(p_key,p_tenant,p_actor,p_body,p_shortcut) returning * into row;
 return jsonb_build_object('id',row.id,'body',row.body,'shortcut',row.shortcut);
end $$;
revoke all on function public.save_inbox_quick_reply(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.save_inbox_quick_reply(uuid,uuid,uuid,text,text) to service_role;
-- Existing clients can continue using the original four-argument signature.
create or replace function public.save_inbox_quick_reply(p_tenant uuid,p_actor uuid,p_key uuid,p_body text)
returns jsonb language sql set search_path=pg_catalog,public as $$
 select public.save_inbox_quick_reply(p_tenant,p_actor,p_key,p_body,'');
$$;
revoke all on function public.save_inbox_quick_reply(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.save_inbox_quick_reply(uuid,uuid,uuid,text) to service_role;
commit;
