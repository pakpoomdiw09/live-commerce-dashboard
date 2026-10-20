# HTTP 200 with no Facebook worker claims

The route verifies the signature and calls enqueue_facebook_webhook before
acknowledging. A valid receipt must contain an ID and an accepted event count.
Failures, malformed receipts and database timeouts return 503 so Meta can retry.
An accepted count of zero can be valid: the events may already exist. Echoes,
read/delivery notifications and unsupported events are not new customer messages.

At the user's request, `[WEBHOOK RECEIVER] Payload:` now prints the parsed JSON
body immediately after the bounded body read, before signature verification.
This diagnostic includes message bodies/media URLs and can include unverified
input; it is not evidence that Meta's signature passed. Verification still uses
the exact original bytes. Raw signed payloads also remain in the service-only
facebook_webhook_payloads table for authorized investigation.

`[WEBHOOK DROP]` identifies missing configuration, invalid signatures, validation,
RPC errors (code/message/details/hint), malformed receipts, empty event collections
and duplicate deliveries. Empty/duplicate deliveries are acknowledged only after
receipt persistence. Tenant and shop-status checks do not run before enqueue.
Existing logs show enqueue latency, claims and record persistence attempts/results.

Ingress queue RPC requests have a 10-second HTTP timeout. Handler DB requests
have a 15-second timeout. These bound client waiting; an interrupted response may
still have committed, so durable event IDs and checkpoint deduplication remain
essential. The original enqueue and persist code was present, not commented out.

A coalesced active worker now runs another bounded pass when another receipt
arrives while it is finishing. Previously that wakeup could wait for the cron.
Each drain performs at most three worker passes; scheduled authenticated cron
processing remains required for delayed retries, restarts and large backlogs.

Run section 2 of supabase/inbox-delivery-diagnostics.sql in SQL Editor. Inspect
the latest events, available_at, lease_until and blocked_by_older_event. Older
requires_review/dead events blocked later events in the original sequential queue.
Apply facebook-webhook-nonblocking.sql to skip those terminal jobs; only pending
and processing jobs remain ordering barriers with the updated worker/RPCs.
After a CPU outage, expired leases can require review if an external side effect
had already started. Do not blindly reset/replay those rows: an earlier send may
have succeeded. Review the event's step records and provider outcome first.

Also check `no active tenant for Page` and `record persisted` ignored/reason logs.
A queued event does not establish that a tenant-linked messages row was written.
No production database state was changed by these code edits or local tests.
