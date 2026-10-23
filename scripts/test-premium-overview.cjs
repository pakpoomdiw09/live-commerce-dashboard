const assert = require('node:assert/strict'),
  { test } = require('node:test'),
  fs = require('node:fs'),
  vm = require('node:vm'),
  ts = require('typescript'),
  React = require('react'),
  { renderToStaticMarkup } = require('react-dom/server')
function load(file, deps = {}, globals = {}) {
  const context = {
    exports: {},
    console,
    Date,
    JSON,
    Math,
    Object,
    Number,
    URLSearchParams,
    process: { env: {} },
    require: (n) => {
      if (n in deps) return deps[n]
      if (n === 'next/image')
        return { default: ({ src, alt }) => React.createElement('img', { src, alt }) }
      if (
        [
          '@/components/ui/page-banner',
          '@/components/overview/CustomerGenderCard',
          '@/components/overview/MessageActivityCharts',
          '@/lib/ui-labels',
        ].includes(n)
      )
        return load(n.replace('@/', '') + (n.startsWith('@/lib/') ? '.ts' : '.tsx'), {
          'react/jsx-runtime': require('react/jsx-runtime'),
          'lucide-react': require('lucide-react'),
          '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
        })
      throw Error('Unexpected dependency ' + n)
    },
    ...globals,
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
const tenant = '11111111-1111-4111-8111-111111111111',
  core = load('lib/features/overview/premium-overview-core.ts')
test('range uses Bangkok calendar boundaries, spans 7/30/90 days and validates untrusted filters', () => {
  const now = new Date('2026-10-15T18:00:00Z')
  for (const days of ['7', '30', '90']) {
    const f = core.overviewFilters({ range: days }, now)
    assert.equal(
      f.from,
      new Date(
        new Date('2026-10-15T17:00:00Z').getTime() - (Number(days) - 1) * 86400000,
      ).toISOString(),
    )
    assert.equal(new Date(f.from) - new Date(f.previousFrom), Number(days) * 86400000)
  }
  assert.equal(core.overviewFilters({ range: 'all' }, now).from, null)
  assert.equal(core.overviewFilters({}, now).range, '30')
  for (const input of [
    { range: '0' },
    { range: 'year' },
    { page: '0' },
    { page: '1.2' },
    { page: '1001' },
    { page: 'NaN' },
    { q: 'a'.repeat(101) },
  ])
    assert.throws(() => core.overviewFilters(input))
  assert.equal(core.overviewFilters({ q: '  own shop  ' }, now).q, 'own shop')
})
test('direct-table overview defaults on and supports an explicit rollback in every environment', () => {
  for (const [env, expected] of [
    [{}, true],
    [{ NODE_ENV: 'development' }, true],
    [{ NODE_ENV: 'production' }, true],
    [{ NODE_ENV: 'development', PREMIUM_OVERVIEW_ENABLED: 'false' }, false],
    [{ NODE_ENV: 'production', PREMIUM_OVERVIEW_ENABLED: 'false' }, false],
  ])
    assert.equal(
      load(
        'lib/features/overview/premium-overview-core.ts',
        {},
        { process: { env } },
      ).premiumOverviewEnabled(),
      expected,
    )
  assert.equal(core.PREMIUM_OVERVIEW_FLAGS.premium_overview_enabled, true)
})
class InboxError extends Error {
  constructor(message, status = 400, code = 'BAD_REQUEST') {
    super(message)
    this.status = status
    this.code = code
  }
}
function fixture({ member = true, enabled = true, error = null, data = null } = {}) {
  let queries = 0
  const calls = [],
    db = {
      from(table) {
        assert.ok(['tenants', 'agent_control_settings'].includes(table))
        const q = {
          select() {
            return q
          },
          eq(column, value) {
            assert.equal(value, tenant)
            return q
          },
          maybeSingle: async () => ({
            data:
              table === 'tenants'
                ? {
                    auto_verify_enabled: false,
                    bank_code: null,
                    account_name: null,
                    page_id: null,
                    page_token_set: false,
                  }
                : { flags: {} },
            error: null,
          }),
        }
        return q
      },
      rpc: async (name, args) => {
        queries++
        calls.push({ name, args })
        return { data: data ?? sample(), error }
      },
    }
  const server = load('lib/features/overview/premium-overview-server.ts', {
    'server-only': {},
    '@/lib/auth': { canAccessTenant: async () => member },
    '@/lib/supabase/server': { supabaseAdmin: () => db },
    '@/lib/features/overview/overview-tables': {
      overviewFromTables: async (_db, t, f) => {
        const response = await db.rpc('direct-table-fixture', {
          p_tenant: t,
          p_from: f.from,
          p_to: f.to,
          p_previous: f.previousFrom,
          p_page: f.page,
          p_query: f.q,
        })
        if (response.error) throw new InboxError('unavailable', 503, 'OVERVIEW_UNAVAILABLE')
        return { summary: response.data, notices: [] }
      },
    },
    '@/lib/features/inbox/inbox-server': { InboxError },
    '@/lib/utils': { UUID: /^[0-9a-f-]{36}$/ },
    '@/lib/features/overview/premium-overview-core': {
      ...core,
      premiumOverviewEnabled: () => enabled,
    },
  })
  return {
    run: (actor = { kind: 'user', id: 'user' }, t = tenant, f = {}) =>
      server.loadPremiumOverview(actor, t, f),
    calls,
    get queries() {
      return queries
    },
  }
}
function sample() {
  return {
    shop: { id: tenant, name: 'Test shop — isolated fixture' },
    updatedAt: '2026-10-16T02:00:00Z',
    filters: core.overviewFilters({ range: '7' }, new Date('2026-10-16T02:00:00Z')),
    access: { slips: true, customers: true, ai: true },
    metrics: {
      reconciledRevenue: null,
      messages: 0,
      incomingMessages: 0,
      uniqueCustomers: 0,
      approved: 0,
      totalSlips: 0,
      pending: 0,
      slipCredits: 0,
      verifiedSlipAmount: 0,
    },
    previous: null,
    results: { passed: 0, pending: 0, rejected: 0, error: 0 },
    series: [],
    bucket: 'day',
    slips: [],
    slipMatches: 0,
    chats: [],
    chatMatches: 0,
    ai: null,
    activity: [],
    hourActivity: [],
    customerGenders: null,
    health: [
      { name: 'Database', status: 'active', detail: 'อ่านข้อมูลสำเร็จ', setupHref: '/settings' },
      { name: 'Messenger', status: 'setup', detail: 'ยังไม่ได้ตรวจสอบ', setupHref: '/select-page' },
    ],
  }
}
test('server rejects anonymous/internal callers, foreign tenant, invalid scope and disabled flag before data reads', async () => {
  for (const [opts, actor, t, status] of [
    [{}, null, tenant, 401],
    [{}, { kind: 'internal' }, tenant, 401],
    [{ member: false }, { kind: 'user' }, tenant, 404],
    [{}, { kind: 'user' }, 'bad', 404],
    [{ enabled: false }, { kind: 'user' }, tenant, 403],
  ]) {
    const f = fixture(opts)
    await assert.rejects(f.run(actor, t), (e) => e.status === status)
    assert.equal(f.queries, 0)
  }
  const f = fixture()
  await assert.rejects(f.run(undefined, tenant, { range: 'invalid' }), (e) => e.status === 400)
  assert.equal(f.queries, 0)
})
test('aggregation sends validated server scope and filters; health reflects saved setup, not fake Online', async () => {
  const f = fixture()
  const v = await f.run(undefined, tenant, { range: '7', page: '2', q: ' own ' })
  assert.equal(f.queries, 1)
  assert.equal(f.calls[0].args.p_tenant, tenant)
  assert.equal(f.calls[0].args.p_page, 2)
  assert.equal(f.calls[0].args.p_query, 'own')
  assert.equal(v.metrics.reconciledRevenue, null)
  assert.equal(v.health.find((h) => h.setupHref === '/select-page').status, 'setup')
  assert.equal(v.health.find((h) => h.setupHref === '/billing').status, 'active')
})
test('RPC failure and wrong-tenant response fail without fabricating zero metrics', async () => {
  await assert.rejects(
    fixture({ error: { code: '42883' } }).run(),
    (e) => e.status === 503 && e.code === 'OVERVIEW_UNAVAILABLE',
  )
  await assert.rejects(
    fixture({ data: { ...sample(), shop: { id: 'foreign' } } }).run(),
    (e) => e.status === 503,
  )
})
test('Dashboard API passes authenticated scope, rejects failed guards and disables shared caching', async () => {
  let called = 0
  const api = load('app/api/overview/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => ({ body, ...options }) } },
    '@/lib/auth': { getActor: async () => ({ kind: 'user' }) },
    '@/lib/features/overview/premium-overview-server': {
      loadPremiumOverview: async (a, t, p) => {
        called++
        assert.equal(t, tenant)
        assert.equal(p.range, '7')
        return sample()
      },
    },
    '@/lib/features/inbox/inbox-server': { inboxError: (e) => ({ status: e.status }) },
  })
  const result = await api.GET({
    nextUrl: new URL('https://local/api/overview?tenantId=' + tenant + '&range=7'),
  })
  assert.equal(called, 1)
  assert.equal(result.headers['Cache-Control'], 'private, no-store')
  const denied = load('app/api/overview/route.ts', {
    'next/server': {},
    '@/lib/auth': { getActor: async () => null },
    '@/lib/features/overview/premium-overview-server': {
      loadPremiumOverview: async () => {
        throw new InboxError('unauthorized', 401)
      },
    },
    '@/lib/features/inbox/inbox-server': { inboxError: (e) => ({ status: e.status }) },
  })
  assert.equal((await denied.GET({ nextUrl: new URL('https://local/api/overview') })).status, 401)
})
function component() {
  return load('components/overview/PremiumOverview.tsx', {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'next/link': {
      default: ({ href, children, ...props }) =>
        React.createElement('a', { href, ...props }, children),
    },
    'next/navigation': { useRouter: () => ({ refresh() {} }) },
    'lucide-react': require('lucide-react'),
    '@/components/inbox/Avatar': {
      Avatar: ({ c }) => React.createElement('span', {}, c.display_name),
    },
    './RevenueChart': {
      RevenueChart: ({ caption, data }) =>
        React.createElement('figure', { 'aria-label': caption }, String(data.length)),
    },
  }).PremiumOverview
}
test('responsive SSR renders five truthful KPIs, empty states, real navigation, accessible forms and no fake Online', () => {
  const html = renderToStaticMarkup(
    React.createElement(component(), { data: sample(), shopCount: 1, userName: 'Test user' }),
  )
  for (const path of [
    '/slips',
    '/inbox',
    '/shop',
    '/broadcast',
    '/analytics',
    '/billing',
    '/select-page',
  ])
    assert.ok(html.includes('href="' + path + '"'))
  assert.ok(html.includes('xl:grid-cols-5'))
  assert.ok(html.includes('sm:grid-cols-2'))
  assert.ok(html.includes('aria-label="'))
  assert.ok(html.includes('ยังไม่มีข้อมูลการทำงานของ AI'))
  assert.ok(html.includes('ตั้งค่า'))
  assert.ok(!html.includes('Online'))
  assert.ok(html.includes('ไม่ใช่ยอดรับเงินที่ธนาคารตรวจสอบแล้ว'))
  assert.ok(html.includes('name="range"'))
  assert.ok(html.includes('name="q"'))
})
test('populated recent lists expose receipt notes, Inbox deep links and a scrollable table', () => {
  const data = sample()
  data.slips = [
    {
      id: 'slip-fixture',
      created_at: data.updatedAt,
      customer: 'Test customer',
      amount: 9,
      result: 'passed',
      note: 'Isolated test',
    },
  ]
  data.chats = [
    {
      id: tenant,
      name: 'Test customer',
      avatar_url: null,
      body: '<script>unsafe</script>',
      last_message_at: data.updatedAt,
      unread_count: 1,
      owner: 'บอท',
    },
  ]
  data.slipMatches = 11
  const html = renderToStaticMarkup(
    React.createElement(component(), { data, shopCount: 1, userName: 'Test' }),
  )
  assert.ok(html.includes('overflow-x-auto'))
  assert.ok(html.includes('/inbox?customer=' + tenant))
  assert.ok(html.includes('หน้าถัดไป'))
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(html.includes('Isolated test'))
})
test('locked modules hide records and show upgrade links; unsafe text is escaped in SSR', () => {
  const data = sample()
  data.access = { slips: false, customers: false, ai: false }
  data.results = null
  data.shop.name = '<script>alert(1)</script>'
  const html = renderToStaticMarkup(
    React.createElement(component(), { data, shopCount: 1, userName: 'Test' }),
  )
  assert.ok(html.includes('อัปเกรดแพ็กเกจ'))
  assert.ok(!html.includes('<script>alert'))
  assert.ok(html.includes('&lt;script&gt;'))
})
module.exports = { sample, component }
