# Live CF and Auction: Final Local Audit

## Scope and execution boundary

All inspection and tests ran against workspace files and isolated PGlite instances. No migration or query was run against Supabase production or staging; no deployment or live Meta request was made. The full TAP logs and JSON summaries are [current-final.log](./current-final.log), [current-final.json](./current-final.json), [baseline-start.log](./baseline-start.log), and [baseline-start.json](./baseline-start.json). The detached clean-HEAD baseline was commit `e6cc3de64b17c0e9cd75a0390128163a230f231d`. The workspace already contained uncommitted auction work when this audit began, so the clean-HEAD comparison measures the total workspace delta against that commit; it cannot attribute every baseline-only pass exclusively to edits made in this audit turn.

## Findings

| Item | Status | Evidence |
|---|---|---|
| `npm test` ENOMEM root cause | PASS | Sandboxed `npm.cmd test` stops in `tsx` at `uv_os_get_passwd` before tests start. The same command outside the sandbox exits 0: 131 tests, 131 pass, 0 fail. This is an OS account lookup restriction in the sandbox, not exhausted memory or a project test failure. |
| Browser RPC leak audit | PASS | Search of `app`, `components`, and `hooks` found no browser call to `finalize_live_auction`, `finalize_live_auction_highest_bid`, `process_live_auction_comment`, `advance_live_auction`, or `expire_live_auctions`. The settings UI reads/writes `/api/live-auction/workspace` in [AuctionUnifiedForm.tsx:157,241](../../components/live-cf/AuctionUnifiedForm.tsx); server processing calls `process_live_auction_comment` in [auction-server.ts:697](../../lib/features/commerce/auction-server.ts). The only matching direct RPC routes are server routes: [close/route.ts:15](../../app/api/live-cf/auction/close/route.ts) and [facebook-webhooks/route.ts:26](../../app/api/cron/facebook-webhooks/route.ts), which calls the reporting wrapper `expire_live_auctions_report`. |
| Expiry ingress and authorization | PASS | The settings page does not call `expire_live_auctions`. The existing expiry worker is the authenticated cron route: it checks `CRON_SECRET`/`INTERNAL_API_SECRET` at [facebook-webhooks/route.ts:14-20](../../app/api/cron/facebook-webhooks/route.ts), then calls `expire_live_auctions_report` at line 26 through `supabaseAdmin`. `git blame` attributes that call to commit `650ad0c` (`fix(live-auction): harden winner flow, poller security, and add audit-2 migration`). It is pre-existing and out of scope; it was not modified. The reported `live-auctions.sql` string has no match in active app/component/lib source. |
| Missing RPC/schema/internal error messaging | PASS | [workspace/route.ts:28-38,43-60](../../app/api/live-auction/workspace/route.ts) distinguishes missing RPC, incomplete schema, and generic read errors without returning database internals. The UI displays the safe response message and status at [AuctionUnifiedForm.tsx:157-178,267,333-335](../../components/live-cf/AuctionUnifiedForm.tsx). API coverage is in [test-auction-workspace-api.cjs:12](../../scripts/test-auction-workspace-api.cjs). Against the clean pre-fix route, the new schema assertion failed (`actual undefined`, expected `DATABASE_SCHEMA_INCOMPLETE`); current API test exits 0. |
| Settings status badge | PASS | [auction-settings-status.ts:6-26](../../lib/features/commerce/auction-settings-status.ts) shows loaded, checking, and failed states; failed reads cannot display an emerald success badge. The baseline-entry test failed on the old component with “a failed workspace read shows a degraded status instead of a success badge”; current [test-auction-degraded-form.cjs:4](../../scripts/test-auction-degraded-form.cjs) passes. |
| Auction RPC permissions | PASS | [live-auction-auto-cycle.sql:228-234](../../supabase/live-auction-auto-cycle.sql) explicitly revokes every new helper/worker RPC including `normalize_auction_settings_before_split`, `auction_host_command`, `advance_live_auction`, `save_auction_workspace`, `process_live_auction_comment`, and both finalizers from `public`, `anon`, and `authenticated`, then grants `service_role`. Existing expiry RPCs are likewise service-only at [live-auction-audit-hardening-2.sql:35-36](../../supabase/live-auction-audit-hardening-2.sql). The preservation migration repeats the highest-bid finalizer restriction at [live-auction-confirmation-preservation.sql:49-50](../../supabase/live-auction-confirmation-preservation.sql). [test-auction-auto-cycle.cjs:87-128](../../scripts/test-auction-auto-cycle.cjs) uses `SET ROLE`, asserts exact SQLSTATE `42501` for both browser roles across the new helper and finalizers, checks `has_function_privilege`, and successfully executes as `service_role`. Targeted output: 1 test, 1 pass, 0 fail, exit 0. |
| Normal host close and order timing | PASS | [live-auction-audit-hardening.sql:36-72](../../supabase/live-auction-audit-hardening.sql) closes/locks the winner and returns `orderId: null`; order creation is gated by winner confirmation in the highest-bid finalizer. The local lifecycle test in [test-auction-auto-cycle.cjs:39-84](../../scripts/test-auction-auto-cycle.cjs) confirms closed + `winner_locked_at`, null `order_id`, successor creation, exactly one order after confirmation, and an unaffected active successor. No immediate-order behavior was found, so no stop condition was triggered. |
| Confirmation timestamp preservation | PASS | The pre-fix finalizer overwrote `closed_at` and `close_event_id` on confirmation. Forward-only [live-auction-confirmation-preservation.sql:40](../../supabase/live-auction-confirmation-preservation.sql) now uses `coalesce(a.closed_at, clock_timestamp())` and `coalesce(a.close_event_id, p_event)`. The lifecycle assertion verifies the original values survive confirmation. |
| Stale pre-round confirmation | PASS | In [live-auction-auto-cycle.sql:160-175](../../supabase/live-auction-auto-cycle.sql), source-time validation now happens before a confirmation is queued as `awaiting_host_close`. The pre-fix test returned `awaiting_host_close` where `stale` was expected; the current full run passes the regression test. |
| Dual-round target routing | PASS | [auction-server.ts:599-621](../../lib/features/commerce/auction-server.ts) first searches a closed, winner-locked, unconfirmed round for the sender and only assigns it when the message parses as confirmation. Otherwise [auction-server.ts:580-596,622](../../lib/features/commerce/auction-server.ts) selects the active round. Thus confirmation tags from the locked winner reach the prior round; numeric bids fall through to the active round. Dispatch to `process_live_auction_comment` is at line 697. Routing and replay tests pass in the full run. |
| Cancellation, missing author, duplicate and non-winner edges | PASS | [test-auction-auto-cycle.cjs:128-149](../../scripts/test-auction-auto-cycle.cjs) covers cancellation, no order/successor, and author-less comments. Lines 39-84 cover early confirmation, non-winner confirmation, duplicate close/confirmation replay, and exactly-one-order behavior. |
| Bank account scope on auto-cycle | FAIL / DESIGN DECISION REQUIRED | [advance_live_auction](../../supabase/live-auction-auto-cycle.sql:40-58) raises `BANK_SCOPE` when the saved bank account is null or inactive. Both cases are tested at [test-auction-auto-cycle.cjs:151-170](../../scripts/test-auction-auto-cycle.cjs) and roll back the entire host-close transaction: the round remains active/unlocked and no successor exists. No behavior change was made. Options: reject enabling auto-cycle unless a tenant-scoped active bank account is saved, or explicitly choose a prior-round bank fallback. |
| Customer tab and tenant isolation | PASS | The order finalizer raises `AUCTION_CUSTOMER_TENANT` for a foreign customer at [live-auction-confirmation-preservation.sql:15](../../supabase/live-auction-confirmation-preservation.sql); `SELECT ... INTO STRICT` requires the order’s customer-tab attachment at line 20. Tests at [test-auction-auto-cycle.cjs:178-201](../../scripts/test-auction-auto-cycle.cjs) verify trigger failure rolls back confirmation/order and cross-tenant collisions produce `42501` with no order. |
| True two-transaction confirmation race | UNVERIFIED | The `Promise.all` test at [test-auction-auto-cycle.cjs:163-175](../../scripts/test-auction-auto-cycle.cjs) produces exactly one order, but its PGlite fixture uses one database connection. It does not prove behavior under two independent PostgreSQL transactions. No local PostgreSQL, Docker, or Podman executable was available; no remote database was used. |
| Migration order and idempotency | PASS | [build-full-database-setup.cjs:134-150,324-329](../../scripts/build-full-database-setup.cjs) orders the final auction sources through auto-cycle and confirmation preservation. The staging rehearsal and complete-schema tests apply the chain locally; `test-complete-schema.cjs` reruns the complete schema and checks that application data is preserved. `node scripts/build-full-database-setup.cjs --check` exits 0: 142 SQL sources, 124 included, 18 excluded, bundle size 1,193,117 bytes. |
| Production `pg_get_functiondef` comparison | UNVERIFIED | No production database dump was present in the workspace/reports/supabase tree. The local rehearsal compares the staged final function to a fresh local installation, but no production comparison was attempted. |
| On-demand winner source | PASS | [live-auction-on-demand.sql:127-135](../../supabase/live-auction-on-demand.sql) uses the locked auction row’s `leading_bidder_id`, `current_price`, and order fields to create the order. `auction_bids` is used for comment/bid history and idempotency, not as the authoritative winner source. `test-auction-on-demand.cjs` passes in the full run. |
| Counting defaults | PASS | The schema defaults `countEnabled` to false (for example [complete_schema.sql:15237](../../supabase/complete_schema.sql)); the parser only counts when `countEnabled === true` at [auction-comment-parser.ts:48](../../lib/integrations/facebook/auction-comment-parser.ts). SQL/parser parity test passes. |
| A3 diagnostic mutability | PASS | [a3-stalled-rounds.sql](./a3-stalled-rounds.sql) contains only a read-only `SELECT`, with no DML or repair statements. |
| Poller and host-action coverage | PASS | [test-auction-poller-hardening.cjs:229-366](../../scripts/test-auction-poller-hardening.cjs) tests 250-comment pagination, overlap boundary, Graph error 100, missing authors, untrusted continuation hosts, and token sanitization. [test-auction-host-actions.cjs:6,187-213](../../scripts/test-auction-host-actions.cjs) imports the real parser and tests session count overrides. [LiveCommentPoller.tsx:49-65](../../components/live-cf/LiveCommentPoller.tsx) reports aggregate skip counts and stops on inaccessible videos; the dashboard shows re-selection guidance at [LiveSessionDashboard.tsx:447-455,502-505](../../components/live-cf/LiveSessionDashboard.tsx). |
| Secret scan and `.env` handling | REVIEW | `node scripts/audit-credential-shapes.cjs` scans tracked/unignored files plus root `.env*` files and suppresses values. `.env.local` findings (all real-like, validity unverified): line 4 cron secret; 6 Meta App Secret shape; 9 Gemini API key; 10 internal API secret; 19 Meta Page access token shape; 38 Supabase JWT signing secret; 40 Supabase secret key shape; 42 Vercel OIDC token; 43 Live CF payment-link secret; 47 ZWIZ API key. No values were emitted or sent to a network. Test fixtures and a patch snapshot also match credential assignment patterns. `.env.local` exists, is ignored by `.gitignore:26`, and is not tracked (`git ls-files` reports only `.env.example`). |

