# Messenger / Claim action on Vercel

## Observations from this investigation

For `https://live-commerce-dashboard-xi.vercel.app`:

- GET `/api/webhook` with the Verify Token loaded from the local environment returned 200 and the exact diagnostic challenge. An invalid token returned 403 with no redirect. This proves that this route is reachable and the GET token agrees; it does not test Meta's POST delivery or the App Secret.
- An unauthenticated GET to the conversation API returned 401 with no redirect. No authenticated production claim was attempted and no messages were sent.
- GitHub reports both Vercel contexts successful for commit `e565e43`. Successful builds do not prove runtime database access or webhook subscription health.
- The Supabase project configured in the local environment had no unfinished webhook events; its most recent receipt was 20 October 2026 at 19:38 Bangkok time. This does not prove Vercel uses the same Supabase project.

## Fixes in this working tree

`ConversationActions` previously waited indefinitely for PATCH and then for `onChange()` before clearing its busy state. The mutation now has a 20-second transport/body deadline, and refresh has a separate 8-second deadline. Refresh failure no longer overwrites an existing mutation failure. An ambiguous timeout retains the pending request key/version; there is no automatic resend. A timed-out request may already have committed, so reload/check the chat state before repeating an action.

Inbox Supabase requests and the session/membership checks used during authorization now have 10-second HTTP deadlines. These apply per network request, not to the whole authorization chain. The conversation route declares Node runtime and a 30-second function budget; plan/platform limits still apply. Aborting an HTTP request does not guarantee cancellation of a SQL transaction.

PATCH logs include `started`, RPC started, completed or failed, the current stage and elapsed time. They omit tokens, message text and full request bodies. Missing action RPCs map to `INBOX_SCHEMA_UNAVAILABLE`; SQL statement cancellation maps to `DATABASE_TIMEOUT`. Existing lock/version conflicts remain 409.

## Check the actual environment names

| Purpose | Names read by this project |
| --- | --- |
| Supabase browser/server URL | `NEXT_PUBLIC_SUPABASE_URL` |
| Browser/session key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Trusted server key | `SUPABASE_SERVICE_ROLE_KEY` |
| GET webhook token | `FB_VERIFY_TOKEN`, fallback `FACEBOOK_VERIFY_TOKEN` |
| POST HMAC secret | `FB_APP_SECRET` |
| Facebook diagnostic flag | `FB_DEBUG=true` |
| Optional single-Page token | `FB_PAGE_TOKEN`, fallback `PAGE_ACCESS_TOKEN`, scoped by `FB_PAGE_ID` |

`SUPABASE_URL` and `VERBOSE_LOGS` alone do not configure these paths. Most Pages use the token stored in their own tenant row. The Page token is for Graph requests/replies; it does not replace the Verify Token or App Secret, and its absence does not explain a GET handshake failure.

In Vercel, check the project owning the live domain and its Production environment. Public Supabase URL/key are included at build time; changing environment settings requires a new deployment. Compare the Supabase project reference in the configured URL to the project where migrations and Facebook Page tenants exist. Do not put service-role keys in NEXT_PUBLIC variables or logs.

## Runtime log procedure

Open the correct Vercel project → Logs, choose Production and the latest deployment. Filter Request Path to `/api/webhook` (or the exact callback path registered with Meta) and send one real message from your own test account. Filter `/api/inbox/conversations/` and click Claim once. Use the same timestamp and RequestId to follow each request. Build Logs are separate from Runtime Logs. See [Vercel Runtime Logs](https://vercel.com/docs/logs/runtime).

| Result | Where to investigate |
| --- | --- |
| No webhook invocation | Meta callback domain/path, Page subscribed app and `messages` field, app permissions/mode, Vercel firewall/protection |
| GET 403 | Verify Token mismatch or missing challenge/mode |
| POST 401 | `FB_APP_SECRET` belongs to a different Meta app, missing/invalid signature, upstream body changes |
| POST 503 before `queued` | Supabase target/key/connectivity or missing `enqueue_facebook_webhook`; inspect the safe error code |
| `queued` but no message | Worker logs, tenant mapping, ignored echo/system events and persisted-record result; inspect the durable queue |
| Claim `started` only | Session/membership/customer reads; correlate function timeout and Supabase connectivity |
| Claim `rpc started` but no completion | RPC execution, row/advisory locks and DB load |
| Claim 401/403 | Session, tenant membership and package entitlement |
| Claim 409 | Another user/version changed, or outgoing delivery currently owns the chat; refresh instead of forcing assignment |
| Claim 503 / `INBOX_SCHEMA_UNAVAILABLE` | Missing base `smart-inbox.sql`, or `smart-inbox-pro.sql` when the Pro flag is enabled |
| Claim 200 but refresh fails | `/api/inbox/state` and other refresh requests; the claim itself may already be saved |

Use `supabase/inbox-request-diagnostics.sql` for read-only RPC-presence and lock-wait checks. `dashboard-read-models.sql` does not install the claim/handover RPCs. Do not replay unrelated migrations or reset conversation versions to fix a lock.

The scheduled recovery endpoint `/api/cron/facebook-webhooks` still needs an authenticated scheduler; `after()` alone cannot recover a stopped process. Confirm a scheduler actually invokes that route, not only the separate follow-up cron. Keep the existing signature verification and durable enqueue-before-200 behavior.

## Validation

Use `node --test scripts/test-inbox-action-timeout.cjs scripts/test-webhook-db-timeout.cjs scripts/test-smart-inbox-api.cjs scripts/test-inbox-request.cjs` for mutation/refresh timeouts, cancellation, authorization and no-replay cases. Production environment values, Meta subscription configuration, authenticated runtime logs and final end-to-end delivery require access to those accounts; the public probes above do not establish the root cause.

The expanded suite including route security, Dashboard loading and Pro Inbox API checks passed 32 tests. TypeScript and ESLint on changed application files also passed. These changes are local until separately committed and deployed.
