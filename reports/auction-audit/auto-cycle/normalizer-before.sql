CREATE OR REPLACE FUNCTION public.normalize_auction_thai_settings(settings jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 select case when settings ? 'auto_accumulate_summary' and jsonb_typeof(settings->'auto_accumulate_summary')<>'boolean'
  then null else public.normalize_auction_settings_before_split(settings)||jsonb_build_object(
   'auto_accumulate_summary',coalesce(settings->'auto_accumulate_summary','true'::jsonb)) end
$function$