## API authorization table

| Route | Authentication / scope evidence | Status |
|---|---|---|
| `/api/live-cf/setup` | `getActor` and owner `canAccessTenant` at [setup/route.ts:20-28](../../app/api/live-cf/setup/route.ts) | PASS |
| `/api/live-cf/products` | `getActor` and staff `canAccessTenant` at [products/route.ts:12-19](../../app/api/live-cf/products/route.ts) | PASS |
| `/api/live-cf/sessions` | `authorizeAuction` at [sessions/route.ts:43,108](../../app/api/live-cf/sessions/route.ts); write also checks actor at line 110 | PASS |
| `/api/live-cf/auction` | `authorizeAuction` at [auction/route.ts:20,78](../../app/api/live-cf/auction/route.ts) | PASS |
| `/api/live-cf/auction/timer` | `authorizeAuction` at [timer/route.ts:31,42](../../app/api/live-cf/auction/timer/route.ts) | PASS |
| `/api/live-cf/auction/host-action` | owner authorization and same-origin write check through `authorizeAuction` at [host-action/route.ts:22](../../app/api/live-cf/auction/host-action/route.ts) | PASS |
| `/api/live-cf/auction/close` | owner authorization and same-origin write check at [close/route.ts:11](../../app/api/live-cf/auction/close/route.ts); UI uses it for cancellation, while ordinary host close uses `host-action` | PASS |
| `/api/live-cf/auction/poll-comments` | `getActor` and staff tenant access at [poll-comments/route.ts:56,71](../../app/api/live-cf/auction/poll-comments/route.ts) | PASS |
| `/api/live-cf/payment-variant` | Signed capability token verified at [payment-variant/route.ts:37](../../app/api/live-cf/payment-variant/route.ts); no login is required by design, and the verified order is passed to the scoped RPC | PASS |
| `/api/live-auction/workspace` | Owner authorization at [workspace/route.ts:72,156](../../app/api/live-auction/workspace/route.ts); service-role DB client is server-only | PASS |
| `/api/cron/facebook-webhooks` | Timing-safe cron bearer check at [facebook-webhooks/route.ts:14-20](../../app/api/cron/facebook-webhooks/route.ts) | PASS; pre-existing/out of scope |

