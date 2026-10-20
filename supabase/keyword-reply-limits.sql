-- Apply after automation.sql, billing.sql and security.sql. Safe to rerun.
begin;
create or replace function public.guard_keyword_reply_limit() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare allowed integer; used integer;
begin
 if tg_op='UPDATE' and new.tenant_id=old.tenant_id then return new;end if;
 -- Serialize creation and tenant moves with subscription changes. RLS still
 -- authorizes the original write; service_role imports obey this guard too.
 select case when t.is_active and t.plan in ('starter','pro')
  and t.plan_expires_at>clock_timestamp() then 20 else 3 end
 into allowed from public.tenants t where t.id=new.tenant_id for update;
 if not found then raise exception 'Tenant not found' using errcode='23503';end if;
 select count(*) into used from public.chat_rules where tenant_id=new.tenant_id;
 if used>=allowed then
  raise exception 'KEYWORD_REPLY_LIMIT: maximum % replies per tenant',allowed
   using errcode='P0422',hint='Delete an existing keyword reply or upgrade the subscription.';
 end if;
 return new;
end $$;
revoke all on function public.guard_keyword_reply_limit() from public,anon,authenticated,service_role;
drop trigger if exists keyword_reply_limit on public.chat_rules;
create trigger keyword_reply_limit before insert or update of tenant_id on public.chat_rules
for each row execute function public.guard_keyword_reply_limit();
commit;
