-- Read-only verification. Run after dashboard-read-models.sql in the SAME production project.
-- Every installed/service_can_execute result should be true; client_can_execute should be false.
with expected(signature) as (
  values
    ('public.customer_directory(uuid,integer,text,text,text)'),
    ('public.agent_overview_stats(uuid,integer,timestamp with time zone)'),
    ('public.basic_overview_stats(uuid,timestamp with time zone)')
), installed as (
  select signature, to_regprocedure(signature) as oid from expected
)
select
  signature,
  oid is not null as installed,
  case when oid is not null then has_function_privilege('service_role', oid, 'execute') else false end as service_can_execute,
  case when oid is not null then
    has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute')
    else false end as client_can_execute
from installed;

select name, to_regclass('public.' || name) is not null as installed
from (values
  ('inbox_customers_recent'),
  ('dashboard_valid_customer_slips'),
  ('overview_slips_time'),
  ('dashboard_agent_period'),
  ('dashboard_agent_lifetime')
) as expected(name);
