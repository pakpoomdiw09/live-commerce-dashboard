const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const { test } = require('node:test')

function load(file, mocks) {
  const context = { exports: {}, console, require(name) {
    if (!(name in mocks)) throw new Error('Unexpected import: ' + name)
    return mocks[name]
  } }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context)
  return context.exports
}
const id = '11111111-1111-4111-8111-111111111111'
function fixture({ actor = {}, member = true, owner = true, scope = { tenant_id: 'shop' }, scopeError = null } = {}) {
  const calls = []
  const db = { from() {
    const query = { select() { return query }, eq() { return query }, maybeSingle: async () => ({ data: scope, error: scopeError }) }
    calls.push('scope')
    return query
  } }
  const mocks = {
    '@/lib/feature-access': { hasFeature: async () => true },
    'next/server': { NextResponse: { json: (body, opts = {}) => ({ body, status: opts.status || 200 }) } },
    '@/lib/supabase/server': { supabaseAdmin() { calls.push('admin'); return db } },
    '@/lib/auth': { getActor: async () => actor, canAccessTenant: async (_actor, tenant, role) => { calls.push(role || 'member'); assert.equal(tenant, 'shop'); return role === 'owner' ? owner : member } },
    '@/lib/utils': { UUID: /^[0-9a-f-]{36}$/ },
    '@/lib/features/slips/detail': { loadSlipDetail: async (_db, _id, tenant) => { calls.push('detail'); assert.equal(tenant, 'shop'); return { tenant_id: 'shop' } } },
    '@/lib/features/commerce/orders': { pendingOrders() { throw Error('Must not modify orders') } },
    '@/lib/features/slips/process': { markOrdersPaid() { throw Error('Must not modify orders') } },
    '@/lib/status': { APPROVABLE: ['valid'] },
  }
  return { calls, mocks }
}
test('unauthenticated slip GET never creates a service client', async () => {
  const f = fixture({ actor: null })
  const api = load('app/api/slips/[id]/route.ts', f.mocks)
  assert.equal((await api.GET({}, { params: Promise.resolve({ id }) })).status, 401)
  assert.deepEqual(f.calls, [])
})
test('forbidden, missing and failed scope lookups never load detail/sign URLs', async () => {
  for (const options of [{ member: false }, { scope: null }, { scopeError: { code: 'failed' } }]) {
    const f = fixture(options)
    const api = load('app/api/slips/[id]/route.ts', f.mocks)
    assert.ok([404, 500].includes((await api.GET({}, { params: Promise.resolve({ id }) })).status))
    assert.equal(f.calls.includes('detail'), false)
  }
})
test('authorized GET checks membership before loading scoped detail', async () => {
  const f = fixture()
  const api = load('app/api/slips/[id]/route.ts', f.mocks)
  assert.equal((await api.GET({}, { params: Promise.resolve({ id }) })).status, 200)
  assert.deepEqual(f.calls, ['admin', 'scope', 'member', 'detail'])
})
test('staff cannot approve even an already approved slip', async () => {
  const f = fixture({ owner: false, scope: { tenant_id: 'shop', status: 'valid', approved_at: 'existing' } })
  const api = load('app/api/slips/[id]/approve/route.ts', f.mocks)
  assert.equal((await api.POST({}, { params: Promise.resolve({ id }) })).status, 403)
})
test('owner can approve idempotently', async () => {
  const f = fixture({ scope: { tenant_id: 'shop', status: 'valid', approved_at: 'existing', customer_id: null } })
  const api = load('app/api/slips/[id]/approve/route.ts', f.mocks)
  assert.equal((await api.POST({}, { params: Promise.resolve({ id }) })).status, 200)
})
test('dashboard guard redirects without constructing service-role client', async () => {
  const api = load('lib/auth.ts', {
    'server-only': {}, react: { cache: fn => fn },
    'next/navigation': { redirect() { throw Error('LOGIN_REDIRECT') } },
    '@/lib/supabase/server': {
      supabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } }),
      supabaseAdmin() { throw Error('Service role accessed before session') },
    },
  })
  await assert.rejects(api.requireDashboardUser(), /LOGIN_REDIRECT/)
})
