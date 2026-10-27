# Follow-up dispatch repair

The production job claimed at 20:14:03 Bangkok on 27 October 2026 was cancelled
at 20:14:06 with `reason=disabled`, before any Facebook send. Its tenant had
`auto_reply_enabled=false`; the job was explicitly enrolled with
`manual_without_order=true`. The tenant Page token was present and the follow-up
feature was enabled. The job also had `ai_approved=false`.

## Apply

1. Run `supabase/follow-up-manual-dispatch-fix.sql` in the new Supabase project's
   SQL Editor, after `follow-up-simplified.sql`. This static, rerunnable migration
   updates both dispatch gates. Manual enrollment no longer requires the
   automatic-chat reply switch. Automatic workflows still require their switches.
2. Deploy the changed Cron route, worker and Facebook client to Vercel.
3. Add a new manual follow-up, inspect its draft and approve it when it reaches
   `requires_review / ai_draft`. Previously cancelled jobs are retained as history
   and are not automatically replayed. The existing opt-out, assignment, approval,
   emergency-stop and verified 24-hour Messenger window checks still apply.
4. Inspect the authenticated Cron response and `[FOLLOW-UP CRON] worker result`.
   `dueCount` counts eligible-by-time pending rows; `sent` counts provider receipts
   whose result is persisted. `jobs` gives each processed job's status/reason.
   HTTP 503 identifies explicit send failures or operational/persistence errors.

`Send API` uses `POST /{FB_GRAPH_VERSION}/me/messages`, the tenant's Page token
in `Authorization: Bearer`, and `recipient.id`, `message.text`,
`messaging_type=RESPONSE`. The SQL gates validate signed inbound evidence within
24 hours immediately before sending. General sales/payment follow-ups do not
have event-registration evidence, so no `CONFIRMED_EVENT_UPDATE` tag is inferred.

A successful receipt completes `follow_up_jobs` and its durable `messages` row
through `complete_follow_up`, including `sent_at` and `provider_message_id`.
Completion failures retry only database persistence and then verify the stored
receipt; the network send is never retried automatically after an uncertain result.
Provider failures are JSON-logged with HTTP status, Meta code/subcode and a fixed
error message, and saved to `follow_up_execution_logs` with `status=delivery_error`.
Tokens, message contents and raw provider responses are excluded from these logs.

## Read-only checks

```sql
select id,status,reason,attempts,dispatch_started_at,send_authorized_at,
       sent_at,provider_message_id
from public.follow_up_jobs
order by created_at desc limit 20;

select job_id,status,reason,created_at
from public.follow_up_execution_logs
order by created_at desc limit 30;
```
