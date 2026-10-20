-- Read-only. Run each section in Supabase SQL Editor; no message bodies or tokens.
-- 1. All five tables should be published. DEFAULT replica identity with a PK
-- is sufficient for new-message INSERTs; FULL is not required by this Inbox.
select c.relname as table_name, c.relrowsecurity as rls_enabled,
 case c.relreplident when 'd' then 'DEFAULT' when 'f' then 'FULL'
 when 'i' then 'INDEX' when 'n' then 'NOTHING' end as replica_identity,
 exists(select 1 from pg_index i where i.indrelid=c.oid and i.indisprimary) as has_primary_key,
 exists(select 1 from pg_publication_tables p where p.pubname='supabase_realtime'
  and p.schemaname='public' and p.tablename=c.relname) as published
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in
 ('messages','customers','comments','slips','conversation_reads') and c.relkind='r';

select pubname, pubinsert, pubupdate, pubdelete
from pg_publication where pubname='supabase_realtime';

-- 2. Queue receipt does not prove message persistence. Missing queue tables
-- or RPCs indicate migrations have not been applied to this project.
select to_regprocedure('public.enqueue_facebook_webhook(text,text,jsonb)') as enqueue_rpc,
 to_regprocedure('public.persist_facebook_webhook_record(uuid,uuid,uuid)') as persist_rpc;

select status, count(*), min(created_at) as oldest
from public.facebook_webhook_events group by status;

select e.id, e.page_id, e.status, e.attempts, e.last_error,
 e.created_at, e.available_at, e.lease_until,
 s.result->>'id' as record_id, s.result->>'ignored' as ignored,
 s.result->>'reason' as ignored_reason,
 exists(select 1 from public.facebook_webhook_events older
  where older.page_id=e.page_id and older.ordering_key=e.ordering_key
   and older.sequence<e.sequence
   and older.status in ('pending','processing')) as blocked_by_older_event
from public.facebook_webhook_events e
left join public.facebook_webhook_steps s on s.event_id=e.id and s.name='record'
order by e.sequence desc limit 50;

-- 3. Was an incoming message actually stored, and linked to the selected tenant?
select m.id, m.external_id, m.customer_id, m.created_at,
 c.tenant_id, c.last_message_at, t.page_id, t.is_active
from public.messages m join public.customers c on c.id=m.customer_id
left join public.tenants t on t.id=c.tenant_id
where m.sender='customer' order by m.created_at desc limit 20;

-- 4. RLS policies and the inbound counter trigger.
-- SQL Editor typically runs as postgres: seeing rows here does NOT prove
-- the signed-in browser user can read them under RLS.
select tablename, policyname, roles, cmd, qual
from pg_policies where schemaname='public'
 and tablename in ('messages','customers','comments','slips','conversation_reads');

select tgname, tgenabled, pg_get_triggerdef(oid) as definition
from pg_trigger where tgrelid='public.messages'::regclass and not tgisinternal;

-- Optional: replace both UUIDs to test access as the actual staff user.
-- BEGIN;
-- SET LOCAL ROLE authenticated;
-- SELECT set_config('request.jwt.claims',
--  '{"sub":"STAFF_USER_UUID","role":"authenticated"}', true);
-- SELECT auth.uid(), public.can_access_tenant('TENANT_UUID'::uuid);
-- SELECT id, last_message_at FROM public.customers
--  WHERE tenant_id='TENANT_UUID'::uuid ORDER BY last_message_at DESC NULLS LAST LIMIT 5;
-- SELECT m.id, m.created_at FROM public.messages m
--  JOIN public.customers c ON c.id=m.customer_id
--  WHERE c.tenant_id='TENANT_UUID'::uuid ORDER BY m.created_at DESC LIMIT 5;
-- ROLLBACK;
