const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function load(file, dependencies, globals = {}) {
  const context = {
    exports: {},
    process: { env: {} },
    console: { error() {}, warn() {}, info() {} },
    AbortSignal,
    require(name) {
      if (name === 'server-only') return {}
      if (name === '@/lib/safe-logging')
        return require('./helpers/load-safe-logging.cjs')({ info() {}, warn() {}, error() {} })
      if (Object.hasOwn(dependencies, name)) return dependencies[name]
      throw new Error('Unexpected dependency: ' + name)
    },
    ...globals,
  }
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    context,
  )
  return context.exports
}

function fixture({ rejectCard = false } = {}) {
  const requests = []
  const confirms = []
  let activeTenant = 'tenant-a'
  const client = load(
    'lib/integrations/facebook/client.ts',
    {},
    {
      process: {
        env: {
          FB_GRAPH_VERSION: 'v24.0',
          FB_PAGE_ID: 'page-shared',
          FB_PAGE_TOKEN: 'mock-shared-token',
        },
      },
      fetch: async (url, options) => {
        const body = JSON.parse(options.body)
        requests.push({ url, headers: options.headers, body })
        if (rejectCard && body.message.attachment)
          return Response.json(
            { error: { code: 100, message: 'Template rejected' } },
            { status: 400 },
          )
        return Response.json({ message_id: 'mid-' + requests.length })
      },
    },
  )
  const notify = load('lib/features/slips/notify.ts', {
    '@/lib/integrations/facebook/client': client,
    '@/lib/message-quota': {
      sendWithMessageCredit: async (_db, tenantId, send) => {
        assert.equal(tenantId, activeTenant)
        return send()
      },
    },
    '@/lib/features/inbox/inbox-automation-window': { assertAutomationWindow: async () => {} },
  })
  const db = {
    rpc: async () => ({ data: 'lease', error: null }),
    from(table) {
      const q = {
        select() {
          return q
        },
        insert() {
          return q
        },
        update(values) {
          if (table === 'slips') confirms.push(values)
          return q
        },
        eq() {
          return q
        },
        single: async () => ({ data: { id: 'message' }, error: null }),
        maybeSingle: async () => ({ data: { tenant_id: activeTenant }, error: null }),
        then(resolve, reject) {
          return Promise.resolve({ data: null, error: null }).then(resolve, reject)
        },
      }
      return q
    },
  }
  return {
    client,
    notify,
    db,
    requests,
    confirms,
    tenant: (id) => {
      activeTenant = id
    },
  }
}

test('verified slip cards use each tenant Page token, customer PSID and RESPONSE without a tag', async () => {
  const f = fixture()
  for (const [tenant, page, psid, token] of [
    ['tenant-a', '11111', '123456789', 'mock-token-a'],
    ['tenant-b', '22222', '987654321', 'mock-token-b'],
  ]) {
    f.tenant(tenant)
    await f.notify.notifySlipResult(
      f.db,
      { id: 'slip-' + tenant, status: 'valid', amount: 123.45, transRef: 'mock-transfer' },
      {
        id: 'customer-uuid-' + tenant,
        psid,
        token: f.client.pageTokenFor({ page_id: page, page_access_token: token }),
      },
      'Test shop',
    )
    const request = f.requests.at(-1)
    assert.equal(request.url, 'https://graph.facebook.com/v24.0/me/messages')
    assert.equal(request.headers.Authorization, 'Bearer ' + token)
    assert.equal(request.body.recipient.id, psid)
    assert.equal(request.body.messaging_type, 'RESPONSE')
    assert.equal(Object.hasOwn(request.body, 'tag'), false)
    assert.ok(request.body.message.attachment.payload.elements[0].subtitle.includes('123.45'))
  }
  assert.equal(f.confirms.length, 2)
})

test('explicitly rejected payment cards fall back to a RESPONSE text with the verified amount', async () => {
  const f = fixture({ rejectCard: true })
  await f.notify.notifySlipResult(
    f.db,
    { id: 'slip-test', status: 'valid', amount: 250, transRef: 'mock-transfer' },
    { id: 'customer-uuid', psid: '123456789', token: 'mock-token-a' },
  )
  assert.equal(f.requests.length, 2)
  const text = f.requests[1].body
  assert.equal(text.recipient.id, '123456789')
  assert.equal(text.messaging_type, 'RESPONSE')
  assert.ok(text.message.text.includes('250.00'))
  assert.equal(Object.hasOwn(text, 'tag'), false)
  assert.equal(f.confirms.length, 1)
})
