-- Apply after facebook-webhook-comment-ordering.sql / live-auction-winner-confirmation.sql.
-- One atomic request saves live selection, automation, financial inputs and the round.
begin;
alter table public.live_sessions add column if not exists other_fees numeric(14,2) not null default 0 check(other_fees>=0);
create table if not exists public.auction_workspace_requests (
 tenant_id uuid not null references public.tenants(id), request_id uuid not null,
 actor_id uuid not null references auth.users(id), input jsonb not null, result jsonb not null,
 created_at timestamptz not null default clock_timestamp(), primary key(tenant_id,request_id)
);
alter table public.auction_workspace_requests enable row level security;
revoke all on public.auction_workspace_requests from public,anon,authenticated;
grant all on public.auction_workspace_requests to service_role;
create or replace function public.save_auction_workspace(p_tenant uuid,p_actor uuid,p_request uuid,p_input jsonb)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare prior public.auction_workspace_requests; s public.live_sessions; a public.auctions;
 settings jsonb; result jsonb; page text; round_id uuid;
begin
 if p_request is null or p_actor is null then raise exception 'INVALID_REQUEST';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':auction-workspace',0));
 select * into prior from public.auction_workspace_requests where tenant_id=p_tenant and request_id=p_request;
 if found then
  if prior.actor_id<>p_actor or prior.input<>p_input then raise exception 'REQUEST_REUSED' using errcode='40001';end if;
  return prior.result;
 end if;
 select page_id into page from public.tenants where id=p_tenant and is_active;
 if page is null or p_input->>'pageId' is distinct from page or coalesce(p_input->>'livePostId','') !~ '^[0-9]{1,64}$'
  then raise exception 'PAGE_SCOPE' using errcode='42501';end if;
 if length(trim(coalesce(p_input->>'itemName',''))) not between 1 and 200
  or (p_input->>'startPrice')::numeric not between 0.01 and 999999999
  or (p_input->>'minStep')::numeric not between 0.01 and 999999999
  or (p_input->>'shippingFee')::numeric not between 0 and 999999 then raise exception 'INVALID_ROUND';end if;
 -- Match finalization lock order: auction before session.
 select * into a from public.auctions where tenant_id=p_tenant and page_id=page
  and live_post_id=p_input->>'livePostId' and status='active' for update;
 if a.id is not null and a.id is distinct from (p_input->>'roundId')::uuid then
  raise exception 'ACTIVE_ROUND_CHANGED' using errcode='40001';end if;
 if a.id is null and p_input->>'roundId' is not null then raise exception 'ROUND_CLOSED' using errcode='40001';end if;
 select * into s from public.live_sessions where tenant_id=p_tenant and page_id=page
  and live_post_id=p_input->>'livePostId' for update;
 if s.id is not null then
  if s.id is distinct from (p_input->>'sessionId')::uuid or s.ended_at is not null
   or s.automation_revision<>(p_input->>'revision')::bigint
   or s.financial_revision<>(p_input->>'financialRevision')::bigint then
   raise exception 'SESSION_CHANGED' using errcode='40001';end if;
  perform public.configure_auction_session(p_tenant,p_actor,gen_random_uuid(),jsonb_build_object(
   'action','settings','sessionId',s.id,'revision',s.automation_revision,'settings',p_input->'settings'));
 else
  if p_input->>'sessionId' is not null then raise exception 'SESSION_SCOPE' using errcode='42501';end if;
  perform public.configure_auction_session(p_tenant,p_actor,gen_random_uuid(),jsonb_build_object(
   'action','start','pageId',page,'livePostId',p_input->>'livePostId','settings',p_input->'settings'));
 end if;
 select * into strict s from public.live_sessions where tenant_id=p_tenant and page_id=page and live_post_id=p_input->>'livePostId' for update;
 settings:=s.auction_settings;
 if exists(select 1 from jsonb_each(p_input->'finance') v where (v.value#>>'{}')::numeric<0
  or (v.value#>>'{}')::numeric>999999999999.99 or (v.value#>>'{}')::numeric<>round((v.value#>>'{}')::numeric,2)) then
  raise exception 'INVALID_FINANCE';end if;
 update public.live_sessions set cost_amount=(p_input->'finance'->>'cost')::numeric,
  ad_spent=(p_input->'finance'->>'ads')::numeric,shipping_cost=(p_input->'finance'->>'shipping')::numeric,
  other_fees=(p_input->'finance'->>'fees')::numeric,
  financial_revision=financial_revision+1 where id=s.id returning * into s;
 insert into public.live_session_changes(tenant_id,session_id,actor_id,request_id,payload,result)
  values(p_tenant,s.id,p_actor,p_request,
   p_input->'finance'||jsonb_build_object('action','costs','revision',s.financial_revision-1),
   jsonb_build_object('sessionId',s.id,'revision',s.financial_revision));
 if a.id is null then
  insert into public.auctions(tenant_id,page_id,live_post_id,item_name,start_price,min_step,shipping_fee,bank_account_id,host_ids)
   values(p_tenant,page,p_input->>'livePostId',trim(p_input->>'itemName'),(p_input->>'startPrice')::numeric,
    (p_input->>'minStep')::numeric,(p_input->>'shippingFee')::numeric,(settings->>'bankAccountId')::uuid,
    array(select jsonb_array_elements_text(p_input->'hostIds'))) returning id into round_id;
 else
  if a.leading_bidder_id is not null and (a.item_name is distinct from trim(p_input->>'itemName')
   or a.start_price<>(p_input->>'startPrice')::numeric or a.min_step<>(p_input->>'minStep')::numeric
   or a.shipping_fee<>(p_input->>'shippingFee')::numeric or a.bank_account_id<>(settings->>'bankAccountId')::uuid) then
   raise exception 'BIDS_ALREADY_ACCEPTED';end if;
  update public.auctions set item_name=trim(p_input->>'itemName'),start_price=(p_input->>'startPrice')::numeric,
   min_step=(p_input->>'minStep')::numeric,shipping_fee=(p_input->>'shippingFee')::numeric,
   bank_account_id=(settings->>'bankAccountId')::uuid,
   session_automation=settings,private_reply_enabled=(settings->>'privateReply')::boolean,
   public_reply_enabled=(settings->>'publicReply')::boolean,private_reply_template=settings->>'privateText',
   bid_reply_template=settings->>'bidText',close_reply_template=settings->>'closeText',
   host_ids=array(select distinct unnest(a.host_ids||array(select jsonb_array_elements_text(p_input->'hostIds'))))
   where id=a.id;
  round_id:=a.id;
 end if;
 result:=jsonb_build_object('sessionId',s.id,'auctionId',round_id,'revision',s.automation_revision,'financialRevision',s.financial_revision);
 insert into public.auction_workspace_requests(tenant_id,request_id,actor_id,input,result) values(p_tenant,p_request,p_actor,p_input,result);
 return result;
end $$;
revoke all on function public.save_auction_workspace(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_auction_workspace(uuid,uuid,uuid,jsonb) to service_role;
commit;
