-- Read-only: does not claim, transfer or send any conversation.
select expected.name, c.column_name is not null as installed
from (values ('tenant_id'),('assigned_user_id'),('bot_enabled'),('conversation_status'),
  ('conversation_version'),('inbound_seq'),('handover_at'),('outbound_lock_until')) expected(name)
left join information_schema.columns c on c.table_schema='public'
  and c.table_name='customers' and c.column_name=expected.name;

with expected(signature) as (values
  ('public.manage_inbox_conversation(uuid,uuid,text,integer,uuid)'),
  ('public.manage_inbox_pro(uuid,uuid,text,integer,uuid,text,uuid)')
), installed as (select signature,to_regprocedure(signature) oid from expected)
select signature,oid is not null as installed,
  case when oid is not null then has_function_privilege('service_role',oid,'execute') else false end service_can_execute,
  case when oid is not null then has_function_privilege('authenticated',oid,'execute') else false end client_can_execute
from installed;

select tgname,pg_get_triggerdef(oid) definition from pg_trigger
where tgrelid='public.customers'::regclass and not tgisinternal;
