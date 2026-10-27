-- Run LAST after facebook-message-window.sql, broadcast-policy.sql,
-- follow-up-simplified.sql and follow-up-manual-dispatch-fix.sql. Rerunnable.
-- All clocks are timestamptz instants; 86400 seconds is exactly 24 elapsed hours.
begin;
alter table public.customers add column if not exists last_interaction_at timestamptz;
alter table public.customers add column if not exists window_expires_at timestamptz;

-- persist_facebook_webhook_record updates last_interaction_at from the signed
-- Meta event timestamp in the same transaction as the inbound message INSERT.
create or replace function public.sync_facebook_customer_window() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.platform='facebook' then
  new.window_expires_at:=case when new.last_interaction_at is null then null
   else new.last_interaction_at+interval '86400 seconds' end;
 end if;
 return new;
end $$;
drop trigger if exists customers_facebook_window on public.customers;
create trigger customers_facebook_window before insert or update of last_interaction_at
 on public.customers for each row execute function public.sync_facebook_customer_window();

-- Keep the cache in sync when verified inbound evidence is saved/backfilled too.
create or replace function public.sync_facebook_evidence_window() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.kind='inbound_message' and new.interacted_at<=clock_timestamp() then
  update public.customers c set last_interaction_at=new.interacted_at
  from public.tenants t where c.id=new.customer_id and c.tenant_id=new.tenant_id
   and c.platform='facebook' and t.id=c.tenant_id and t.page_id=new.page_id
   and (c.last_interaction_at is null or c.last_interaction_at<new.interacted_at);
 end if;
 return new;
end $$;
drop trigger if exists broadcast_inbound_customer_window on public.broadcast_messaging_events;
create trigger broadcast_inbound_customer_window after insert or update
 on public.broadcast_messaging_events for each row execute function public.sync_facebook_evidence_window();

-- Historical outgoing messages/profile edits never establish a Messenger window.
update public.customers c set
 last_interaction_at=(select max(e.interacted_at) from public.broadcast_messaging_events e
  join public.tenants t on t.id=e.tenant_id and t.page_id=e.page_id
  where e.tenant_id=c.tenant_id and e.customer_id=c.id and e.kind='inbound_message'
   and e.interacted_at<=clock_timestamp())
where c.platform='facebook';

-- The cache alone is not proof: bind it to the active tenant's current Page and
-- verified inbound evidence. Missing, future or exact-boundary clocks are closed.
create or replace function public.follow_up_window_expires_at(p_tenant uuid,p_customer uuid)
returns timestamptz language sql stable security definer set search_path=pg_catalog,public as $$
 select least(c.window_expires_at,e.inbound_at+interval '86400 seconds')
 from public.customers c join public.tenants t on t.id=c.tenant_id and t.is_active
 cross join lateral (select max(b.interacted_at) inbound_at from public.broadcast_messaging_events b
  where b.tenant_id=t.id and b.customer_id=c.id and b.page_id=t.page_id and b.kind='inbound_message') e
 where c.id=p_customer and c.tenant_id=p_tenant and c.platform='facebook'
  and c.window_expires_at is not null and c.last_interaction_at<=statement_timestamp()
  and e.inbound_at<=statement_timestamp()
