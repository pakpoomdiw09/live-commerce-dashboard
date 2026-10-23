const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function load(file, deps, globals = {}) {
  const context = {
    exports: {},
    console: { error() {}, warn() {} },
    process: { env: {} },
    require: (name) => {
      if (name in deps) return deps[name]
      throw Error('Unexpected dependency ' + name)
    },
    ...globals,
  }
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, 'utf8'), {
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
const id = '11111111-1111-4111-8111-111111111111'
class InboxError extends Error {
  constructor(message, status = 400, code = 'INBOX_ERROR') {
    super(message)
    this.status = status
    this.code = code
  }
}

function tenants(results, picked = id) {
  const selections = []
  const db = {
    from: () => ({
      select(columns) {
        selections.push(columns)
        return this
      },
      order() {
        return this
      },
      returns: async () => results.shift(),
    }),
  }
  const api = load('lib/tenant.ts', {
    'server-only': {},
    react: { cache: (fn) => fn },
    'next/headers': { cookies: async () => ({ get: () => ({ value: picked }) }) },
    '@/lib/supabase/server': { supabaseAdmin: () => db },
    '@/lib/auth': { getActor: async () => ({ kind: 'user', id: 'admin', isPlatformAdmin: true }) },
    '@/lib/integrations/facebook/client': {},
    '@/lib/types': { TENANT_COLUMNS: 'id,name,slip_quota_credits' },
  })
  return { api, selections }
}

test('missing optional top-up column or grant keeps RLS-visible tenants and selection', async () => {
  for (const code of ['42501', '42703', 'PGRST204']) {
    const f = tenants([
      { data: null, error: { code } },
      { data: [{ id, name: 'Accessible shop' }], error: null },
    ])
    const selected = await f.api.getActiveTenant()
    assert.equal(selected.id, id)
    assert.equal(selected.slip_quota_credits, 0)
    assert.equal(f.selections[1], 'id,name')
  }
})

test('tenant failures remain errors; empty membership cannot manufacture access', async () => {
  const failed = tenants([{ data: null, error: { code: 'NETWORK', message: 'offline' } }])
  assert.equal((await failed.api.getTenants()).error, 'offline')
  assert.equal(failed.selections.length, 1)
  const denied = tenants([
    { data: null, error: { code: '42501' } },
    { data: null, error: { code: '42501', message: 'permission denied' } },
  ])
  assert.equal((await denied.api.getTenants()).error, 'permission denied')
  assert.equal(await tenants([{ data: [], error: null }]).api.getActiveTenant(), null)
})

test('stale tenant cookie selects an accessible shop instead of trusting the cookie', async () => {
  const f = tenants(
    [{ data: [{ id, name: 'Own shop', slip_quota_credits: 10 }], error: null }],
    'foreign',
  )
  assert.equal((await f.api.getActiveTenant()).id, id)
})

test('service-role tenant reads scope ordinary users by stored membership before reading shops', async () => {
  const calls = []
  const db = {
    from(table) {
      const query = {
        select(columns) {
          calls.push([table, 'select', columns])
          return this
        },
        eq(key, value) {
          calls.push([table, key, value])
          return this
        },
        in(key, values) {
          calls.push([table, key, Array.from(values)])
          return this
        },
        order() {
          return this
        },
        returns: async () => ({ data: [{ id }], error: null }),
        then(resolve, reject) {
          return Promise.resolve({ data: [{ tenant_id: id }], error: null }).then(resolve, reject)
        },
      }
      return query
    },
  }
  const api = load('lib/tenant.ts', {
    'server-only': {},
    react: { cache: (fn) => fn },
    'next/headers': {},
    '@/lib/auth': {},
    '@/lib/integrations/facebook/client': {},
    '@/lib/supabase/server': { supabaseAdmin: () => db },
    '@/lib/types': { TENANT_COLUMNS: 'id,name' },
  })
  assert.equal((await api.getTenantsForActor(null)).tenants.length, 0)
  assert.equal(calls.length, 0)
  const result = await api.getTenantsForActor({
    kind: 'user',
    id: 'member',
    isPlatformAdmin: false,
  })
  assert.equal(result.tenants[0].id, id)
  assert.deepEqual(
    calls.find((call) => call[0] === 'tenant_members' && call[1] === 'user_id'),
    ['tenant_members', 'user_id', 'member'],
  )
  assert.deepEqual(
    calls.find((call) => call[0] === 'tenants' && call[1] === 'id'),
    ['tenants', 'id', [id]],
  )
  assert.deepEqual(
    calls.find((call) => call[0] === 'tenants' && call[1] === 'is_active'),
    ['tenants', 'is_active', true],
  )
})

test('service-role membership lookup fails closed without reading tenant records', async () => {
  for (const result of [
    { data: [], error: null },
    { data: null, error: { message: 'membership unavailable' } },
  ]) {
    const api = load('lib/tenant.ts', {
      'server-only': {},
      react: { cache: (fn) => fn },
      'next/headers': {},
      '@/lib/auth': {},
      '@/lib/integrations/facebook/client': {},
      '@/lib/types': {},
      '@/lib/supabase/server': {
        supabaseAdmin: () => ({
          from: (table) => {
            assert.equal(table, 'tenant_members')
            return {
              select() {
                return this
              },
              eq: async () => result,
            }
          },
        }),
      },
    })
    const value = await api.getTenantsForActor({
      kind: 'user',
      id: 'member',
      isPlatformAdmin: false,
    })
    assert.equal(value.tenants.length, 0)
    assert.equal(value.error, result.error?.message ?? null)
  }
})

test('overview route restores the premium component and retains an authenticated basic view', async () => {
  let enabled = true,
    checks = 0
  const Premium = () => null,
    Basic = () => null
  const api = load('app/(dashboard)/overview/page.tsx', {
    'react/jsx-runtime': require('react/jsx-runtime'),
    '@/lib/auth': {
      requireDashboardUser: async () => {
        checks++
      },
    },
    '@/lib/features/overview/premium-overview-core': { premiumOverviewEnabled: () => enabled },
    '@/components/overview/PremiumOverviewPage': { PremiumOverviewPage: Premium },
    '@/components/overview/BasicOverviewPage': { BasicOverviewPage: Basic },
  })
  assert.equal((await api.default({ searchParams: Promise.resolve({ range: '7' }) })).type, Premium)
  assert.equal(
    (await api.default({ searchParams: Promise.resolve({ view: 'basic' }) })).type,
    Basic,
  )
  enabled = false
  assert.equal((await api.default({ searchParams: Promise.resolve({}) })).type, Basic)
  assert.equal(checks, 3)
})

test('development overview RPC errors are visible and never fabricate zero metrics', async () => {
  const api = load(
    'lib/features/overview/premium-overview-server.ts',
    {
      'server-only': {},
      '@/lib/auth': { canAccessTenant: async () => true },
      '@/lib/supabase/server': {
        supabaseAdmin: () => ({ rpc: async () => ({ error: { code: '42883' }, data: null }) }),
      },
      '@/lib/features/inbox/inbox-server': { InboxError },
      '@/lib/utils': { UUID: /^[0-9a-f-]{36}$/ },
      '@/lib/features/overview/premium-overview-core': {
        premiumOverviewEnabled: () => true,
        overviewFilters: () => ({}),
      },
      '@/lib/features/overview/overview-tables': {
        overviewFromTables: async () => {
          throw new InboxError('unavailable', 503, 'OVERVIEW_UNAVAILABLE')
        },
      },
    },
    { process: { env: { NODE_ENV: 'development' } } },
  )
  await assert.rejects(
    api.loadPremiumOverview(
      { kind: 'user' },
      id,
      {},
      { autoVerifyEnabled: true, bankConfigured: true, pageConfigured: true },
    ),
    (error) => error.status === 503 && error.code === 'OVERVIEW_UNAVAILABLE',
  )
})

function slipApi({ actor = { kind: 'user' }, allowed = true, error = null } = {}) {
  const filters = []
  let reads = 0
  const query = {
    select() {
      return this
    },
    or(value) {
      filters.push(value)
      return this
    },
    order() {
      return this
    },
    limit: async () => ({ data: [{ id: 'slip' }], error }),
  }
  const api = load('app/api/slips/route.ts', {
    'next/server': {
      NextResponse: { json: (body, options = {}) => ({ body, status: 200, ...options }) },
    },
    '@/lib/auth': { getActor: async () => actor, canAccessTenant: async () => allowed },
    '@/lib/tenant': {
      getActiveTenant: async () => ({ id }),
      tenantFilter: (value) => 'tenant_id.eq.' + value,
    },
    '@/lib/supabase/server': {
      supabaseServer: async () => ({
        from: () => {
          reads++
          return query
        },
      }),
    },
    '@/lib/types': { SLIP_COLUMNS: 'id' },
    '@/lib/utils': { UUID: /^[0-9a-f-]{36}$/ },
    '@/lib/features/inbox/inbox-server': {
      InboxError,
      inboxError: (error) => ({ status: error.status }),
    },
  })
  return {
    run: (limit = '200') =>
      api.GET({ nextUrl: new URL('https://test/api/slips?tenantId=' + id + '&limit=' + limit) }),
    filters,
    reads: () => reads,
  }
}

test('slip listing checks session/access before reads and never converts DB failures to empty results', async () => {
  for (const [options, status] of [
    [{ actor: null }, 401],
    [{ actor: { kind: 'internal' } }, 401],
    [{ allowed: false }, 404],
  ]) {
    const f = slipApi(options)
    assert.equal((await f.run()).status, status)
    assert.equal(f.reads(), 0)
  }
  const success = slipApi(),
    result = await success.run()
  assert.equal(result.body.slips.length, 1)
  assert.equal(result.headers['Cache-Control'], 'private, no-store')
  assert.equal(success.filters[0], 'tenant_id.eq.' + id)
  assert.equal((await slipApi({ error: { code: '42501' } }).run()).status, 503)
  assert.equal((await slipApi().run('201')).status, 400)
})
