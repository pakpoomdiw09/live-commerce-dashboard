const fs = require('node:fs'), path = require('node:path')
const folder = path.resolve(__dirname, '..')
const head = JSON.parse(fs.readFileSync(path.join(folder, 'hardening-head.json'), 'utf8'))
const final = JSON.parse(fs.readFileSync(path.join(folder, 'hardening-verified.json'), 'utf8'))
const added = final.failures.filter(x => !head.failures.includes(x))
const resolved = head.failures.filter(x => !final.failures.includes(x))
const intentional = added.filter(x => x.includes('bootstrap financial functions and timestamp volatility'))
const unexpected = added.filter(x => !intentional.includes(x))
const comparison = { baseline: head.counts, current: final.counts, added, intentional, unexpected, resolved }
fs.writeFileSync(path.join(__dirname, 'comparison.json'), JSON.stringify(comparison, null, 2) + '\n')
const read = file => { const b = fs.readFileSync(path.join(__dirname, file)); return b[0] === 255 && b[1] === 254 ? b.toString('utf16le') : b.toString('utf8') }
for (const file of ['typecheck.log', 'build.log']) if (!read(file).includes('Exit code: 0')) throw Error('Verification is not passing: ' + file)
const rows = [
  ['1.1', 'PASS', '`scripts/test-auction-hardening-2.cjs:5`; `remediation/sql-red.log` (2 failures before fix), `sql-green.log`, `targeted.log`. Real parser + PGlite: same-second confirmation creates exactly one order; older confirmation is stale; replay is idempotent.', 'High'],
  ['1.2', 'PASS', '`scripts/build-full-database-setup.cjs:145`–147; `supabase/live-auction-deadlines.sql:3`–5; `scripts/test-auction-hardening-2.cjs:23`. Not-due, draining, due/closed/winner-locked/no-order paths execute in PGlite.', 'High'],
  ['1.3', 'PASS', '`supabase/live-auction-audit-hardening-2.sql:3`–36; `app/api/cron/facebook-webhooks/route.ts:29`; SQL failure injection records only three columns and returns `{closed:0,failed:1}`. Cron response contract is tested.', 'High'],
  ['1.4', 'PASS', '`remediation/protected-files.txt`; `git log -- supabase/live-auction-audit-hardening.sql` identifies committed HEAD 39cf4dd. Audit 1 has zero diff; new audit 2 is last in the registry.', 'High'],
  ['1.5', 'PASS', '`remediation/drift.log`, `process.before.sql`, `process.after.sql`, `function.patch`: actual PGlite function definitions captured before/after audit 2.', 'High'],
  ['2.1', 'PASS', '`DEPLOY-PLAN.md`; both protected bootstrap files have zero diff. No generator command wrote a bundle.', 'High'],
  ['2.2', 'FAIL', '`scripts/test-auction-bundle-parity.cjs`; `remediation/parity-head.log` and `parity.log`. Intentional failure: both financial functions and timestamp volatility differ from stored bootstrap.', 'High'],
  ['3.1–3.3', 'PASS', '`scripts/test-auction-poller-remediation.cjs`; `remediation/poller-red.log` (three new assertions fail), `privacy-poller-green.log`. Exact initial parameters/path and shifted-page continuity tested with mocked Graph.', 'High'],
  ['3.4', 'PASS', '`DEPLOY-PLAN.md`, identity limitations. Missing-author comments age out of overlap after high-water advancement. Future persistence-first recovery is documented; identity-unverified implementation remains gated.', 'High'],
  ['4', 'PASS', '`scripts/test-auction-ingestion-privacy.cjs`; `remediation/privacy-red.log` (2/2 fail before fix), `targeted.log` (pass). Console spies exercise real handler/HTTP error paths with synthetic sensitive sentinels.', 'High'],
  ['5.1', 'PASS', '`app/api/live-auction/workspace/route.ts:32`; `components/live-cf/AuctionUnifiedForm.tsx:213`; workspace tests cover 404/503 and safe review hydration; form test keeps inputs mounted and blocks degraded submission. Red/green logs retained.', 'High'],
  ['5.2', 'PASS', '`components/live-cf/LiveSessionDashboard.tsx:488`; workspace API returns only channel/status from tenant-scoped review rows; API assertion rejects extra private fixture fields. Active dashboard includes badge/list and review-unavailable state.', 'Medium'],
  ['5.3', 'PASS', '`components/live-cf/LiveCommentPoller.tsx`; `scripts/test-auction-background.cjs` recognized-reasons test. `skip-red.log` fails before fix; `targeted.log` passes. Poller still returns null.', 'Medium'],
  ['6.1', 'PASS', '`remediation/financial-head.log` and `financial-green.log`: identical repaired fixtures, 12/12 passing in both roots. Fixtures dispatch public winner confirmation with the real parser before asserting orders.', 'High'],
  ['6.2', 'CANNOT VERIFY', 'Pre-existing webhook/slip fixture dependency failures remain. See baseline/current full logs and DEPLOY-PLAN coverage note. Two mocked auction slip settlement tests pass; failing full slip routes do not establish end-to-end payment coverage.', 'High'],
  ['6.3', unexpected.length ? 'FAIL' : 'PASS', '`hardening-head.json`, `hardening-verified.json`, `remediation/comparison.json`: ' + unexpected.length + ' unexpected new failures; ' + intentional.length + ' explicitly intentional parity failure. Entire suite remains non-green due to baseline failures.', 'High'],
  ['7', 'PASS', '`remediation/cache-history.txt`, `cache-paths.txt`, empty `cache-tracked.txt`, `cache-ignore.txt`; `.gitignore`. Metadata-only assessment: Likely benign npm cache; secret content/exposure was not verified.', 'Medium'],
  ['8.1', 'PASS', '`remediation/inbox-telemetry.patch`; `components/inbox/InboxClient.tsx:392`, `:398`, `:673`; existing real component lifecycle test passes in targeted/full runs. No runtime recovery behavior changed.', 'Low'],
  ['8.2 / live behavior', 'CANNOT VERIFY', '`DEPLOY-PLAN.md` documents hidden-tab, in-flight, 10-second timeout and API authorization/error gates. No browser/live diagnostics, Meta calls, scheduler inspection, or production queries were performed.', 'High'],
]
const source = `# Live Auction remediation — 2026-11-09 (Asia/Bangkok)

TypeScript and the production build both exit 0. All 29 targeted checks pass; the repaired financial fixtures pass 12/12 against clean HEAD and current source. The final whole-suite comparison has **${unexpected.length} unexpected new regressions**, plus the one requested intentional bootstrap parity failure. This is not a claim that the whole repository is green or that production is deployment-ready.

| Item # | Status | Evidence | Risk level |
| --- | --- | --- | --- |
${rows.map(r => '| ' + r.join(' | ') + ' |').join('\n')}

## Full-suite comparison

| Run | Tests | Pass | Fail | Exit |
| --- | ---: | ---: | ---: | ---: |
| Clean HEAD 39cf4dd, isolated worktree | ${head.counts.tests} | ${head.counts.pass} | ${head.counts.fail} | ${head.code} |
| Final working tree | ${final.counts.tests} | ${final.counts.pass} | ${final.counts.fail} | ${final.code} |

Unexpected newly failing cases: ${unexpected.length ? unexpected.map(x => '\n- ' + x).join('') : '**none**'}.

Intentional newly failing case: bootstrap financial functions and timestamp volatility parity. Existing complete-schema/full-database freshness failures remain; bundles were intentionally not regenerated.

The first working-tree full run found two genuine upgrade regressions (\`auction_expiry_failures\` already exists). Idempotent table/index creation fixed both; \`remediation/bootstrap-upgrades.log\` shows their targeted passes and \`hardening-verified.log\` is the subsequent full rerun. \`hardening-final.log\` is retained as the superseded diagnostic run.

Resolved baseline failures:

${resolved.map(x => '- ' + x).join('\n')}

The bank SVG asset result varies between the clean worktree and this workspace; no bank asset change is attributed to this task. Three financial fixture repairs are verified independently on both roots. The runner's case totals include unchanged poller scenarios registered through a reused fixture import; totals are execution counts, not a count of unique newly added scenarios.

All remaining exact failures and file lists are in \`remediation/comparison.json\` and the two full-run JSON/log pairs. The pre-existing slip-routing failures include missing \`facebookMessageEcho\` and \`comment-config\` mocks. They remain out of scope, not hidden or counted as passing. Two existing mocked auction slip-to-tab settlement checks pass; live slip ingestion/provider/payment has not been verified.

## SQL definition/history review

The only changes to the captured \`process_live_auction_comment\` definition are the two new local variables, trusted host-close event lookup/source timestamp selection, and replacement of the confirmation floor comparison. No financial allocation, order creation, replay handling, host-command timestamp checks, or unrelated function-body changes appear in \`remediation/function.patch\`. Timer closures still use \`winner_locked_at\`.

Audit 1 and both stored bundles have zero diff against committed HEAD. Audit 2 adds a three-column RLS-protected expiry ledger, reporting RPC, compatibility wrapper, confirmation-floor fix, and grants. The reporting RPC is called by cron so failed-expiry counts reach its caller. Existing integer-RPC callers retain compatibility. No historical migration was reset or overwritten.

## Review artifacts and isolation

- [Full unified Parts 1/3/4/5 diff against HEAD, whitespace ignored](remediation/parts-1-3-4-5.patch)
- [This task's logic diff against the captured entry state](remediation/task-entry-logic.patch)
- [Inbox telemetry only](remediation/inbox-telemetry.patch)
- [Concise in-scope git status](remediation/status.txt)
- [Deployment plan and operator checks](DEPLOY-PLAN.md)
- [Commands, verification logs and metadata](remediation/verification.json)
- [Before/after failing-then-passing test evidence](remediation/red-green.json)
- [Actual function-definition drift](remediation/function.patch)

No formatter ran. Inherited dirty files, old reports, baseline worktree, and external changes were preserved. The task-entry diff distinguishes this task from inherited changes; the HEAD diff includes inherited business changes in the requested files while ignoring whitespace-only changes. The isolated Inbox patch was not committed, because this task does not authorize staging/committing the shared dirty tree.

## Unverified work and operator actions

Production migrations, RLS state, real Graph behavior, high-volume backlog throughput, live delivery/Inbox UI, external worker scheduling, and credential exposure are **not verified** by offline mocks/PGlite. A sustained backlog beyond the bounded re-walk budget needs a dedicated load test/catch-up design. The form reload/disabled behavior and review-list integration are covered by source/API/component checks, not an authenticated browser session.

No production migration/deployment, real Graph call, credential-file read, token rotation, or identity-unverified implementation occurred. An authorized operator must inventory live migration/checksum state, release synchronized bundles separately, privately assess historical cache exposure and rotate confirmed exposed tokens, provide sanitized Meta/browser diagnostics, and prove authenticated external cron invocations. The explicit identity phase gate remains in force.

One initial concurrent standalone type check collided with Next.js regenerating \`.next/types\`. The sequential post-build check exits 0; its final log is \`remediation/typecheck.log\`. The build exits 0 with existing lint warnings. No compile/bundling errors remain.
`
fs.writeFileSync(path.join(folder, 'REMEDIATION.md'), source)
console.log(JSON.stringify({ baseline: head.counts, final: final.counts, unexpected, intentional, resolved }))
if (unexpected.length) process.exitCode = 1
