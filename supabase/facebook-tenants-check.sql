-- Read-only checks to run in Supabase SQL Editor after facebook-tenants.sql.
select p.proname, p.prosecdef as security_definer, p.proconfig,
       pg_get_userbyid(p.proowner) as owner,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute
from pg_proc p
where p.oid = to_regprocedure('public.sync_facebook_tenants(uuid,jsonb)');

select column_name, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'tenants'
  and column_name in ('bank_code', 'account_number', 'page_id', 'page_name', 'page_access_token');

select indexname, indexdef from pg_indexes
where schemaname = 'public' and tablename = 'tenants';

select c.relname, c.relrowsecurity as rls_enabled
from pg_class c where c.oid in ('public.tenants'::regclass, 'public.tenant_members'::regclass);
select tablename, policyname, cmd, roles, qual from pg_policies
where schemaname = 'public' and tablename in ('tenants', 'tenant_members');

select has_column_privilege('authenticated', 'public.tenants', 'page_name', 'SELECT') as page_name_readable,
       has_column_privilege('authenticated', 'public.tenants', 'page_access_token', 'SELECT') as token_readable,
       has_table_privilege('authenticated', 'public.tenants', 'INSERT') as browser_can_insert,
       has_table_privilege('authenticated', 'public.tenants', 'UPDATE') as browser_can_update;

-- Counts only: do not print Page tokens.
select count(*) as linked_pages,
       count(*) filter (where not exists (
         select 1 from public.tenant_members m where m.tenant_id = t.id and m.role = 'owner'
       )) as pages_without_owner
from public.tenants t where t.page_id is not null;
