const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript')
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
function load(file, dependencies = {}) {
  const context = { exports: {}, console, URL, URLSearchParams, Date, Intl, process: { env: {} }, require(name) {
    if (name in dependencies) return dependencies[name]
    throw Error('Unexpected dependency: ' + name)
  } }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, context)
  return context.exports
}
class CommerceError extends Error { constructor(message, status = 400) { super(message); this.status = status } }
const id = '11111111-1111-4111-8111-111111111111'
const core = { CommerceError, commerceFlag: () => true, shopV2: () => true, isUuid: value => /^[0-9a-f-]{36}$/.test(value), ORDER_STATES: { paid: 'ชำระแล้ว', pending_payment: 'รอชำระเงิน' } }
const service = () => load('lib/features/commerce/commerce-server.ts', { 'server-only': {}, 'node:crypto': require('node:crypto'), 'next/server': {}, '@/lib/auth': {}, '@/lib/supabase/server': {}, '@/lib/features/commerce/commerce-core': core })
function fixture() {
  const stats = { products: 1205, customers: 1205, todayOrders: 1205, pending: 5, shipping: 6, revenue: 120.5,
    amounts: [{ label: '10-18', amount: 120.5 }], best: [{ name: 'Top product', qty: 1205 }], low: [], report: { monthly: [{ month: '2026-10', total: 120.5 }] } }
  const page = { products: [], variants: [], categories: [], categoryRows: [], pages: [], orders: [], items: [], customers: [{ id, name: 'Buyer', phone: '0800000000', order_count: 1205 }], audit: [], counts: { products: 1205, customers: 1205, orders: 1205, pages: 0, categories: 0 } }
  return { stats, page }
}
test('commerce rejects malformed or excessive pages and unsafe filters before reading tables', async () => {
  const api = service(), { stats, page } = fixture()
  let calls = 0
  const scope = { tenantId: id, tenant: { name: 'Shop' }, db: { from() { calls++; throw Error('must not read') }, rpc() { calls++; return { data: stats ?? page } } } }
  for (const value of [{ productPage: '0' }, { orderPage: '1001' }, { customerPage: 'NaN' }, { categoryPage: '1.5' }, { pagePage: '-1' }, { q: 'x'.repeat(101) }, { category: 'foreign SQL' }, { sort: 'drop table' }, { status: '__proto__' }]) {
    await assert.rejects(api.commerceSnapshot(scope, value), e => e.status === 400)
  }
  assert.equal(calls, 0)
})
test('commerce reads one store and two bounded RPCs regardless of tenant size; preserves full KPIs and report entitlement', async () => {
  const { stats, page } = fixture(), calls = []
  let unavailable = false
  const db = {
    from(table) { assert.equal(table, 'commerce_stores'); calls.push({ table }); const q = { select() { return q }, eq(key, value) { assert.equal(key, 'tenant_id'); assert.equal(value, id); return q }, maybeSingle: async () => ({ data: null, error: null }) }; return q },
    rpc: async (name, args) => { calls.push({ name, args }); return { data: name === 'commerce_dashboard_stats' ? stats : page, error: unavailable ? { code: 'PGRST202' } : null } },
  }
  const api = service(), scope = { db, tenantId: id, tenant: { name: 'Shop' }, limits: { reports: false }, canManage: true }
  const data = await api.commerceSnapshot(scope, { orderPage: '2', q: ' test ', status: 'paid' })
  assert.equal(calls.length, 3)
  assert.equal(data.stats.products, 1205)
  assert.equal(data.products.length, 0)
  assert.equal(data.report, null)
  assert.equal(data.stats.report, null)
  const request = calls.find(call => call.name === 'commerce_dashboard_page')
  assert.equal(request.args.p_tenant, id)
  assert.equal(request.args.p_order_page, 2)
  assert.equal(request.args.p_query, 'test')
  assert.equal(request.args.p_status, 'paid')
  unavailable = true
  await assert.rejects(api.commerceSnapshot(scope), e => e.status === 503 && /ฐานข้อมูล/.test(e.message))
})
test('commerce API passes filters only after authenticated tenant scope and disables shared caching', async () => {
  let scoped = false
  const api = load('app/api/commerce/route.ts', {
    'next/server': { NextResponse: { json: (data, options) => ({ data, ...options }) } },
    '@/lib/features/commerce/commerce-core': { CommerceError },
    '@/lib/features/commerce/commerce-server': { commerceScope: async tenant => { assert.equal(tenant, id); scoped = true; return { tenantId: id } },
      commerceSnapshot: async (scope, filters) => { assert.equal(scoped, true); assert.equal(scope.tenantId, id); assert.equal(filters.orderPage, '2'); return { ok: true } }, commerceResponse: e => { throw e } },
  })
  const response = await api.GET({ nextUrl: new URL('https://local/api/commerce?tenantId=' + id + '&orderPage=2') })
  assert.equal(response.data.ok, true)
  assert.equal(response.headers['Cache-Control'], 'private, no-store')
})
test('commerce renders complete SQL KPIs rather than page lengths, server pagination and customer totals', () => {
  const { stats, page } = fixture(), filters = service().commerceFilters()
  const Workspace = load('components/shop/CommerceWorkspace.tsx', {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'), 'lucide-react': require('lucide-react'),
    'next/link': { default: ({ href, children, ...props }) => React.createElement('a', { href, ...props }, children) },
    'next/navigation': { useRouter: () => ({ push() {} }) }, '@/lib/features/commerce/commerce-core': { ...core, SHOP_TABS: { overview: 'ภาพรวม', customers: 'ลูกค้า' } },
    '@/components/shop/CommerceProducts': { CommerceProducts: () => null }, '@/components/shop/CommerceEditor': { commerceButton: 'button', commercePrimary: 'primary', commerceInput: 'input', CommerceEditor: () => null },
  }).CommerceWorkspace
  const initial = { ...page, stats, report: stats.report, tenant: { id, name: 'Shop' }, filters, pageSize: 50, flags: { dashboard: true }, limits: { checkout: true }, store: null, canManage: true }
  const overview = renderToStaticMarkup(React.createElement(Workspace, { initial }))
  assert.ok(overview.includes('1205'))
  assert.ok(overview.includes('120.50'))
  assert.ok(overview.includes('Top product'))
  const customers = renderToStaticMarkup(React.createElement(Workspace, { initial, tab: 'customers' }))
  assert.ok(customers.includes('ออเดอร์ 1205 รายการ'))
  assert.ok(customers.includes('customerPage=2'))
  assert.ok(customers.includes('aria-label="แบ่งหน้ารายการ"'))
})
