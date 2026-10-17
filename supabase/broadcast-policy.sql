-- Additive broadcast reliability/evidence. Run after automation.sql, billing.sql,
-- smart-inbox.sql and agent-control.sql. Test locally before applying anywhere else.
begin;
create table if not exists public.broadcast_messaging_events (
 tenant_id uuid not null references public.tenants(id), customer_id uuid not null references public.customers(id),
 event_id text not null, page_id text not null, kind text not null check(kind='inbound_message'),
 interacted_at timestamptz not null, received_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,event_id), check(interacted_at<=received_at)
);
create index if not exists broadcast_events_latest on public.broadcast_messaging_events(tenant_id,customer_id,interacted_at desc);
create table if not exists public.broadcast_runs (
 broadcast_id uuid primary key references public.broadcasts(id), lease uuid not null,
 locked_until timestamptz not null, actor_id uuid not null, updated_at timestamptz not null default clock_timestamp()
);
create table if not exists public.broadcast_deliveries (
 broadcast_id uuid not null references public.broadcasts(id), customer_id uuid not null references public.customers(id), tenant_id uuid not null references public.tenants(id),
 status text not null check(status in ('claimed','accepted','delivered','read','failed','unknown','skipped')),
 reason text, provider_message_id text, lease uuid not null, monthly integer not null default 0, topup integer not null default 0,
 transport_started_at timestamptz, accepted_at timestamptz, created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 primary key(broadcast_id,customer_id), check(monthly>=0 and topup>=0)
);
create unique index if not exists broadcast_provider_receipt on public.broadcast_deliveries(provider_message_id) where provider_message_id is not null;
alter table public.broadcast_messaging_events enable row level security;
alter table public.broadcast_runs enable row level security;
alter table public.broadcast_deliveries enable row level security;
revoke all on public.broadcast_messaging_events,public.broadcast_runs,public.broadcast_deliveries from public,anon,authenticated;
grant all on public.broadcast_messaging_events,public.broadcast_runs,public.broadcast_deliveries to service_role;

create or replace function public.freeze_broadcast_content() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if old.status<>'draft' and (new.tenant_id,new.name,new.message,new.audience_segment,new.audience_tags,new.audience_window,new.message_tag)
  is distinct from (old.tenant_id,old.name,old.message,old.audience_segment,old.audience_tags,old.audience_window,old.message_tag) then
  raise exception 'Started campaign content is immutable' using errcode='40001';
 end if;
 return new;
end $$;
drop trigger if exists freeze_broadcast_content on public.broadcasts;
create trigger freeze_broadcast_content before update on public.broadcasts for each row execute function public.freeze_broadcast_content();

