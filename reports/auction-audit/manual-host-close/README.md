# Manual host-close workspace mode

The unified form no longer renders the auction-duration input or mounts its timer component. Duration is not part of editable/hydrated draft state. Every create/update payload includes `durationSeconds: null`; the workspace API accepts and preserves that null, including when duration is omitted by an API caller.

`supabase/live-auction-manual-host-close.sql` is a new forward-only migration registered after audit 2. It replaces only `save_auction_workspace` and preserves its authorization, atomic save, and request replay behavior through the existing underlying RPC. Explicit JSON null clears `duration_seconds`, `timer_started_at`, and `ends_at` inside the save transaction. This also clears the timer initialized by the insert trigger before the new row commits. A replayed historical timed save cannot restart a timer after a newer manual save.

Explicit numeric durations and direct SQL callers that omit duration retain the earlier timed behavior. Existing timed rounds are not bulk-modified: saving one through the updated form switches it to manual mode. Unrelated timer routes/callers remain supported. In manual mode, `close_due_live_auction` returns `not_due`, the expiry sweep ignores the round, a configured host close comment locks the highest bidder and returns `awaiting_confirmation`, and only that bidder's confirmation creates one order. No identities are fabricated.

## Release requirement

Apply the new manual-host-close migration through the approved migration process **after deadlines → audit 1 → audit 2**, before deploying/enabling this form/API against that database. The older save wrapper converts JSON null back to 300 seconds; changing the frontend alone is insufficient. The earlier read-only preflight checks the original hardening prerequisites; its success alone does not establish that this additional workspace migration is installed. Rehearse a real null-duration workspace save in isolated staging and verify all three timer fields remain null.

No production migration, deployment, Meta request, bootstrap regeneration, or credential inspection occurred. Historical migration files and stored bundles are unchanged. The already-known bootstrap financial parity test remains intentionally failing until the separate regeneration task.

## Verification

- `red.log`: the null-duration API and both database behaviors fail before the fix.
- `form-red.log`: both real form render/submit tests fail on the committed pre-change form.
- `green.log` / `form-green.log`: manual database/API behavior, form hydration/submission, and degraded-form safeguards pass after the fix.
- `auction-tests.log` / `auction-tests.json`: every `scripts/test-auction-*.cjs` suite except the explicitly intentional bundle-parity failure is run with the full-suite tsx loader. Final result: **104 tests, 104 passes, zero failures, exit 0**. Counts and exit code are stored in the JSON. The Windows sandbox's tsx startup ENOMEM was resolved by running the same offline tests outside the sandbox; no production access was used.
- `typecheck.log` and `build.log`: both commands exit **0**. `parity.log` separately records the expected parity failure.

The existing preflight rehearsal now applies the appended manual migration after audit 2 before comparing against a fresh install. The degraded-form test harness now provides `AbortSignal`, so an erroneous submission could actually reach the mocked fetch instead of failing early on a missing browser global.
