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

const aiErrors = {}
vm.runInNewContext(transpile('lib/features/agents/ai-errors.ts'), { exports: aiErrors })
const agentCode = transpile('lib/features/agents/ai-agent.ts')
const chatbotCode = transpile('lib/features/agents/chatbot-server.ts')
const plans = {}
vm.runInNewContext(transpile('lib/features/billing/plans.ts'), { exports: plans })
const fallbacks = {}
vm.runInNewContext(transpile('lib/features/agents/fallback-messages.ts'), { exports: fallbacks })
const FAKE_KEY = 'mock-gemini-key-never-used-on-network'
const context = {
  shopName: 'ร้านทดสอบ',
  instructions: ' ส่งฟรีเมื่อซื้อครบ 500 บาท ',
  customerName: 'คุณทดสอบ',
  customerId: 'customer-1',
  tenantId: 'tenant-1',
}

class ApiError extends Error {
  constructor({ status, message }) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

// Only mock credentials, fake Supabase, and an SDK stub are available here.
// No .env reading, external requests, database writes, or live SDK imports occur.
function fixture({
  env = { GEMINI_API_KEY: FAKE_KEY },
  messages = [
    {
      customer_id: context.customerId,
      sender: 'customer',
      body: 'สินค้าราคาเท่าไร',
      created_at: 1,
    },
  ],
  products = [],
  response = { text: ' สวัสดีค่ะ ', candidates: [{ finishReason: 'STOP' }] },
  sdkError = null,
  dbError = null,
  settings = {},
  billing = { plan: 'pro', planExpiresAt: null },
} = {}) {
  const queries = []
  const requests = []
  const clients = []
  const logs = []
  const deliveries = []
  const updates = []
  const botSettings = {
    tenant_id: context.tenantId,
    reply_mode: 'ai',
    ai_instructions: context.instructions,
    fallback_text: 'ข้อความสำรอง',
    handover_text: 'แอดมินจะตอบกลับค่ะ',
    handover_keywords: [],
    ...settings,
  }

  class GoogleGenAI {
    constructor(options) {
      clients.push(options)
      this.models = {
        async generateContent(request) {
          requests.push(request)
          if (typeof sdkError === 'function') {
            const failure = sdkError(request)
            if (failure) throw failure
          } else if (sdkError) throw sdkError
          return response
        },
      }
    }
  }

  const db = {
    from(table) {
      const query = { table, filters: [] }
      queries.push(query)
      return {
        select(columns) {
          query.columns = columns
          return this
        },
        eq(column, value) {
          query.filters.push([column, value])
          return this
        },
        order(column, options) {
          query.order = { column, options }
          return this
        },
        async limit(count) {
          query.limit = count
          if (dbError) throw dbError
          const rows = table === 'messages' ? messages : products
          const filtered = rows.filter((row) =>
            query.filters.every(([column, value]) => row[column] === value),
          )
          if (table === 'messages') filtered.sort((a, b) => b.created_at - a.created_at)
          return { data: filtered.slice(0, count), error: null }
        },
        async maybeSingle() {
          assert.equal(table, 'bot_settings')
          return { data: botSettings, error: null }
        },
        update(values) {
          assert.equal(table, 'customers')
          return {
            async eq(column, value) {
              updates.push({ table, values, column, value })
              return { error: null }
            },
          }
        },
      }
    },
  }

  const log = (...args) => logs.push(args)
  const modules = {
    '@/lib/features/agents/ai-errors': aiErrors,
    '@/lib/feature-access': { hasFeature: async () => billing.plan === 'pro' },
    'server-only': {},
    '@google/genai': { GoogleGenAI, ApiError },
  }
  const agent = {}
  vm.runInNewContext(agentCode, {
    exports: agent,
    process: { env },
    setTimeout: (fn) => setImmediate(fn), // skip the retry back-off delay in tests
    console: { warn: log, error: log, log },
    require(name) {
      assert.ok(Object.hasOwn(modules, name), `Unexpected agent module: ${name}`)
      return modules[name]
    },
  })

  const chatbotModules = {
    'server-only': {},
    '@/lib/features/agents/ai-agent': agent,
    '@/lib/features/billing/billing': { getBilling: async () => billing },
    '@/lib/features/billing/plans': plans,
    '@/lib/features/agents/fallback-messages': fallbacks,
    '@/lib/features/agents/bot': { botReply: async () => 'legacy reply' },
    '@/lib/integrations/facebook/client': { quickReplies: () => ({}) },
    '@/lib/features/slips/notify': {
      deliverOnce: async (...args) => deliveries.push(args),
      deliverRichOnce: async () => {
        throw new Error('Unexpected keyword-rule delivery')
      },
    },
    '@/lib/features/agents/chatbot': {
      BOT_SETTINGS_COLUMNS:
        'tenant_id,reply_mode,ai_instructions,fallback_text,handover_keywords,handover_text',
      CHAT_RULE_COLUMNS: '',
      matchChatRule: () => null,
      ruleOrder: () => 0,
      wantsHuman: () => false,
    },
  }
  const actions = {}
  vm.runInNewContext(transpile('lib/features/agents/chatbot-actions.ts'), {
    exports: actions,
    console: { warn: log, error: log, log },
    require: (name) => chatbotModules[name],
  })
  chatbotModules['@/lib/features/agents/chatbot-actions'] = actions
  const chatbot = {}
  vm.runInNewContext(chatbotCode, {
    exports: chatbot,
    process: { env: {} }, // new opt-in orchestrator remains disabled in legacy compatibility cases
    console: { warn: log, error: log, log },
    require(name) {
      assert.ok(Object.hasOwn(chatbotModules, name), `Unexpected chatbot module: ${name}`)
      return chatbotModules[name]
    },
  })

  return { ...agent, ...chatbot, db, queries, requests, clients, logs, deliveries, updates }
}

const plain = (value) => JSON.parse(JSON.stringify(value))

test('missing or whitespace Gemini key does not activate AI or query services', async () => {
  for (const env of [
    {},
    { GEMINI_API_KEY: '  ' },
    { ANTHROPIC_API_KEY: 'old-key', ANTHROPIC_AUTH_TOKEN: 'old-token' },
  ]) {
    const api = fixture({ env })
    assert.equal(api.aiConfigured(), false)
    assert.equal(await api.aiReply(api.db, context), null)
    assert.equal(api.queries.length, 0)
    assert.equal(api.clients.length, 0)
    assert.equal(api.requests.length, 0)
  }
})

test('Gemini receives tenant catalog, shop facts, customer history and the fixed Flash model', async () => {
  const api = fixture({
    env: { GEMINI_API_KEY: ` ${FAKE_KEY} `, ANTHROPIC_MODEL: 'unused-model' },
    products: [
      {
        tenant_id: context.tenantId,
        is_active: true,
        code: 'A12',
        name: 'เสื้อ',
        price: '199',
        stock: 3,
        description: 'ผ้าฝ้าย',
      },
      {
        tenant_id: 'other-tenant',
        is_active: true,
        code: 'PRIVATE',
        name: 'OTHER SHOP SECRET',
        price: 1,
        stock: 1,
      },
      {
        tenant_id: context.tenantId,
        is_active: false,
        code: 'HIDDEN',
        name: 'DISABLED PRODUCT',
        price: 2,
        stock: 1,
      },
    ],
  })
  assert.equal(api.aiConfigured(), true)
  assert.equal(await api.aiReply(api.db, context), 'สวัสดีค่ะ')
  assert.equal(api.clients[0].apiKey, FAKE_KEY)
  assert.equal(api.clients[0].vertexai, false)
  assert.equal(api.clients[0].httpOptions.timeout, 25_000)
  assert.equal(api.clients[0].httpOptions.retryOptions.attempts, 1)
  const request = api.requests[0]
  assert.equal(request.model, 'gemini-3-flash-preview')
  assert.equal(request.config.maxOutputTokens, 2000)
  assert.equal(request.config.thinkingConfig.thinkingBudget, 0)
  assert.match(request.config.systemInstruction, /ร้านทดสอบ/)
  assert.match(request.config.systemInstruction, /คุณทดสอบ/)
  assert.match(request.config.systemInstruction, /ส่งฟรีเมื่อซื้อครบ 500 บาท/)
  assert.match(request.config.systemInstruction, /A12 \| เสื้อ \| 199 \| 3 \| ผ้าฝ้าย/)
  assert.doesNotMatch(request.config.systemInstruction, /OTHER SHOP SECRET|DISABLED PRODUCT/)
  assert.deepEqual(plain(request.contents), [
    { role: 'user', parts: [{ text: 'สินค้าราคาเท่าไร' }] },
  ])
  const productQuery = api.queries.find((query) => query.table === 'products')
  assert.deepEqual(productQuery.filters, [
    ['tenant_id', context.tenantId],
    ['is_active', true],
  ])
  const historyQuery = api.queries.find((query) => query.table === 'messages')
  assert.ok(
    historyQuery.filters.some(
      ([column, value]) => column === 'customer_id' && value === context.customerId,
    ),
  )
  assert.equal(historyQuery.order.column, 'created_at')
  assert.equal(historyQuery.order.options.ascending, false)
  assert.equal(historyQuery.limit, 12)
})

test('history uses chronological user/model turns and keeps attachment-only customer messages', async () => {
  const rows = [
    ['admin', 'leading reply', []],
    ['customer', ' สวัสดี ', []],
    ['customer', 'ขอรายละเอียด', []],
    ['bot', 'สินค้ามีพร้อมส่ง', []],
    ['admin', 'ราคา 199 บาท', []],
    ['customer', null, [{ type: 'image' }]],
    ['customer', ' ', []],
    ['admin', 'trailing reply', []],
  ].map(([sender, body, attachments], index) => ({
    customer_id: context.customerId,
    sender,
    body,
    attachments,
    created_at: index,
  }))
  const api = fixture({ messages: rows })
  await api.aiReply(api.db, context)
  const contents = plain(api.requests[0].contents)
  assert.equal(contents.length, 3)
  assert.deepEqual(contents[0], { role: 'user', parts: [{ text: 'สวัสดี\nขอรายละเอียด' }] })
  assert.deepEqual(contents[1], {
    role: 'model',
    parts: [{ text: 'สินค้ามีพร้อมส่ง\nราคา 199 บาท' }],
  })
  assert.equal(contents[2].role, 'user')
  assert.match(contents[2].parts[0].text, /^\[.+\]$/)
  assert.doesNotMatch(JSON.stringify(contents), /leading reply|trailing reply/)
})

test('Playground uses supplied conversation and tenant catalog without reading customer messages', async () => {
  const api = fixture({
    products: [
      {
        tenant_id: context.tenantId,
        is_active: true,
        code: 'TEST',
        name: 'Draft product',
        price: 100,
        stock: 2,
      },
    ],
  })
  const turns = [
    { role: 'user', text: 'hello' },
    { role: 'model', text: 'welcome' },
    { role: 'user', text: 'price?' },
  ]
  await api.aiReply(api.db, { ...context, instructions: 'unsaved instructions' }, turns)
  assert.equal(
    api.queries.some((q) => q.table === 'messages'),
    false,
  )
  assert.deepEqual(
    plain(api.requests[0].contents),
    turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
  )
  assert.ok(api.requests[0].config.systemInstruction.includes('unsaved instructions'))
  assert.ok(api.requests[0].config.systemInstruction.includes('Draft product'))
})

test('an empty or model-only history cannot produce a reply', async () => {
  for (const messages of [
    [],
    [{ customer_id: context.customerId, sender: 'admin', body: 'reply', created_at: 1 }],
  ]) {
    const api = fixture({ messages })
    assert.equal(await api.aiReply(api.db, context), null)
    assert.equal(api.requests.length, 0)
  }
})

test('output is trimmed, Messenger-length bounded, and hands off instead of sending marker text', async () => {
  const long = fixture({
    response: { text: ` ${'ก'.repeat(2300)} `, candidates: [{ finishReason: 'MAX_TOKENS' }] },
  })
  assert.equal((await long.aiReply(long.db, context)).length, 2000)
  const handover = fixture({
    response: { text: 'โปรดติดต่อแอดมิน [HANDOVER]', candidates: [{ finishReason: 'STOP' }] },
  })
  assert.equal(await handover.aiReply(handover.db, context), handover.HANDOVER_TOKEN)
  for (const text of [undefined, '', '   ']) {
    const api = fixture({ response: { text, candidates: [{ finishReason: 'STOP' }] } })
    assert.equal(await api.aiReply(api.db, context), null)
  }
})

test('Gemini prompt blocks or unsafe/failed candidate finishes fall back even with text', async () => {
  const responses = [
    { text: 'blocked text', promptFeedback: { blockReason: 'SAFETY' } },
    ...[
      'SAFETY',
      'RECITATION',
      'OTHER',
      'PROHIBITED_CONTENT',
      'SPII',
      'MALFORMED_FUNCTION_CALL',
    ].map((finishReason) => ({
      text: 'do not send this',
      candidates: [{ finishReason }],
    })),
  ]
  for (const response of responses) {
    const api = fixture({ response })
    assert.equal(await api.aiReply(api.db, context), null)
  }
})

test('authentication, quota, timeout, network and database failures return null without logging secrets', async () => {
  for (const sdkError of [
    new ApiError({ status: 401, message: `rejected key=${FAKE_KEY}` }),
    new ApiError({ status: 403, message: `forbidden key=${FAKE_KEY}` }),
    new ApiError({ status: 429, message: `quota key=${FAKE_KEY}` }),
    new ApiError({ status: 500, message: `remote payload key=${FAKE_KEY}` }),
    new Error(`timeout https://api.example?key=${FAKE_KEY}`),
    new Error(`network key=${FAKE_KEY}`),
  ]) {
    const api = fixture({ sdkError })
    assert.equal(await api.aiReply(api.db, context), null)
    assert.ok(api.logs.length > 0)
    assert.doesNotMatch(JSON.stringify(api.logs), new RegExp(FAKE_KEY))
  }
  const api = fixture({ dbError: new Error(`database payload key=${FAKE_KEY}`) })
  assert.equal(await api.aiReply(api.db, context), null)
  assert.equal(api.requests.length, 0)
  assert.doesNotMatch(JSON.stringify(api.logs), new RegExp(FAKE_KEY))
})

const incoming = {
  tenant: { id: context.tenantId, name: context.shopName },
  customer: { id: context.customerId, display_name: context.customerName },
  recipient: { id: context.customerId, psid: 'fake-psid', token: 'fake-page-token' },
  messageId: 'message-1',
  text: 'สินค้าราคาเท่าไร',
}

test('automatic chat delivers a Gemini answer once and retains the existing fallback on errors', async () => {
  const api = fixture()
  await api.answerChat(api.db, incoming)
  assert.equal(api.deliveries.length, 1)
  assert.equal(api.deliveries[0][2], 'reply:message-1')
  assert.equal(api.deliveries[0][3], 'สวัสดีค่ะ')
  assert.equal(api.updates.length, 0)

  const failed = fixture({ sdkError: new ApiError({ status: 429, message: 'mock quota' }) })
  await failed.answerChat(failed.db, incoming)
  assert.equal(failed.deliveries.length, 1)
  assert.equal(failed.deliveries[0][3], 'ข้อความสำรอง')
})

test('Failed AI chooses an array fallback and uses the default after all messages are deleted', async () => {
  const api = fixture({
    sdkError: new ApiError({ status: 429, message: 'quota' }),
    settings: { fallback_messages: ['first fallback', 'second fallback'] },
  })
  await api.answerChat(api.db, incoming)
  assert.ok(['first fallback', 'second fallback'].includes(api.deliveries[0][3]))
  const empty = fixture({
    sdkError: new ApiError({ status: 429, message: 'quota' }),
    settings: { fallback_messages: [] },
  })
  await empty.answerChat(empty.db, incoming)
  assert.equal(empty.deliveries[0][3], fallbacks.DEFAULT_FALLBACK_MESSAGE)
})

test('Free automation never calls Gemini, including admin-owned Free tenants', async () => {
  const blocked = fixture({ billing: { plan: 'free', planExpiresAt: null } })
  await blocked.answerChat(blocked.db, incoming)
  assert.equal(blocked.requests.length, 0)
  assert.equal(blocked.deliveries[0][3], 'ข้อความสำรอง')
  const admin = fixture({ billing: { plan: 'free', planExpiresAt: null, featureBypass: true } })
  await admin.answerChat(admin.db, incoming)
  assert.equal(admin.requests.length, 0)
  assert.equal(admin.deliveries[0][3], blocked.deliveries[0][3])
})

test('Gemini handover delegates atomic pause and acknowledgement to the delivery lease', async () => {
  const api = fixture({ response: { text: '[HANDOVER]', candidates: [{ finishReason: 'STOP' }] } })
  await api.answerChat(api.db, incoming)
  assert.equal(api.updates.length, 0)
  assert.ok(api.deliveries[0][2].startsWith('handover:'))
  assert.equal(api.deliveries[0][3], 'แอดมินจะตอบกลับค่ะ')
  assert.notEqual(api.deliveries[0][3], api.HANDOVER_TOKEN)
})

test('Playground reports missing key, rate limits, invalid key, retired model, timeout and safety separately', async () => {
  const cases = [
    [{ env: {} }, 'MISSING_API_KEY', 503],
    [{ sdkError: new ApiError({ status: 429, message: 'quota exceeded' }) }, 'RATE_LIMIT', 429],
    [
      { sdkError: new ApiError({ status: 403, message: 'permission denied' }) },
      'INVALID_API_KEY',
      503,
    ],
    [
      { sdkError: new ApiError({ status: 404, message: 'model unavailable' }) },
      'MODEL_NOT_FOUND',
      503,
    ],
    [{ sdkError: new Error('request timed out') }, 'TIMEOUT', 504],
    [{ response: { promptFeedback: { blockReason: 'SAFETY' } } }, 'SAFETY_BLOCK', 422],
    [{ response: { candidates: [{ finishReason: 'SAFETY' }] } }, 'GENERATION_BLOCKED', 422],
    [{ response: { text: '' } }, 'EMPTY_RESPONSE', 503],
  ]
  for (const [options, code, status] of cases) {
    const api = fixture(options)
    await assert.rejects(
      api.aiReply(api.db, context, [{ role: 'user', text: 'test' }], true),
      (error) => error.code === code && error.status === status,
    )
  }
})

test('Configured custom model is used without incompatible thinking options', async () => {
  const api = fixture({ env: { GEMINI_API_KEY: FAKE_KEY, GEMINI_MODEL: 'custom-model' } })
  await api.aiReply(api.db, context)
  assert.equal(api.requests[0].model, 'custom-model')
  assert.equal(Object.hasOwn(api.requests[0].config, 'thinkingConfig'), false)
})

test('GEMINI_MODEL handles unset, empty, whitespace, quotes and models/ prefix', async () => {
  for (const [value, expected] of [
    [undefined, 'gemini-3-flash-preview'],
    ['', 'gemini-3-flash-preview'],
    ['   ', 'gemini-3-flash-preview'],
    [' models/custom-model-a ', 'custom-model-a'],
    ['"custom-model-b"', 'custom-model-b'],
  ]) {
    const api = fixture({ env: { GEMINI_API_KEY: FAKE_KEY, GEMINI_MODEL: value } })
    await api.aiReply(api.db, context)
    assert.equal(api.requests[0].model, expected)
  }
})

test('Unknown configured model retries default once; rate limit never switches model', async () => {
  const api = fixture({
    env: { GEMINI_API_KEY: FAKE_KEY, GEMINI_MODEL: 'retired-model' },
    sdkError: (request) =>
      request.model === 'retired-model'
        ? new ApiError({ status: 404, message: 'not found' })
        : null,
  })
  assert.equal(
    await api.aiReply(api.db, context, [{ role: 'user', text: 'hello' }], true),
    'สวัสดีค่ะ',
  )
  assert.deepEqual(
    api.requests.map((r) => r.model),
    ['retired-model', 'gemini-3-flash-preview'],
  )
  const failed = fixture({
    env: { GEMINI_API_KEY: FAKE_KEY, GEMINI_MODEL: 'retired-model' },
    sdkError: new ApiError({ status: 404, message: 'not found' }),
  })
  await assert.rejects(
    failed.aiReply(failed.db, context, [{ role: 'user', text: 'hello' }], true),
    (error) => error.code === 'MODEL_NOT_FOUND',
  )
  assert.equal(failed.requests.length, 2)
  const limited = fixture({
    env: { GEMINI_API_KEY: FAKE_KEY, GEMINI_MODEL: 'custom-model' },
    sdkError: new ApiError({ status: 429, message: 'quota' }),
  })
  await assert.rejects(
    limited.aiReply(limited.db, context, [{ role: 'user', text: 'hello' }], true),
    (error) => error.code === 'RATE_LIMIT',
  )
  assert.equal(limited.requests.length, 1)
})

test('Overloaded Gemini (503) retries once on the default model, then reports MODEL_OVERLOADED', async () => {
  const recovered = fixture({
    env: { GEMINI_API_KEY: FAKE_KEY, GEMINI_MODEL: 'custom-model' },
    sdkError: (request) =>
      request.model === 'custom-model'
        ? new ApiError({ status: 503, message: 'overloaded' })
        : null,
  })
  assert.equal(
    await recovered.aiReply(recovered.db, context, [{ role: 'user', text: 'hello' }], true),
    'สวัสดีค่ะ',
  )
  assert.deepEqual(
    recovered.requests.map((r) => r.model),
    ['custom-model', 'gemini-3-flash-preview'],
  )
  const failed = fixture({ sdkError: new ApiError({ status: 503, message: 'overloaded' }) })
  await assert.rejects(
    failed.aiReply(failed.db, context, [{ role: 'user', text: 'hello' }], true),
    (error) => error.code === 'MODEL_OVERLOADED' && error.status === 503,
  )
  assert.equal(failed.requests.length, 2)
})
