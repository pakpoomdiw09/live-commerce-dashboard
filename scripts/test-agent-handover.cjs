const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm'),
  ts = require('typescript')
function load(file, deps = {}) {
  const exports = {}
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      console,
      require: (name) => {
        if (name in deps) return deps[name]
        throw Error('Unexpected dependency ' + name)
      },
    },
  )
  return exports
}
const info = load('lib/features/agents/agent-handover.ts')
test('customer identity uses real trimmed names and distinct fallback IDs, with truthful channel badges', () => {
  assert.equal(
    info.handoverCustomerName({
      id: 'customer',
      display_name: '  ดิว เมืองลุง  ',
      platform_user_id: '123456',
    }),
    'ดิว เมืองลุง',
  )
  assert.equal(
    info.handoverCustomerName({ id: 'customer', display_name: ' ', platform_user_id: '123456' }),
    'ผู้ใช้ …3456',
  )
  for (const [platform, label] of [
    ['facebook', 'Facebook Messenger'],
    ['LINE', 'LINE'],
    ['lazada', 'Lazada'],
    ['TikTok', 'TikTok'],
    [null, 'ไม่ระบุช่องทาง'],
    ['unconnected', 'ช่องทางอื่น'],
  ])
    assert.equal(info.handoverChannel(platform).label, label)
})
test('queue query fetches actual avatar, name and platform only after tenant customer entitlement', async () => {
  const reads = []
  let allowed = false
  const api = load('lib/features/agents/agent-control-server.ts', {
    'server-only': {},
    '@/lib/auth': {},
    '@/lib/supabase/server': {},
    '@/lib/feature-access': { hasFeature: async () => allowed },
    '@/lib/features/inbox/inbox-server': {},
    '@/lib/features/agents/agent-control-flags': {},
    '@/lib/utils': {},
    '@/lib/features/agents/agent-control-core': {
      conversationOwner: () => 'WAITING_ADMIN',
      redactAgentText: (text) => text,
    },
  })
  const db = {
    from(table) {
      const entry = { table, fields: '', filters: [] }
      reads.push(entry)
      const q = {
        select(fields) {
          entry.fields = fields
          return q
        },
        eq(key, value) {
          entry.filters.push([key, value])
          return q
        },
        order() {
          return q
        },
        limit(value) {
          assert.equal(value, 50)
          return q
        },
        then(resolve) {
          return Promise.resolve({
            data: [
              {
                id: 'customer',
                display_name: '  ชื่อจริง  ',
                avatar_url: 'https://example.test/avatar.png',
                platform_user_id: 'psid',
                platform: 'facebook',
              },
            ],
            error: null,
          }).then(resolve)
        },
      }
      return q
    },
  }
  assert.equal((await api.agentHandoverCustomers(db, 'own')).length, 0)
  assert.equal(reads.length, 0)
  allowed = true
  const rows = await api.agentHandoverCustomers(db, 'own')
  assert.equal(rows[0].display_name, 'ชื่อจริง')
  assert.equal(rows[0].avatar_url, 'https://example.test/avatar.png')
  assert.equal(rows[0].platform, 'facebook')
  assert.match(reads[0].fields, /avatar_url/)
  assert.match(reads[0].fields, /platform_user_id/)
  assert.ok(reads[0].filters.some(([key, value]) => key === 'tenant_id' && value === 'own'))
})
test('queue read API uses session-scoped tenant and disables caching; unauthorized reads stop early', async () => {
  let allowed = false,
    reads = 0
  const api = load('app/api/agent-control/handover/route.ts', {
    'next/server': {
      NextResponse: { json: (body, options) => ({ status: 200, body, headers: options.headers }) },
    },
    '@/lib/features/agents/agent-control-server': {
      agentControlTenant: async () => {
        if (!allowed) throw Error('Unauthorized')
        return { db: {}, tenantId: 'server-tenant' }
      },
      agentHandoverCustomers: async (_db, tenant) => {
        reads++
        assert.equal(tenant, 'server-tenant')
        return []
      },
    },
    '@/lib/features/inbox/inbox-server': { inboxError: () => ({ status: 401 }) },
  })
  const req = { nextUrl: { searchParams: new URLSearchParams('tenantId=forged') } }
  assert.equal((await api.GET(req)).status, 401)
  assert.equal(reads, 0)
  allowed = true
  const result = await api.GET(req)
  assert.equal(result.headers['Cache-Control'], 'private, no-store')
  assert.equal(reads, 1)
})
