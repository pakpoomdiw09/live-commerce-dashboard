# Final directive: preflight and migration sequencing

The current workspace application is **not compatible with the active database described in the supplied audit**. That audit reports missing timers/expiry RPCs and legacy immediate-order comment SQL. No live database inspection, migration, deployment, Meta call, or credential inspection was performed in this task. The deployed application commit is unknown.

The required known suffix is **deadlines → audit 1 → audit 2**, after missing prerequisite migrations are resolved. Audit 2 alone cannot repair that baseline. Both stored bootstrap bundles remain unchanged and their parity check remains intentionally failing.

| Requirement | Status | Evidence |
| --- | --- | --- |
| Read-only prerequisite/capability preflight | PASS locally; live execution not performed | [preflight.sql](preflight.sql), [3-test log](remediation/preflight.log): empty database reports blockers without a catalogue exception or schema writes |
| Full-prefix staging simulation and ordered suffix | PASS locally | `scripts/test-auction-preflight.cjs:24`; same log; registry prefixes are replayed with the checksum-aware ledger |
| Legacy immediate-order behavior reproduced | PASS in a controlled simulation | Rehearsal overlays the two actual original functions from `supabase/live-auctions.sql`; host closure creates one legacy order before upgrade |
| Safe close and same-second confirmation after upgrade | PASS locally | Audit 1 closes without an order and reproduces the seconds race; audit 2 accepts the same confirmation once; genuinely pre-round confirmations stay stale; historical order is preserved |
| No unexplained final function drift | PASS locally | Actual `pg_get_functiondef` captured at legacy/deadlines/audit1/audit2 stages in [evidence folder](remediation/preflight); final definition equals fresh current-source installation |
| Readiness gates | PASS locally | [Baseline output](remediation/preflight/preflight-baseline.json): 37 blockers. [Final output](remediation/preflight/preflight-final.json): 142 checks, zero blockers. These counts describe only the simulated fixture, not the active Supabase instance |
| Bad browser grants / missing server RPC permission | PASS locally | Negative-permission test reports BLOCKED and leaves permissions unchanged |
| Application/database compatibility matrix | Prepared | [COMPATIBILITY.md](COMPATIBILITY.md) cites the real workspace call sites, distinguishes supplied active facts from unknown capabilities, and blocks release before schema/behavior validation |
| Existing auction/privacy/poller/workspace/financial/Inbox checks | PASS | [Verification log](remediation/preflight-verification.log): 87 tests, 87 passes, exit 0. Final expanded preflight was additionally rerun: 3/3, exit 0 |
| Bootstrap financial parity | FAIL, intentional | [Parity log](remediation/preflight-parity.log): exit 1; source-vs-bundle financial function/volatility differences remain. No bundle was regenerated |
| Broader repository baseline | Existing failures remain | Prior complete comparison: [hardening-head.json](hardening-head.json) vs [hardening-verified.json](hardening-verified.json), zero unexpected new failures, 57 retained failures plus one intentional parity failure. That full run predates the three new preflight tests; it is not represented as a new full run |
| Live migration readiness / hosted scheduler / Meta behavior | CANNOT VERIFY here | Requires authorized operator/staging/live evidence. PGlite does not exercise hosted pg_cron or real provider behavior |

Build/type-check results for this directive are recorded in `remediation/preflight-typecheck.log` and `remediation/preflight-build.log`; see `remediation/preflight-verification.json` for their verified exit statuses after completion.

The staged [legacy-to-final function diff](remediation/preflight/legacy-to-final.patch) includes the intended numeric-author/tenant guards, session-configured command parsing, confirmation-only close and winner order flow, source-time/deadline checks, and confirmation delivery targeting. The [audit-1-to-audit-2 diff](remediation/preflight/audit1-to-audit2.patch) isolates the source-time floor correction. No unexplained final definition drift is observed: the rehearsal asserts exact equality against a fresh source installation, and preflight checks all four reviewed financial/close function bodies.

## Changes added by this directive

- `reports/auction-audit/preflight.sql`: read-only catalogue checks grouped by prerequisite stage, types/signatures/volatility, protected table access, server report-RPC execution, and source-body drift checks. Missing schema returns BLOCKED instead of throwing. No application RPC, customer rows, identifiers, tokens, function bodies, or message bodies are returned.
- `scripts/test-auction-preflight.cjs`: empty-schema checks, real-parser/PGlite staged migration rehearsal, public winner confirmation/replay, pre-round stale boundary, preserved historical orders, final-vs-fresh definition comparison, and bad-grant detection.
- `reports/auction-audit/COMPATIBILITY.md` and updates to `DEPLOY-PLAN.md`: supplied active state, exact known migration suffix, missing-prefix resolution, release gates, writer/worker quiescence, hosted cron scheduling side effect, checksum handling, and staging/production distinction.
- Evidence under `reports/auction-audit/remediation/preflight*`. Existing application behavior, applied migration sources, and bootstrap bundles were preserved. No formatter ran and identity-unverified remains gated.

The preflight red evidence (`remediation/preflight-entry-red.log`) executes the new suite against the clean HEAD's missing preflight artifact and fails with ENOENT. It demonstrates the previously absent artifact, not a previously failing SQL behavior. The staging test independently reproduces the actual legacy order flow and the audit-1 timestamp race before proving the fixed flow.

## Operator sequence

1. Run the read-only preflight privately; establish the actual deployed application build and migration ledger/checksum inventory.
2. Resolve every `00_base` blocker from the registry. Rehearse the full prefix and **deadlines → audit 1 → audit 2** in disposable staging. Do not skip audit 1 because audit 2 exists.
3. Keep writers/workers quiesced through intermediate states. Account for the deadlines migration's optional automatic pg_cron scheduling. Verify transaction handling rather than concatenating files containing BEGIN/COMMIT inside another transaction.
4. Review stage definitions, preserved old orders/deadlines, winner-only order creation, replay, queue draining, expiry failure counts, grants, and scheduler execution before enabling the matching app.
5. Regenerate/review the bootstrap bundles in the separate isolated task. Live execution, production release, and Meta diagnostics remain external follow-up; none was performed here.

[Deployment plan](DEPLOY-PLAN.md) · [Compatibility / staging details](COMPATIBILITY.md) · [Existing logical diff](remediation/parts-1-3-4-5.patch) · [Preflight additions diff](remediation/preflight-artifacts.patch) · [Scoped git status](remediation/preflight-status.txt)
