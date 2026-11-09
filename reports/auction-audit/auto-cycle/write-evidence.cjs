const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process')
const root = path.resolve(__dirname, '../../..')
const git = args => { const r = cp.spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }); if (r.status > 1) throw Error(r.stderr); return r }
const tests = JSON.parse(fs.readFileSync(path.join(__dirname, 'auction-tests.json'), 'utf8'))
if (tests.exit !== 0 || tests.counts.fail !== 0) throw Error('Test run is not passing')
const read = file => { const b = fs.readFileSync(path.join(__dirname, file)); return b[0] === 255 && b[1] === 254 ? b.toString('utf16le') : b.toString('utf8') }
for (const file of ['typecheck.log', 'build.log']) if (!read(file).includes('Exit code: 0')) throw Error('Verification failed: ' + file)
const protectedFiles = ['supabase/live-auction-deadlines.sql', 'supabase/live-auction-audit-hardening.sql', 'supabase/live-auction-audit-hardening-2.sql', 'supabase/live-auction-manual-host-close.sql', 'supabase/complete_schema.sql', 'supabase/full_database_setup.sql']
if (git(['diff', '--quiet', 'HEAD', '--', ...protectedFiles]).status !== 0) throw Error('Protected SQL changed')
const files = ['app/api/live-auction/workspace/route.ts', 'components/live-cf/AuctionUnifiedForm.tsx',
  'lib/features/commerce/auction-server.ts', 'lib/features/commerce/auction-types.ts', 'lib/features/commerce/session-automation.ts',
  'lib/integrations/facebook/auction-comment-parser.ts', 'scripts/build-full-database-setup.cjs',
  'scripts/test-auction-auto-cycle.cjs', 'scripts/test-auction-manual-form.cjs', 'scripts/test-auction-preflight.cjs',
  'scripts/test-auction-server.cjs', 'scripts/test-auction-workspace-api.cjs', 'supabase/live-auction-auto-cycle.sql']
let diff = git(['diff', '-w', 'HEAD', '--', ...files]).stdout
for (const f of files) if (!git(['ls-files', '--', f]).stdout.trim()) diff += git(['diff', '--no-index', '-w', '--', 'NUL', f]).stdout
fs.writeFileSync(path.join(__dirname, 'logic.patch'), diff)
const gates = JSON.parse(read('preflight-current.json'))
fs.writeFileSync(path.join(__dirname, 'verification.json'), JSON.stringify({ tests: tests.counts, testExit: tests.exit,
  typecheckExit: 0, buildExit: 0, preflightChecks: gates.length, preflightBlocked: gates.filter(r => r.status !== 'PASS').length,
  parity: 'Known intentional failure; bootstrap regeneration remains separate', protectedFilesUnchanged: protectedFiles,
  productionMigration: false, graphRequests: false, credentialInspection: false }, null, 2))
console.log(JSON.stringify({ tests: tests.counts, typecheck: 0, build: 0, preflightChecks: gates.length }))
