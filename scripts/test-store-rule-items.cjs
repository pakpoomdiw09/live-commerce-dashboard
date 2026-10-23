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
const codec = load('lib/features/store-rules/store-rule-items.ts'),
  settings = load('lib/features/store-rules/shop-persona-settings.ts', {
    '@/lib/features/store-rules/store-rule-items': codec,
  })
test('stored item IDs and multiline content round-trip while the prompt contains only rule text', () => {
  const items = [
      { id: 'one', body: 'ตัดรอบ 15:00 น.\nเฉพาะวันทำการ' },
      { id: 'two', body: 'ค่าส่ง 50 บาท' },
    ],
    raw = codec.serializeStoreRuleItems(items)
  assert.equal(JSON.stringify(codec.readStoreRuleItems(raw)), JSON.stringify(items))
  assert.equal(settings.shopRulesPrompt(raw), items.map((item) => item.body).join('\n\n'))
  assert.equal(codec.readStoreRuleItems('ข้อความเดิม')[0].body, 'ข้อความเดิม')
  assert.equal(settings.shopRulesPrompt(codec.serializeStoreRuleItems([])), '')
  assert.throws(() =>
    codec.validateStoreRules(
      '{"snapbot_store_rules":1,"rules":[{"id":"x","body":"a"},{"id":"x","body":"b"}]}',
    ),
  )
})
test('item API saves additions/edits/deletes with owner scope, prior-body checks and atomic compare-and-swap', async () => {
  let raw = 'กฎเดิม',
    allowed = true,
    conflict = false
  const writes = []
  class InboxError extends Error {
    constructor(message, status = 400) {
      super(message)
      this.status = status
    }
  }
  const db = {
    from() {
      return {
        select() {
          return this
        },
        eq(key, value) {
          assert.equal(value, 'own')
          return this
        },
        maybeSingle: async () => ({ data: { ai_instructions: raw }, error: null }),
      }
    },
    rpc: async (name, args) => {
      writes.push(args)
      assert.equal(name, 'save_store_rule_items')
      assert.equal(args.p_tenant, 'own')
      assert.equal(args.p_actor, 'owner')
      assert.equal(args.p_expected, raw)
      if (conflict) return { error: { code: '40001' } }
      raw = args.p_instructions
      return { error: null }
    },
  }
  const api = load('app/api/agent-control/rules/route.ts', {
    'next/server': { NextResponse: { json: (body) => ({ status: 200, body }) } },
    '@/lib/features/agents/agent-control-server': {
      agentControlTenant: async (_req, _tenant, owner) => {
        assert.equal(owner, true)
        if (!allowed) throw new InboxError('Forbidden', 403)
        return { db, tenantId: 'own', actor: { id: 'owner' } }
      },
    },
    '@/lib/features/inbox/inbox-server': {
      InboxError,
      inboxError: (error) => ({ status: error.status ?? 500 }),
      checkRpc: (error) => {
        if (error) throw error
      },
    },
    '@/lib/features/agents/agent-control-core': {
      containsSecret: (body) => body.includes('api_key='),
    },
    '@/lib/features/store-rules/shop-persona-settings': settings,
    '@/lib/features/store-rules/store-rule-items': codec,
  })
  const id = '11111111-1111-4111-8111-111111111111',
    req = (body) => ({
      nextUrl: { searchParams: new URLSearchParams('tenantId=forged') },
      json: async () => body,
    })
  assert.equal((await api.POST(req({ id, body: 'กฎใหม่' }))).status, 200)
  assert.equal(codec.readStoreRuleItems(raw).length, 2)
  assert.equal((await api.POST(req({ id, body: 'กฎใหม่' }))).status, 200)
  assert.equal(writes.length, 1)
  assert.equal(
    (await api.PATCH(req({ id, body: 'แก้แล้ว', previousBody: 'เก่าไม่ตรง' }))).status,
    409,
  )
  assert.equal(writes.length, 1)
  assert.equal((await api.PATCH(req({ id, body: 'แก้แล้ว', previousBody: 'กฎใหม่' }))).status, 200)
  assert.equal(
    (
      await api.PATCH(
        req({
          id,
          enabled: false,
          previousBody: 'แก้แล้ว',
          previousCategory: 'general',
          previousEnabled: true,
        }),
      )
    ).status,
    200,
  )
  assert.equal(settings.shopRulesPrompt(raw), 'กฎเดิม')
  assert.equal(codec.readStoreRuleItems(raw)[1].body, 'แก้แล้ว')
  assert.equal(
    (
      await api.PATCH(
        req({
          id,
          enabled: true,
          previousBody: 'แก้แล้ว',
          previousCategory: 'general',
          previousEnabled: true,
        }),
      )
    ).status,
    409,
  )
  assert.equal(
    (
      await api.PATCH(
        req({
          id,
          category: 'shipping',
          previousBody: 'แก้แล้ว',
          previousCategory: 'general',
          previousEnabled: false,
        }),
      )
    ).status,
    200,
  )
  assert.equal(codec.readStoreRuleItems(raw)[1].category, 'shipping')
  assert.equal(codec.readStoreRuleItems(raw)[1].enabled, false)
  assert.equal(
    (await api.PATCH(req({ id, enabled: 'false', previousBody: 'แก้แล้ว' }))).status,
    400,
  )
  assert.equal(
    (await api.PATCH(req({ id, category: 'invented', previousBody: 'แก้แล้ว' }))).status,
    400,
  )
  conflict = true
  assert.equal((await api.DELETE(req({ id, previousBody: 'แก้แล้ว' }))).status, 409)
  assert.equal(codec.readStoreRuleItems(raw).length, 2)
  conflict = false
  assert.equal((await api.DELETE(req({ id, previousBody: 'แก้แล้ว' }))).status, 200)
  assert.equal(settings.shopRulesPrompt(raw), 'กฎเดิม')
  assert.equal((await api.POST(req({ id, body: 'api_key=secret' }))).status, 400)
  allowed = false
  assert.equal((await api.POST(req({ id, body: 'forged' }))).status, 403)
})
test('disabled rows stay stored but never enter the prompt; old rows are enabled by default', () => {
  const raw = codec.serializeStoreRuleItems([
    { id: 'a', body: 'กฎเดิม' },
    { id: 'b', body: 'กฎปิด', enabled: false, category: 'shipping' },
    { id: 'c', body: 'กฎเปิด', enabled: true, category: 'general' },
  ])
  assert.equal(settings.shopRulesPrompt(raw), 'กฎเดิม\n\nกฎเปิด')
  assert.equal(codec.readStoreRuleItems(raw).length, 3)
  assert.throws(() =>
    codec.validateStoreRules(
      '{"snapbot_store_rules":1,"rules":[{"id":"x","body":"a","enabled":"false"}]}',
    ),
  )
  assert.throws(() =>
    codec.validateStoreRules(
      '{"snapbot_store_rules":1,"rules":[{"id":"x","body":"a","category":"invented"}]}',
    ),
  )
})
