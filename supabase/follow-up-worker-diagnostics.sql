-- Read-only diagnostics; never sends messages. No tokens, bodies, or cron command text.
select current_setting('TimeZone') as database_timezone,
 now() as database_now, now() at time zone 'UTC' as utc_now,
 now() at time zone 'Asia/Bangkok' as bangkok_now;

select column_name,data_type from information_schema.columns
where table_schema='public' and table_name='follow_up_jobs'
 and column_name in ('run_at','anchor_at','claim_until','sent_at');

select status,count(*) as jobs,
 count(*) filter(where run_at<=now()) as due,
 min(run_at) as earliest_run_at
from public.follow_up_jobs group by status;

select id,tenant_id,kind,step,status,reason,attempts,
 anchor_at at time zone 'Asia/Bangkok' as anchor_bangkok,
 run_at at time zone 'Asia/Bangkok' as due_bangkok,
 extract(epoch from (run_at-anchor_at))/60 as scheduled_minutes,
 run_at<=now() as is_due,claim_until,dispatch_started_at,sent_at
from public.follow_up_jobs order by created_at desc,id desc limit 50;

select to_regprocedure('public.claim_follow_up_jobs(uuid,integer)') as claim_rpc,
 to_regprocedure('public.prepare_follow_up(uuid,uuid)') as prepare_rpc,
 to_regprocedure('public.authorize_follow_up_dispatch(uuid,uuid)') as final_check_rpc;

-- Missing pg_cron is reported instead of raising a missing-relation error.
-- An external scheduler (Vercel etc.) will not appear here.
do $$
declare j record; runs record; has_scheduler boolean:=false;
begin
 if to_regclass('cron.job') is null then
  raise notice 'pg_cron is not installed; verify an external scheduler calls /api/cron/follow-ups';
  return;
 end if;
 for j in execute $query$
  select jobid,jobname,schedule,active from cron.job
  where command like '%/api/cron/follow-ups%'
 $query$ loop
  has_scheduler:=true;
  raise notice 'Follow-up scheduler: id=%, name=%, schedule=%, active=%',j.jobid,j.jobname,j.schedule,j.active;
  if to_regclass('cron.job_run_details') is not null then
   for runs in execute 'select status,start_time,end_time from cron.job_run_details where jobid=$1 order by start_time desc limit 5' using j.jobid loop
    raise notice 'Cron run: status=%, start=%, end=%',runs.status,runs.start_time,runs.end_time;
   end loop;
  end if;
 end loop;
 if not has_scheduler then raise notice 'No pg_cron entry invokes /api/cron/follow-ups; configure a scheduler if no external scheduler exists';end if;
end $$;
