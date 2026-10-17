const assert = require('node:assert/strict'), { test } = require('node:test')
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript')
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
function load(file, deps = {}) {
  const context = { exports: {}, console, Date, Map, Set, process: { env: {} }, require: name => {
    if (name in deps) return deps[name]
    throw Error('Unexpected dependency ' + name)
  } }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, context)
  return context.exports
}
class InboxError extends Error { constructor(message, status, code) { super(message); this.status = status; this.code = code } }
const moduleDeps = { 'server-only': {}, './feature-access': { hasFeature: async (_db, _id, feature) => feature === 'slip_auto_pilot' }, './inbox-server': { InboxError } }
const reader = load('lib/overview-tables.ts', moduleDeps)
const core = load('lib/premium-overview-core.ts')
const filters = core.overviewFilters({ range: '7' }, new Date('2026-10-17T05:00:00Z'))
const slip = (id, status = 'valid', amount = 1, date = '2026-10-16T18:00:00+00:00', approved_at = null) => ({ id, customer_id: 'customer', created_at: date, status, amount, approved_at, note: null, trans_ref: id })

test('direct slip aggregates use Bangkok dates, exact amounts, previous period and approved outcomes', () => {
  const slips = [slip('one', 'valid', 0.1), slip('two', 'error', 0.2, undefined, 'approved'), slip('dup', 'duplicate', 900, undefined, 'approved'), slip('wait', 'pending'), slip('old', 'valid', 12, '2026-10-09T18:00:00Z')]
  const result = reader.aggregateOverviewSlips(slips, [], filters)
  assert.equal(result.totalSlips, 4)
  assert.equal(result.approved, 2)
  assert.equal(result.pending, 1)
  assert.equal(result.verifiedSlipAmount, 0.3)
  assert.equal(result.previous.verifiedSlipAmount, 12)
  assert.equal(result.series.length, 7)
  assert.equal(result.series.at(-1).amount, 0.3)
  assert.equal(result.results.rejected, 1)
})

test('search paginates lists without changing totals and never reveals unauthorized customer names', () => {
  const slips = Array.from({ length: 15 }, (_, i) => slip('ref-' + i))
  const result = reader.aggregateOverviewSlips(slips, [], { ...filters, q: 'ref-', page: 2 })
  assert.equal(result.slips.length, 5)
  assert.equal(result.slipMatches, 15)
  assert.equal(result.totalSlips, 15)
  assert.ok(result.slips.every(row => row.customer === null))
  const named = reader.aggregateOverviewSlips(slips, [{ id: 'customer', display_name: 'Own customer' }], { ...filters, q: 'own customer' })
  assert.equal(named.slipMatches, 15)
})

test('direct reader pages beyond 1000 records, scopes every read, and never calls the missing overview RPC', async () => {
  const entries = Array.from({ length: 1001 }, (_, i) => slip(String(i)))
  const scopes = [], ranges = []
  let fail = false
  const db = { from(table) {
    const q = { select() { return this }, eq(key, value) { scopes.push([table, key, value]); return this }, lt() { return this }, gte() { return this }, order() { return this },
      range(start, end) { ranges.push([start, end]); this.start = start; this.end = end; return this },
      returns: async function () { return fail ? { data: null, error: { message: 'offline' } } : { data: entries.slice(this.start, this.end + 1), error: null } },
      maybeSingle: async () => ({ data: { id: 'shop', name: 'Shop', slip_quota: 100, slip_quota_credits: 30, slip_used: 10 }, error: null }) }
    return q
  }, rpc() { throw Error('Dashboard must not call an aggregation RPC') } }
  const { summary } = await reader.overviewFromTables(db, 'shop', filters)
  assert.equal(summary.metrics.totalSlips, 1001)
  assert.equal(summary.metrics.slipCredits, 120)
  assert.equal(summary.metrics.messages, null)
  assert.deepEqual(ranges, [[0, 999], [1000, 1999]])
  assert.ok(scopes.some(([table, key, value]) => table === 'slips' && key === 'tenant_id' && value === 'shop'))
  fail = true
  await assert.rejects(reader.overviewFromTables(db, 'shop', filters), error => error.status === 503)
})

test('Sidebar exposes bank-tab slip and AI links without provider branding', () => {
  const { AppShell } = load('components/shell/AppShell.tsx', {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'), 'next/navigation': { usePathname: () => '/overview', useRouter: () => ({ refresh() {} }) },
    '@/components/shell/PageTransition': { PageTransition: ({ children }) => children }, 'next/image': { default: props => React.createElement('img', props) },
    'next/link': { default: ({ children, href, ...props }) => React.createElement('a', { href, ...props }, children) },
    'lucide-react': require('lucide-react'), '@/lib/utils': { cn: (...parts) => parts.filter(Boolean).join(' ') },
  })
  const html = renderToStaticMarkup(React.createElement(AppShell, { email: 'test@example.com', page: null, credits: null }, 'Dashboard'))
  assert.ok(html.includes('href="/slips?tab=banks"'))
  assert.ok(html.includes('ตรวจสอบสลิป'))
  assert.ok(!/slip\s*ok/i.test(html))
  assert.ok(html.includes('href="/chatbot"'))
  assert.ok(html.includes('from-orange-500'))
  assert.ok(!html.includes('กำลังพัฒนา'))
})

test('Chatbot page restores the saved editor and Gemini readiness after checking tenant access', async () => {
  let allowed = true, reads = 0
  const Editor = () => null
  const db = { from(table) {
    reads++
    const result = { data: table === 'bot_settings' ? null : [], error: null }
    const q = { select() { return this }, eq() { return this }, not() { return this }, order() { return this }, limit() { return this },
      maybeSingle: async () => result, then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) }
    return q
  } }
  const page = load('app/(dashboard)/chatbot/conversations/page.tsx', {
    'react/jsx-runtime': require('react/jsx-runtime'),
    '@/lib/auth': { requireDashboardUser: async () => ({}), getActor: async () => ({ kind: 'user' }), canAccessTenant: async () => allowed },
    '@/lib/tenant': { getActiveTenant: async () => ({ id: 'shop', auto_reply_enabled: true }), getViewer: async () => ({ role: allowed ? 'owner' : null }) },
    '@/lib/agent-control-flags': { agentControlConfig: async () => null }, '@/components/chatbot/AgentControlCenter': { AgentControlCenter: () => null },
    '@/lib/supabase/server': { supabaseAdmin: () => db }, '@/lib/feature-access': { hasFeature: async () => true },
    '@/lib/ai-agent': { aiConfigured: () => true }, '@/lib/chatbot': { defaultBotSettings: id => ({ tenant_id: id, reply_mode: 'keyword' }), ruleOrder: () => 0 },
    '@/components/chatbot/ConversationsClient': { ConversationsClient: Editor }, '@/components/SetupNotice': {}, '@/components/ErrorState': { InlineError: () => null },
  }).default
  const rendered = await page()
  assert.equal(rendered.type, Editor)
  assert.equal(rendered.props.tenantId, 'shop')
  assert.equal(rendered.props.aiReady, true)
  assert.equal(rendered.props.initialSettings.reply_mode, 'keyword')
  const before = reads
  allowed = false
  assert.notEqual((await page()).type, Editor)
  assert.equal(reads, before)
})
