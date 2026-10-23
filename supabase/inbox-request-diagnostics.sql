-- Read-only. Run in the same Supabase project configured on Vercel Production.
-- No message text, tokens or query text is returned.
select signature, to_regprocedure(signature) is not null as installed
from (values
  ('public.manage_inbox_conversation(uuid,uuid,text,integer,uuid)'),
  ('public.manage_inbox_pro(uuid,uuid,text,integer,uuid,text,uuid)'),
  ('public.enqueue_facebook_webhook(text,text,jsonb)'),
  ('public.claim_facebook_webhook(integer)'),
  ('public.persist_facebook_webhook_record(uuid,uuid,uuid)')
) as expected(signature);

select state, wait_event_type, wait_event, count(*) as sessions,
  max(clock_timestamp() - query_start) as oldest_query_age
from pg_stat_activity
where datname = current_database() and pid <> pg_backend_pid()
group by state, wait_event_type, wait_event
order by oldest_query_age desc nulls last;

select pid, cardinality(pg_blocking_pids(pid)) as blockers,
  clock_timestamp() - query_start as query_age
from pg_stat_activity
where datname = current_database() and cardinality(pg_blocking_pids(pid)) > 0
order by query_start;
