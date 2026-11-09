# Dashboard counting and continuous auction cycles

## Behavior

- Dashboard controls configure `countEnabled`, `counting_tags`, configured close words, confirmation keywords, and `autoCycleRounds`. New unified-form drafts enable cycling; merchants can disable it. Counting is no longer forcibly disabled by the API or the inner SQL settings normalizer. The outer financial normalizer and its winner-flow / accumulation defaults remain intact.
- Only a recognized host/Page can count or close. Separate configured count comments and newline-separated sequences update `host_count` without closing. Configured closing tags take precedence. One comment can close at most one round, even when it contains multiple close lines. Unknown lines before a command cause the sequence to be ignored. No built-in numeric countdown length is enforced: tags can represent 5→1, 3→1, custom words, or merchant-defined values.
- A configured host closure locks the old highest bidder and closure timestamp, then creates exactly one active successor from the saved template in the same database transaction. The item, starting price, minimum step, shipping fee, bank, aliases, hosts, reply templates and public/private flags are preserved. Successors have no timer, no leader, no order, and a zero current price until bidding begins.
- The round template is persisted on `live_sessions.auction_round_template`. Inputs hydrate from it; editing template prices after bids does not alter the current round's prices. The bank remains locked once bids exist. Saving applies changes to following rounds. Unsaved edits are not visible to the backend. Changes of active round refresh the form's base identity while preserving dirty draft edits.
- Previous unconfirmed winners are routed before the active round when their configured confirmation keyword matches. Numeric bids go to the active successor. In cycled sessions, a fresh confirmation cannot invoice an active round: `awaiting_host_close` is durably checkpointed and replay cannot turn it into a sale after closure. The winner must send a new confirmation after host closure.
- Event/comment replay lookup spans the same tenant/Page/live so a retried close cannot close its own successor. A unique predecessor link enforces one successor. Confirmation results carry the original auction ID so replay routed through the current active row still drains the original winner's outbox. Existing delivery claims and uncertain-send protections remain in place.
- Successor creation uses the host close's source-time floor, bounded by event receipt time, so comments already queued after the closure are not rejected merely because processing created the successor later. Existing queue ordering and stale-boundary checks remain active.
- Failure to create a successor rolls the entire closure back. The unchanged event can safely retry. No order is created on close; order allocation and notifications remain tied to winner confirmation. Existing explicitly timed/non-cycling SQL callers retain their behavior.

## Implementation and migration

Apply `supabase/live-auction-auto-cycle.sql` only after the existing deadlines → audit 1 → audit 2 → manual-host-close chain and its prerequisites. This is a new, last-registered forward migration. Historical migrations and stored bootstrap bundles were not edited or regenerated. No migration, deployment, real Meta request, or credential inspection was performed on production.

The migration adds a saved template column and a unique predecessor link, defines host-command classification and successor creation, updates the existing workspace/comment RPCs, and changes only the inner legacy settings normalizer's forced counting/closing flags. It preserves the outer split-summary wrapper; a full test run caught the initial wrapper regression, and restoring that wrapper resolved it. Server-only RPC permissions are retained.

Preflight now checks the new columns/helpers and seven reviewed function bodies. Source digests, the compiled comment function and local preflight results are saved here. These describe isolated PGlite, not live database readiness. Enable cycling by saving the dashboard after the migration is installed; existing settings/templates are not bulk-rewritten at install time.

## Verified evidence

Final combined result: **135 tests, 135 passes, zero failures**. Typecheck and build both exit **0**. The local read-only preflight has **149 passing checks**. The existing bootstrap parity test remains intentionally failing and is recorded separately.

- `red.log`: new counting/cycle/template/API assertions fail before remediation.
- `pre-close-confirmation-red.log`: demonstrates the initially uncovered premature-confirmation case before its new guard.
- `notification-replay-red.log`: the replay outbox assertion fails on the committed pre-change server source.
- `green.log`, `targeted.log`, `cycle-green.log`, `parallel-notifications.log`, `normalizer-green.log`, `preflight-green.log`, `form-api.log`: focused passing checks. The final combined run is `auction-tests.log` / `auction-tests.json`, covering every auction suite except the explicitly intentional bundle-parity test, plus financial/session/shipping and parser/config suites.
- `first-auction-tests.log`: retained initial run showing the financial-default regression. The final run uses the preserved financial wrapper and passes.
- `typecheck.log`, `build.log`: command exit codes. `parity.log` records the existing intentional bootstrap parity failure, which remains outside this migration-only task.
- `process-current.sql` and `process-drift.patch`: actual local `pg_get_functiondef` and its changes versus the prior audit-2 definition. The staged preflight test also checks final-vs-fresh function equality.

The tests use the real parser and in-memory PostgreSQL for five-step/custom counts, multiline closure, a 200-baht successor, queued next-round bids, old winner confirmation during new bidding, a second rollover, duplicate host/confirmation events, protected template edits, all four public/private switch combinations, and transaction rollback. Notification transports are mocked; no real Facebook delivery or authenticated browser session is claimed. The broader repository's previously documented unrelated failures were not repaired or represented as passing.

Results and clean-tree commits are summarized in the final response. Reproduce with `node reports/auction-audit/auto-cycle/run-tests.cjs`; it writes only this folder's test evidence. Source fingerprint refresh uses local PGlite through `refresh-preflight.cjs` and never updates bootstrap bundles.
