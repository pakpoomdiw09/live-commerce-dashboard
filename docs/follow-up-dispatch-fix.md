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
   Then run `supabase/follow-up-24h-window.sql` LAST, before deploying the worker.
   It adds/backfills `customers.window_expires_at`, synchronizes verified inbound
   events, and installs the expiration RPC and both updated dispatch gates.
2. Deploy the changed Cron route, worker and Facebook client to Vercel.
3. Add a new manual follow-up, inspect its draft and approve it when it reaches
   `requires_review / ai_draft`. Previously cancelled jobs are retained as history
   and are not automatically replayed. The existing opt-out, assignment, approval,
   emergency-stop and verified 24-hour Messenger window checks still apply.
4. Inspect the authenticated Cron response and `[FOLLOW-UP CRON] worker result`.
   `dueCount` counts eligible-by-time pending rows; `sent` counts provider receipts
   whose result is persisted. `jobs` gives each processed job's status/reason.
   HTTP 503 identifies explicit send failures or operational/persistence errors.

## 24-hour expiration

`persist_facebook_webhook_record` stores each accepted incoming message and its
latest inbound timestamp in one transaction. `window_expires_at` is that verified
Meta event time plus exactly 86,400 seconds. New inbound messages extend it;
duplicates, out-of-order messages, delivery/read receipts and outgoing messages
never extend it to the worker's processing time. A delayed webhook therefore
does not grant an extra 24 hours. All persisted times are `timestamptz` and the
worker parses ISO timestamps into milliseconds; the server's local timezone is
irrelevant.

The worker first calls `expire_follow_up_if_outside_window` for the claimed due
job, before token/credit work. Closed, missing or future inbound windows cause
`cancelled / outside_24h_window`. Preparation and final authorization check again
in the database; the worker compares `windowExpiresAt` once more immediately
before the network call. Expiration after preparation refunds reserved credits
and releases the delivery lease. Exact equality with the expiry time is closed.
An explicit late window rejection from Meta is also cancelled and recorded;
other Meta failures retain their original message and codes. A valid local window
cannot override a provider refusal due to permissions, token or Page restrictions.

Existing expired/cancelled jobs are not resumed when a new inbound opens a new
window. A new job must still meet its workflow, approval and ownership checks.

```sql
select id,last_message_at,last_interaction_at,window_expires_at,
       window_expires_at > now() as cached_window_open
from public.customers where platform='facebook';

select id,status,reason,sent_at from public.follow_up_jobs
order by created_at desc limit 20;
```

`Send API` uses `POST /{FB_GRAPH_VERSION}/me/messages`, the tenant's Page token
in `Authorization: Bearer`, and `recipient.id`, `message.text`,
`messaging_type=RESPONSE`. The SQL gates validate signed inbound evidence within
24 hours immediately before sending. General sales/payment follow-ups do not
have event-registration evidence, so no `CONFIRMED_EVENT_UPDATE` tag is inferred.

A successful receipt completes `follow_up_jobs` and its durable `messages` row
through `complete_follow_up`, including `sent_at` and `provider_message_id`.
Completion failures retry only database persistence and then verify the stored
receipt; the network send is never retried automatically after an uncertain result.
Provider failures are JSON-logged with HTTP status, Meta code/subcode and Meta's
own error message (credentials and reflected outgoing text are redacted), and
saved to `follow_up_execution_logs` with `status=delivery_error`.
The Dashboard attaches the latest delivery error to each matching job and shows
the message and codes under “รายละเอียดจาก Meta”. No extra database column is required.
Tokens, message contents and raw provider responses are excluded from these logs.

The latest stored refusal at 20:41 Bangkok was HTTP 400, code 2022, subcode
1404132. The earlier client discarded Meta's explanation, so that historical
message cannot be reconstructed. A new failed request will retain it. This code
alone does not establish a 24-hour window failure. Code 10 alone is also no longer
treated as a window rejection: it may indicate missing permissions. No automatic
retry with an unrelated event-update tag is performed for a general follow-up.

## Approval mode and explicit retry

Run `supabase/follow-up-approval-mode.sql` in Supabase SQL Editor after
`follow-up-24h-window.sql` and `follow-up-step-settings.sql`, then deploy the code.
It is rerunnable; it never sends messages or changes existing jobs at installation.

The setting lives in `follow_up_policies.approval_mode`. The default is
`manual_review`: all newly created jobs use `requires_review / ai_draft` until an
admin approves them. `auto_approve` sets `ai_approved=true` and `status=pending`
for new manual and automatically scheduled jobs. A BEFORE INSERT trigger applies
the setting to every creation path. Changing the mode does not approve old drafts
or revoke approvals already granted. The Dashboard saves this setting immediately
through `PATCH /api/chatbot/follow-ups` with `{tenantId, approvalMode}`; this scoped
RPC does not revise workflows or cancel queues. `/api/follow-ups` returns the
saved policy on refresh.

Approval does not bypass the worker's tenant, workflow, handover, opt-out,
order/slip, quota or verified 24-hour checks. No extra AI call is made just to
approve a job.

Code 2022 or subcode 1404132 is stored with reason `page_restricted`; the Dashboard
shows the Page-status guidance and “ทดสอบส่งใหม่”. Historical `api_rejected`
failures with these diagnostics also show the guidance. This button requests
`retry_send` via the existing job endpoint. The server allows it only for a
confirmed refused send with a failed message, no provider receipt, no live claim
and no outstanding reserved credits. It keeps the failed message and audits the
admin action, clears the completed dispatch markers, and queues a new attempt.
The Cron sends it after checking the current conditions again. Double clicks,
unknown delivery outcomes and accepted sends cannot reset a job. If the window
has already expired, retry cancels the job without contacting Meta.

Validation commands:

```sh
node --test scripts/test-smart-followups.cjs
node scripts/test-followup-approval-sql.cjs
```

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