## Full-suite comparison

Commands:

```text
node reports/auction-audit/run-suite.cjs 'C:\Users\Victus\Downloads\chat-dashboard2-with-env (2)' current-final
node reports/auction-audit/run-suite.cjs 'C:\Users\Victus\AppData\Local\Temp\live-cf-audit-start-e6cc3de' baseline-start
```

Actual runner summaries:

```text
current-final: code 1, 1021 tests, 1008 pass, 13 fail
baseline-start: code 1, 1013 tests, 954 pass, 59 fail
shared failures: 13; baseline-only: 46; current-only: 0
```

Current failing tests by suite file:

| Suite file | Failed tests | Category |
|---|---:|---|
| `scripts/test-admin-feature-bypass.cjs` | 1 | Admin/feature access |
| `scripts/test-agent-control.cjs` | 1 | Agent control |
| `scripts/test-billing-slip-topups.cjs` | 1 | Billing/top-up behavior |
| `scripts/test-broadcast-policy.cjs` | 2 | Broadcast policy |
| `scripts/test-feature-restoration.cjs` | 1 | Feature restoration |
| `scripts/test-followup-and-broadcast.cjs` | 1 | Follow-up/broadcast |
| `scripts/test-followups-paused.cjs` | 1 | Follow-up navigation fixture |
| `scripts/test-gemini-ai-agent.cjs` | 1 | Gemini agent routing |
| `scripts/test-inbox-reply-isolation.cjs` | 1 | Inbox/agent dependency fixture |
| `scripts/test-overview-fetch.cjs` | 1 | Overview fetching |
| `scripts/test-slip-settings.cjs` | 1 | Slip settings |
| `scripts/test-smart-inbox-api.cjs` | 1 | Smart Inbox API |
| **Total** | **13** | All 13 also fail on baseline |

