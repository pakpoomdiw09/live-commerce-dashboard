const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), cp = require('node:child_process')
const root = path.resolve(__dirname, '../../..')
const entry = JSON.parse(fs.readFileSync(path.join(__dirname, 'entry.json'), 'utf8'))
const files = [
  'supabase/live-auction-audit-hardening-2.sql', 'scripts/build-full-database-setup.cjs',
  'app/api/cron/facebook-webhooks/route.ts', 'app/api/live-cf/auction/poll-comments/route.ts',
  'lib/integrations/facebook/webhook-handler.ts', 'lib/integrations/facebook/webhook-http.ts',
  'app/api/live-auction/workspace/route.ts', 'components/live-cf/AuctionUnifiedForm.tsx',
  'components/live-cf/LiveCommentPoller.tsx', 'components/live-cf/LiveSessionDashboard.tsx',
  'scripts/test-auction-hardening-2.cjs', 'scripts/helpers/auction-hardening-db.cjs',
  'scripts/test-auction-ingestion-privacy.cjs', 'scripts/test-auction-poller-hardening.cjs',
  'scripts/test-auction-poller-remediation.cjs', 'scripts/test-auction-workspace-api.cjs',
  'scripts/test-auction-degraded-form.cjs', 'scripts/test-auction-background.cjs', 'scripts/test-auction-cron.cjs',
]
const git = args => { const r = cp.spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 20e6 }); if (r.status > 1) throw Error(r.stderr); return r.stdout }
let head = git(['diff', '-w', 'HEAD', '--', ...files])
for (const f of files.filter(f => !git(['ls-files', '--', f]).trim())) {
  head += git(['diff', '--no-index', '-w', '--', 'NUL', f])
}
fs.writeFileSync(path.join(__dirname, 'parts-1-3-4-5.patch'), head)
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'auction-diff-'))
let task = ''
try {
  for (const f of files) {
    const before = path.join(temporary, 'before'), after = path.join(temporary, 'after')
    fs.writeFileSync(before, entry.files[f] ?? '')
    fs.writeFileSync(after, fs.readFileSync(path.join(root, f), 'utf8'))
    const diff = git(['diff', '--no-index', '-w', '--', before, after])
    task += diff.replace(/^diff --git .*$/m, `diff --git a/${f} b/${f}`).replace(/^--- .*$/m, `--- a/${f}`).replace(/^\+\+\+ .*$/m, `+++ b/${f}`)
  }
} finally { fs.unlinkSync(path.join(temporary, 'before')); fs.unlinkSync(path.join(temporary, 'after')); fs.rmdirSync(temporary) }
fs.writeFileSync(path.join(__dirname, 'task-entry-logic.patch'), task)
fs.writeFileSync(path.join(__dirname, 'inbox-telemetry.patch'), git(['diff', 'HEAD', '--', 'components/inbox/InboxClient.tsx']))
const status = git(['status', '--short', '--', '.gitignore', ...files, 'components/inbox/InboxClient.tsx',
  'scripts/helpers/confirm-auction-winner.cjs', 'scripts/test-customer-tabs.cjs', 'scripts/test-live-session-dashboard.cjs',
  'scripts/test-shipping.cjs', 'scripts/test-facebook-webhook-queue.cjs', 'scripts/test-auction-bundle-parity.cjs',
  'reports/auction-audit/DEPLOY-PLAN.md', 'reports/auction-audit/REMEDIATION.md', 'reports/auction-audit/remediation/',
  'reports/auction-audit/hardening-head.json', 'reports/auction-audit/hardening-head.log',
  'reports/auction-audit/hardening-final.json', 'reports/auction-audit/hardening-final.log',
  'reports/auction-audit/hardening-verified.json', 'reports/auction-audit/hardening-verified.log'])
fs.writeFileSync(path.join(__dirname, 'status.txt'), status)
const protectedFiles = ['supabase/live-auction-audit-hardening.sql', 'supabase/complete_schema.sql', 'supabase/full_database_setup.sql']
const protectedDiff = git(['diff', 'HEAD', '--', ...protectedFiles])
if (protectedDiff) throw Error('Protected migration or bootstrap changed')
fs.writeFileSync(path.join(__dirname, 'protected-files.txt'), 'PASS: zero diff against HEAD for ' + protectedFiles.join(', ') + '\n')
console.log('PASS: full scoped HEAD diff, task-entry diff, isolated Inbox patch, status and protected-file evidence saved')
