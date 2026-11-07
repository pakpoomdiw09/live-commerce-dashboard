-- Append after live-auction-on-demand.sql. Keep labels when later dashboard RPCs replace older versions.
begin;
do $$
declare signature text; definition text;
begin
 foreach signature in array array['public.live_session_dashboard(uuid,uuid)', 'public.live_session_tab_proof(uuid,uuid,uuid)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  definition:=replace(definition, '''name'',i.item_name',
   '''name'',case when i.order_type=''auction'' then ''[ประมูล] ''||i.item_name when i.order_type=''cf'' then ''[CF''||case when i.source_code is not null then ''-''||upper(i.source_code) else '''' end||''] ''||i.item_name else i.item_name end');
  execute definition;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
