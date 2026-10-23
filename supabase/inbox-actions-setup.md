# Inbox claim and handoff diagnostics

The buttons call `PATCH /api/inbox/conversations/[id]`. The server authorizes the
signed-in user's tenant membership and package access, then uses the service-role
client to call `manage_inbox_pro` (Pro flag on) or `manage_inbox_conversation`.
It updates customers.assigned_user_id, bot_enabled, conversation_status,
conversation_version and handover_at inside one transaction with audit records.

This path does **not** call Facebook pass_thread_control/take_thread_control.
An external Graph API handover therefore cannot block its assignment update.
Manual replies still require a valid Messenger window and the existing send policy.

## Find the production failure

1. In Vercel Logs filter `/api/inbox/conversations/` and `[inbox/action]`, then click
   Claim once. Logs contain the stage/RPC, tenant/customer IDs, HTTP status,
   Postgres code, message, details, hint and elapsed time. Credentials and request
   contents are not printed.
2. `node scripts/diagnose-inbox-actions.cjs` checks the local .env.local project's
   column groups and RPC parameter names using reads/OpenAPI metadata. It never
   invokes a claim or sends a real message. Local success does not establish that
   Vercel has the same environment or that database triggers succeed on a write.
3. Run `supabase/inbox-actions-check.sql` in the SAME Supabase project as Vercel.
   Core columns and service_can_execute must be true; client_can_execute false.
   Pro RPC is required only if SMART_INBOX_PRO_ENABLED=true.
4. Missing table/column/function errors (42703,42P01,PGRST202,PGRST204,42883) now
   produce INBOX_SCHEMA_UNAVAILABLE. Resolve prerequisite schema migrations first.
   `supabase/inbox-actions.sql` reinstalls the canonical atomic legacy RPC and its
   grants; run only after smart-inbox.sql and feature-access.sql. It is also used
   by the Pro wrapper and does not replace Pro receipts/stage triggers.
5. 40001/55P03 become HTTP 409: the version changed or a delivery lease is active.
   Refresh before retrying. 42501 stays HTTP 403; do not bypass membership checks.
   For other codes inspect the logged details, including installed customer triggers.

Successful responses include the confirmed customer state from the repaired legacy
RPC's transaction or a scoped read-back (Pro and older legacy installations).
The UI merges it immediately, preserves unread counts and rejects older or foreign
tenant responses. If the post-save read fails, the response remains successful with
refreshRequired=true; it does not pretend that the already committed write failed.
No ambiguous mutation is automatically replayed. The normal background refresh still
runs, and server-authorized assignee/state plus Messenger policy control the composer.

## Validation

```sh
node --test scripts/test-smart-inbox-api.cjs scripts/test-smart-inbox-pro-api.cjs scripts/test-inbox-action-timeout.cjs scripts/test-inbox-assignment.cjs scripts/test-smart-inbox-sql.cjs scripts/test-smart-inbox-pro-sql.cjs
```

SQL tests run in isolated PostgreSQL/PGlite and cover repeat installation, racing
versions, foreign tenants, assignment, audit and leases. They do not modify production.
