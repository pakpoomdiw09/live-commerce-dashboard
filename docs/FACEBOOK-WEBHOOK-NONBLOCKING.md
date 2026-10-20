# Nonblocking webhook delivery

Apply `supabase/facebook-webhook-nonblocking.sql` after facebook-webhook-queue.sql
and before deploying the new worker. It replaces the claim/finish RPC definitions
without resetting old jobs or step checkpoints. Existing requires_review/dead jobs
are immediately skipped by claims for newer messages from the same sender.

Only earlier pending/processing jobs remain ordering barriers. Failed persistence
still retries with the existing exponential delay and eight-attempt limit; exhausted
pending jobs become dead. Never delete failed events to unblock a conversation.

Once persistRecord confirms a stored message, an optional handler error completes
the event with last_error set and increments sideEffectFailed in worker summaries.
The finish RPC independently verifies the completed record checkpoint before
allowing completion with unfinished external steps. Expired workers with a durable
message checkpoint are also finalized without replaying their optional work.

Completed means inbox ingestion succeeded; it does not assert the AI response,
slip verification or other optional automation succeeded. Started external-step
checkpoints remain untouched for review, and errors include step/event IDs. A lost
lease never authorizes the stale worker to finish or dispatch again. Old failed
jobs are not automatically retried, and ambiguous sends are not replayed.

The handler skips slip/vision image candidates for message.sticker_id. Image
candidate extraction tolerates null/non-array attachments and null array entries.
Message persistence runs before those optional operations.

To find optional failures even on completed events:

```sql
select e.id,e.status,e.last_error,s.name,s.status as step_status,e.created_at
from public.facebook_webhook_events e
left join public.facebook_webhook_steps s on s.event_id=e.id and s.status='started'
where e.last_error is not null or e.status in ('requires_review','dead')
order by e.sequence desc limit 50;
```

Local PGlite tests cover terminal-job skipping, active ordering/fencing, persisted
messages with failed automation, expired leases, preserved ambiguous checkpoints,
retry exhaustion and idempotent migration application. No production SQL was run.
