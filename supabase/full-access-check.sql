-- Read-only. Run in the production project after full-access.sql.
select t.id, t.name, f.feature, public.has_tenant_feature(t.id,f.feature) as allowed
from public.tenants t
cross join (values ('ai_agent'),('image_assistant'),('customer_management'),
  ('slip_auto_pilot'),('customer_follow_up')) f(feature)
where t.is_active
order by t.id, f.feature;

select count(*) as saved_functions from public.full_access_function_backup;
select has_function_privilege('service_role',
  'public.start_agent_ai_call(uuid,uuid,uuid,uuid,uuid)','execute') as service_can_execute,
  has_function_privilege('authenticated',
  'public.start_agent_ai_call(uuid,uuid,uuid,uuid,uuid)','execute') as client_can_execute;
