-- Run after store-rules.sql; rerunnable. Validates optional category/enabled metadata.
-- Existing items without metadata remain supported. Does not change quota or send messages.
begin;
create or replace function public.save_store_rule_items(p_tenant uuid,p_actor uuid,p_expected text,p_instructions text)
returns void language plpgsql set search_path=pg_catalog,public as $$
declare current_rules text;doc jsonb;
begin
 if not public.has_tenant_feature(p_tenant,'ai_agent') or not(
 exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner')
 or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Owner required' using errcode='42501';end if;
 if p_instructions is null or length(p_instructions)>50000 then raise exception 'Invalid rules' using errcode='22023';end if;
 doc:=p_instructions::jsonb;
 if doc->'snapbot_store_rules' is distinct from '1'::jsonb or jsonb_typeof(doc->'rules') is distinct from 'array' then raise exception 'Invalid rules' using errcode='22023';end if;
 if jsonb_array_length(doc->'rules')>200 or exists(select 1 from jsonb_array_elements(doc->'rules') item where jsonb_typeof(item->'id') is distinct from 'string' or jsonb_typeof(item->'body') is distinct from 'string' or length(trim(item->>'body'))=0)
 or (select count(*) from jsonb_array_elements(doc->'rules'))<>(select count(distinct item->>'id') from jsonb_array_elements(doc->'rules') item) then raise exception 'Invalid rules' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(doc->'rules') item where
   item ? 'category' and (jsonb_typeof(item->'category') is distinct from 'string' or item->>'category' not in ('general','shipping','payment','promotion','returns','persona','handoff'))
   or item ? 'enabled' and jsonb_typeof(item->'enabled') is distinct from 'boolean') then raise exception 'Invalid rule category or status' using errcode='22023';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 select ai_instructions into current_rules from public.bot_settings where tenant_id=p_tenant for update;
 if coalesce(current_rules,'') is distinct from coalesce(p_expected,'') then raise exception 'Store rules changed' using errcode='40001';end if;
 perform public.save_agent_prompt(p_tenant,p_actor,p_instructions);
end $$;
revoke all on function public.save_store_rule_items(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.save_store_rule_items(uuid,uuid,text,text) to service_role;
notify pgrst,'reload schema';
commit;