$$;
create or replace function public.follow_up_window_open(p_tenant uuid,p_customer uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(public.follow_up_window_expires_at(p_tenant,p_customer)>statement_timestamp(),false)
$$;

-- Cancellation after a prepared dispatch releases reserved credits and the Inbox
-- lease, just like a confirmed provider refusal. It never marks a message sent.
create or replace function public.complete_follow_up(p_job uuid,p_claim uuid,p_result text,p_provider text default null,p_reason text default null) returns boolean
language plpgsql set search_path=pg_catalog,public as $$
declare j public.follow_up_jobs;
begin
 select * into j from public.follow_up_jobs where id=p_job;
 if not found then return false;end if;
 perform 1 from public.tenants where id=j.tenant_id for update;
 perform 1 from public.customers where id=j.customer_id for update;
 select * into j from public.follow_up_jobs where id=p_job for update;
 if j.status<>'processing' or j.claim_token is distinct from p_claim or j.dispatch_started_at is null then return false;end if;
 if p_result is null or p_result not in ('sent','failed','requires_review','cancelled')
 or (p_result='sent' and nullif(trim(p_provider),'') is null)
 or (p_result='cancelled' and (p_reason is distinct from 'outside_24h_window' or p_provider is not null)) then
  raise exception 'Invalid delivery outcome or missing provider receipt' using errcode='22023';end if;
 if p_result in ('failed','cancelled') or p_result='requires_review' and p_reason='window_closed' then
  perform public.refund_broadcast_credits(j.tenant_id,j.reserved_monthly,j.reserved_topup);end if;
 update public.messages set delivery_status=case when p_result='sent' then 'sent'
  when p_result in ('failed','cancelled') or p_reason='window_closed' then 'failed' else 'unknown' end,
  provider_message_id=p_provider where id=j.message_id;
 update public.follow_up_jobs set status=p_result,reason=p_reason,provider_message_id=p_provider,
  sent_at=case when p_result='sent' then now() else null end,claim_token=null,claim_until=null,
  reserved_monthly=0,reserved_topup=0 where id=j.id;
 perform public.end_inbox_delivery(j.customer_id,j.delivery_lease);
 return true;
end $$;

-- Run before token/profile/credit work so a due, expired job is cancelled even
-- when automation is paused or its Page token is unavailable.
create or replace function public.expire_follow_up_if_outside_window(p_job uuid,p_claim uuid) returns boolean
language plpgsql set search_path=pg_catalog,public as $$
declare j public.follow_up_jobs;
begin
 select * into j from public.follow_up_jobs where id=p_job;
 if not found then return false;end if;
 perform 1 from public.tenants where id=j.tenant_id for update;
 perform 1 from public.customers where id=j.customer_id for update;
 select * into j from public.follow_up_jobs where id=p_job for update;
 if j.status<>'processing' or j.claim_token is distinct from p_claim or j.claim_until<=clock_timestamp()
 or j.dispatch_started_at is not null then return false;end if;
 if public.follow_up_window_open(j.tenant_id,j.customer_id) then return false;end if;
 update public.follow_up_jobs set status='cancelled',reason='outside_24h_window',claim_token=null,claim_until=null where id=j.id;
 return true;
end $$;

revoke all on function public.sync_facebook_customer_window(),public.sync_facebook_evidence_window() from public,anon,authenticated,service_role;
revoke all on function public.follow_up_window_expires_at(uuid,uuid),public.follow_up_window_open(uuid,uuid),public.complete_follow_up(uuid,uuid,text,text,text),public.expire_follow_up_if_outside_window(uuid,uuid) from public,anon,authenticated;
grant execute on function public.follow_up_window_expires_at(uuid,uuid),public.follow_up_window_open(uuid,uuid),public.complete_follow_up(uuid,uuid,text,text,text),public.expire_follow_up_if_outside_window(uuid,uuid) to service_role;

-- Dispatch functions are defined below so installing this file alone updates both gates.
create or replace function public.prepare_follow_up(p_job uuid,p_claim uuid) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
<<preflight>>
declare j public.follow_up_jobs;c public.customers;w public.follow_up_workflows;t public.tenants;o public.orders;
 reason text;next_status text:='cancelled';reservation record;lease uuid;msg uuid;rendered text;product text;total numeric;
begin
 select * into j from public.follow_up_jobs where id=p_job;
 if not found then return jsonb_build_object('status','skipped');end if;
 -- Consistent tenant -> customer -> job order, also used by completion. Customer triggers lock jobs.
 select * into t from public.tenants where id=j.tenant_id for update;
 select * into c from public.customers where id=j.customer_id for update;
 if j.order_id is not null then perform 1 from public.orders where id=j.order_id and tenant_id=j.tenant_id and customer_id=j.customer_id for update;end if;
 select * into j from public.follow_up_jobs where id=p_job for update;
 if j.status<>'processing' or j.claim_token is distinct from p_claim or j.claim_until<=clock_timestamp() or j.dispatch_started_at is not null then return jsonb_build_object('status','skipped');end if;
 if j.run_at>clock_timestamp() then
  update public.follow_up_jobs set status='pending',reason='not_due',claim_token=null,claim_until=null,attempts=greatest(0,attempts-1) where id=j.id;
  return jsonb_build_object('status','deferred','reason','not_due');
 end if;
 select * into w from public.follow_up_workflows where id=j.workflow_id and tenant_id=j.tenant_id;
 if c.id is null or c.tenant_id is distinct from j.tenant_id or w.id is null then reason:='invalid_reference';
 elsif not public.has_tenant_feature(j.tenant_id,'customer_follow_up') or (j.kind<>'payment' or w.use_ai) and not public.has_tenant_feature(j.tenant_id,'ai_agent') then reason:='plan_required';
 elsif not j.manual_without_order and (not w.enabled or not t.auto_reply_enabled) then reason:='disabled';
 elsif w.version<>j.workflow_version then reason:='workflow_changed';
 elsif c.followup_opted_out then reason:='opt_out';
 elsif c.contact_suspended then reason:='contact_suspended';
 elsif not c.bot_enabled or c.assigned_user_id is not null or c.conversation_status='closed' then reason:='handover';
 elsif (w.stop_on_reply or j.kind='interested') and c.inbound_seq>j.source_seq then reason:='customer_replied';end if;
 if reason is null and j.kind in ('payment','after_sales') and not j.manual_without_order then
  select * into o from public.orders where id=j.order_id and tenant_id=j.tenant_id and customer_id=j.customer_id;
  if not found then reason:='invalid_reference';
  elsif o.status='cancelled' then reason:='order_cancelled';
  elsif j.kind='payment' and o.status<>'pending_payment' then reason:='paid';
  elsif j.kind='payment' and o.confirmed_at is null then reason:='order_unconfirmed';next_status:='requires_review';
  elsif j.kind='payment' and exists(select 1 from public.slips where tenant_id=j.tenant_id and customer_id=c.id and created_at>=o.created_at) then reason:='slip_received';next_status:='requires_review';
  elsif j.kind='after_sales' and (o.status<>'shipped' or not exists(select 1 from public.order_delivery_events where order_id=o.id and tenant_id=j.tenant_id and delivered_at<=clock_timestamp())) then reason:='invalid_reference';end if;
  product:=o.product_name;total:=o.amount;
 elsif reason is null and j.kind='interested' and not j.manual_without_order then
  select name,price into product,total from public.products where id=j.product_id and tenant_id=j.tenant_id and is_active;
  if not found or not exists(select 1 from public.messages where id=j.source_message_id and customer_id=c.id and sender='customer') then reason:='invalid_reference';
  elsif exists(select 1 from public.orders where tenant_id=j.tenant_id and customer_id=c.id and created_at>=j.anchor_at) then reason:='new_order';end if;
 end if;
 if reason is null and not public.follow_up_window_open(j.tenant_id,j.customer_id) then reason:='outside_24h_window';next_status:='cancelled';end if;
 if reason is null and (w.use_ai or j.manual_without_order) and not j.ai_approved then reason:='ai_draft';next_status:='requires_review';end if;
 if reason is not null then
  update public.follow_up_jobs set status=next_status,reason=preflight.reason,claim_token=null,claim_until=null where id=j.id;
  return jsonb_build_object('status',next_status,'reason',reason);
 end if;
 if c.outbound_lock_until>clock_timestamp() then
  update public.follow_up_jobs set status='pending',reason='delivery_busy',run_at=clock_timestamp()+interval '1 minute',attempts=greatest(0,attempts-1),claim_token=null,claim_until=null where id=j.id;return jsonb_build_object('status','deferred');
 end if;
 if exists(select 1 from public.messages where external_id='followup:'||j.id::text) then
  update public.follow_up_jobs set status='requires_review',reason='delivery_unknown',claim_token=null,claim_until=null where id=j.id;return jsonb_build_object('status','requires_review');
 end if;
 select * into reservation from public.reserve_broadcast_credits(j.tenant_id,1);
 if reservation.monthly+reservation.topup<>1 then
  update public.follow_up_jobs set status='requires_review',reason='quota_exhausted',claim_token=null,claim_until=null where id=j.id;return jsonb_build_object('status','requires_review','reason','quota_exhausted');
 end if;
 -- The lease blocks Inbox claim/transfer while the network request is in flight.
 lease:=public.start_inbox_delivery(c.id,null);
 rendered:=public.render_smart_follow_up(j.text,c.display_name,product,total);
 insert into public.messages(customer_id,sender,external_id,body,delivery_status) values(c.id,'bot','followup:'||j.id::text,rendered,'pending') returning id into msg;
 update public.follow_up_jobs set dispatch_started_at=clock_timestamp(),message_id=msg,delivery_lease=lease,reserved_monthly=reservation.monthly,reserved_topup=reservation.topup where id=j.id;
 return jsonb_build_object('status','ready','text',rendered,'customerId',c.id,'psid',c.platform_user_id,'tenantId',j.tenant_id,'messageId',msg);
end $$;
create or replace function public.authorize_follow_up_dispatch(p_job uuid,p_claim uuid) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare j public.follow_up_jobs;c public.customers;o public.orders;t public.tenants;
 w public.follow_up_workflows;block_reason text;next_status text:='cancelled';
begin
 select * into j from public.follow_up_jobs where id=p_job;
 if not found then return jsonb_build_object('status','skipped','reason','invalid_reference');end if;
 -- Lock orders before jobs, matching the order-status trigger's order -> jobs order.
 select * into t from public.tenants where id=j.tenant_id for update;
 select * into c from public.customers where id=j.customer_id for update;
 if j.order_id is not null then
   select * into o from public.orders where id=j.order_id and tenant_id=j.tenant_id and customer_id=j.customer_id for update;
 end if;
 select * into j from public.follow_up_jobs where id=p_job for update;
 if j.status<>'processing' or j.claim_token is distinct from p_claim or j.dispatch_started_at is null or j.send_authorized_at is not null then
   return jsonb_build_object('status','skipped','reason','dispatch_not_available');
 end if;
 select * into w from public.follow_up_workflows where id=j.workflow_id and tenant_id=j.tenant_id;
 if c.id is null or c.tenant_id is distinct from j.tenant_id or w.id is null then block_reason:='invalid_reference';
 elsif j.claim_until<=clock_timestamp() then block_reason:='claim_expired';next_status:='requires_review';
 elsif j.run_at>clock_timestamp() then block_reason:='not_due';next_status:='requires_review';
 elsif not public.has_tenant_feature(j.tenant_id,'customer_follow_up') or (j.kind<>'payment' or w.use_ai) and not public.has_tenant_feature(j.tenant_id,'ai_agent') then block_reason:='plan_required';
 elsif not j.manual_without_order and (not w.enabled or not t.auto_reply_enabled) then block_reason:='disabled';
 elsif w.version<>j.workflow_version then block_reason:='workflow_changed';
 elsif c.followup_opted_out then block_reason:='opt_out';
 elsif c.contact_suspended then block_reason:='contact_suspended';
 elsif not c.bot_enabled or c.assigned_user_id is not null or c.conversation_status='closed' then block_reason:='handover';
 elsif (w.stop_on_reply or j.kind='interested') and c.inbound_seq>j.source_seq then block_reason:='customer_replied';
 end if;
 if block_reason is null and j.kind='payment' and not j.manual_without_order then
   if o.id is null then block_reason:='invalid_reference';
   elsif o.status='cancelled' then block_reason:='order_cancelled';
   elsif o.status<>'pending_payment' then block_reason:='paid';
   elsif o.confirmed_at is null then block_reason:='order_unconfirmed';next_status:='requires_review';
   elsif exists(select 1 from public.slips where tenant_id=j.tenant_id and customer_id=j.customer_id and created_at>=o.created_at) then block_reason:='slip_received';next_status:='requires_review';
   end if;
 end if;
 if block_reason is null and j.manual_without_order and not j.ai_approved then block_reason:='ai_draft';next_status:='requires_review';end if;
 if block_reason is null and not public.follow_up_window_open(j.tenant_id,j.customer_id) then block_reason:='outside_24h_window';next_status:='cancelled';end if;
 if block_reason is not null then
   if not public.complete_follow_up(j.id,p_claim,'failed',null,block_reason) then return jsonb_build_object('status','skipped');end if;
   update public.follow_up_jobs set status=next_status,reason=block_reason where id=j.id;
   insert into public.follow_up_execution_logs(tenant_id,job_id,status,reason) values(j.tenant_id,j.id,'precheck_blocked',block_reason);
   return jsonb_build_object('status',next_status,'reason',block_reason);
 end if;
 update public.follow_up_jobs set send_authorized_at=clock_timestamp() where id=j.id;
 insert into public.follow_up_execution_logs(tenant_id,job_id,status,reason)
 values(j.tenant_id,j.id,'precheck_passed',case when j.kind='payment' then 'unpaid_confirmed' else 'eligibility_confirmed' end);
 return jsonb_build_object('status','ready','windowExpiresAt',public.follow_up_window_expires_at(j.tenant_id,j.customer_id));
end $$;

revoke all on function public.prepare_follow_up(uuid,uuid),public.authorize_follow_up_dispatch(uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_follow_up(uuid,uuid),public.authorize_follow_up_dispatch(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;



