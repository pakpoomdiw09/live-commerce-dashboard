-- Apply after live-auction-close-presets.sql.
-- New sessions start without bid or close keywords; merchants add and save their own.
begin;

create or replace function public.live_auction_thai_dashboard(p_tenant uuid,p_session uuid)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare result jsonb; active jsonb; people jsonb; s public.live_sessions;
begin
 result:=public.live_auction_customer_dashboard(p_tenant,p_session);
 select * into strict s from public.live_sessions where id=p_session and tenant_id=p_tenant;
 select jsonb_build_object(
  'id',a.id,'itemName',a.item_name,
  'currentPrice',case when a.leading_bidder_id is null then 0 else a.current_price end)
  into active from public.auctions a
  where a.tenant_id=p_tenant and a.page_id=s.page_id and a.live_post_id=s.live_post_id
   and a.status='active' order by a.created_at desc limit 1;
 with latest as (
  select distinct on (e.payload->'value'->'from'->>'id')
   e.payload->'value'->'from'->>'id' fb_id,e.payload->'value'->>'message' message
  from public.facebook_webhook_events e
  where e.page_id=s.page_id and e.kind='change' and e.payload->'value'->>'verb'='add'
   and e.payload->'value'->>'item' in ('comment','live_comment') and (
    regexp_replace(e.payload->'value'->>'post_id','^.*_','')=s.live_post_id
    or e.payload->'value'->>'video_id'=s.live_post_id
    or e.payload->'value'->>'live_video_id'=s.live_post_id
    or exists(select 1 from public.auctions a where a.tenant_id=p_tenant and a.page_id=s.page_id
     and a.live_post_id=s.live_post_id
     and e.payload->'value'->>'post_id'=any(a.live_post_aliases)))
  order by e.payload->'value'->'from'->>'id',e.created_at desc,e.id desc
 )
 select coalesce(jsonb_agg(x||jsonb_build_object('lastText',latest.message) order by pos),'[]'::jsonb)
  into people from jsonb_array_elements(result->'commenters') with ordinality rows(x,pos)
  left join latest on latest.fb_id=x->>'fbId';
 return result||jsonb_build_object('activeAuction',active,'commenters',people);
end $$;

create or replace function public.default_auction_close_keywords() returns jsonb
language sql immutable set search_path=pg_catalog,public as $$ select '[]'::jsonb $$;

create or replace function public.normalize_auction_thai_settings(settings jsonb) returns jsonb
language sql immutable returns null on null input set search_path=pg_catalog,public as $$
 select settings||jsonb_build_object(
  'keywords',coalesce(settings->'keywords','[]'::jsonb),
  'closeKeywords',coalesce(settings->'closeKeywords','[]'::jsonb),
  'closeKeywordPresetsVersion',1,'countEnabled',false,'heartCloses',false,'closeEnabled',true,
  'bidText',case when settings ? 'closeKeywords' then settings->>'bidText' else coalesce(settings->>'closeText','ยินดีด้วยครับ คุณ {bidder_name} ชนะประมูล {product_name} ราคา {price} บาท') end,
  'closeText',case when settings ? 'closeKeywords' then settings->>'bidText' else coalesce(settings->>'closeText','ยินดีด้วยครับ คุณ {bidder_name} ชนะประมูล {product_name} ราคา {price} บาท') end)
$$;

