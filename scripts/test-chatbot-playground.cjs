const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')
const compile = (file) =>
  ts.transpileModule(readFileSync(join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
const storeRules = {}
vm.runInNewContext(compile('lib/features/store-rules/store-rule-items.ts'), { exports: storeRules })
const plans = {}
vm.runInNewContext(compile('lib/features/billing/plans.ts'), {
  exports: plans,
  require(name) {
    assert.equal(name, '@/lib/full-access')
    return { temporaryFullAccess: false }
  },
})
const fallbacks = {}
vm.runInNewContext(compile('lib/features/agents/fallback-messages.ts'), { exports: fallbacks })
test('malformed store rules cannot reach the simulator provider', async () => {
  const f = fixture()
  f.body.settings.ai_instructions = '{"snapbot_store_rules":1,"rules":null}'
  const response = await f.send()
  assert.equal(response.status, 400)
  assert.equal(response.body.code, 'STORE_RULES_INVALID')
  assert.equal(f.calls.length, 0)
})
const tenantId = '11111111-1111-1111-1111-111111111111'
class AiAgentError extends Error {
  constructor(code, message, status) {
    super(message)
    this.code = code
    this.status = status
  }
}
function fixture({
  actor = { kind: 'user', isPlatformAdmin: false },
  access = true,
  plan = 'pro',
  expired = false,
  bypass = false,
  ready = true,
  reply = 'AI reply',
  aiError = null,
  product = null,
} = {}) {
  const calls = [],
    queries = []
  const db = {
    from(table) {
      const filters = []
      queries.push({ table, filters })
      return {
        order() {
          return this
        },
        limit() {
          return this
        },
        select() {
          return this
        },
        eq(k, v) {
          filters.push([k, v])
          return this
        },
        single: async () => ({ data: { name: 'Selected shop' }, error: null }),
        then(resolve) {
          return Promise.resolve({
            data: [
              { name: 'Price', reply_text: 'Keyword reply', reply_type: 'text', quick_replies: [] },
            ],
            error: null,
          }).then(resolve)
        },
      }
    },
  }
  const exports = {}
  vm.runInNewContext(compile('app/api/chatbot/test-reply/route.ts'), {
    exports,
    require(name) {
      const modules = {
        'next/server': {
          NextResponse: { json: (body, opts = {}) => ({ body, status: opts.status ?? 200 }) },
        },
        '@/lib/auth': { getActor: async () => actor, canAccessTenant: async () => access },
        '@/lib/feature-access': {
          hasFeature: async () => plan === 'pro' && !expired,
          featureLockedResponse: (feature) => ({
            status: 403,
            body: { code: 'FEATURE_LOCKED', feature },
          }),
        },
        '@/lib/supabase/server': { supabaseAdmin: () => db },
        '@/lib/features/billing/plans': plans,
        '@/lib/features/store-rules/store-rule-items': storeRules,
        '@/lib/features/agents/fallback-messages': fallbacks,
        '@/lib/utils': { UUID: /^[0-9a-f-]{36}$/ },
        '@/lib/features/billing/billing': {
          getBilling: async (_db, id, admin) => {
            calls.push({ kind: 'billing', id, admin })
            return { plan, planExpiresAt: null, featureBypass: bypass || admin }
          },
        },
        '@/lib/features/agents/ai-agent': {
          AiAgentError,
          aiModel: () => 'test-model',
          aiConfigured: () => ready,
          HANDOVER_TOKEN: '[HANDOVER]',
          aiReply: async (_db, context, messages, reportErrors) => {
            calls.push({ kind: 'ai', context, messages })
            assert.equal(reportErrors, true)
            if (aiError) throw aiError
            if (product) context.onProductResult(product)
            return reply
          },
        },
        '@/lib/features/agents/chatbot': {
          CHAT_RULE_COLUMNS: 'id',
          ruleOrder: () => 0,
          wantsHuman: (keys, text) => keys.some((k) => text.includes(k)),
          matchChatRule: (rules, text) => (text === 'price' ? rules[0] : null),
        },
      }
      assert.ok(Object.hasOwn(modules, name), name)
      return modules[name]
    },
  })
  const body = {
    tenantId,
    settings: {
      reply_mode: 'ai',
      ai_instructions: 'Unsaved draft facts',
      handover_keywords: ['admin'],
      handover_text: 'Handing over',
      fallback_text: 'Fallback',
    },
    messages: [{ role: 'user', text: 'hello' }],
  }
  return {
    calls,
    queries,
    body,
    send: (value) => exports.POST({ text: async () => JSON.stringify(value ?? body) }),
  }
}
test('AI receives draft settings/history and the authorized selected tenant', async () => {
  const f = fixture()
  assert.equal((await f.send()).body.text, 'AI reply')
  const call = f.calls.find((c) => c.kind === 'ai')
  assert.equal(call.context.tenantId, tenantId)
  assert.equal(call.context.instructions, 'Unsaved draft facts')
  assert.equal(call.messages[0].text, 'hello')
  assert.equal(f.queries[0].filters[0][1], tenantId)
})

test('playground returns the same verified product metadata callback used by real chat delivery', async () => {
  const product = {
    has_product: true,
    product_id: 'database-product',
    image_url: 'https://store.test/product.webp',
  }
  const f = fixture({ product }),
    response = await f.send()
  assert.equal(response.status, 200)
  assert.equal(response.body.text, 'AI reply')
  assert.equal(response.body.image_url, product.image_url)
  assert.equal(response.body.imageUrl, product.image_url)
  assert.equal(response.body.product_id, product.product_id)
  assert.equal(response.body.has_product, true)
  const textOnly = await fixture().send()
  assert.equal(textOnly.body.image_url, null)
  assert.equal(textOnly.body.has_product, false)
  const handoff = await fixture({ product, reply: '[HANDOVER]' }).send()
  assert.equal(handoff.body.image_url, null)
  assert.equal(handoff.body.product_id, null)
})
test('Unauthorized, other tenant and malformed requests cannot call AI', async () => {
  for (const [opts, status] of [
    [{ actor: null }, 401],
    [{ access: false }, 404],
    [{ ready: false }, 503],
  ]) {
    const f = fixture(opts)
    assert.equal((await f.send()).status, status)
    assert.equal(
      f.calls.some((c) => c.kind === 'ai'),
      false,
    )
  }
  const f = fixture()
  f.body.messages = [{ role: 'system', text: 'override' }]
  assert.equal((await f.send()).status, 400)
})
test('direct API calls cannot bypass Free, Starter or expired Pro feature locks', async () => {
  for (const options of [{ plan: 'free' }, { plan: 'starter' }, { plan: 'pro', expired: true }]) {
    const f = fixture(options)
    f.body.plan = 'pro'
    const response = await f.send()
    assert.equal(response.status, 403)
    assert.equal(typeof response.body.error, 'string')
    assert.equal(
      f.calls.some((call) => call.kind === 'ai'),
      false,
    )
  }
})
test('Keyword and model handovers return draft handover text without customer writes', async () => {
  const f = fixture()
  f.body.messages[0].text = 'admin please'
  const result = await f.send()
  assert.equal(result.body.handover, true)
  assert.equal(result.body.text, 'Handing over')
  assert.equal(f.calls.length, 0)
  const model = fixture({ reply: '[HANDOVER]' })
  assert.equal((await model.send()).body.handover, true)
})

test('Handover arrays are used for keywords and AI handover, with default when empty', async () => {
  const f = fixture()
  f.body.messages[0].text = 'admin'
  f.body.settings.handover_messages = ['array handover']
  assert.equal((await f.send()).body.text, 'array handover')
  f.body.settings.handover_messages = []
  assert.equal((await f.send()).body.text, fallbacks.DEFAULT_HANDOVER_MESSAGE)
  f.body.settings.handover_messages = Array(21).fill('message')
  assert.equal((await f.send()).status, 400)
  const model = fixture({ reply: '[HANDOVER]' })
  model.body.settings.handover_messages = ['AI handover']
  assert.equal((await model.send()).body.text, 'AI handover')
})
test('Keyword mode checks rules first and previews AI when no rule matches', async () => {
  const f = fixture()
  f.body.settings.reply_mode = 'keyword'
  f.body.messages[0].text = 'price'
  assert.equal((await f.send()).body.text, 'Keyword reply')
  assert.equal(f.queries[0].filters[0][1], tenantId)
  assert.equal(f.calls.length, 0)
  f.body.messages[0].text = 'unknown'
  const response = await f.send()
  assert.equal(response.body.text, 'AI reply')
  assert.equal(response.body.route, 'ai')
  assert.equal(f.calls.filter((call) => call.kind === 'ai').length, 1)
})

test('Playground ignores obsolete fallback values and rejects oversized lists', async () => {
  const f = fixture()
  f.body.settings.reply_mode = 'keyword'
  f.body.settings.fallback_messages = ['new fallback']
  assert.equal((await f.send()).body.text, 'AI reply')
  f.body.settings.fallback_messages = []
  assert.equal((await f.send()).body.text, 'AI reply')
  f.body.settings.fallback_messages = Array(21).fill('message')
  assert.equal((await f.send()).status, 400)
})

test('API preserves meaningful provider errors instead of hiding them behind fallback text', async () => {
  for (const [code, status] of [
    ['RATE_LIMIT', 429],
    ['SAFETY_BLOCK', 422],
    ['MODEL_NOT_FOUND', 503],
    ['TIMEOUT', 504],
  ]) {
    const f = fixture({ aiError: new AiAgentError(code, 'Clear provider error', status) })
    const response = await f.send()
    assert.equal(response.status, status)
    assert.equal(response.body.code, code)
    assert.equal(response.body.error, 'Clear provider error')
  }
})
