-- Update existing installations after broadcast-policy.sql. No customer data is changed.
-- Inbox pause/closed states are not recipient opt-out; retain every other eligibility gate.
begin;
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

revoke execute on function public.broadcast_recipient_reason(uuid,uuid) from public,anon,authenticated;
grant execute on function public.broadcast_recipient_reason(uuid,uuid) to service_role;
commit;