All 13 remaining failures also occur on baseline. The 46 baseline-only failures include bundle/schema checks and Facebook send/slip tests whose stale mock dependencies were corrected in this work. Current auction lifecycle, poller, webhook, migration, and slip-confirmation tests pass; there are zero current-only failures. The full repository suite still exits 1 on the 13 baseline-shared failures, so the repository as a whole is not green.

## Test output evidence

```text
npm.cmd test (outside sandbox): tests 131, pass 131, fail 0, exit 0
node --test --test-name-pattern='auto-cycle finalizer permissions' scripts/test-auction-auto-cycle.cjs:
  tests 1, pass 1, fail 0, exit 0
node --test scripts/test-auction-workspace-api.cjs:
  tests 1, pass 1, fail 0, exit 0
node --test scripts/test-auction-degraded-form.cjs:
  tests 1, pass 1, fail 0, exit 0
node --test --test-name-pattern='null or inactive successor bank' scripts/test-auction-auto-cycle.cjs:
  tests 1, pass 1, fail 0, exit 0
node --test --test-concurrency=1 scripts/test-slip-automatic-gate.cjs scripts/test-slip-messenger-confirmation.cjs scripts/test-restored-exports.cjs scripts/test-facebook-send-diagnostics.cjs scripts/test-sensitive-logging.cjs:
  tests 65, pass 65, fail 0, exit 0
node --test --test-concurrency=1 scripts/test-auction-*.cjs scripts/test-live-auction*.cjs:
  tests 136, pass 136, fail 0, exit 0
```

The complete-suite logs contain the raw TAP output and per-test names. The pre-fix UI and API assertion failures were also run and observed before the green current tests.

The final full-suite TAP run occurred before the bank-account test was expanded to exercise both null and inactive configuration in one test. That expanded final-source test was then run independently and passed (1/1); the application SQL did not change after the full-suite run.

## Scope decisions and limitations

- No cron route was changed; its existing `expire_live_auctions_report` invocation was audited separately.
- The inactive-bank auto-cycle failure is documented for a product decision; no fallback or save-time restriction was introduced.
- PGlite `Promise.all` coverage is not evidence of two independent concurrent PostgreSQL transactions.
- No production database dump was supplied, so production function-definition comparison is unavailable.
- No Phase 2 identity work, deployment, production migration, or live Meta request was started.
