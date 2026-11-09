# Continuous-cycle verification

The engine for configured host closure, atomic successor creation, and parallel old-winner confirmation is implemented. This pass fixed a remaining polling boundary that could skip an older winner's delayed confirmation while a newer round was active. Direct Count/Close/Immediate Stop controls are still absent from the active unified dashboard; see [CONTROL-REVIEW.md](CONTROL-REVIEW.md) for the control-by-control assessment.

| Check | Result | Evidence |
| --- | --- | --- |
| Targeted cycle, server/outbox, and polling tests | 49 pass, 0 fail | [targeted.log](targeted.log) |
| Polling regression before fix | Two new cases fail; scope isolation case passes | [polling-red.log](polling-red.log) |
| Typecheck | exit 0 | [typecheck.log](typecheck.log) |
| Production build | exit 0, existing lint warnings | [build.log](build.log) |
| Full repository suite | 1013 tests, 955 pass, 58 fail, exit 1 | [Full log](../cycle-final-full.log), [metadata](../cycle-final-full.json) |
| Newly failing names versus previous completed full run | 0 | [comparison.json](comparison.json) |

The entire repository is **not green**. All 58 failures match the previously recorded full run: the known unrelated baseline failures and the intentionally red bootstrap parity test remain. They were not suppressed, repaired outside scope, or represented as passing. The comparison is against the previous completed full-run artifact, not a newly rerun baseline worktree for this pass. Execution counts include unchanged tests registered through a reused poller fixture import.

The poller's oldest-pending-winner lookup is scoped to tenant, Page and the selected live video. It preserves the 20-second high-water overlap and existing source-time validation in SQL. A newer active round therefore does not stop pagination too early for an older pending winner; confirmed/foreign/other-live rounds do not widen the scan. This does not promise recovery beyond the existing bounded overlap.

The source migration chain was not modified by this polling fix. The previously committed auto-cycle migration must still be installed and a valid template/settings saved for live cycling. No live database migration, Meta request, credential inspection, or authenticated browser verification was performed. Current code alone cannot establish that production has applied the migrations.

[Polling change](polling.patch) · [Control assessment](CONTROL-REVIEW.md)
