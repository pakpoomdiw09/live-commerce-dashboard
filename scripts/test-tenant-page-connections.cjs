const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function transpile(file) {
  return ts.transpileModule(readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
}

const facebookCode = transpile('lib/integrations/facebook/client.ts')
const tenantCode = transpile('lib/tenant.ts')

// Use the real Facebook helpers with fake credentials and mocked Supabase/Meta responses.
// No .env access, real network requests, or database writes are possible in this harness.
function fixture({ rows = [], env = {}, dbError = null, dbThrows = false, debugError = false, profile = null, picture = null } = {}) {
  const queries = []
  const requests = []
  const logs = []
  const facebook = {}
  vm.runInNewContext(facebookCode, {
    exports: facebook,
    require: name => { assert.equal(name, '@/lib/safe-logging'); return require('./helpers/load-safe-logging.cjs')({ info: (...args) => logs.push(args), warn: (...args) => logs.push(args), error: (...args) => logs.push(args) }) },
    process: { env },
    AbortSignal,
    URL,
    fetch: async (url, options) => {
      requests.push({ url, options })
      const requestUrl = new URL(url)
      if (requestUrl.pathname.endsWith('/debug_token')) {
        const token = requestUrl.searchParams.get('input_token')
        const row = rows.find((item) => item.page_access_token === token)
        const pageId = row?.page_id ?? (token === env.FB_PAGE_TOKEN ? env.FB_PAGE_ID : null)
        if (debugError) return { ok: false, status: 403, json: async () => ({ error: { code: 10 } }) }
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { is_valid: true, type: 'PAGE', profile_id: pageId, scopes: ['pages_messaging'], expires_at: 0 } }),
        }
      }
      if (requestUrl.pathname.endsWith('/picture')) return { ok: !!picture, status: picture ? 200 : 403, json: async () => picture ? { data: { url: picture } } : { error: { code: 10 } } }
      assert.ok(requestUrl.pathname.endsWith('/me'), `Unexpected Graph request: ${requestUrl.pathname}`)
      return { ok: !!profile, status: profile ? 200 : 403, json: async () => profile ?? ({ error: { code: 10 } }) }
    },
  })

  const admin = () => {
    if (dbThrows) throw new Error('mock missing service role configuration')
    return {
      from(table) {
        assert.equal(table, 'tenants')
        queries.push({ operation: 'from', table })
        return {
          select(columns) {
            queries.push({ operation: 'select', columns })
            return {
              async in(column, values) {
                queries.push({ operation: 'in', column, values })
                return { data: dbError ? null : rows.filter((row) => values.includes(row[column])), error: dbError }
              },
              eq(column, value) {
                queries.push({ operation: 'eq', column, value })
                return {
                  async maybeSingle() {
                    queries.push({ operation: 'maybeSingle' })
                    return { data: dbError ? null : rows.find((row) => row[column] === value) ?? null, error: dbError }
                  },
                }
              },
            }
          },
          insert() { throw new Error('Unexpected mutating insert') },
          update() { throw new Error('Unexpected mutating update') },
          upsert() { throw new Error('Unexpected mutating upsert') },
          delete() { throw new Error('Unexpected mutating delete') },
        }
      },
      rpc() { throw new Error('Unexpected mutating RPC') },
    }
  }

  const modules = {
    'server-only': {},
    react: { cache: (fn) => fn },
    'next/headers': { cookies: async () => ({ get: () => undefined }) },
    '@/lib/supabase/server': { supabaseAdmin: admin, supabaseServer: admin },
    '@/lib/auth': { getActor: async () => null, tenantRole: async () => null },
    '@/lib/integrations/facebook/client': facebook,
    '@/lib/types': { TENANT_COLUMNS: 'id,page_id,page_name,page_token_set' },
  }
  const tenant = {}
  vm.runInNewContext(tenantCode, {
    exports: tenant,
    process: { env },
    require(name) {
      assert.ok(Object.hasOwn(modules, name), `Unexpected module: ${name}`)
      return modules[name]
    },
    console: { error: (...args) => logs.push(args), log: (...args) => logs.push(args) },
  })
  return { ...tenant, queries, requests, logs }
}

function storedTenant(index = 1) {
  return { id: `tenant-${index}`, page_id: `page-${index}`, page_name: `Saved Page ${index}`, page_token_set: true }
}

function secretRow(tenant) {
  return { ...tenant, page_access_token: `secret-for-${tenant.id}` }
}

test('8 imported messaging Pages remain verified when every profile read is denied', async () => {
  const tenants = Array.from({ length: 8 }, (_, index) => storedTenant(index + 1))
  const rows = tenants.map(secretRow)
  const api = fixture({ rows })
  const [statuses, profiles] = await Promise.all([
    api.tenantPageConnections(tenants),
    Promise.all(tenants.map((tenant) => api.tenantPages(tenant))),
  ])
  assert.equal(statuses.size, 8)
  for (const tenant of tenants) assert.equal(statuses.get(tenant.id), 'verified')
  for (const [index, result] of profiles.entries()) {
    assert.equal(result[0].id, tenants[index].page_id)
    assert.equal(result[0].name, tenants[index].page_name)
    assert.equal(result[0].picture, null)
  }
  assert.equal(api.requests.filter((request) => new URL(request.url).pathname.endsWith('/debug_token')).length, 8)
  assert.equal(api.requests.filter((request) => new URL(request.url).pathname.endsWith('/me')).length, 8)
  const dashboardPayload = JSON.stringify({ statuses: [...statuses], profiles })
  for (const row of rows) assert.ok(!dashboardPayload.includes(row.page_access_token))
  assert.ok(api.queries.every((query) => ['from', 'select', 'in', 'eq', 'maybeSingle'].includes(query.operation)))
})

