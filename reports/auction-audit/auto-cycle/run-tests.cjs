// Offline tests only: PGlite and mocked transports, never a production connection.
const cp = require('node:child_process'), fs = require('node:fs'), path = require('node:path')
const root = path.resolve(__dirname, '../../..')
const files = fs.readdirSync(path.join(root, 'scripts')).filter(f => /^test-auction-.*\.cjs$/.test(f) && f !== 'test-auction-bundle-parity.cjs').map(f => 'scripts/' + f).concat([
  'scripts/test-customer-tabs.cjs', 'scripts/test-live-session-dashboard.cjs', 'scripts/test-shipping.cjs',
  'scripts/test-live-auctions.cjs', 'scripts/test-live-auction-dashboard-api.cjs',
  'tests/features/commerce/auction-comment.test.ts', 'tests/features/commerce/auction-confirmation.test.ts',
  'tests/features/commerce/comment-config.test.ts',
])
const args = ['--import', 'tsx', '--test', '--test-concurrency=1', '--test-reporter=tap', ...files]
const log = fs.openSync(path.join(__dirname, 'auction-tests.log'), 'w')
fs.writeSync(log, 'Command: node ' + args.join(' ') + '\n')
const result = cp.spawnSync(process.execPath, args, { cwd: root, stdio: ['ignore', log, log], windowsHide: true })
fs.closeSync(log)
const output = fs.readFileSync(path.join(__dirname, 'auction-tests.log'), 'utf8')
const counts = Object.fromEntries([...output.matchAll(/^# (tests|pass|fail|skipped|cancelled) (\d+)$/gm)].map(m => [m[1], Number(m[2])]))
fs.writeFileSync(path.join(__dirname, 'auction-tests.json'), JSON.stringify({ files, exit: result.status, counts }, null, 2))
console.log(JSON.stringify({ exit: result.status, counts }))
process.exitCode = result.status ?? 1
