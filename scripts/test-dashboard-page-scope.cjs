// Execute the actual server pages against mock rows from multiple Pages.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')
const jsx = (type, props) => ({ type, props })
const today = new Date().toISOString()
const rows = ['A', 'B', null].map((tenant_id, i) => ({
  id: `row-${i}`,
  tenant_id,
  amount: (i + 1) * 100,
  status: 'valid',
  created_at: today,
  approved_at: null,
  customers: { display_name: `customer-${i}` },
  messages: [],
  slips: [],
}))
function fixture(page) {
  const queries = []
  let tenant = { id: 'A', name: 'Page A', page_id: 'facebook-A', slip_quota: 100, slip_used: 0 }
  const db = {
    rpc: async (name, args) => {
      queries.push({ table: name, filters: [['tenant_id', args.p_tenant]] })
      const scoped = rows.filter((r) => r.tenant_id === args.p_tenant)
      const amount = scoped.reduce((sum, r) => sum + r.amount, 0)
      return {
        data:
          name === 'basic_overview_stats'
            ? {
                totalSlips: scoped.length,
                attentionCount: 0,
                attention: [],
                byStatus: { valid: scoped.length },
                periodTotal: amount,
                points: Array.from({ length: 14 }, (_, i) => ({
                  day: new Date(Date.now() - (13 - i) * 86400000).toLocaleDateString('en-CA', {
                    timeZone: 'Asia/Bangkok',
                  }),
                  amount: i === 13 ? amount : 0,
                  count: i === 13 ? scoped.length : 0,
                })),
              }
            : {
                rows: scoped,
                total: scoped.length,
                totalPaid: amount,
                page: 1,
                pages: 1,
                pageSize: 50,
                tags: [],
              },
        error: null,
      }
    },
    from(table) {
      const query = { table, filters: [] }
      queries.push(query)
      const builder = {
        select() {
          return this
        },
        gte() {
          return this
        },
        order() {
          return this
        },
        limit() {
          return this
        },
        eq(column, value) {
          query.filters.push([column, value])
          return this
        },
        then(resolve, reject) {
          return Promise.resolve({
            data: rows.filter((r) =>
              query.filters.every(([column, value]) => column.includes('.') || r[column] === value),
            ),
            error: null,
          }).then(resolve, reject)
        },
      }
      return builder
    },
  }
  function loadModule(filename) {
    const exports = {}
    const code = ts.transpileModule(readFileSync(join(__dirname, '..', filename), 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText
    vm.runInNewContext(code, {
      exports,
      Date,
      process: { env: {} },
      URLSearchParams,
      console,
      require(name) {
        if (name === 'server-only') return {}
        if (name === '@/lib/auth')
          return {
            requireDashboardUser: async () => ({ id: 'viewer' }),
            getActor: async () => ({ kind: 'user', id: 'viewer' }),
          }
        if (name === '@/components/overview/PremiumOverviewPage')
          return loadModule('components/overview/PremiumOverviewPage.tsx')
        if (name === '@/lib/features/overview/premium-overview-server')
          return {
            loadPremiumOverview: async (_actor, tenantId) => {
              queries.push({
                table: 'overview_dashboard_stats',
                filters: [['tenant_id', tenantId]],
              })
              return {
                shop: { id: tenantId, name: `Page ${tenantId}` },
                filters: { range: '30', page: 1, q: '' },
                access: { slips: true, customers: true, ai: true },
                metrics: {
                  uniqueCustomers: 1,
                  incomingMessages: 1,
                  pending: 0,
                  verifiedSlipAmount: rows
                    .filter((row) => row.tenant_id === tenantId)
                    .reduce((sum, row) => sum + row.amount, 0),
                },
                health: [],
                slips: [],
                chats: [],
                activity: null,
                hourActivity: null,
              }
            },
          }
        if (name === '@/components/overview/BasicOverviewPage')
          return loadModule('components/overview/BasicOverviewPage.tsx')
        if (name === '@/lib/features/overview/basic-overview-server')
          return loadModule('lib/features/overview/basic-overview-server.ts')
        if (name === '@/lib/features/customers/customer-directory-server')
          return loadModule('lib/features/customers/customer-directory-server.ts')
        if (name === '@/lib/features/customers/customer-directory')
          return loadModule('lib/features/customers/customer-directory.ts')
        if (name === '@/lib/features/overview/premium-overview-core')
          return { premiumOverviewEnabled: () => false }
        if (name === '@/lib/feature-access') return { hasFeature: async () => true }
        if (name === '@/lib/features/payments/payment-pro-flags')
          return { paymentProConfig: async () => null, paymentProUiEnabled: () => true }
        if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
        if (name === '@/lib/supabase/server')
          return { supabaseServer: async () => db, supabaseAdmin: () => db }
        if (name === '@/lib/tenant')
          return {
            getActiveTenant: async () => tenant,
            getTenants: async () => ({ error: null, tenants: tenant ? [tenant] : [] }),
            getViewer: async () => ({ isPlatformAdmin: false, role: 'owner' }),
          }
        if (name === '@/lib/features/billing/billing')
          return { getBilling: async () => ({ plan: 'pro', planExpiresAt: null }) }
        if (name === '@/lib/status')
          return {
            ORDER_STATUSES: ['new', 'paid'],
            APPROVABLE: [],
            SLIP_STATUS: { valid: { tone: 'success', label: 'valid' } },
          }
        if (name === '@/lib/utils')
          return { baht: (v) => `THB ${v}`, cn: (...v) => v.join(' '), when: (v) => v }
        if (name === '@/lib/types')
          return {
            CUSTOMER_COLUMNS: 'id,tenant_id',
            CUSTOMER_COLUMNS_WITHOUT_AVATAR: 'id,tenant_id',
            SLIP_COLUMNS: 'id,tenant_id',
            isMissingCustomerAvatarColumn: () => false,
          }
        return new Proxy({}, { get: (_, key) => String(key) })
      },
    })
    return exports
  }
  const exports = loadModule(`app/(dashboard)/${page}/page.tsx`)
  return {
    queries,
    render: async (params = {}) => {
      const tree = await exports.default({ searchParams: Promise.resolve(params) })
      return typeof tree.type === 'function' ? tree.type(tree.props) : tree
    },
    switchTo(id) {
      tenant = id ? { ...tenant, id, name: `Page ${id}`, page_id: `facebook-${id}` } : null
    },
  }
}
function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null
  if (predicate(tree)) return tree
  for (const child of [tree.props?.children].flat()) {
    const result = find(child, predicate)
    if (result) return result
  }
  return null
}
test('Overview re-queries A → B → A, excludes unassigned/other Page slips and changes live scope', async () => {
  const f = fixture('overview')
  for (const [id, amount] of [
    ['A', 100],
    ['B', 200],
    ['A', 100],
  ]) {
    f.switchTo(id)
    const tree = await f.render()
    assert.equal(
      find(tree, (n) => n.type === 'PremiumOverview').props.data.metrics.verifiedSlipAmount,
      amount,
    )
    assert.equal(find(tree, (n) => n.type === 'PremiumOverview').props.data.shop.id, id)
    assert.equal(f.queries.at(-1).filters[0][1], id)
  }
})
test('Inbox, slips and customer pages filter by the selected Page tenant', async () => {
  for (const page of ['inbox', 'slips', 'customers']) {
    const f = fixture(page)
    f.switchTo('B')
    await f.render()
    for (const query of f.queries)
      assert.ok(query.filters.some(([column, value]) => column === 'tenant_id' && value === 'B'))
  }
})
test('No selected tenant never runs a global dashboard/inbox/slip/customer query', async () => {
  for (const page of ['overview', 'inbox', 'slips', 'customers']) {
    const f = fixture(page)
    f.switchTo(null)
    const tree = await f.render()
    assert.equal(tree.type, 'SetupNotice')
    assert.equal(f.queries.length, 0)
  }
})

test('Both slip dashboard tabs use the currently selected tenant after A → B → A', async () => {
  const f = fixture('slips')
  for (const id of ['A', 'B', 'A']) {
    f.switchTo(id)
    for (const tab of ['overview', 'settings']) {
      const tree = await f.render({ tab })
      assert.equal(tree.type, 'SlipsDashboard')
      assert.equal(tree.props.tenant.id, id)
      assert.equal(tree.props.activeTab, tab)
      assert.equal(tree.props.initial.length, 1)
      assert.equal(tree.props.initial[0].tenant_id, id)
    }
  }
})
