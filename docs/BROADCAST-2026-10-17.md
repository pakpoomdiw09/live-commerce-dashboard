# Broadcast workspace — 17 October 2026

## Implementation and rollout state

The new `/broadcast` workspace is installed, with Thai three-step composition,
locked active Page/status, OR tag filtering, the existing customer/order segments,
editable drafts, history, recipient reasons and explicit final confirmation.
Only plain text is supported. Media, buttons and scheduling are deliberately not
offered because the existing broadcast integration does not implement them.
The active Page comes from the authenticated shop context and cannot be switched on this screen. Preview results are invalidated on content changes; switching shop elsewhere remounts the workspace. The server returns the
saved content snapshot so concurrent edits cannot silently change the review.

**Production outbound sending is disabled by default. No production migration,
deployment, customer send, token change or environment-file edit was performed.**

## Policy verification and external dependencies

Official documentation checks on 2026-10-17 attempted:

- https://developers.facebook.com/docs/messenger-platform/policy/policy-overview/
- https://developers.facebook.com/docs/messenger-platform/send-messages/message-tags/
- https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy-overview
- https://developers.facebook.com/docs/features-reference/human-agent/

These pages returned HTTP 429 or could not be retrieved in this environment.
Consequently no claim is made that the current policy, supported interaction
types, exact time boundary, tag availability/deprecation dates, or the actual
app's approval has been independently verified. No third-party summary was used
to authorize transport. **All outside-window channels remain closed**, regardless
of plan or the legacy MessageTags entitlement. Human Agent is never a broadcast
channel or rejection fallback.

The conservative, dormant standard route accepts only signature-verified inbound
non-echo messages with a provider event ID, matching sender/recipient Page and
past event timestamp. It uses server/database UTC and age strictly less than
24 hours; the exact boundary is excluded. Receipts, comments, postbacks, outbound
messages, duplicated webhook deliveries and generic `last_message_at` updates
cannot renew the window. This is an implementation restriction, not a statement
that all these interactions are disallowed by the current Meta documentation.
No historical interaction timestamps are fabricated or backfilled.

Before enabling standard sends, the operator must review accessible current
official documentation and the deployed Graph version, then verify the actual
App Live mode, review/Advanced Access requirements, `pages_messaging`, Page token
ownership/expiry, Page restrictions and subscription/webhook setup. The runtime
token-status check alone cannot prove all those requirements. If the reviewed
policy differs from this implementation, update the policy and tests first.

## Database and delivery guarantees

`supabase/broadcast-policy.sql` is additive and was applied twice successfully
to an isolated PGlite test database, never to the configured Supabase database.
Prerequisites are `automation.sql`, `billing.sql`, `smart-inbox.sql` and
`agent-control.sql` with their existing dependencies. Review and apply the new
migration on staging before production. Keep its tables on rollback; do not
drop ledger/evidence tables or refund ambiguous deliveries automatically.

Service-role-only RLS tables record inbound evidence, actor/run leases, recipient
claims, credit buckets, provider receipts, outcomes and reason codes. Browser
roles cannot write evidence or invoke claim/settlement RPCs. Actual tenant
membership and owner/admin rights are checked before server data access and
again before transport. Existing billing refresh/reservation/refund functions
remain authoritative for plan expiry and monthly/top-up quotas; paid plans do
not grant messaging permission. Existing automation stop controls still apply.

Each recipient is rechecked against current ownership, tenant/Page state,
opt-out, automation state, audience/order membership and UTC interaction evidence.
Database locks and `(broadcast_id, customer_id)` uniqueness prevent duplicate
reservations/sends. Started content is immutable. Legacy campaigns with old
transcripts and no new ledger cannot be resumed automatically.

An API receipt means **accepted**, not delivered. Delivery/read counts require
signed, tenant/customer-scoped webhook evidence. Explicit provider rejection
refunds its reservation once. Network uncertainty or worker interruption is
durable `unknown`, retains its reservation and is never resent automatically;
reconcile it manually against provider evidence before considering any refund.
There are no automatic recipient retries. Continuing a campaign only processes
recipients without any earlier claim. Zero eligible recipients still permits
saving a draft. Logs omit tokens and message bodies; ledger identifiers are
necessary for deduplication/audit and require normal tenant-data retention rules.

## Flags

`BROADCAST_UI_ENABLED` defaults to the new workspace; set `false` to render the
legacy UI. Its old send payload does not meet the new confirmation contract,
so rollback is intentionally read/draft-only and cannot bypass the new policy.

Keep `BROADCAST_STANDARD_SEND_ENABLED=false` until the external review above is
completed. Only after that review, staging migration and sandbox validation,
configure all of the following server-side:

```dotenv
BROADCAST_UI_ENABLED=true
BROADCAST_STANDARD_SEND_ENABLED=true
BROADCAST_POLICY_VERSION=standard-inbound-24h-v1
BROADCAST_POLICY_GRAPH_VERSION=v24.0
BROADCAST_POLICY_REVIEWED_AT=<actual completed review time in ISO 8601 UTC>
```

`BROADCAST_POLICY_GRAPH_VERSION` must exactly match deployed `FB_GRAPH_VERSION`
(the existing default is `v24.0`; this is not a recommendation of a Graph version).
The actual review date must not be in the future or 30 days old. Missing,
mismatched or expired attestation closes sending. This manual attestation is
not an automated Meta approval check. Disable sends immediately with
`BROADCAST_STANDARD_SEND_ENABLED=false`; then optionally roll back the UI flag.
Restart/redeploy as required for environment changes. Outside-window sending has
no enabling flag in this implementation.

## Validation

- `npm.cmd run lint`: zero errors, 10 existing warnings.
- `node node_modules/typescript/bin/tsc --noEmit --pretty false`: passed.
- `npm.cmd run build`: passed.
- Broadcast policy/sender/migration suite: 13 tests passed, including concurrent
  confirmations, one credit per recipient, one-time refund, uncertain transport,
  exact boundary, unsupported interactions, cross-tenant denial, stopped/expired
  rights, policy flags and database browser-role restrictions.
- Combined targeted suite (broadcast, Facebook auth/token, slip single-page,
  message quotas and automation safety): 64 tests passed.
- `node scripts/check-broadcast-browser.cjs`: actual React workspace in local
  headless Chrome, mocked APIs only; zero-recipient draft/preview, confirmation,
  content invalidation, exactly one mock send, no uncaught browser errors and
  no horizontal overflow at 375/768/1440px.
- Screenshots: `screenshots/broadcast-375.png`, `broadcast-768.png`,
  `broadcast-1440.png`. They explicitly show an offline test dataset, not live
  Page permissions or customer data.

Not tested: live Meta sends/receipts, real app review/permissions, production
Supabase migration, deployed multi-worker/load behavior, actual outside-window
products, or current official policy content. The unit/database/browser tests
are evidence of the local implementation only, not a promise of live delivery.
