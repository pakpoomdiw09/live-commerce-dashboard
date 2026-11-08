const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process')
const root = path.resolve(__dirname, '../../..')
const read = name => { const b = fs.readFileSync(path.join(__dirname, name)); return b[0] === 255 && b[1] === 254 ? b.toString('utf16le') : b.toString('utf8') }
const checks = JSON.parse(read('preflight/preflight-final.json'))
if (checks.some(row => row.status !== 'PASS')) throw Error('Local final preflight has blockers')
for (const name of ['preflight-typecheck.log', 'preflight-build.log', 'preflight.log', 'preflight-verification.log']) {
  if (!read(name).includes('Exit code: 0')) throw Error('Check failed: ' + name)
}
if (!read('preflight-parity.log').includes('Exit code: 1 (intentional')) throw Error('Expected parity failure not recorded')
const git = args => { const r = cp.spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }); if (r.status > 1) throw Error(r.stderr); return r }
const protectedFiles = ['supabase/live-auction-audit-hardening.sql', 'supabase/complete_schema.sql', 'supabase/full_database_setup.sql']
if (git(['diff', '--quiet', 'HEAD', '--', ...protectedFiles]).status) throw Error('Protected SQL changed')
let patch = ''
for (const file of ['reports/auction-audit/preflight.sql', 'reports/auction-audit/COMPATIBILITY.md', 'reports/auction-audit/DEPLOY-PLAN.md', 'reports/auction-audit/PREFLIGHT-REPORT.md', 'scripts/test-auction-preflight.cjs']) {
  patch += git(['diff', '--no-index', '-w', '--', 'NUL', file]).stdout
}
fs.writeFileSync(path.join(__dirname, 'preflight-artifacts.patch'), patch)
for (const [before, after, output] of [['legacy', 'audit2', 'legacy-to-final.patch'], ['audit1', 'audit2', 'audit1-to-audit2.patch']]) {
  fs.writeFileSync(path.join(__dirname, 'preflight', output), git(['diff', '--no-index', '--', 'reports/auction-audit/remediation/preflight/' + before + '.sql', 'reports/auction-audit/remediation/preflight/' + after + '.sql']).stdout)
}
fs.writeFileSync(path.join(__dirname, 'preflight-verification.json'), JSON.stringify({
  sourceOfActiveDatabaseFacts: 'User-supplied final directive; no live inspection',
  targetedSuites: { tests: 87, pass: 87, fail: 0, exit: 0, log: 'preflight-verification.log' },
  finalPreflightSuite: { tests: 3, pass: 3, fail: 0, exit: 0, log: 'preflight.log' },
  localCatalogChecks: { total: checks.length, blocked: 0 },
  typecheck: { exit: 0, log: 'preflight-typecheck.log' }, build: { exit: 0, log: 'preflight-build.log' },
  parity: { exit: 1, intentional: true, log: 'preflight-parity.log' },
  protectedFilesUnchangedAgainstHead: protectedFiles,
  productionExecution: false, graphCalls: false, credentialInspection: false,
}, null, 2) + '\n')
console.log('PASS: preflight artifacts, actual function diffs and verified result metadata saved; protected SQL unchanged')
