# Auction deployment and operator plan

## Manual workspace mode update

The unified form now always submits `durationSeconds: null`. Its deployment additionally requires `live-auction-manual-host-close.sql` **after** the deadlines → audit 1 → audit 2 suffix described below. Without this new migration, the older workspace save RPC converts null back into a five-minute deadline. See [manual-host-close/README.md](manual-host-close/README.md) for behavior, compatibility, tests, and the explicit staging-save check. The earlier preflight's original hardening checks do not certify this added workspace behavior.

This task performs no production migration, deployment, real Graph call, or credential inspection. Validation uses local mocks and in-memory PGlite. The committed bootstrap bundles are deliberately unchanged and are **not ready for use as the current auction installer**.

The user's latest active-database audit reports legacy immediate-order comment SQL, absent timer columns/expiry RPCs, an existing migration ledger, and audit 1 never applied. These are user-supplied observations, not database queries performed here. **The current application must not be enabled against that reported schema yet.** Use the read-only [preflight.sql](preflight.sql) and [Compatibility Matrix / staging sequence](COMPATIBILITY.md) before an operator applies migrations. The known required suffix is `live-auction-deadlines.sql` → `live-auction-audit-hardening.sql` → `live-auction-audit-hardening-2.sql`, after any missing prerequisites. Audit 2 alone is insufficient.

## Supported deployment paths

1. **Existing installation:** an authorized operator inventories `snapbot_schema_migrations`, installed RPC definitions/signatures, table grants, and timer columns. Apply only missing forward migrations in registry order using the established migration process. `live-auction-audit-hardening-2.sql` requires the first audit migration and deadlines migration. Do not replay historical financial migrations over newer functions. Deploy the reporting-RPC caller only after its migration is installed; otherwise cron explicitly reports expiry as unavailable.
2. **Fresh installation / generated upgrade:** first complete the separate bundle-regeneration task below. Use the reviewed, synchronized `complete_schema.sql` with Supabase platform prerequisites installed. The alternative `full_database_setup.sql` is a generated ordered script, not a substitute for migration inventory or checksum enforcement.
3. **Local validation:** the builder's `build().completeSql` assembles current source entirely in memory for PGlite. That does not update the stored bundles and is not a production deployment.

The new report RPC returns `{closed, failed}`. Cron exposes this as `auctionExpiry`; an RPC-level failure returns `{closed:0,failed:1,unavailable:true}`. The integer-returning `expire_live_auctions(uuid)` remains a compatibility wrapper. Its callers can query the three-column failure ledger; callers needing counts should use `expire_live_auctions_report(uuid)`. The ledger contains only SQLSTATE, auction UUID, and occurrence time, has RLS enabled, and is inaccessible to browser roles. Operational access is through authorized server tooling, not the auction browser.

## Isolated bundle regeneration procedure — not executed here

Create a separate clean branch/worktree containing the approved migration changes. Preserve any unrelated working tree changes. Run:

```powershell
node scripts/build-full-database-setup.cjs
node scripts/build-full-database-setup.cjs --check
node --test scripts/test-auction-bundle-parity.cjs scripts/test-complete-schema.cjs scripts/test-full-database-setup.cjs
npx.cmd tsc --noEmit
npm.cmd run build
```

Review both generated SQL files and `full_database_setup-manifest.md` together. Run fresh-install and representative upgrade PGlite suites, inspect final financial function definitions and `auction_comment_timestamp(text)` volatility, and commit generated outputs separately. The explicit parity test currently fails for both financial functions and timestamp volatility; do not suppress that failure to claim readiness.

The checksum guard in `scripts/lib/complete-schema.cjs:118` rejects a source migration whose effective checksum differs from the previously applied checksum. An unchanged recorded migration is skipped. Do not bypass the guard, rewrite ledger checksums, or edit an applied migration to force a rerun. The first audit migration is unchanged versus HEAD `39cf4dd`; all SQL introduced in this task is in the new final migration. An operator must establish actual production history before choosing an upgrade path.

## Pre-deployment validation

- Confirm timer columns (`ends_at`, `timer_started_at`, `duration_seconds`) and RPC signatures on the target. Registry lines 145–147 place deadlines before audit 1 and audit 2; `supabase/live-auction-deadlines.sql:3`–5 creates those columns.
- Compare actual installed financial definitions against approved source. Preserve a backup and inventory unresolved auctions, pending webhook work, delivery review states, and expiry errors. Never log author IDs, bodies, or tokens during this inventory.
- Verify server-only access and tenant isolation for auctions, cursors, delivery reviews, and expiry failures. Browser RLS failures must not be “fixed” by granting direct access to these tables.
- Resolve the intentional bootstrap parity failure in its isolated task. Review full-suite baseline failures separately; this change does not establish system-wide test health.
- Confirm an authenticated external scheduler actually invokes the webhook cron and records `auctionExpiry.failed`/`unavailable`. A headless browser component runs only while mounted and is not a durable scheduler.
- Quiesce writers/workers during the ordered upgrade and account for the deadlines migration's optional automatic pg_cron scheduling. Do not expose intermediate financial definitions. See the staging sequence for ledger handling and transaction boundaries.

