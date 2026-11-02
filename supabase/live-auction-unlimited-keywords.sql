-- Remove the keyword count ceiling while preserving per-keyword validation and tenant scoping.
begin;
create or replace function public.configure_auction_session(p_tenant uuid,p_actor uuid,p_request uuid,p_input jsonb)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare s public.live_sessions; prior public.auction_session_requests; settings jsonb:=public.normalize_auction_thai_settings(p_input->'settings'); result jsonb; page text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||p_request::text,0));
 select * into prior from public.auction_session_requests where tenant_id=p_tenant and request_id=p_request;
 if found then
  if prior.actor_id<>p_actor or prior.input<>p_input then raise exception 'REQUEST_REUSED' using errcode='40001';end if;
  return prior.result;
 end if;
 if settings is null then raise exception 'INVALID_SETTINGS';end if;
 if p_input->>'action' not in ('start','settings') or p_actor is null or p_request is null then raise exception 'INVALID_ACTION';end if;
 if jsonb_typeof(settings)<>'object' or jsonb_typeof(settings->'keywords')<>'array'
  or jsonb_array_length(settings->'keywords')<1 then raise exception 'INVALID_SETTINGS';end if;
 if jsonb_typeof(settings->'closeKeywords') is distinct from 'array' or jsonb_array_length(settings->'closeKeywords')<1 then raise exception 'INVALID_CLOSE_KEYWORDS';end if;
 if exists(select 1 from jsonb_array_elements(settings->'closeKeywords') k where jsonb_typeof(k)<>'string' or length(trim(k#>>'{}')) not between 1 and 40) then raise exception 'INVALID_CLOSE_KEYWORDS';end if;
 if exists(select 1 from jsonb_array_elements(settings->'keywords') k where jsonb_typeof(k)<>'string' or length(trim(k#>>'{}')) not between 1 and 40)
  or exists(select 1 from unnest(array['publicReply','privateReply','countEnabled','closeEnabled','heartCloses']) k where jsonb_typeof(settings->k) is distinct from 'boolean')
  or exists(select 1 from unnest(array['bidText','privateText','closeText']) k where jsonb_typeof(settings->k) is distinct from 'string' or length(settings->>k) not between 1 and 2000)
  then raise exception 'INVALID_SETTINGS';end if;
 if not exists(select 1 from public.bank_accounts where id=(settings->>'bankAccountId')::uuid and tenant_id=p_tenant and is_active)
  then raise exception 'BANK_SCOPE' using errcode='42501';end if;
 select page_id into page from public.tenants where id=p_tenant and is_active;
 if page is null then raise exception 'PAGE_SCOPE' using errcode='42501';end if;
 if p_input->>'action'='start' then
  if p_input->>'pageId' is distinct from page or coalesce(p_input->>'livePostId','') !~ '^[0-9]{1,64}$' then raise exception 'PAGE_SCOPE' using errcode='42501';end if;
  insert into public.live_sessions(tenant_id,page_id,live_post_id,auction_settings)
   values(p_tenant,page,p_input->>'livePostId',settings)
   on conflict(tenant_id,page_id,live_post_id) do nothing;
  perform 1 from public.auctions where tenant_id=p_tenant and page_id=page and live_post_id=p_input->>'livePostId' and status='active' order by id for update;
  select * into s from public.live_sessions where tenant_id=p_tenant and page_id=page and live_post_id=p_input->>'livePostId' for update;
  if s.ended_at is not null then raise exception 'SESSION_ENDED' using errcode='40001';end if;
  -- Starting an existing Session must not reset its saved automation or ledger.
  if s.auction_settings is null then
   update public.live_sessions set auction_settings=settings,automation_revision=automation_revision+1 where id=s.id returning * into s;
  end if;
 else
  select * into s from public.live_sessions where id=(p_input->>'sessionId')::uuid and tenant_id=p_tenant;
  if not found then raise exception 'SESSION_NOT_FOUND' using errcode='P0002';end if;
  -- Use auction -> session lock order, matching finalization and tab attachment.
  perform 1 from public.auctions where tenant_id=p_tenant and page_id=s.page_id and live_post_id=s.live_post_id and status='active' order by id for update;
  select * into s from public.live_sessions where id=s.id for update;
  if s.ended_at is not null then raise exception 'SESSION_ENDED' using errcode='40001';end if;
  if s.automation_revision<>(p_input->>'revision')::integer then raise exception 'SETTINGS_CHANGED' using errcode='40001';end if;
  update public.live_sessions set auction_settings=settings,automation_revision=automation_revision+1 where id=s.id returning * into s;
 end if;
 update public.auctions set session_automation=s.auction_settings||jsonb_build_object('bankAccountId',bank_account_id),
  private_reply_enabled=(s.auction_settings->>'privateReply')::boolean,public_reply_enabled=(s.auction_settings->>'publicReply')::boolean,
  private_reply_template=s.auction_settings->>'privateText',bid_reply_template=s.auction_settings->>'bidText',close_reply_template=s.auction_settings->>'closeText'
 where tenant_id=p_tenant and page_id=s.page_id and live_post_id=s.live_post_id and status='active';
 result:=jsonb_build_object('id',s.id,'revision',s.automation_revision);
 insert into public.auction_session_requests(tenant_id,request_id,actor_id,input,result) values(p_tenant,p_request,p_actor,p_input,result);
 return result;
end $$;
commit;
