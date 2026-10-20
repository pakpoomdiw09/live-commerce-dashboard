-- Apply after broadcast-policy.sql, facebook-webhook-queue.sql and
-- facebook-message-window.sql. Only signed queue-backed messages open a window.
begin;
create index if not exists facebook_webhook_message_id_lookup on public.facebook_webhook_events
 (page_id,((payload->'message')->>'mid')) where kind='message';
create or replace function public.sync_broadcast_inbound_message() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.sender<>'customer' or new.external_id is null then return new;end if;
 insert into public.broadcast_messaging_events(tenant_id,customer_id,event_id,page_id,kind,interacted_at)
 select c.tenant_id,c.id,new.external_id,t.page_id,'inbound_message',new.created_at
 from public.customers c join public.tenants t on t.id=c.tenant_id
 where c.id=new.customer_id and c.platform='facebook' and t.is_active
 and exists(select 1 from public.facebook_webhook_events e
  where e.kind='message' and e.page_id=t.page_id
   and e.payload->'message'->>'mid'=new.external_id
   and e.payload->'sender'->>'id'=c.platform_user_id
   and public.facebook_inbound_message_at(e.payload,e.page_id,e.created_at)=new.created_at)
 on conflict(tenant_id,event_id) do nothing;
 return new;
end $$;
revoke all on function public.sync_broadcast_inbound_message() from public,anon,authenticated,service_role;
drop trigger if exists broadcast_inbound_message_sync on public.messages;
create trigger broadcast_inbound_message_sync after insert on public.messages
for each row execute function public.sync_broadcast_inbound_message();
-- Repair only recent incoming records corroborated by the signed durable queue.
-- Never infer inbound activity from last_message_at, AI replies or local imports.
insert into public.broadcast_messaging_events(tenant_id,customer_id,event_id,page_id,kind,interacted_at)
select distinct on(c.tenant_id,m.external_id) c.tenant_id,c.id,m.external_id,t.page_id,'inbound_message',m.created_at
from public.messages m join public.customers c on c.id=m.customer_id
join public.tenants t on t.id=c.tenant_id
join public.facebook_webhook_events e on e.page_id=t.page_id and e.kind='message'
 and e.payload->'message'->>'mid'=m.external_id and e.payload->'sender'->>'id'=c.platform_user_id
where m.sender='customer' and c.platform='facebook' and t.is_active
 and m.created_at>clock_timestamp()-interval '24 hours' and m.created_at<=clock_timestamp()
 and public.facebook_inbound_message_at(e.payload,e.page_id,e.created_at)=m.created_at
order by c.tenant_id,m.external_id,e.sequence
on conflict(tenant_id,event_id) do nothing;
commit;
