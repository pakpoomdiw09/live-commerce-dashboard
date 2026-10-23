const assert = require('node:assert/strict'),
  { test } = require('node:test')
const fs = require('node:fs'),
  vm = require('node:vm'),
  ts = require('typescript')
const React = require('react'),
  { renderToStaticMarkup } = require('react-dom/server')
function load(file, deps = {}) {
  const context = {
    exports: {},
    console,
    Date,
    Map,
    Set,
    process: { env: {} },
    require: (name) => {
      if (name in deps) return deps[name]
      throw Error('Unexpected dependency ' + name)
    },
  }
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    context,
  )
  return context.exports
}
class InboxError extends Error {
  constructor(message, status, code) {
    super(message)
    this.status = status
    this.code = code
  }
}
const moduleDeps = {
  'server-only': {},
  '@/lib/feature-access': {
    hasFeature: async (_db, _id, feature) => feature === 'slip_auto_pilot',
  },
  '@/lib/features/inbox/inbox-server': { InboxError },
}
const reader = load('lib/features/overview/overview-tables.ts', moduleDeps)
const aggregate = load('scripts/fixtures/overview-slips.ts')
const core = load('lib/features/overview/premium-overview-core.ts')
const filters = core.overviewFilters({ range: '7' }, new Date('2026-10-17T05:00:00Z'))
const slip = (
  id,
  status = 'valid',
  amount = 1,
  date = '2026-10-16T18:00:00+00:00',
  approved_at = null,
) => ({
  id,
  customer_id: 'customer',
  created_at: date,
  status,
  amount,
  approved_at,
  note: null,
  trans_ref: id,
})

test('direct slip aggregates use Bangkok dates, exact amounts, previous period and approved outcomes', () => {
  const slips = [
    slip('one', 'valid', 0.1),
    slip('two', 'error', 0.2, undefined, 'approved'),
    slip('dup', 'duplicate', 900, undefined, 'approved'),
    slip('wait', 'pending'),
    slip('old', 'valid', 12, '2026-10-09T18:00:00Z'),
  ]
  const result = aggregate.aggregateOverviewSlips(slips, [], filters)
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
  const result = aggregate.aggregateOverviewSlips(slips, [], { ...filters, q: 'ref-', page: 2 })
  assert.equal(result.slips.length, 5)
  assert.equal(result.slipMatches, 15)
  assert.equal(result.totalSlips, 15)
  assert.ok(result.slips.every((row) => row.customer === null))
  const named = aggregate.aggregateOverviewSlips(
    slips,
    [{ id: 'customer', display_name: 'Own customer' }],
    { ...filters, q: 'own customer' },
  )
  assert.equal(named.slipMatches, 15)
})

test('overview uses bounded SQL aggregates, preserves full totals and returns a recoverable error when unavailable', async () => {
  const calls = []
  let fail = false
  const data = {
    access: { slips: true, customers: false, ai: false },
    totals: { totalSlips: 1001, approved: 1001, pending: 0, verifiedSlipAmount: 1001 },
    series: [],
    activity: [],
    hours: [],
    slips: [],
    chats: [],
    slipMatches: 1001,
    chatMatches: 0,
  }
  const db = {
    from(table) {
      assert.equal(table, 'tenants')
      const q = {
        select() {
          return q
        },
        eq() {
          return q
        },
        maybeSingle: async () => ({
          data: {
            id: 'shop',
            name: 'Shop',
            slip_quota: 100,
            slip_quota_credits: 30,
            slip_used: 10,
          },
          error: null,
        }),
      }
      return q
    },
    rpc: async (name, args) => {
      calls.push({ name, args })
      return fail ? { data: null, error: { code: 'PGRST202' } } : { data, error: null }
    },
  }
  const { summary } = await reader.overviewFromTables(db, 'shop', filters)
  assert.equal(summary.metrics.totalSlips, 1001)
  assert.equal(summary.metrics.slipCredits, 120)
  assert.equal(summary.metrics.messages, null)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'overview_dashboard_stats')
  assert.equal(calls[0].args.p_tenant, 'shop')
  assert.equal(calls[0].args.p_page, 1)
  fail = true
  await assert.rejects(reader.overviewFromTables(db, 'shop', filters), (e) => e.status === 503)
})

test('Sidebar exposes bank-tab slip and AI links without provider branding', () => {
  const { AppShell } = load('components/shell/AppShell.tsx', {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'next/navigation': { usePathname: () => '/overview', useRouter: () => ({ refresh() {} }) },
    '@/components/shell/PageTransition': { PageTransition: ({ children }) => children },
    'next/image': { default: (props) => React.createElement('img', props) },
    'next/link': {
      default: ({ children, href, ...props }) =>
        React.createElement('a', { href, ...props }, children),
    },
    'lucide-react': require('lucide-react'),
    '@/lib/utils': { cn: (...parts) => parts.filter(Boolean).join(' ') },
  })
  const html = renderToStaticMarkup(
    React.createElement(
      AppShell,
      { email: 'test@example.com', page: null, credits: null },
      'Dashboard',
    ),
  )
  assert.ok(html.includes('href="/slips?tab=banks"'))
  assert.ok(html.includes('ตรวจสอบสลิป'))
  assert.ok(!/slip\s*ok/i.test(html))
  assert.ok(html.includes('href="/chatbot"'))
  assert.ok(html.includes('from-orange-500'))
  assert.ok(!html.includes('กำลังพัฒนา'))
})