create or replace function public.claim_broadcast_run(p_broadcast uuid,p_actor uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare b public.broadcasts;r public.broadcast_runs;token uuid:=gen_random_uuid();
begin
 select * into b from public.broadcasts where id=p_broadcast for update;
 if not found or b.status='sent' then return null;end if;
 if exists(select 1 from public.messages where external_id like 'bc:'||b.id::text||':%') and not exists(select 1 from public.broadcast_runs where broadcast_id=b.id) then
  raise exception 'Legacy campaign requires review before resuming' using errcode='40001';end if;
 if not exists(select 1 from public.tenants where id=b.tenant_id and is_active)
  or not (exists(select 1 from public.platform_admins where user_id=p_actor) or exists(select 1 from public.tenant_members where tenant_id=b.tenant_id and user_id=p_actor and role='owner')) then
  raise exception 'Forbidden' using errcode='42501';end if;
 if b.audience_window<>'within_24h' or b.message_tag is not null then raise exception 'Unsupported broadcast channel' using errcode='42501';end if;
 select * into r from public.broadcast_runs where broadcast_id=b.id;
 if found and r.locked_until>clock_timestamp() then return null;end if;
 -- A stale claim may already have reached Meta: never retry/refund it speculatively.
 update public.broadcast_deliveries set status='unknown',reason='worker_interrupted',updated_at=clock_timestamp() where broadcast_id=b.id and status='claimed';
 insert into public.broadcast_runs(broadcast_id,lease,locked_until,actor_id) values(b.id,token,clock_timestamp()+interval '90 seconds',p_actor)
 on conflict(broadcast_id) do update set lease=excluded.lease,locked_until=excluded.locked_until,actor_id=excluded.actor_id,updated_at=clock_timestamp();
 update public.broadcasts set status='sending',started_at=coalesce(started_at,clock_timestamp()),last_error=null where id=b.id;
 return token;
end $$;

-- DB boundary mirrors the conservative service policy and uses the database clock.
create or replace function public.broadcast_recipient_reason(p_broadcast uuid,p_customer uuid) returns text
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare b public.broadcasts;c public.customers;t public.tenants;ev public.broadcast_messaging_events;
begin
 select * into b from public.broadcasts where id=p_broadcast;
 select * into c from public.customers where id=p_customer;
 select * into t from public.tenants where id=b.tenant_id;
 if b.id is null or c.id is null or c.tenant_id is distinct from b.tenant_id or t.is_active is distinct from true then return 'scope_unavailable';end if;
 if b.audience_window<>'within_24h' or b.message_tag is not null then return 'unsupported_channel';end if;
 if c.agent_opted_out is null then return 'consent_unknown';end if;
 if c.agent_opted_out then return 'opted_out';end if;
 -- Inbox pause/handoff/closed controls auto-replies, not owner-confirmed broadcasts.
 -- Consent, audience membership and verified inbound evidence still apply below.
 if cardinality(b.audience_tags)>0 and not(c.tags&&b.audience_tags) then return 'audience_changed';end if;
 if b.audience_segment='pending_payment' and not exists(select 1 from public.orders where tenant_id=b.tenant_id and customer_id=c.id and status='pending_payment') then return 'audience_changed';end if;
 if b.audience_segment='paid_before' and not exists(select 1 from public.orders where tenant_id=b.tenant_id and customer_id=c.id and status in ('paid','shipped')) then return 'audience_changed';end if;
 select * into ev from public.broadcast_messaging_events where tenant_id=b.tenant_id and customer_id=c.id and page_id=t.page_id and kind='inbound_message' order by interacted_at desc limit 1;
 if not found then return 'missing_interaction';end if;
 if ev.interacted_at>clock_timestamp() then return 'invalid_interaction';end if;
 if ev.interacted_at<=clock_timestamp()-interval '24 hours' then return 'outside_window';end if;
 return 'eligible';
end $$;

create or replace function public.claim_broadcast_recipient(p_broadcast uuid,p_customer uuid,p_lease uuid) returns text
language plpgsql security definer set search_path=pg_catalog,public as $$
declare b public.broadcasts;why text;m integer;u integer;
begin
 select * into b from public.broadcasts where id=p_broadcast for update;
 if not exists(select 1 from public.broadcast_runs where broadcast_id=b.id and lease=p_lease and locked_until>clock_timestamp()) then raise exception 'Expired lease' using errcode='40001';end if;
 if exists(select 1 from public.broadcast_deliveries where broadcast_id=b.id and customer_id=p_customer) then return 'duplicate';end if;
 perform 1 from public.customers where id=p_customer for update;
 why:=public.broadcast_recipient_reason(b.id,p_customer);
 if why<>'eligible' then
  insert into public.broadcast_deliveries(broadcast_id,customer_id,tenant_id,status,reason,lease) values(b.id,p_customer,b.tenant_id,'skipped',why,p_lease);
  return why;
 end if;
 select monthly,topup into m,u from public.reserve_broadcast_credits(b.tenant_id,1);
 if coalesce(m,0)+coalesce(u,0)<>1 then return 'credits_exhausted';end if;
 insert into public.broadcast_deliveries(broadcast_id,customer_id,tenant_id,status,lease,monthly,topup) values(b.id,p_customer,b.tenant_id,'claimed',p_lease,m,u);
 return 'claimed';
end $$;

create or replace function public.settle_broadcast_recipient(p_broadcast uuid,p_customer uuid,p_lease uuid,p_result text,p_reason text default null,p_receipt text default null) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.broadcast_deliveries;
begin
 if p_result not in ('accepted','failed','unknown','skipped') or (p_result='accepted' and nullif(trim(p_receipt),'') is null) then raise exception 'Invalid result';end if;
 select * into d from public.broadcast_deliveries where broadcast_id=p_broadcast and customer_id=p_customer for update;
 if not found or d.lease<>p_lease or d.status<>'claimed' then return;end if;
 if p_result in ('failed','skipped') then perform public.refund_broadcast_credits(d.tenant_id,d.monthly,d.topup);end if;
 update public.broadcast_deliveries set status=p_result,reason=p_reason,provider_message_id=p_receipt,
  accepted_at=case when p_result='accepted' then clock_timestamp() else null end,updated_at=clock_timestamp() where broadcast_id=p_broadcast and customer_id=p_customer;
end $$;

create or replace function public.begin_broadcast_transport(p_broadcast uuid,p_customer uuid,p_lease uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare why text;
begin
 if not exists(select 1 from public.broadcast_runs where broadcast_id=p_broadcast and lease=p_lease and locked_until>clock_timestamp()) then return false;end if;
 if not exists(select 1 from public.broadcast_runs r join public.broadcasts b on b.id=r.broadcast_id where r.broadcast_id=p_broadcast and r.lease=p_lease and
  (exists(select 1 from public.platform_admins where user_id=r.actor_id) or exists(select 1 from public.tenant_members where tenant_id=b.tenant_id and user_id=r.actor_id and role='owner'))) then
  perform public.settle_broadcast_recipient(p_broadcast,p_customer,p_lease,'skipped','owner_access_changed');return false;end if;
 perform 1 from public.broadcast_deliveries where broadcast_id=p_broadcast and customer_id=p_customer and lease=p_lease and status='claimed' and transport_started_at is null for update;
 if not found then return false;end if;
 perform 1 from public.customers where id=p_customer for update;
 why:=public.broadcast_recipient_reason(p_broadcast,p_customer);
 if why<>'eligible' then perform public.settle_broadcast_recipient(p_broadcast,p_customer,p_lease,'skipped',why);return false;end if;
 update public.broadcast_deliveries set transport_started_at=clock_timestamp() where broadcast_id=p_broadcast and customer_id=p_customer;
 return true;
end $$;

revoke all on function public.claim_broadcast_run(uuid,uuid),public.broadcast_recipient_reason(uuid,uuid),public.claim_broadcast_recipient(uuid,uuid,uuid),public.settle_broadcast_recipient(uuid,uuid,uuid,text,text,text),public.begin_broadcast_transport(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_broadcast_run(uuid,uuid),public.broadcast_recipient_reason(uuid,uuid),public.claim_broadcast_recipient(uuid,uuid,uuid),public.settle_broadcast_recipient(uuid,uuid,uuid,text,text,text),public.begin_broadcast_transport(uuid,uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