## Post-deployment validation — operator only

Check HTTP authorization failures separately from degraded workspace reads. A missing explicit session returns 404; failed reads return 503 with `ready:false,degraded:true`. A successful empty workspace is allowed only after successful scoped reads. The form remains mounted but prevents mutation while hydration is unavailable and offers an explicit reload. The earlier fake 200 fallback was introduced to keep setup visible during schema/read failures; it incorrectly represented failed reads as an empty, ready workspace.

Check a real two-bidder round: trusted host closure locks the winner without an order, an older confirmation is stale, a same-second confirmation creates one order, and replay creates no second order. For timer closures, the confirmation floor remains the database winner-lock time. Check due/not-due/draining behavior, error-ledger writes, shipping totals, and public/private delivery review entries. Review entries are bounded to 50 and contain only channel/status in the browser; “50+” indicates the display cap, not an exact total.

## Poller and identity limitations

Initial calls explicitly include `order=reverse_chronological`, `filter=stream`, and requested `live_filter=no_filter`. Parameter tests establish request construction, not Meta's live response behavior. Pagination accepts only HTTPS, exact `graph.facebook.com`, and the exact version/video/comments path. Tokens travel in Authorization headers; continuation URLs have every `access_token` parameter removed.

A matching saved page-one anchor does not prove intermediate pages stayed unchanged. The poller therefore follows the freshly returned page chain rather than jumping to a saved opaque continuation. Scans remain bounded; sustained volumes exceeding the per-cycle page budget require an operator load test and potentially a separately designed durable catch-up mechanism. This task does not claim unbounded backlog throughput.

Advancing high water across `MISSING_FROM_ID` comments means they eventually leave the 20-second overlap and are no longer eligible for recovery by this poller. A future identity-unverified workflow must persist comments and their recoverable state **before** skipping/advancing. No synthetic identities or identity-unverified workflow were implemented. Real Meta diagnostics are still required before that work begins.

## Inbox diagnostics — isolated telemetry only

`components/inbox/InboxClient.tsx` logs recognized subscription states, safe error codes, and snapshot HTTP status/duration. The isolated patch is `remediation/inbox-telemetry.patch`. No subscription filters, recovery intervals, authentication gates, or connection-state behavior changed. Remove temporary telemetry after diagnosis.

Conditions that can keep the orange Inbox banner visible:

- `lib/realtime-visibility.ts:7` disposes subscriptions while hidden; recovery also returns early for hidden tabs.
- `InboxClient.tsx:447` recovery's `recovering` guard prevents a second overlapping snapshot. A pending request must settle before another attempt.
- Snapshot requests abort after 10 seconds. Abort, transport, malformed payload, and non-success HTTP responses cannot establish successful recovery.
- `lib/features/inbox/inbox-server.ts:35`–47 maps failures to 503 and gates reads on session (401), tenant access (404), and feature entitlement (403). Repeated polling cannot bypass those gates.
- Snapshot success establishes polling mode; a subscription failure still requires state diagnostics to distinguish transient reconnects from persistent channel failure.

Collect browser state transitions and status/duration only, plus worker invocation evidence. Do not include network Authorization headers, identifiers, or comment/message bodies. No runtime fix for the live Inbox banner is claimed without diagnostics.

## Repository security and remaining coverage

Metadata-only history inspection found npm content-addressed cache paths in older commits; `git ls-files -- .npm-audit-cache` is empty today and `.gitignore:23` excludes the directory. Assessment: **Likely benign npm cache**, based on path/history evidence only. Contents were not opened, so credential exposure cannot be ruled out. Existing logs and cache history should be inspected privately by an authorized operator; rotate credentials if exposure is confirmed. Rotation itself is not authorized or performed here. Common local cache/coverage directories are now ignored.

The existing webhook/slip suites have missing `facebookMessageEcho` exports and `comment-config` mocks; those fixture repairs remain separate. There is no passing end-to-end coverage from those failing slip-routing tests. It would be inaccurate to claim all slip-to-payment logic lacks passing coverage: the existing `test-auction-customer-tab-slip.cjs` contains two passing mocked settlement checks. Live slip/provider/payment behavior remains unverified.

Required external follow-up: private credential assessment/rotation decision; live database migration inventory and grants; synchronized bundle release; Meta live diagnostics and numeric-bid/identity testing; real scheduler confirmation; and browser delivery/Inbox diagnostics. None was performed by this offline task.