test('Chatbot page restores the saved editor and Gemini readiness after checking tenant access', async () => {
  let allowed = true,
    reads = 0
  const Editor = () => null
  const db = {
    from(table) {
      reads++
      const result = { data: table === 'bot_settings' ? null : [], error: null }
      const q = {
        select() {
          return this
        },
        eq() {
          return this
        },
        not() {
          return this
        },
        order() {
          return this
        },
        limit() {
          return this
        },
        maybeSingle: async () => result,
        then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
      }
      return q
    },
  }
  const page = load('app/(dashboard)/chatbot/conversations/page.tsx', {
    'react/jsx-runtime': require('react/jsx-runtime'),
    '@/lib/auth': {
      requireDashboardUser: async () => ({}),
      getActor: async () => ({ kind: 'user' }),
      canAccessTenant: async () => allowed,
    },
    '@/lib/tenant': {
      getActiveTenant: async () => ({ id: 'shop', auto_reply_enabled: true }),
      getViewer: async () => ({ role: allowed ? 'owner' : null }),
    },
    '@/lib/features/agents/agent-control-flags': { agentControlConfig: async () => null },
    '@/components/chatbot/AgentControlCenter': { AgentControlCenter: () => null },
    '@/lib/supabase/server': { supabaseAdmin: () => db },
    '@/lib/feature-access': { hasFeature: async () => true },
    '@/lib/features/agents/ai-agent': { aiConfigured: () => true },
    '@/lib/features/agents/chatbot': {
      defaultBotSettings: (id) => ({ tenant_id: id, reply_mode: 'keyword' }),
      ruleOrder: () => 0,
    },
    '@/components/chatbot/ConversationsClient': { ConversationsClient: Editor },
    '@/components/shared/SetupNotice': {},
    '@/components/shared/ErrorState': { InlineError: () => null },
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

test('overview carries SQL avatar output and initials fallback into both recent tables without raw customer reads', async () => {
  for (const avatar_url of ['https://images.example.test/customer.jpg', null]) {
    const db = {
      from(table) {
        assert.equal(table, 'tenants')
        const q = {
          select() {
            return q
          },
          eq() {
            return q
          },
          maybeSingle: async () => ({
            data: { id: 'shop', name: 'Shop', slip_quota: 10, slip_used: 0 },
            error: null,
          }),
        }
        return q
      },
      rpc: async () => ({
        error: null,
        data: {
          access: { slips: true, customers: true, ai: false },
          totals: {},
          series: [],
          activity: [],
          hours: [],
          slips: [{ id: 'slip', customer: 'ลูกค้าทดสอบ', avatar_url }],
          chats: [{ id: 'customer', name: 'ลูกค้าทดสอบ', avatar_url }],
          slipMatches: 1,
          chatMatches: 1,
        },
      }),
    }
    const { summary } = await reader.overviewFromTables(db, 'shop', filters)
    assert.equal(summary.slips[0].avatar_url, avatar_url)
    assert.equal(summary.chats[0].avatar_url, avatar_url)
  }
})

test('Avatar renders real stored URLs and keeps initials when missing, invalid or image load fails', () => {
  let failed = null
  const Avatar = load('components/inbox/Avatar.tsx', {
    react: {
      useState: () => [
        failed,
        (value) => {
          failed = value
        },
      ],
    },
    'react/jsx-runtime': require('react/jsx-runtime'),
    '@/lib/utils': {
      cn: (...values) => values.filter(Boolean).join(' '),
      customerName: (c) => c.display_name || 'ลูกค้า',
    },
  }).Avatar
  const customer = {
    id: 'customer',
    display_name: 'ทดสอบ',
    platform_user_id: 'customer',
    avatar_url: ' https://images.example.test/customer.jpg ',
  }
  const image = Avatar({ c: customer }).props.children[1]
  assert.equal(image.props.src, customer.avatar_url.trim())
  image.props.onError()
  const fallback = Avatar({ c: customer })
  assert.equal(fallback.props.children[0], 'ท')
  assert.equal(fallback.props.children[1], false)
  for (const avatar_url of [null, '', 'http://insecure.example.test/image', 'javascript:alert(1)'])
    assert.equal(Avatar({ c: { ...customer, avatar_url } }).props.children[1], null)
})
