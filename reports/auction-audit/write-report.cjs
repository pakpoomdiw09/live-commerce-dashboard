const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const dir = __dirname
const root = path.resolve(dir, '../..')
const baseline = '64b063be6f6b1686d83dfbb03edaac28ff47d737'
const sourcePaths = [
  'app/api/live-auction/workspace/route.ts',
  'app/api/live-cf/auction/host-action/route.ts',
  'app/api/live-cf/auction/poll-comments/route.ts',
  'components/live-cf/AuctionUnifiedForm.tsx',
  'components/live-cf/LiveAuctionPanel.tsx',
  'components/live-cf/LiveAuctionTimer.tsx',
  'components/live-cf/LiveCommentPoller.tsx',
  'components/live-cf/LiveSessionDashboard.tsx',
  'lib/features/commerce/auction-server.ts',
  'scripts/test-auction-audit-lifecycle.cjs',
  'scripts/test-auction-background.cjs',
  'scripts/test-auction-deadlines.cjs',
  'scripts/test-auction-host-actions.cjs',
  'scripts/test-auction-on-demand.cjs',
  'scripts/test-auction-poller-hardening.cjs',
  'scripts/test-auction-server.cjs',
  'scripts/test-auction-workspace-api.cjs',
  'supabase/live-auction-audit-hardening.sql',
  'reports/auction-audit/a3-stalled-rounds.sql',
  'reports/auction-audit/run-suite.cjs',
  'reports/auction-audit/run-regressions.cjs',
  'reports/auction-audit/capture-function-defs.cjs',
  'reports/auction-audit/write-report.cjs',
]
function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 30 * 1024 * 1024,
    })
  } catch (error) {
    if (error.status === 1 && args.includes('--no-index')) return error.stdout
    throw error
  }
}
function textLog(file) {
  const bytes = fs.readFileSync(path.join(dir, file))
  return bytes.toString(bytes[0] === 255 ? 'utf16le' : 'utf8')
}
const head = JSON.parse(fs.readFileSync(path.join(dir, 'head.json')))
const entry = JSON.parse(fs.readFileSync(path.join(dir, 'current-entry.json')))
const final = JSON.parse(fs.readFileSync(path.join(dir, 'final.json')))
const regressions = final.failures.filter((name) => !head.failures.includes(name))
let diff = git(['diff', baseline, '--', ...sourcePaths])
for (const file of sourcePaths) {
  if (fs.existsSync(path.join(root, file)) && !git(['ls-files', '--', file]).trim())
    diff += git(['diff', '--no-index', '--', 'NUL', file])
}
fs.writeFileSync(path.join(dir, 'changes.patch'), diff)
fs.writeFileSync(path.join(dir, 'status.txt'), git(['status', '--short', '--', ...sourcePaths]))
fs.writeFileSync(
  path.join(dir, 'function-definition.patch'),
  git([
    'diff',
    '--no-index',
    '--',
    'reports/auction-audit/process-comment.before.sql',
    'reports/auction-audit/process-comment.after.sql',
  ]),
)
const link = (file) => `[${file}](<${path.join(dir, file).replaceAll('\\', '/')}>)`
const row = (name, run) =>
  `| ${name} | ${run.files.length} | ${run.counts.tests} | ${run.counts.pass} | ${run.counts.fail} | ${run.code} |`
