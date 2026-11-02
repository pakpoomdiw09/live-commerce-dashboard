-- Latest comment text for the compact customer table. No billing changes.
create or replace function public.live_auction_thai_dashboard(p_tenant uuid,p_session uuid) returns jsonb
language plpgsql stable set search_path=pg_catalog,public as $$
declare result jsonb; active jsonb; people jsonb; s public.live_sessions;
begin
 result:=public.live_auction_customer_dashboard(p_tenant,p_session);
 select * into strict s from public.live_sessions where id=p_session and tenant_id=p_tenant;
 select jsonb_build_object('id',a.id,'itemName',a.item_name) into active from public.auctions a
 where a.tenant_id=p_tenant and a.page_id=s.page_id and a.live_post_id=s.live_post_id
 and a.status='active' order by a.created_at desc limit 1;
 with latest as (
  select distinct on (e.payload->'value'->'from'->>'id')
   e.payload->'value'->'from'->>'id' fb_id,e.payload->'value'->>'message' message
  from public.facebook_webhook_events e
  where e.page_id=s.page_id and e.kind='change' and e.payload->'value'->>'verb'='add'
   and e.payload->'value'->>'item' in ('comment','live_comment') and (
    regexp_replace(e.payload->'value'->>'post_id','^.*_','')=s.live_post_id
    or e.payload->'value'->>'video_id'=s.live_post_id or e.payload->'value'->>'live_video_id'=s.live_post_id
    or exists(select 1 from public.auctions a where a.tenant_id=p_tenant and a.page_id=s.page_id
     and a.live_post_id=s.live_post_id and e.payload->'value'->>'post_id'=any(a.live_post_aliases)))
  order by e.payload->'value'->'from'->>'id',e.created_at desc,e.id desc
 )
 select coalesce(jsonb_agg(x||jsonb_build_object('lastText',latest.message) order by pos),'[]'::jsonb) into people
 from jsonb_array_elements(result->'commenters') with ordinality rows(x,pos)
 left join latest on latest.fb_id=x->>'fbId';
 return result||jsonb_build_object('activeAuction',active,'commenters',people);
end $$;
revoke all on function public.live_auction_thai_dashboard(uuid,uuid) from public,anon,authenticated;
grant execute on function public.live_auction_thai_dashboard(uuid,uuid) to service_role;
