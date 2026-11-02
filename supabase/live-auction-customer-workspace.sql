-- Apply after live-auction-instant-winners.sql. Notes never change the monetary ledger.
begin;
create table if not exists public.live_session_customer_notes (
 session_id uuid not null references public.live_sessions(id) on delete cascade,
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 fb_id text not null check(fb_id ~ '^[0-9]{1,64}$'),
 note text not null default '' check(length(note)<=500), revision integer not null default 1,
 updated_at timestamptz not null default clock_timestamp(), primary key(session_id,fb_id)
);
alter table public.live_session_customer_notes enable row level security;
revoke all on public.live_session_customer_notes from public,anon,authenticated;
grant all on public.live_session_customer_notes to service_role;

create or replace function public.live_auction_matched_customers(p_tenant uuid,p_session uuid)
returns table(fb_id text) language sql stable set search_path=pg_catalog,public as $$
 with s as (select * from public.live_sessions where id=p_session and tenant_id=p_tenant)
 select b.bidder_id from public.auction_bids b join public.auctions a on a.id=b.auction_id join s on a.page_id=s.page_id and a.live_post_id=s.live_post_id
  where a.tenant_id=p_tenant and b.status in ('accepted','too_low','already_opened') and b.bidder_id<>s.page_id
 union
 select e.payload->'value'->'from'->>'id' from public.facebook_webhook_events e join public.live_cf_webhook_receipts r
  on r.comment_id=e.payload->'value'->>'comment_id' and r.page_id=e.page_id and r.tenant_id=p_tenant
 join s on e.page_id=s.page_id where e.kind='change' and e.payload->'value'->>'verb'='add'
 and e.payload->'value'->>'item' in ('comment','live_comment') and e.payload->'value'->'from'->>'id'<>s.page_id and (
 regexp_replace(e.payload->'value'->>'post_id','^.*_','')=s.live_post_id or e.payload->'value'->>'video_id'=s.live_post_id
 or e.payload->'value'->>'live_video_id'=s.live_post_id or exists(select 1 from public.auctions a where a.tenant_id=p_tenant
  and a.page_id=s.page_id and a.live_post_id=s.live_post_id and e.payload->'value'->>'post_id'=any(a.live_post_aliases)))
$$;

create or replace function public.live_auction_customer_dashboard(p_tenant uuid,p_session uuid)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare result jsonb; ids text[]; tabs jsonb; people jsonb;
begin
 result:=public.live_auction_dashboard(p_tenant,p_session);
 select coalesce(array_agg(fb_id),'{}') into ids from public.live_auction_matched_customers(p_tenant,p_session);
 select coalesce(jsonb_agg(x||jsonb_build_object('fbId',t.customer_fb_id,'matched',t.customer_fb_id=any(ids),
  'note',coalesce(n.note,''),'noteRevision',coalesce(n.revision,0)) order by pos),'[]') into tabs
 from jsonb_array_elements(result->'tabs') with ordinality rows(x,pos)
 join public.customer_tabs t on t.id=(x->>'id')::uuid and t.tenant_id=p_tenant and t.live_session_id=p_session
 left join public.live_session_customer_notes n on n.session_id=p_session and n.fb_id=t.customer_fb_id and n.tenant_id=p_tenant;
 select coalesce(jsonb_agg(x||jsonb_build_object('matched',x->>'fbId'=any(ids),'note',coalesce(n.note,''),
  'noteRevision',coalesce(n.revision,0)) order by pos),'[]') into people
 from jsonb_array_elements(result->'commenters') with ordinality rows(x,pos)
 left join public.live_session_customer_notes n on n.session_id=p_session and n.fb_id=x->>'fbId' and n.tenant_id=p_tenant;
 return result||jsonb_build_object('tabs',tabs,'commenters',people);
end $$;

