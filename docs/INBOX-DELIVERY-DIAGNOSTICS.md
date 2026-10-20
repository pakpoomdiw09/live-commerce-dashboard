# Inbox delivery diagnostics

Webhook HTTP 200 means the signed payload was committed to the durable queue. The worker then writes `messages` and updates `customers.last_message_at` atomically using `persist_facebook_webhook_record`. It does not mean automation has finished.

Follow server logs in this order:

- `[facebook-webhook/ingress] queued`: receipt ID, total events and newly accepted events. Zero accepted can mean a duplicate delivery.
- `[facebook-webhook/worker] record persisted`: event ID, Page, tenant, record ID and duplicate/ignored flags. Ignored events include receipts, echoes and invalid inbound messages.
- `no active tenant for Page`: check `tenants.page_id` and `is_active`; an unassigned message cannot appear in a tenant Inbox.
- `record persistence failed`: database error code and event ID.
- `[facebook-webhook/worker] drain complete`: completed, retry, dead and review counts.

No queued log: inspect HTTP status and signature/input errors. Confirm `FB_APP_SECRET` and the verification token in the deployment. Never log secrets or raw customer payloads.

Apply `supabase/facebook-webhook-queue.sql` and its message-window upgrade as described in `FACEBOOK-WEBHOOK-QUEUE.md`. Schedule authenticated `/api/cron/facebook-webhooks` calls every minute so retries and queued work survive process restarts. A `dead` or `requires_review` event blocks later events for that customer by design; inspect checkpoints before resolving it to avoid duplicate outgoing actions.

Read-only queue checks in Supabase SQL Editor:

```sql
select status, count(*), min(created_at) as oldest
from public.facebook_webhook_events group by status;

select id, page_id, status, attempts, last_error, created_at
from public.facebook_webhook_events
where status <> 'completed' order by sequence limit 100;

select tablename from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public';
```

Realtime requires `customers`, `messages`, `comments`, `slips` in the publication and tenant read access through RLS. Apply `supabase/inbox-realtime.sql` if publication entries are missing. Do not disable RLS. The browser also refreshes on mount, reconnect and returning to the tab. Safety polling runs every 2 minutes with a subscribed channel, or every 30 seconds while disconnected, and pauses in hidden tabs. Browser Console logs identify conversation, comments, slips and thread query errors independently.

Local verification uses mocked services and PGlite; it does not confirm the deployed Meta subscription, scheduler, environment, publication or database state. Send a real inbound message after deployment and correlate the queue and persistence logs with the Inbox.

Run the read-only sections in `supabase/inbox-delivery-diagnostics.sql` for publication flags, replica identity, primary keys, queue checkpoints, blocked events, persisted rows, RLS and triggers. Its optional transaction tests reads as a specific staff user; replace both UUIDs first.

This app uses Postgres Changes, not a custom Broadcast event: committed inserts/updates are replicated by Supabase. `customers` is the conversation table; `conversation_reads` drives staff read markers. Publish all five tables, including `conversation_reads` (added by `smart-inbox.sql`). `DEFAULT` replica identity with a primary key is sufficient for new-message inserts. `FULL` is only needed if consumers require previous non-key values, which this Inbox does not. See https://supabase.com/docs/guides/realtime/postgres-changes.

Browser Console now reports connection status in production. `SUBSCRIBED` confirms channel subscription, not successful replication or tenant row visibility. Check Network for the `/realtime/v1/websocket` connection, and check REST requests for errors or empty results. Realtime reconnection is managed by the Supabase client; mount/reconnect/visibility/online recovery and safety polling also fetch snapshots. Verify that the deployed browser and webhook use the same Supabase project, and rebuild after changing `NEXT_PUBLIC_SUPABASE_*` values.

## Database load changes

- Known customer events update state from the Realtime payload instead of requerying the customer with message/slip joins. Concurrent discovery queries for a new customer share one request.
- Recovery snapshots no longer query the selected customer twice when already included in the snapshot.
- Inbox state events debounce for 800 ms, serialize background requests and replay a pending refresh after an in-flight request. Safety polling uses the same 2-minute/live and 30-second/offline policy as the thread.
- Filter metadata and workspace safety polls run every 2 minutes while visible. Metadata requests cannot overlap. Message bursts trigger one delayed workspace refresh instead of an immediate and a delayed request.
- Successful client expiry writes stop; only failures retry with exponential backoff capped at 30 seconds.
- The Facebook worker exits when the queue has no claimable work, and is bounded by 20 events / 240 seconds by default. Database retries have backoff and an 8-attempt cap; review/dead events block later work for that customer. Heartbeats every 20 seconds keep active leases valid and should not be removed.

These changes reduce requests, but do not establish the cause of live High CPU. Compare Supabase Query Performance before/after deployment. Check whether the latest-message and tenant-list indexes from `supabase/dashboard-performance.sql` are installed before considering further query changes; that migration also contains unrelated dashboard functions and is not a diagnostic script.