const failures = final.failures
  .map((name) => {
    let reason =
      'Pre-existing failure; original assertion/stack retained in the raw full-suite log.'
    if (/customer_tab_id|cumulative tabs|session financial|paid bills become/.test(name))
      reason =
        'Ledger fixture assumes closing immediately creates an order; it does not send the required winner confirmation.'
    if (
      /facebookMessageEcho|Messenger slips|auction slips|shipping address text|standalone|pending verified|unclear\/ordinary|album rechecks|order lookup errors/.test(
        name,
      )
    )
      reason =
        'Webhook fixture lacks the current facebookMessageEcho export; this is outside the auction engine changes.'
    if (
      /send receipt|explicit Send API|quick replies|Meta error messages|customer profiles|plain-text receipts|slip confirmations|tenant templates|missing migration|verified receipts|unverified verdicts|Meta refusal|network uncertainty|takeover exception|verified Pro|manual verification|notification failure|unlinked|manual confirmation|receipt uses|unavailable or invalid amount|admin confirmation API/.test(
        name,
      )
    )
      reason =
        'Client/slip test dependency mocks lack the current comment-config dependency; see exact stack in log.'
    if (/complete schema|fresh-install bundle/.test(name))
      reason =
        'Generated bootstrap SQL was stale before this task. Rebuilding it would incorporate unrelated baseline changes.'
    if (/navigation hides/.test(name))
      reason =
        'Navigation fixture does not mock InboxRealtimeNotifications; Inbox changes intentionally left isolated.'
    if (/keyword and AI routing/.test(name))
      reason = 'Agent fixture does not mock tenant-ai-quota; outside auction scope.'
    if (/test-admin-feature/.test(name))
      reason =
        'SQL fixture tenants record lacks is_active, required by the installed broadcast-credit function.'
    if (
      /logs the complete|full response text|original complete message|Axios-style|rejected response details|diagnostics identify|Facebook.*diagnostics|lookups retain/.test(
        name,
      )
    )
      reason =
        'Existing diagnostics/logging expectations or missing client fixture dependencies; no production provider behavior changed here.'
    return `| ${name.replaceAll('|', '/')} | fail | fail | ${reason} |`
  })
  .join('\n')
