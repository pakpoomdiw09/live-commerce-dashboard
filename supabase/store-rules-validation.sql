-- Run after store-rules.sql and store-rule-items.sql. Existing data/history are never rewritten.
begin;
create or replace function public.assert_valid_store_rules(p_instructions text) returns void
language plpgsql immutable set search_path=pg_catalog,public as $$
declare doc jsonb;item jsonb;candidate boolean;seen text[]:=array[]::text[];
 whitespace text:=U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]';
begin
 if p_instructions is null then return;end if;
 if length(p_instructions)>50000 then raise exception 'STORE_RULES_INVALID: ข้อมูลกฎยาวเกิน 50,000 ตัวอักษร' using errcode='22023';end if;
 candidate:=left(ltrim(p_instructions,E' \t\r\n'||chr(65279)),1) in ('{','[') and p_instructions ~ ('"snapbot_store_rules"'||whitespace||'*:');
 begin doc:=p_instructions::jsonb;
 exception when invalid_text_representation or numeric_value_out_of_range or untranslatable_character then
  if candidate then raise exception 'STORE_RULES_INVALID: รูปแบบข้อมูลกฎไม่สมบูรณ์' using errcode='22023';end if;
  return;
 end;
 if jsonb_typeof(doc)<>'object' or not(doc ? 'snapbot_store_rules') then
  if jsonb_typeof(doc)='array' and candidate then raise exception 'STORE_RULES_INVALID: เอกสารกฎไม่ถูกต้อง' using errcode='22023';end if;
  return;
 end if;
 if doc->'snapbot_store_rules' is distinct from '1'::jsonb or jsonb_typeof(doc->'rules') is distinct from 'array'
 or exists(select 1 from jsonb_object_keys(doc) k where k not in ('snapbot_store_rules','rules')) then raise exception 'STORE_RULES_INVALID: โครงสร้างข้อมูลกฎไม่ถูกต้อง' using errcode='22023';end if;
 if jsonb_array_length(doc->'rules')>200 then raise exception 'STORE_RULES_INVALID: เพิ่มกฎได้สูงสุด 200 ข้อ' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(doc->'rules') loop
  if jsonb_typeof(item) is distinct from 'object' then raise exception 'STORE_RULES_INVALID: รายการกฎไม่ถูกต้อง' using errcode='22023';end if;
  if exists(select 1 from jsonb_object_keys(item) k where k not in ('id','body','category','enabled'))
  or jsonb_typeof(item->'id') is distinct from 'string' or length(item->>'id')>128 or regexp_replace(item->>'id',whitespace,'','g')=''
  or item->>'id' ~ U&'[\0001-\001F\007F]' or jsonb_typeof(item->'body') is distinct from 'string' or regexp_replace(item->>'body',whitespace,'','g')=''
  or (item ? 'category' and (jsonb_typeof(item->'category') is distinct from 'string' or item->>'category' not in ('general','shipping','payment','promotion','returns','persona','handoff')))
  or (item ? 'enabled' and jsonb_typeof(item->'enabled') is distinct from 'boolean') then raise exception 'STORE_RULES_INVALID: รายละเอียด หมวดหมู่ หรือสถานะกฎไม่ถูกต้อง' using errcode='22023';end if;
  if item->>'id'=any(seen) then raise exception 'STORE_RULES_INVALID: พบรหัสกฎซ้ำ' using errcode='22023';end if;
  seen:=array_append(seen,item->>'id');
 end loop;
end $$;

create or replace function public.guard_store_rules_validation() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare revision integer;actor uuid;
begin
 if tg_op='INSERT' then perform public.assert_valid_store_rules(new.ai_instructions);
 elsif new.ai_instructions is distinct from old.ai_instructions then
  perform public.assert_valid_store_rules(new.ai_instructions);
  if old.ai_instructions is not null and not exists(select 1 from public.agent_prompt_versions where tenant_id=old.tenant_id and instructions is not distinct from old.ai_instructions) then
   actor:=coalesce(auth.uid(),nullif(current_setting('snapbot.agent_actor',true),'')::uuid);
   select coalesce(max(version),0)+1 into revision from public.agent_prompt_versions where tenant_id=old.tenant_id;
   insert into public.agent_prompt_versions(tenant_id,version,instructions,actor_id) values(old.tenant_id,revision,old.ai_instructions,actor);
  end if;
 end if;
 return new;
end $$;
drop trigger if exists bot_settings_store_rules_validation on public.bot_settings;
create trigger bot_settings_store_rules_validation before insert or update of ai_instructions on public.bot_settings for each row execute function public.guard_store_rules_validation();

create or replace function public.save_validated_store_rules(p_tenant uuid,p_actor uuid,p_expected text,p_instructions text) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare current_rules text;
begin
 if not public.has_tenant_feature(p_tenant,'ai_agent') or not(
  exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner')
  or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Owner required' using errcode='42501';end if;
 perform public.assert_valid_store_rules(p_instructions);
 perform 1 from public.tenants where id=p_tenant for update;
 select ai_instructions into current_rules from public.bot_settings where tenant_id=p_tenant for update;
 if coalesce(current_rules,'') is distinct from coalesce(p_expected,'') then raise exception 'Store rules changed' using errcode='40001';end if;
 perform public.save_agent_prompt(p_tenant,p_actor,p_instructions);
end $$;
revoke all on function public.save_validated_store_rules(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.save_validated_store_rules(uuid,uuid,text,text) to service_role;
-- The validator is pure and must also run for existing authenticated table writes.
revoke all on function public.assert_valid_store_rules(text) from public,anon;
grant execute on function public.assert_valid_store_rules(text) to authenticated,service_role;
revoke all on function public.guard_store_rules_validation() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
