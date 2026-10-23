const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm'),
  ts = require('typescript')
function load(file, deps = {}) {
  const exports = {}
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    {
      exports,
      console,
      require(name) {
        if (Object.hasOwn(deps, name)) return deps[name]
        if (name.startsWith('react') || name === 'lucide-react') return require(name)
        throw Error('Unexpected dependency ' + name)
      },
    },
  )
  return exports
}
const codec = load('lib/features/store-rules/store-rule-items.ts'),
  persona = load('lib/features/store-rules/shop-persona-settings.ts', {
    '@/lib/features/store-rules/store-rule-items': codec,
  })
const good = [{ id: 'legacy-item', body: 'ค่าส่ง 50 บาท\nตัดรอบ 15:00 น.' }]
const invalid = [
  '{"snapbot_store_rules":',
  '{"snapbot_store_rules":1,"rules":null}',
  JSON.stringify({ snapbot_store_rules: '1', rules: [] }),
  JSON.stringify({ snapbot_store_rules: 2, rules: [] }),
  JSON.stringify({ snapbot_store_rules: 1, rules: good, surprise: true }),
  ...[
    null,
    { id: '', body: 'rule' },
    { id: 'x', body: ' ' },
    { id: 'x', body: 3 },
    { id: 'x', body: 'rule', enabled: 'false' },
    { id: 'x', body: 'rule', category: 'forged' },
    { id: 'x', body: 'rule', extra: true },
    { id: 'x', body: '\0' },
    { id: 'x', body: '\ud800' },
  ].map((item) => JSON.stringify({ snapbot_store_rules: 1, rules: [item] })),
  JSON.stringify({
    snapbot_store_rules: 1,
    rules: [
      { id: 'duplicate', body: 'one' },
      { id: 'duplicate', body: 'two' },
    ],
  }),
  JSON.stringify({
    snapbot_store_rules: 1,
    rules: Array.from({ length: 201 }, (_, index) => ({ id: String(index), body: 'rule' })),
  }),
]
test('malformed reads return Thai structured states, never throw or become model context', () => {
  for (const raw of invalid) {
    const result = codec.parseStoreRules(raw)
    assert.equal(result.ok, false, raw)
    assert.equal(result.raw, raw)
    assert.match(result.issues[0].message, /[ก-๙]/)
    assert.equal(typeof result.issues[0].path, 'string')
    assert.doesNotThrow(() => codec.readStoreRuleItems(raw))
    assert.equal(persona.shopRulesPrompt(raw), '')
    assert.throws(
      () => codec.validateStoreRules(raw),
      (error) => error.code === 'STORE_RULES_INVALID',
    )
  }
})
test('legacy text, quoted markers and metadata-free historical rows remain byte-for-byte intact', () => {
  for (const raw of [
    '  กฎเดิม\n\n',
    'ตัวอย่าง "snapbot_store_rules" สำหรับอธิบาย',
    '{"note":{"snapbot_store_rules":1}}',
    '["ข้อความเดิม"]',
  ]) {
    const parsed = codec.parseStoreRules(raw)
    assert.equal(parsed.ok, true)
    assert.equal(parsed.kind, 'legacy')
    assert.equal(parsed.raw, raw)
    assert.equal(parsed.items[0].body, raw)
  }
  const raw = codec.serializeStoreRuleItems(good)
  assert.equal(codec.parseStoreRules(raw).raw, raw)
  assert.equal(JSON.stringify(codec.readStoreRuleItems(raw)), JSON.stringify(good))
  assert.equal(codec.parseStoreRules('ก'.repeat(50000)).ok, true)
  assert.equal(codec.parseStoreRules('ก'.repeat(50001)).issues[0].code, 'TOO_LONG')
})