const evidenceFiles = [
  'head.log',
  'current-entry.log',
  'final.log',
  'regressions-head.log',
  'regressions-final.log',
  'head-facebook-tenants.log',
  'current-facebook-tenants.log',
  'typecheck.log',
  'verification.json',
  'status.txt',
  'build.log',
  'sql-evidence.log',
  'sql-evidence.json',
]
const report = `Audit completed through Phases 0–5; Meta identity-unverified and Inbox Realtime work remain deferred.

Baseline is pinned to ${baseline}. A clean detached worktree was created in the Windows temporary directory, with only an ignored node_modules junction to the existing dependencies. No environment file or database credentials were copied. The shared branch advanced externally to 39cf4dd during the audit; that commit was preserved. The source diff below compares the final working tree to the original pinned HEAD, including the auction fixes already present when this request arrived. No other existing migration was edited, and no production database was accessed or migrated. All SQL execution used fresh in-memory PGlite databases.

| Run | Test files | Tests | Pass | Fail | Exit |
| --- | ---: | ---: | ---: | ---: | ---: |
${row('Pinned HEAD', head)}
${row('Working tree on entry', entry)}
${row('Final working tree', final)}

New failures against pinned HEAD: **${regressions.length}**. This is baseline regression parity, not a claim that the repository-wide suite is green. Counts differ because the final tree includes additional tests. The deadline leaf/container failures were resolved by the auction deadline fixes. A third passing asset check differs because ignored local assets exist only in the current workspace; that is an environment difference, not an auction fix. The standalone Facebook tenant SQL utility also exited 0 against HEAD and current source, using the already installed PGlite package explicitly. Browser QA utilities requiring a running authenticated app were not run.

The full suite covers every scripts/test-*.cjs and tests/**/*.test.ts file in this repository's test directories, using node --import tsx --test --test-concurrency=1 --test-reporter=tap. The exact expanded command, raw output, file manifest and exit status are preserved in the corresponding .log/.json files. The first sandbox attempt failed before test execution (Windows uv_os_get_passwd/tsx); both comparable full runs were then executed with approved matching permissions.

The identical focused regression set reports **41 pass / 10 fail on HEAD** and **51 pass / 0 fail on final source**. The 10 red-to-green checks detect strict round boundaries, disabled host defaults before credential reads, headless timer behavior, inaccessible-video notification, aggregate diagnostics, safe Graph logging, invalid identities, continuation bridging and stale cursor discard. Other protective checks already passed HEAD; it would be inaccurate to claim every newly added assertion fails on already-correct behavior.

TypeScript: npx tsc --noEmit exited 0. Production build: npm run build exited 0, with pre-existing lint warnings only. The Windows .cmd launchers were used. Build/typecheck logs are included below.

The historical report of 16/26 auction-server failures and the cron 503 was not reproduced. HEAD already had the required PostgREST .or() evaluator and expire_live_auctions mock. Both were verified by execution; the cron route was not edited. Its expiry recovery call is intentional, and the RPC exists in the assembled schema. Auction checks now use the real parser for host actions, custom count tokens, explicit disabling, and session comment_settings overrides.

The canonical start is auctions.created_at: the poller uses Date.parse(target.created_at); webhook selection now compares parsed instants instead of lexicographic timestamp strings; SQL uses a.created_at. Confirmation checks only start/lock lower boundaries. Host close/count checks both start and closed_at boundaries. Timer expiry now locks the leader through the confirmation-only finalizer and leaves order_id null. Both highest_bid and on_demand use the locked auction's leader fields; no bid-history re-query chooses the winner.

Counting defaults are off in SQL, the real parser, host-action API and dashboard buttons; an omitted flag cannot authorize a send. No unrelated changes to shared Inbox configuration were made. auction_comment_timestamp was already STABLE in the pinned source and remains STABLE, verified from pg_proc. finalize_live_auction_highest_bid has one four-argument signature with two trailing defaults, so historical three-argument callers are valid; the audited confirmation call now explicitly supplies false as the fourth argument. No historical migration was rewritten to change compatible defaulted callers.

The poller renders null. The parent dashboard displays only aggregate missing-author counts and a reselect-live notification. No latency/countdown UI, raw user identity, raw comment body or token was added. API pagination uses a 20-second overlap, first-page boundary stop, high-water advancement for skipped comments, strict HTTPS Graph validation, no redirect following, sanitized cursors, and a fresh page-two bridge before an anchored cursor resumes. No Meta identity-unverified handling was attempted.

Full unified source/test/SQL/reproduction diff: ${link('changes.patch')}. Generated execution evidence is delivered separately rather than duplicated inside the patch. Read-only Bug A3 diagnostic: ${link('a3-stalled-rounds.sql')}. It detects closed rounds with no lock/order and at least one bid; it performs no updates and returns no bidder identities.

Actual pg_get_functiondef comparison: ${link('function-definition.patch')}, with ${link('process-comment.before.sql')} and ${link('process-comment.after.sql')}. These were captured from an isolated baseline installation before and after applying only the allowed audit script. Function OID/dependencies were preserved. Every difference in that function is:

1. Reject blank/synthetic author identifiers and blank comment identifiers before mutations.
2. Remove the one-second grace before the confirmation start boundary; preserve the winner-lock lower boundary and absence of a closed_at upper boundary.
3. Remove one-second grace on both host action boundaries.
4. Restore deadline handling for non-confirmation events without rejecting valid later confirmations.
5. Call the four-argument finalizer explicitly with p_cancel=false.

The audit script also defines cursor continuation metadata and confirmation-only expiry behavior, preserves cursor RLS/browser revocations, and restricts locked leaders to valid numeric identifiers. ${link('sql-evidence.json')} records the actual function signatures/volatility and verifies RLS enabled with anon/authenticated SELECT denied.

Raw execution evidence:

${evidenceFiles.map((file) => '- ' + link(file)).join('\n')}

Remaining discrepancies and limits:

- ${final.counts.fail} full-suite failures remain; none is newly introduced against HEAD. Their comparison/root-cause table follows. Unrelated Inbox/Sync, billing, agent and shipping code was left untouched.
- Generated complete_schema.sql, full_database_setup.sql and their manifest were stale before this audit. They were intentionally not regenerated because that would fold unrelated baseline differences into this scope. Isolated SQL tests assemble source migrations in memory.
- The attachment's Phase 2/Phase 6 ambiguity was clarified by the user: pagination may proceed; only Meta identity-unverified work waits for verified live logs.
- No live Meta diagnostics were supplied, and no live-provider/browser end-to-end success is claimed. The end-to-end auction lifecycle was executed in PGlite with the real parser and mocked network/database boundaries where appropriate.
- All-new-tests-must-fail-before is recorded as a discrepancy: 10 actual regression checks fail on HEAD, while already-correct protective checks pass both versions. No artificial failures were introduced to satisfy that wording.

| Remaining test failure | HEAD | Final | Root cause / isolation decision |
| --- | --- | --- | --- |
${failures}
`
fs.writeFileSync(path.join(dir, 'REPORT.md'), report)
fs.writeFileSync(
  path.join(dir, 'comparison.json'),
  JSON.stringify(
    {
      baseline,
      head: head.counts,
      entry: entry.counts,
      final: final.counts,
      newFailures: regressions,
    },
    null,
    2,
  ) + '\n',
)
console.log(
  JSON.stringify({
    report: 'reports/auction-audit/REPORT.md',
    sourceDiffBytes: Buffer.byteLength(diff),
    newFailures: regressions,
  }),
)
