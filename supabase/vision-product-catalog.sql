-- Apply after vision-master-switch.sql. No training opt-in is needed for catalog replies.
-- Preserve installed quota, claim fencing, feature access and human/Messenger guards.
begin;
do $$
declare signature text; definition text;
begin
 foreach signature in array array[
  'public.claim_vision_job(uuid)', 'public.start_vision_analysis(uuid,uuid)',
  'public.begin_vision_dispatch(uuid,uuid)', 'public.handover_vision_job(uuid,uuid,text)'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  definition:=replace(definition,
   'not exists(select 1 from public.vision_settings where tenant_id=j.tenant_id and enabled)',
   'not exists(select 1 from public.tenants where id=j.tenant_id and is_active and auto_reply_enabled)');
  -- Catalog matching belongs to image_assistant, whose feature/quota guards remain intact.
  definition:=regexp_replace(definition,
   ' if j.decision->>''action''=''PRODUCT_SEARCH''[^\n]+then return false;end if;', '', 'g');
  if position('vision_settings' in definition)>0 then
   raise exception 'Unrecognized legacy Vision settings guard in %',signature;
  end if;
  execute definition;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