function fixture(initial = 'กฎเดิม') {
  let raw = initial,
    allowed = true
  const writes = [],
    snapshots = []
  class InboxError extends Error {
    constructor(message, status = 400, code = 'INBOX_ERROR') {
      super(message)
      this.status = status
      this.code = code
    }
  }
  const db = {
    from() {
      return {
        select() {
          return this
        },
        eq() {
          return this
        },
        maybeSingle: async () => ({
          data: { ai_instructions: raw, instructions: raw },
          error: null,
        }),
      }
    },
    async rpc(name, args) {
      assert.equal(args.p_tenant, 'own')
      assert.equal(args.p_actor, 'owner')
      if (args.p_expected !== raw) return { error: { code: '40001' } }
      writes.push({ name, args })
      snapshots.push(raw)
      raw = args.p_instructions
      return { error: null }
    },
  }
  const deps = {
    'next/server': {
      NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) },
    },
    '@/lib/features/agents/agent-control-server': {
      agentControlDashboard: async () => ({ shopInstructions: raw }),
      agentControlTenant: async () => {
        if (!allowed) throw new InboxError('ไม่มีสิทธิ์', 403)
        return { db, tenantId: 'own', actor: { id: 'owner' }, config: { flags: {} } }
      },
    },
    '@/lib/auth': { canAccessTenant: async () => true },
    '@/lib/features/inbox/inbox-server': {
      InboxError,
      inboxError: (error) => ({
        body: { error: error.message, code: error.code },
        status: error.status ?? 503,
      }),
      checkRpc: (error) => {
        if (error) throw error
      },
    },
    '@/lib/features/agents/agent-control-core': {
      containsSecret: (text) => text.includes('api_key='),
    },
    '@/lib/features/store-rules/shop-persona-settings': persona,
    '@/lib/features/store-rules/store-rule-items': codec,
  }
  const main = load('app/api/agent-control/route.ts', deps),
    items = load('app/api/agent-control/rules/route.ts', deps),
    restore = load('app/api/agent-control/prompts/[version]/restore/route.ts', deps)
  const request = (body) => ({
    nextUrl: { searchParams: new URLSearchParams('tenantId=forged') },
    json: async () => body,
  })
  return {
    main,
    items,
    restore,
    request,
    writes,
    snapshots,
    raw: () => raw,
    deny: () => {
      allowed = false
    },
  }
}
test('main PATCH rejects every invalid document and wrong type before persistence', async () => {
  const f = fixture()
  for (const instructions of [...invalid, null, 1, {}, []]) {
    const result = await f.main.PATCH(f.request({ instructions }))
    assert.equal(result.status, 400)
  }
  assert.equal(f.writes.length, 0)
  assert.equal(f.raw(), 'กฎเดิม')
})
test('invalid stored data cannot be overwritten through normal saves or row edits; explicit recovery uses CAS', async () => {
  const original = invalid[1],
    f = fixture(original)
  assert.equal(
    (await f.main.PATCH(f.request({ instructions: 'replacement' }))).body.code,
    'STORE_RULES_RECOVERY_REQUIRED',
  )
  assert.equal((await f.items.POST(f.request({ id: 'new', body: 'replacement' }))).status, 400)
  assert.equal(f.writes.length, 0)
  assert.equal(f.raw(), original)
  assert.equal(
    (
      await f.main.PATCH(
        f.request({ instructions: 'fixed', recover: true, expectedInstructions: 'stale' }),
      )
    ).status,
    409,
  )
  const fixed = await f.main.PATCH(
    f.request({ instructions: '  fixed\n', recover: true, expectedInstructions: original }),
  )
  assert.equal(fixed.status, 200)
  assert.equal(f.raw(), '  fixed\n')
  assert.equal(f.snapshots[0], original)
  assert.equal(f.writes[0].name, 'save_validated_store_rules')
  assert.equal(
    (
      await f.main.PATCH(
        f.request({ instructions: 'stale overwrite', expectedInstructions: original }),
      )
    ).status,
    409,
  )
  f.deny()
  assert.equal((await f.main.PATCH(f.request({ instructions: 'forged' }))).status, 403)
})
test('GET retains malformed raw data with a structured state; invalid prompt history cannot be restored', async () => {
  const f = fixture(invalid[1])
  const response = await f.main.GET(f.request({}))
  assert.equal(response.status, 200)
  assert.equal(response.body.shopInstructions, invalid[1])
  assert.equal(response.body.storeRulesState.ok, false)
  assert.equal(
    (await f.restore.POST(f.request({}), { params: Promise.resolve({ version: '1' }) })).status,
    400,
  )
  assert.equal(f.writes.length, 0)
})
test('row edits preserve unrelated legacy rules and reject unknown fields and invalid previous metadata', async () => {
  const f = fixture('  original\n')
  assert.equal((await f.items.POST(f.request({ id: 'new-item', body: 'new' }))).status, 200)
  assert.equal(codec.readStoreRuleItems(f.raw())[0].body, '  original\n')
  for (const extra of [
    { previousEnabled: 'true' },
    { previousCategory: 'forged' },
    { unknown: true },
  ])
    assert.equal(
      (
        await f.items.PATCH(
          f.request({ id: 'new-item', body: 'update', previousBody: 'new', ...extra }),
        )
      ).status,
      400,
    )
  assert.equal(f.writes.length, 1)
})
test('invalid rules render a local recovery panel while valid legacy rules still render the table', () => {
  const React = require('react'),
    { renderToStaticMarkup } = require('react-dom/server')
  const recovery = load('components/chatbot/StoreRulesRecovery.tsx', {
    '@/lib/features/store-rules/store-rule-items': codec,
  })
  const boundary = load('components/chatbot/StoreRulesErrorBoundary.tsx')
  const ui = load('components/chatbot/StoreRulesSettings.tsx', {
    '@/lib/features/store-rules/shop-persona-settings': persona,
    '@/lib/features/store-rules/store-rule-items': codec,
    '@/components/chatbot/StoreRulesRecovery': recovery,
    '@/components/chatbot/StoreRulesErrorBoundary': boundary,
  })
  const props = { tenantId: 'own', onSaved: async () => {}, disabled: false }
  const html = renderToStaticMarkup(
    React.createElement(ui.StoreRulesSettings, { ...props, initial: invalid[1] }),
  )
  assert.match(html, /role="alert"/)
  assert.match(html, /ข้อมูลกฎต้นฉบับ/)
  assert.match(html, /ดาวน์โหลดข้อมูลเดิม/)
  assert.doesNotMatch(html, /<table/)
  assert.match(
    renderToStaticMarkup(
      React.createElement(ui.StoreRulesSettings, { ...props, initial: 'กฎเดิม' }),
    ),
    /<table/,
  )
})