test('tenantPages prefers the stored Page name when profile permission is unavailable', async () => {
  const tenant = storedTenant()
  const api = fixture({ rows: [{ ...secretRow(tenant), page_name: 'Fresh stored name' }] })
  const [page] = await api.tenantPages({ ...tenant, page_name: 'Older viewer name' })
  assert.equal(page.name, 'Fresh stored name')
  assert.equal(page.id, tenant.page_id)
})

test('direct Page picture works without metadata permission and debug output never exposes token', async () => {
  const tenant = { ...storedTenant(), page_id: '123456789' }
  const row = secretRow(tenant)
  const api = fixture({ rows: [row], env: { FB_DEBUG: 'true' }, picture: 'https://cdn.example/profile.jpg' })
  const [page] = await api.tenantPages(tenant)
  assert.equal(page.name, tenant.page_name)
  assert.equal(page.picture, 'https://cdn.example/profile.jpg')
  assert.ok(!JSON.stringify(api.logs).includes(row.page_access_token))
  const safeRecords = api.logs.filter(args => typeof args[0] === 'string' && args[0].startsWith('{'))
  assert.ok(safeRecords.length > 0)
  assert.ok(safeRecords.every(args => Object.keys(JSON.parse(args[0])).every(key => ['requestId','eventType','status','durationMs','errorCode'].includes(key))))
})

test('tenantPages retains its viewer-safe Page name during a service-role read failure', async () => {
  const tenant = storedTenant()
  const api = fixture({ dbError: { code: '42501' } })
  const [page] = await api.tenantPages(tenant)
  assert.equal(page.name, tenant.page_name)
  assert.equal(page.picture, null)
  assert.equal(api.requests.length, 0)
})

test('a profile from another Page never overrides the saved Page identity/name', async () => {
  const tenant = storedTenant()
  const api = fixture({ rows: [secretRow(tenant)], profile: { id: 'unrelated-page', name: 'Wrong Page' } })
  const [page] = await api.tenantPages(tenant)
  assert.equal(page.id, tenant.page_id)
  assert.equal(page.name, tenant.page_name)
})

test('missing Page and missing token are distinct statuses', async () => {
  const noPage = { id: 'no-page', page_id: null, page_token_set: false }
  const noToken = { id: 'no-token', page_id: 'page-empty', page_token_set: false }
  const api = fixture({ rows: [{ ...noToken, page_access_token: null }] })
  const statuses = await api.tenantPageConnections([noPage, noToken])
  assert.equal(statuses.get('no-page'), 'missing-page')
  assert.equal(statuses.get('no-token'), 'missing-token')
  assert.equal(api.requests.length, 0)
  assert.equal((await api.tenantPages(noPage)).length, 0)
})

test('tenants without Page IDs do not query secret columns', async () => {
  const api = fixture()
  const statuses = await api.tenantPageConnections([{ id: 'no-page', page_id: null, page_token_set: true }])
  assert.equal(statuses.get('no-page'), 'missing-page')
  assert.equal(api.queries.length, 0)
})

for (const [name, options] of [
  ['database permission error', { dbError: { code: '42501', message: 'mock permission denied' } }],
  ['service role unavailable', { dbThrows: true }],
  ['debug permission error', { debugError: true }],
]) {
  test(`${name} leaves a saved token unverified`, async () => {
    const tenant = storedTenant()
    const row = secretRow(tenant)
    const api = fixture({ rows: [row], ...options })
    const statuses = await api.tenantPageConnections([tenant])
    assert.equal(statuses.get(tenant.id), 'unverified')
    assert.ok(!JSON.stringify({ statuses: [...statuses], logs: api.logs }).includes(row.page_access_token))
  })
}

test('missing or changed secret rows remain unverified without using an unrelated token', async () => {
  const tenant = storedTenant()
  for (const rows of [[], [{ ...secretRow(tenant), page_id: 'changed-page' }]]) {
    const api = fixture({ rows })
    const statuses = await api.tenantPageConnections([tenant])
    assert.equal(statuses.get(tenant.id), 'unverified')
    assert.equal(api.requests.length, 0)
  }
})

test('the shared environment token verifies only its configured matching Page', async () => {
  const matching = { ...storedTenant(1), page_token_set: false }
  const other = { ...storedTenant(2), page_token_set: false }
  const rows = [matching, other].map((tenant) => ({ ...tenant, page_access_token: null }))
  const api = fixture({ rows, env: { FB_PAGE_TOKEN: 'shared-secret', FB_PAGE_ID: matching.page_id } })
  const statuses = await api.tenantPageConnections([matching, other])
  assert.equal(statuses.get(matching.id), 'verified')
  assert.equal(statuses.get(other.id), 'missing-token')
  assert.equal(api.requests.length, 1)
  assert.ok(!JSON.stringify([...statuses]).includes('shared-secret'))
})

test('a shared token without FB_PAGE_ID cannot falsely connect any tenant', async () => {
  const tenant = { ...storedTenant(), page_token_set: false }
  const api = fixture({ rows: [{ ...tenant, page_access_token: null }], env: { FB_PAGE_TOKEN: 'shared-secret' } })
  const statuses = await api.tenantPageConnections([tenant])
  assert.equal(statuses.get(tenant.id), 'missing-token')
  assert.equal(api.requests.length, 0)
})
