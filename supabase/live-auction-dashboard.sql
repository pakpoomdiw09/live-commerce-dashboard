-- All-in-one orchestration; monetary mutations remain in the existing tab ledger.
begin;
alter table public.live_sessions add column if not exists auction_settings jsonb,
 add column if not exists automation_revision integer not null default 0;
alter table public.auctions add column if not exists session_automation jsonb;
create index if not exists live_auction_comment_events on public.facebook_webhook_events(page_id,created_at desc)
 where kind='change' and payload->'value'->>'verb'='add' and payload->'value'->>'item' in ('comment','live_comment');
create table if not exists public.auction_session_requests (
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 request_id uuid not null, actor_id uuid not null, input jsonb not null, result jsonb not null,
 created_at timestamptz not null default clock_timestamp(), primary key(tenant_id,request_id)
);
alter table public.auction_session_requests enable row level security;
revoke all on public.auction_session_requests from public,anon,authenticated;
grant all on public.auction_session_requests to service_role;

create or replace function public.configure_auction_session(p_tenant uuid,p_actor uuid,p_request uuid,p_input jsonb)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare s public.live_sessions; prior public.auction_session_requests; settings jsonb:=p_input->'settings'; result jsonb; page text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||p_request::text,0));
 select * into prior from public.auction_session_requests where tenant_id=p_tenant and request_id=p_request;
 if found then
  if prior.actor_id<>p_actor or prior.input<>p_input then raise exception 'REQUEST_REUSED' using errcode='40001';end if;
  return prior.result;
 end if;
 if p_input->>'action' not in ('start','settings') or p_actor is null or p_request is null then raise exception 'INVALID_ACTION';end if;
 if jsonb_typeof(settings)<>'object' or jsonb_typeof(settings->'keywords')<>'array'
  or jsonb_array_length(settings->'keywords') not between 1 and 30 then raise exception 'INVALID_SETTINGS';end if;
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
 update public.auctions set session_automation=s.auction_settings,
  bank_account_id=(s.auction_settings->>'bankAccountId')::uuid,
  private_reply_enabled=(s.auction_settings->>'privateReply')::boolean,public_reply_enabled=(s.auction_settings->>'publicReply')::boolean,
  private_reply_template=s.auction_settings->>'privateText',bid_reply_template=s.auction_settings->>'bidText',close_reply_template=s.auction_settings->>'closeText'
 where tenant_id=p_tenant and page_id=s.page_id and live_post_id=s.live_post_id and status='active';
 result:=jsonb_build_object('id',s.id,'revision',s.automation_revision);
 insert into public.auction_session_requests(tenant_id,request_id,actor_id,input,result) values(p_tenant,p_request,p_actor,p_input,result);
 return result;
end $$;

create or replace function public.inherit_auction_session_settings() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
declare settings jsonb;
begin
 select auction_settings into settings from public.live_sessions where tenant_id=new.tenant_id and page_id=new.page_id and live_post_id=new.live_post_id;
 if settings is not null then
  new.session_automation:=settings;
  new.bank_account_id:=(settings->>'bankAccountId')::uuid;
  new.private_reply_enabled:=(settings->>'privateReply')::boolean;new.public_reply_enabled:=(settings->>'publicReply')::boolean;
  new.private_reply_template:=settings->>'privateText';new.bid_reply_template:=settings->>'bidText';new.close_reply_template:=settings->>'closeText';
 end if;
 return new;
end $$;
drop trigger if exists auction_session_settings on public.auctions;
create trigger auction_session_settings before insert on public.auctions for each row execute function public.inherit_auction_session_settings();

create or replace function public.live_auction_dashboard(p_tenant uuid,p_session uuid)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare s public.live_sessions; result jsonb; slips jsonb; commenters jsonb;
begin
 select * into s from public.live_sessions where id=p_session and tenant_id=p_tenant;
 if not found then raise exception 'SESSION_NOT_FOUND' using errcode='P0002';end if;
 result:=public.live_session_dashboard(p_tenant,p_session);
 select coalesce(jsonb_agg(row order by row->>'at' desc,row->>'id'),'[]') into slips from (
  select jsonb_build_object('id',p.slip_id,'name',coalesce(c.display_name,c.platform_user_id),'amount',p.amount,'at',p.transferred_at,'transRef',proof.trans_ref) row
  from public.customer_tab_payments p join public.customer_tabs t on t.id=p.tab_id and t.tenant_id=p_tenant
  join public.customers c on c.id=t.customer_id and c.tenant_id=p_tenant
  join public.slips proof on proof.id=p.slip_id and proof.tenant_id=p_tenant and proof.status='valid'
  where t.live_session_id=s.id order by p.transferred_at desc,p.slip_id limit 500
 ) records;
 select coalesce(jsonb_agg(row||jsonb_build_object('customerId',(select c.id from public.customers c where c.tenant_id=p_tenant and c.platform='facebook' and c.platform_user_id=row->>'fbId')) order by row->>'at' desc,row->>'fbId'),'[]') into commenters from (
  select jsonb_build_object('fbId',v->'from'->>'id',
   'name',coalesce((array_agg(v->'from'->>'name' order by created_at desc))[1],v->'from'->>'id'),'at',max(created_at),'comments',count(*)) row
  from (select e.payload->'value' v,e.created_at from public.facebook_webhook_events e
   where e.page_id=s.page_id and e.kind='change' and e.payload->'value'->>'verb'='add'
   and e.payload->'value'->>'item' in ('comment','live_comment') and (
    regexp_replace(e.payload->'value'->>'post_id','^.*_','')=s.live_post_id
    or e.payload->'value'->>'video_id'=s.live_post_id or e.payload->'value'->>'live_video_id'=s.live_post_id
    or exists(select 1 from public.auctions a where a.tenant_id=p_tenant and a.page_id=s.page_id and a.live_post_id=s.live_post_id and e.payload->'value'->>'post_id'=any(a.live_post_aliases)))) events
  where v->'from'->>'id' is not null and v->'from'->>'id'<>s.page_id
  group by v->'from'->>'id' order by max(created_at) desc limit 500
 ) records;
 return result||jsonb_build_object('slips',slips,'commenters',commenters);
end $$;
revoke all on function public.configure_auction_session(uuid,uuid,uuid,jsonb),public.inherit_auction_session_settings(),public.live_auction_dashboard(uuid,uuid) from public,anon,authenticated;
grant execute on function public.configure_auction_session(uuid,uuid,uuid,jsonb),public.live_auction_dashboard(uuid,uuid) to service_role;
commit;
