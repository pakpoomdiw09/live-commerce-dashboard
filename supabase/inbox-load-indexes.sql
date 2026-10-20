-- Targeted indexes only; apply outside peak traffic. For very large tables,
-- have the DBA create these with CONCURRENTLY outside a transaction instead.
create index if not exists inbox_customers_recent on public.customers
 (tenant_id,last_message_at desc nulls last,id desc);
-- Reuse the name/definition in dashboard-performance.sql to avoid a duplicate.
create index if not exists overview_messages_latest on public.messages
 (customer_id,created_at desc,id desc) include(sender);
create index if not exists inbox_recent_inbound on public.messages
 (created_at desc,id desc) where sender='customer';
create index if not exists inbox_slips_recent on public.slips
 (tenant_id,customer_id,created_at desc);
create index if not exists inbox_comments_recent on public.comments
 (tenant_id,created_at desc);
create index if not exists inbox_reads_by_user on public.conversation_reads
 (user_id,customer_id) include(read_seq);
create index if not exists broadcast_page_recent on public.broadcast_messaging_events
 (tenant_id,page_id,kind,interacted_at desc,event_id);
create index if not exists broadcast_customer_recent on public.broadcast_messaging_events
 (tenant_id,page_id,customer_id,kind,interacted_at desc,event_id);
create index if not exists facebook_webhook_message_id_lookup on public.facebook_webhook_events
 (page_id,((payload->'message')->>'mid')) where kind='message';
