# Performance review and changes

This is a source review and local regression validation, not a measurement of the deployed Supabase CPU. No production schema, scheduler or database was changed automatically.

## Findings addressed

1. Background request overlap: Follow-up, handover, Payment Pro, receiving codes and slip credits could refresh while a previous request was still running. Their shared scheduler now serializes work, coalesces events with a 3-second minimum start gap, pauses hidden tabs, aborts on unmount, and exponentially backs off rejected requests from 30 seconds to 5 minutes. Polling is 60 seconds for handover/payment screens and 120 seconds for follow-up/slip credits. Handover's existing refresh function handles its own errors, so its scheduler retains the 60-second safety poll rather than treating those handled failures as rejected requests.
2. Cron overlap: authenticated follow-up, vision, agent recovery, window expiry, payment recovery and Facebook queue routes share active calls per task in each process. Entries are removed on success and failure. Existing database claims/leases remain authoritative across processes/instances; this is not a distributed scheduler lock or exactly-once guarantee.
3. Duplicate AI catalog queries: `aiReply` loaded products even though the mandatory managed builder loaded the catalog again. The unused legacy query and prompt builder were removed; grounding, quota and draft behavior still use the managed context.
4. Unbounded accumulation: broadcast bulk scans now fail explicitly at 100,000 rows; AI catalog preparation has a 10,000-row scan ceiling and a 500,000-character context ceiling before quota reservation. These limits return errors/handoff rather than silently using incomplete facts. AI still pages products in batches of 100.
5. Keyword execution: active-rule queries now explicitly order and limit to 20 records, matching the supported paid-package ceiling. Existing historical excess records remain available for management but are not all scanned during automatic replies.
6. Shared server-page LiveRefresh now coalesces event storms with a 5-second minimum gap, pauses while hidden, and applies one pending refresh when the tab becomes visible. This reduces repeated full server-render queries on dashboard pages.

## Existing protections verified

Inbox message/thread snapshots have limits and reconcile Realtime events. Inbox metadata is scoped to loaded customers in bounded batches. Broadcast evidence is Page scoped and limits previews to the recent window. Webhook echoes cannot enter automatic reply logic; signed events are deduplicated in the durable queue. Workers stop on empty queues or their event/deadline budget. Follow-up and Vision dispatches use durable database claims; uncertain external results are retained for review rather than automatically resent. Timers, channels and background abort signals are cleaned up on unmount.

## Index/deployment review

Use `supabase/inbox-load-indexes.sql` for the reviewed chat, read-marker, evidence and message-ID lookup indexes. Relevant job indexes are already defined in `smart-follow-ups.sql`, `ai-vision.sql`, `facebook-webhook-queue.sql`, and `inbox-messenger-window.sql`; confirm those migrations and indexes exist in the deployed database before adding duplicates. Index scripts were not applied remotely. Build large-table indexes concurrently outside a transaction with the DBA, or use a quiet maintenance period.

Deploy code and restart the server. Configure each scheduler once at its documented cadence; duplicate cron providers still generate authenticated traffic even when work coalesces locally. Compare Supabase Query Performance/CPU, query counts and request latency before/after rollout. Investigate long-running queries/lock waits and pending/dead/review queues separately. Do not run historical repair SQL repeatedly as a polling job.

Validation covers serialized refreshes, hidden tabs, failure backoff, abort/timer cleanup, cron coalescing/recovery, scan ceilings, AI grounding/quota/drafts, and the affected payment/vision/Inbox paths. Provider calls are mocked; no live messages were sent.
