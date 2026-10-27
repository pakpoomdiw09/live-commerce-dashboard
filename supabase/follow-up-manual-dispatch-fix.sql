-- Apply after follow-up-simplified.sql. Fixes manual follow-ups blocked by the chatbot switch.
-- No existing job is replayed or approved. Review/approve manual drafts in the Dashboard.
-- Apply LAST after smart-follow-up-presend.sql and manual-follow-ups.sql.
-- Requires broadcast-policy.sql / facebook-message-window.sql for verified inbound events.
-- No sends are performed by this migration. Legacy policy columns remain for rollback only.
begin;
create or replace function public.follow_up_window_open(p_tenant uuid,p_customer uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.customers c join public.tenants t on t.id=c.tenant_id
 where c.id=p_customer and c.tenant_id=p_tenant and t.is_active and
 (c.platform<>'facebook' or (select max(e.interacted_at) from public.broadcast_messaging_events e
 where e.tenant_id=t.id and e.customer_id=c.id and e.page_id=t.page_id and e.kind='inbound_message')
 >statement_timestamp()-interval '24 hours' and (select max(e.interacted_at) from public.broadcast_messaging_events e
 where e.tenant_id=t.id and e.customer_id=c.id and e.page_id=t.page_id and e.kind='inbound_message')<=statement_timestamp()))
$$;
revoke all on function public.follow_up_window_open(uuid,uuid) from public,anon,authenticated;
grant execute on function public.follow_up_window_open(uuid,uuid) to service_role;
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
 if reason is null and not public.follow_up_window_open(j.tenant_id,j.customer_id) then reason:='window_closed';next_status:='requires_review';end if;
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
 if block_reason is null and not public.follow_up_window_open(j.tenant_id,j.customer_id) then block_reason:='window_closed';next_status:='requires_review';end if;
 if block_reason is not null then
   if not public.complete_follow_up(j.id,p_claim,'failed',null,block_reason) then return jsonb_build_object('status','skipped');end if;
   update public.follow_up_jobs set status=next_status,reason=block_reason where id=j.id;
   insert into public.follow_up_execution_logs(tenant_id,job_id,status,reason) values(j.tenant_id,j.id,'precheck_blocked',block_reason);
   return jsonb_build_object('status',next_status,'reason',block_reason);
 end if;
 update public.follow_up_jobs set send_authorized_at=clock_timestamp() where id=j.id;
 insert into public.follow_up_execution_logs(tenant_id,job_id,status,reason)
 values(j.tenant_id,j.id,'precheck_passed',case when j.kind='payment' then 'unpaid_confirmed' else 'eligibility_confirmed' end);
 return jsonb_build_object('status','ready');
end $$;

revoke all on function public.prepare_follow_up(uuid,uuid),public.authorize_follow_up_dispatch(uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_follow_up(uuid,uuid),public.authorize_follow_up_dispatch(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;

