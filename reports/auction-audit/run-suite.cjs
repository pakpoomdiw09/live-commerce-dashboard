// Offline unit/integration suites only. SQL tests use isolated PGlite databases.
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const root = path.resolve(process.argv[2])
const label = process.argv[3]
if (!/^[a-z-]+$/.test(label ?? '')) throw new Error('Invalid run label')
// These are operator-facing CLI tools, not unattended test suites. Keep them
// withdrawn from this auto-discovering runner even though their filenames match.
const withdrawn = new Set(['test-overview-fetch.cjs', 'test-followup-and-broadcast.cjs'])
const files = [
  ...fs
    .readdirSync(path.join(root, 'scripts'))
    .filter((f) => /^test-.*\.cjs$/.test(f) && !withdrawn.has(f))
    .map((f) => `scripts/${f}`),
  ...fs
    .readdirSync(path.join(root, 'tests'))
    .filter((f) => /\.test\.ts$/.test(f))
    .map((f) => `tests/${f}`),
  ...fs
    .readdirSync(path.join(root, 'tests/features/commerce'))
    .filter((f) => /\.test\.ts$/.test(f))
    .map((f) => `tests/features/commerce/${f}`),
].sort()
const networkGuard = path.resolve(__dirname, '../../scripts/test-network-guard.cjs')
const args = ['--require', networkGuard, '--import', 'tsx', '--test', '--test-concurrency=1', '--test-reporter=tap', ...files]
const log = fs.openSync(path.join(__dirname, `${label}.log`), 'w')
const started = new Date().toISOString()
fs.writeSync(log, `Command: node ${args.join(' ')}\n`)
const child = spawn(process.execPath, args, {
  cwd: root,
  stdio: ['ignore', log, log],
  windowsHide: true,
})
child.on('exit', (code, signal) => {
  fs.closeSync(log)
  const output = fs.readFileSync(path.join(__dirname, `${label}.log`), 'utf8')
  const counts = Object.fromEntries(
    [...output.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map((m) => [
      m[1],
      Number(m[2]),
    ]),
  )
  const failures = [...output.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((m) => m[1])
  const result = {
    label,
    root,
    started,
    completed: new Date().toISOString(),
    code,
    signal,
    files,
    counts,
    failures,
  }
  fs.writeFileSync(path.join(__dirname, `${label}.json`), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ label, code, counts, failures }))
  process.exitCode = code ?? 1
})