create or replace function public.save_auction_customer_note(p_tenant uuid,p_session uuid,p_actor uuid,p_request uuid,p_fb_id text,p_note text,p_revision integer)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare payload jsonb; prior public.auction_session_requests; current public.live_session_customer_notes; snapshot jsonb; result jsonb;
begin
 if p_fb_id is null or p_fb_id !~ '^[0-9]{1,64}$' or p_note is null or length(p_note)>500 or p_revision is null or p_revision<0 or p_actor is null or p_request is null then raise exception 'INVALID_NOTE';end if;
 payload:=jsonb_build_object('sessionId',p_session,'fbId',p_fb_id,'note',p_note,'revision',p_revision);
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||p_request::text,0));
 select * into prior from public.auction_session_requests where tenant_id=p_tenant and request_id=p_request;
 if found then
  if prior.actor_id<>p_actor or prior.input<>payload then raise exception 'REQUEST_REUSED' using errcode='40001';end if;
  return prior.result;
 end if;
 snapshot:=public.live_auction_customer_dashboard(p_tenant,p_session);
 if not exists(select 1 from jsonb_array_elements(snapshot->'tabs') x where x->>'fbId'=p_fb_id)
  and not exists(select 1 from jsonb_array_elements(snapshot->'commenters') x where x->>'fbId'=p_fb_id)
  then raise exception 'SESSION_CUSTOMER_SCOPE' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_session::text||':'||p_fb_id,0));
 select * into current from public.live_session_customer_notes where session_id=p_session and fb_id=p_fb_id for update;
 if coalesce(current.revision,0)<>p_revision then raise exception 'NOTE_CHANGED' using errcode='40001';end if;
 insert into public.live_session_customer_notes(session_id,tenant_id,fb_id,note) values(p_session,p_tenant,p_fb_id,p_note)
  on conflict(session_id,fb_id) do update set note=excluded.note,revision=live_session_customer_notes.revision+1,updated_at=clock_timestamp()
  returning * into current;
 result:=jsonb_build_object('note',current.note,'revision',current.revision);
 insert into public.auction_session_requests(tenant_id,request_id,actor_id,input,result) values(p_tenant,p_request,p_actor,payload,result);
 return result;
end $$;
create or replace function public.collect_auction_session_customers(p_tenant uuid,p_session uuid,p_fb_ids text[])
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare snapshot jsonb; person jsonb; fb text; name text; cid uuid;
begin
 if coalesce(cardinality(p_fb_ids),0) not between 1 and 500 or exists(select 1 from unnest(p_fb_ids) id where id is null or id !~ '^[0-9]{1,64}$') then raise exception 'INVALID_CUSTOMERS';end if;
 snapshot:=public.live_auction_customer_dashboard(p_tenant,p_session);
 foreach fb in array p_fb_ids loop
  select x into person from jsonb_array_elements(snapshot->'commenters') x where x->>'fbId'=fb;
  if person is null then select x into person from jsonb_array_elements(snapshot->'tabs') x where x->>'fbId'=fb;end if;
  if person is null then raise exception 'SESSION_CUSTOMER_SCOPE' using errcode='42501';end if;
  name:=person->>'name';
  insert into public.customers(tenant_id,platform,platform_user_id,display_name) values(p_tenant,'facebook',fb,left(name,255))
   on conflict(platform,platform_user_id) do update set tenant_id=coalesce(customers.tenant_id,excluded.tenant_id),display_name=coalesce(customers.display_name,excluded.display_name)
   where customers.tenant_id is null or customers.tenant_id=p_tenant returning id into cid;
  if not found then raise exception 'CUSTOMER_TENANT_SCOPE' using errcode='42501';end if;
 end loop;
 -- Importing commenters must not manufacture a Messenger inbound window or a payment.
 return public.live_auction_customer_dashboard(p_tenant,p_session);
end $$;
revoke all on function public.collect_auction_session_customers(uuid,uuid,text[]),public.live_auction_matched_customers(uuid,uuid),public.live_auction_customer_dashboard(uuid,uuid),public.save_auction_customer_note(uuid,uuid,uuid,uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.collect_auction_session_customers(uuid,uuid,text[]) to service_role;
grant execute on function public.live_auction_customer_dashboard(uuid,uuid),public.save_auction_customer_note(uuid,uuid,uuid,uuid,text,text,integer) to service_role;
-- The wrapper needs this invoker function; it is never exposed to browser roles.
grant execute on function public.live_auction_matched_customers(uuid,uuid) to service_role;
commit;
