-- Historical inbox reads must have the same tenant scope as the server API.
-- Plan gates on writes/automation remain in place; membership RLS is retained.
begin;
drop policy if exists customer_feature_access on public.customers;
drop policy if exists customer_feature_write_access on public.customers;
create policy customer_feature_write_access on public.customers as restrictive
 for update to authenticated
 using(public.has_tenant_feature(tenant_id,'customer_management'))
 with check(public.has_tenant_feature(tenant_id,'customer_management'));
drop policy if exists message_feature_access on public.messages;
-- Additional restrictive membership guards also protect installations with old
-- permissive policies. Never grant cross-tenant reads to repair Realtime.
drop policy if exists inbox_customer_tenant_read on public.customers;
create policy inbox_customer_tenant_read on public.customers as restrictive
 for select to authenticated using(public.can_access_tenant(tenant_id));
drop policy if exists inbox_message_tenant_read on public.messages;
create policy inbox_message_tenant_read on public.messages as restrictive
 for select to authenticated using(exists(select 1 from public.customers c
 where c.id=customer_id and public.can_access_tenant(c.tenant_id)));
grant select on public.messages,public.customers to authenticated;
drop policy if exists own_read on public.conversation_reads;
create policy own_read on public.conversation_reads for select to authenticated
 using(user_id=auth.uid() and exists(select 1 from public.customers c
  where c.id=customer_id and public.can_access_tenant(c.tenant_id)));
do $$ declare tab text; begin
 if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
  create publication supabase_realtime;
 end if;
 -- This application uses customers as conversations, not a conversations table.
 foreach tab in array array['messages','customers','conversation_reads','conversations'] loop
  if to_regclass(format('public.%I',tab)) is not null and not exists(
   select 1 from pg_publication_tables where pubname='supabase_realtime'
    and schemaname='public' and tablename=tab
  ) then execute format('alter publication supabase_realtime add table public.%I',tab);end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
