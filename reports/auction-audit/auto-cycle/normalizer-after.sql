CREATE OR REPLACE FUNCTION public.normalize_auction_settings_before_split(settings jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 select case when coalesce(settings->>'winnerFlow','on_demand') in ('on_demand','highest_bid') then settings||jsonb_build_object(
  'winnerFlow',coalesce(settings->>'winnerFlow','on_demand'),
  'keywords',coalesce(settings->'keywords','[]'::jsonb),
  'closeKeywords',coalesce(settings->'closeKeywords','[]'::jsonb),
  'closeKeywordPresetsVersion',1,'countEnabled',coalesce((settings->>'countEnabled')::boolean,false),'heartCloses',false,'closeEnabled',coalesce((settings->>'closeEnabled')::boolean,true),
  'bidText',case when settings ? 'closeKeywords' then settings->>'bidText' else coalesce(settings->>'closeText','ยินดีด้วยครับ คุณ {bidder_name} ชนะประมูล {product_name} ราคา {price} บาท') end,
  'closeText',case when settings ? 'closeKeywords' then settings->>'bidText' else coalesce(settings->>'closeText','ยินดีด้วยครับ คุณ {bidder_name} ชนะประมูล {product_name} ราคา {price} บาท') end) else null end
$function$
