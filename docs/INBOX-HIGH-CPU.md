# Inbox database load

Changes in this revision:

- `/api/inbox/state` previously paged through every customer and every read marker on each refresh. It now accepts up to 500 validated `customerIds`, still enforces tenant authorization, and fetches read markers only for returned customers. Without explicit IDs it returns the latest 150 conversations. The Inbox requests metadata only for conversations already loaded in the UI, in sequential batches if more than 500 were loaded. This is not a global conversation-count endpoint.
- State events coalesce for at least 5 seconds between background requests. Realtime message payloads still update the active thread immediately. Safety polling remains every 2 minutes when connected and every 30 seconds offline; hidden tabs do not poll.
- Broadcast preview evidence now reads only the current 24h history for the selected Page, instead of every historical event. Per-recipient transport checks still query the newest event for that recipient. Missing recent evidence excludes a recipient; it does not fall back to outgoing timestamps.
- Webhook ingress callbacks share a single queue drain per server process. Database leases still handle cron and separate instances. Empty queues terminate, workers have event/time limits, retries back off with an 8-attempt cap, and echoes cannot trigger replies. No unbounded write/reply loop was identified.

Apply `supabase/inbox-load-indexes.sql` to add the targeted list/thread/read/evidence/queue lookup indexes. Index creation takes locks; use a quiet period or have a DBA build them concurrently outside a transaction on a large production database. The script does not run on production automatically.

AI catalog and knowledge construction is event-driven when generating a reply, not a polling loop. Active products are paged in batches of 100; the full catalog is intentionally retained to meet the AI context requirement. Large catalogs can still be expensive; profile real query timings before changing the knowledge scope.

The repository changes identify expensive patterns, not the measured cause of a live CPU incident. After deployment compare Supabase Query Performance, connection counts and request rate. Inspect applied indexes with `select tablename,indexname,indexdef from pg_indexes where schemaname='public' and tablename in ('customers','messages','conversation_reads','broadcast_messaging_events','facebook_webhook_events');`. Check pending/processing/review queue totals using the existing delivery diagnostics. Do not repeatedly run the historical repair migration as a polling job.
