const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process')
const folder = path.resolve(__dirname, '..')
const before = JSON.parse(fs.readFileSync(path.join(folder, 'hardening-verified.json'), 'utf8'))
const current = JSON.parse(fs.readFileSync(path.join(folder, 'cycle-final-full.json'), 'utf8'))
const added = current.failures.filter(name => !before.failures.includes(name))
const resolved = before.failures.filter(name => !current.failures.includes(name))
const read = file => { const b = fs.readFileSync(path.join(__dirname, file)); return b[0] === 255 && b[1] === 254 ? b.toString('utf16le') : b.toString('utf8') }
for (const file of ['typecheck.log', 'build.log']) if (!read(file).includes('Exit code: 0')) throw Error('Nonpassing verification: ' + file)
const result = { full: current.counts, fullExit: current.code, added, resolved,
  targeted: { tests: 49, pass: 49, fail: 0 }, typecheckExit: 0, buildExit: 0,
  baseline: 'hardening-verified.json (previous completed full run)', productionExecution: false }
fs.writeFileSync(path.join(__dirname, 'comparison.json'), JSON.stringify(result, null, 2))
const git = args => { const r = cp.spawnSync('git', args, { encoding: 'utf8', windowsHide: true }); if (r.status > 1) throw Error(r.stderr); return r.stdout }
let diff = git(['diff', 'HEAD', '--', 'app/api/live-cf/auction/poll-comments/route.ts'])
diff += git(['diff', '--no-index', '--', 'NUL', 'scripts/test-auction-cycle-polling.cjs'])
fs.writeFileSync(path.join(__dirname, 'polling.patch'), diff)
fs.writeFileSync(path.join(__dirname, 'SUMMARY.md'), `# Continuous-cycle verification

The engine for configured host closure, atomic successor creation, and parallel old-winner confirmation is implemented. This pass fixed a remaining polling boundary that could skip an older winner's delayed confirmation while a newer round was active. Direct Count/Close/Immediate Stop controls are still absent from the active unified dashboard; see [CONTROL-REVIEW.md](CONTROL-REVIEW.md) for the control-by-control assessment.

| Check | Result | Evidence |
| --- | --- | --- |
| Targeted cycle, server/outbox, and polling tests | 49 pass, 0 fail | [targeted.log](targeted.log) |
| Polling regression before fix | Two new cases fail; scope isolation case passes | [polling-red.log](polling-red.log) |
| Typecheck | exit 0 | [typecheck.log](typecheck.log) |
| Production build | exit 0, existing lint warnings | [build.log](build.log) |
| Full repository suite | ${current.counts.tests} tests, ${current.counts.pass} pass, ${current.counts.fail} fail, exit ${current.code} | [Full log](../cycle-final-full.log), [metadata](../cycle-final-full.json) |
| Newly failing names versus previous completed full run | ${added.length} | [comparison.json](comparison.json) |

The entire repository is **not green**. All 58 failures match the previously recorded full run: the known unrelated baseline failures and the intentionally red bootstrap parity test remain. They were not suppressed, repaired outside scope, or represented as passing. The comparison is against the previous completed full-run artifact, not a newly rerun baseline worktree for this pass. Execution counts include unchanged tests registered through a reused poller fixture import.

The poller's oldest-pending-winner lookup is scoped to tenant, Page and the selected live video. It preserves the 20-second high-water overlap and existing source-time validation in SQL. A newer active round therefore does not stop pagination too early for an older pending winner; confirmed/foreign/other-live rounds do not widen the scan. This does not promise recovery beyond the existing bounded overlap.

The source migration chain was not modified by this polling fix. The previously committed auto-cycle migration must still be installed and a valid template/settings saved for live cycling. No live database migration, Meta request, credential inspection, or authenticated browser verification was performed. Current code alone cannot establish that production has applied the migrations.

[Polling change](polling.patch) · [Control assessment](CONTROL-REVIEW.md)
`)
console.log(JSON.stringify(result))
if (added.length) process.exitCode = 1
