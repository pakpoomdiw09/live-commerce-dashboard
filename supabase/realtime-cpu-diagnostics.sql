-- Read-only diagnostics. Run in Supabase SQL Editor as an administrator.
-- Calls are cumulative: compare two snapshots; high count alone is not CPU time.
-- No raw query text, JWTs or customer message contents are returned.
select usename,application_name,state,wait_event_type,wait_event,count(*) as connections
from pg_stat_activity where datname=current_database()
group by usename,application_name,state,wait_event_type,wait_event
order by connections desc;

select slot_name,plugin,active,
 pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(),restart_lsn)) as retained_wal
from pg_replication_slots where slot_type='logical';

-- Locate the extension's installed schema rather than assuming public/extensions.
create temporary table if not exists realtime_cpu_snapshot(
 role_name text,category text,calls numeric,total_exec_ms double precision
);
truncate table pg_temp.realtime_cpu_snapshot;
do $$
declare extension_schema text;
begin
 select n.nspname into extension_schema from pg_extension e
 join pg_namespace n on n.oid=e.extnamespace where e.extname='pg_stat_statements';
 if extension_schema is null then
  raise notice 'pg_stat_statements not installed; use Supabase Query Performance';return;
 end if;
 execute format($query$
  insert into pg_temp.realtime_cpu_snapshot
  select r.rolname,
   case when s.query ilike '%%realtime%%' or s.query ilike '%%wal%%' then 'realtime_or_wal'
        when s.query ilike '%%set_config%%' then 'session_configuration'
        else 'other_queries' end,
   sum(s.calls),sum(s.total_exec_time)
  from %I.pg_stat_statements s left join pg_roles r on r.oid=s.userid
  where s.dbid=(select oid from pg_database where datname=current_database())
  group by 1,2
 $query$,extension_schema);
end $$;
select role_name,category,calls,round(total_exec_ms::numeric,2) as total_exec_ms,
 round((total_exec_ms/nullif(calls,0))::numeric,4) as mean_exec_ms
from pg_temp.realtime_cpu_snapshot order by total_exec_ms desc;