create or replace function public.configure_auction_session(
 p_tenant uuid,p_actor uuid,p_request uuid,p_input jsonb
) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare
 s public.live_sessions;
 prior public.auction_session_requests;
 settings jsonb:=public.normalize_auction_thai_settings(p_input->'settings');
 result jsonb;
 page text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||p_request::text,0));
 select * into prior from public.auction_session_requests
  where tenant_id=p_tenant and request_id=p_request;
 if found then
  if prior.actor_id<>p_actor or prior.input<>p_input then
   raise exception 'REQUEST_REUSED' using errcode='40001';
  end if;
  return prior.result;
 end if;
 if settings is null then raise exception 'INVALID_SETTINGS';end if;
 if p_input->>'action' not in ('start','settings') or p_actor is null or p_request is null then
  raise exception 'INVALID_ACTION';
 end if;
 if jsonb_typeof(settings)<>'object' or jsonb_typeof(settings->'keywords')<>'array' then
  raise exception 'INVALID_SETTINGS';
 end if;
 if jsonb_typeof(settings->'closeKeywords') is distinct from 'array' then
  raise exception 'INVALID_CLOSE_KEYWORDS';
 end if;
 if exists(select 1 from jsonb_array_elements(settings->'closeKeywords') k
  where jsonb_typeof(k)<>'string' or length(trim(k#>>'{}')) not between 1 and 40) then
  raise exception 'INVALID_CLOSE_KEYWORDS';
 end if;
 if exists(select 1 from jsonb_array_elements(settings->'keywords') k
  where jsonb_typeof(k)<>'string' or length(trim(k#>>'{}')) not between 1 and 40)
  or exists(select 1 from unnest(array['publicReply','privateReply','countEnabled','closeEnabled','heartCloses']) k
   where jsonb_typeof(settings->k) is distinct from 'boolean')
  or exists(select 1 from unnest(array['bidText','privateText','closeText']) k
   where jsonb_typeof(settings->k) is distinct from 'string'
    or length(settings->>k) not between 0 and 2000) then
  raise exception 'INVALID_SETTINGS';
 end if;
 if not exists(select 1 from public.bank_accounts
  where id=(settings->>'bankAccountId')::uuid and tenant_id=p_tenant and is_active) then
  raise exception 'BANK_SCOPE' using errcode='42501';
 end if;
 select page_id into page from public.tenants where id=p_tenant and is_active;
 if page is null then raise exception 'PAGE_SCOPE' using errcode='42501';end if;
 if p_input->>'action'='start' then
  if p_input->>'pageId' is distinct from page
   or coalesce(p_input->>'livePostId','') !~ '^[0-9]{1,64}$' then
   raise exception 'PAGE_SCOPE' using errcode='42501';
  end if;
  insert into public.live_sessions(tenant_id,page_id,live_post_id,auction_settings)
   values(p_tenant,page,p_input->>'livePostId',settings)
   on conflict(tenant_id,page_id,live_post_id) do nothing;
  perform 1 from public.auctions where tenant_id=p_tenant and page_id=page
   and live_post_id=p_input->>'livePostId' and status='active' order by id for update;
  select * into s from public.live_sessions where tenant_id=p_tenant and page_id=page
   and live_post_id=p_input->>'livePostId' for update;
  if s.ended_at is not null then raise exception 'SESSION_ENDED' using errcode='40001';end if;
  if s.auction_settings is null then
   update public.live_sessions set auction_settings=settings,automation_revision=automation_revision+1
    where id=s.id returning * into s;
  end if;
 else
  select * into s from public.live_sessions
   where id=(p_input->>'sessionId')::uuid and tenant_id=p_tenant;
  if not found then raise exception 'SESSION_NOT_FOUND' using errcode='P0002';end if;
  perform 1 from public.auctions where tenant_id=p_tenant and page_id=s.page_id
   and live_post_id=s.live_post_id and status='active' order by id for update;
  select * into s from public.live_sessions where id=s.id for update;
  if s.ended_at is not null then raise exception 'SESSION_ENDED' using errcode='40001';end if;
  if s.automation_revision<>(p_input->>'revision')::integer then
   raise exception 'SETTINGS_CHANGED' using errcode='40001';
  end if;
  update public.live_sessions set auction_settings=settings,automation_revision=automation_revision+1
   where id=s.id returning * into s;
 end if;
 update public.auctions set session_automation=s.auction_settings||jsonb_build_object('bankAccountId',bank_account_id),
  private_reply_enabled=(s.auction_settings->>'privateReply')::boolean,
  public_reply_enabled=(s.auction_settings->>'publicReply')::boolean,
  private_reply_template=s.auction_settings->>'privateText',
  bid_reply_template=s.auction_settings->>'bidText',
  close_reply_template=s.auction_settings->>'closeText'
  where tenant_id=p_tenant and page_id=s.page_id and live_post_id=s.live_post_id and status='active';
 result:=jsonb_build_object('id',s.id,'revision',s.automation_revision);
 insert into public.auction_session_requests(tenant_id,request_id,actor_id,input,result)
  values(p_tenant,p_request,p_actor,p_input,result);
 return result;
end $$;

update public.live_sessions
 set auction_settings=jsonb_set(
  jsonb_set(auction_settings,'{keywords}',
   case when auction_settings->'keywords'='["1"]'::jsonb then '[]'::jsonb else coalesce(auction_settings->'keywords','[]'::jsonb) end),
  '{closeKeywords}','[]'::jsonb),
  automation_revision=automation_revision+1
 where auction_settings->'closeKeywords'=
  '["ปิด","จบ","พอ","321","3 2 1","x","X","❌","🛑","⛔","🚫","✖️","🏁","🚩","🔨","🔔","⏰","❤️","🖤"]'::jsonb;

update public.auctions
 set session_automation=jsonb_set(
  jsonb_set(session_automation,'{keywords}',
   case when session_automation->'keywords'='["1"]'::jsonb then '[]'::jsonb else coalesce(session_automation->'keywords','[]'::jsonb) end),
  '{closeKeywords}','[]'::jsonb),
  bid_reply_template=coalesce(session_automation->>'bidText',bid_reply_template),
  close_reply_template=coalesce(session_automation->>'bidText',close_reply_template)
 where status='active' and session_automation->'closeKeywords'=
  '["ปิด","จบ","พอ","321","3 2 1","x","X","❌","🛑","⛔","🚫","✖️","🏁","🚩","🔨","🔔","⏰","❤️","🖤"]'::jsonb;

revoke all on function public.default_auction_close_keywords(),
 public.normalize_auction_thai_settings(jsonb),
 public.configure_auction_session(uuid,uuid,uuid,jsonb),
 public.live_auction_thai_dashboard(uuid,uuid) from public,anon,authenticated;
grant execute on function public.default_auction_close_keywords(),
 public.normalize_auction_thai_settings(jsonb),
 public.configure_auction_session(uuid,uuid,uuid,jsonb),
 public.live_auction_thai_dashboard(uuid,uuid) to service_role;

commit;
