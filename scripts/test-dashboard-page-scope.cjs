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
  id: `row-${i}`, tenant_id, amount: (i + 1) * 100, status: 'valid', created_at: today,
  approved_at: null, customers: { display_name: `customer-${i}` }, messages: [], slips: [],
}))
function fixture(page) {
  const queries = []
  let tenant = { id: 'A', name: 'Page A', page_id: 'facebook-A', slip_quota: 100, slip_used: 0 }
  const db = { from(table) {
    const query = { table, filters: [] }; queries.push(query)
    const builder = {
      select() { return this }, gte() { return this }, order() { return this }, limit() { return this },
      eq(column, value) { query.filters.push([column, value]); return this },
      then(resolve, reject) {
        return Promise.resolve({ data: rows.filter(r => query.filters.every(([column, value]) => column.includes('.') || r[column] === value)), error: null }).then(resolve, reject)
      },
    }
    return builder
  } }
  const exports = {}
  const code = ts.transpileModule(readFileSync(join(__dirname, `../app/(dashboard)/${page}/page.tsx`), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  vm.runInNewContext(code, { exports, Date, require(name) {
    if (name === '@/lib/premium-overview-core') return { premiumOverviewEnabled: () => false }
    if (name === '@/lib/feature-access') return { hasFeature: async () => true }
    if (name === '@/lib/payment-pro-flags') return { paymentProConfig: async () => null,paymentProUiEnabled:()=>true }
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
    if (name === '@/lib/supabase/server') return { supabaseServer: async () => db, supabaseAdmin: () => db }
    if (name === '@/lib/tenant') return { getActiveTenant: async () => tenant, getViewer: async () => ({ isPlatformAdmin: false }) }
    if (name === '@/lib/billing') return { getBilling: async () => ({ plan: 'pro', planExpiresAt: null }) }
    if (name === '@/lib/status') return { APPROVABLE: [], SLIP_STATUS: { valid: { tone: 'success', label: 'valid' } } }
    if (name === '@/lib/utils') return { baht: v => `THB ${v}`, cn: (...v) => v.join(' '), when: v => v }
    if (name === '@/lib/types') return { CUSTOMER_COLUMNS: 'id,tenant_id', SLIP_COLUMNS: 'id,tenant_id' }
    return new Proxy({}, { get: (_, key) => String(key) })
  } })
  return { queries, render: (params = {}) => exports.default({ searchParams: Promise.resolve(params) }),
    switchTo(id) { tenant = id ? { ...tenant, id, name: `Page ${id}`, page_id: `facebook-${id}` } : null } }
}
function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null
  if (predicate(tree)) return tree
  for (const child of [tree.props?.children].flat()) { const result = find(child, predicate); if (result) return result }
  return null
}
test('Overview re-queries A → B → A, excludes unassigned/other Page slips and changes live scope', async () => {
  const f = fixture('overview')
  for (const [id, amount] of [['A', 100], ['B', 200], ['A', 100]]) {
    f.switchTo(id)
    const tree = await f.render()
    assert.equal(find(tree, n => n.props?.label === 'ยอดรับเงินวันนี้').props.value, `THB ${amount}`)
    assert.equal(find(tree, n => n.type === 'LiveRefresh').props.filter, `tenant_id=eq.${id}`)
    assert.equal(f.queries.at(-1).filters[0][1], id)
  }
})
test('Inbox, slips and customer pages filter by the selected Page tenant', async () => {
  for (const page of ['inbox', 'slips', 'customers']) {
    const f = fixture(page)
    f.switchTo('B')
    await f.render()
    for (const query of f.queries) assert.ok(query.filters.some(([column, value]) => column === 'tenant_id' && value === 'B'))
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
