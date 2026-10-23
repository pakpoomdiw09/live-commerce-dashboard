const { test } = require('node:test')
const assert = require('node:assert/strict')
const load = require('./helpers/load-typescript.cjs')
const next = {
  NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) },
}

test('Inbox metadata queries are bounded and read markers are restricted to requested tenant customers', async () => {
  const id = '11111111-1111-4111-8111-111111111111',
    queries = []
  const db = {
    from(table) {
      const r = { table, filters: [], limits: [] }
      queries.push(r)
      const q = {
        select() {
          return q
        },
        eq(k, v) {
          r.filters.push([k, v])
          return q
        },
        in(k, v) {
          r.filters.push([k, Array.from(v)])
          return q
        },
        limit(v) {
          r.limits.push(v)
          return q
        },
        order() {
          return q
        },
        range() {
          return q
        },
        returns() {
          return q
        },
        single() {
          return q
        },
        then(resolve) {
          return Promise.resolve({
            data:
              table === 'customers'
                ? [{ id, inbound_seq: 3 }]
                : table === 'tenants'
                  ? { name: 'Shop' }
                  : [],
            error: null,
          }).then(resolve)
        },
      }
      return q
    },
  }
  const api = load(
    'app/api/inbox/state/route.ts',
    {
      'next/server': next,
      '@/lib/utils': { UUID: /^[a-f0-9-]{36}$/ },
      '@/lib/feature-access': { hasFeature: async () => true },
      '@/lib/features/inbox/inbox-server': {
        inboxTenant: async () => ({ db, tenantId: 'tenant', actor: { id: 'admin' } }),
        inboxError: (e) => {
          throw e
        },
      },
    },
    { Map, Date, process: { env: {} } },
  )
  const request = (value) =>
    api.GET({
      nextUrl: { searchParams: new URLSearchParams({ tenantId: 'tenant', customerIds: value }) },
    })
  assert.equal((await request(id)).status, 200)
  const customers = queries.find((row) => row.table === 'customers'),
    reads = queries.find((row) => row.table === 'conversation_reads')
  assert.ok(customers.filters.some(([k, v]) => k === 'tenant_id' && v === 'tenant'))
  assert.deepEqual(customers.filters.find(([k]) => k === 'id')[1], [id])
  assert.deepEqual(customers.limits, [500])
  assert.deepEqual(reads.filters.find(([k]) => k === 'customer_id')[1], [id])
  assert.deepEqual(reads.limits, [500])
  const before = queries.length
  assert.equal((await request('invalid')).status, 400)
  assert.equal(queries.length, before)
})

test('keyword and AI routing never reads manual UI template storage', async () => {
  const tables = [],
    sent = []
  let aiCalls = 0
  const rule = { id: 'keyword-rule', reply_text: 'Keyword answer' }
  const api = load(
    'lib/features/agents/chatbot-server.ts',
    {
      'server-only': {},
      '@/lib/features/agents/agent-control-core': { inputRisk: () => null },
      '@/lib/features/inbox/inbox-automation-window': { assertAutomationWindow: async () => {} },
      '@/lib/features/agents/agent-orchestrator': { orchestrateAgentMessage: async () => false },
      '@/lib/features/agents/ai-agent': {
        aiReply: async () => {
          aiCalls++
          return 'AI answer'
        },
        HANDOVER_TOKEN: '[HANDOVER]',
      },
      '@/lib/features/agents/fallback-messages': { randomFallback: () => 'Fallback' },
      '@/lib/features/slips/notify': {
        deliverOnce: async (_db, _recipient, _key, text) => sent.push(text),
      },
      '@/lib/feature-access': { hasFeature: async () => true },
      '@/lib/features/agents/chatbot-actions': {
        loadBotSettings: async () => ({ reply_mode: 'ai', handover_keywords: [] }),
        sendRule: async (_db, _recipient, _key, selected) => sent.push(selected.reply_text),
        handover: async () => {
          throw Error('Unexpected handover')
        },
      },
      '@/lib/features/agents/chatbot': {
        CHAT_RULE_COLUMNS: 'id,reply_text',
        matchChatRule: (rules, text) => (text === 'price' ? rules[0] : null),
        ruleOrder: () => 0,
        chatReplyStrategy: (matched, allowed) => (matched ? 'keyword' : allowed ? 'ai' : 'none'),
        wantsHuman: () => false,
      },
    },
    { console },
  )
  const db = {
    from(table) {
      tables.push(table)
      assert.equal(table, 'chat_rules')
      const q = {
        select() {
          return q
        },
        eq() {
          return q
        },
        order() {
          return q
        },
        limit() {
          return q
        },
        then(resolve) {
          return Promise.resolve({ data: [rule], error: null }).then(resolve)
        },
      }
      return q
    },
    rpc: async () => ({ error: null }),
  }
  const incoming = {
    tenant: { id: 'tenant', name: 'Shop' },
    customer: { id: 'customer', display_name: 'Customer' },
    recipient: {},
    messageId: 'message',
    text: 'price',
  }
  await api.answerChat(db, incoming)
  assert.equal(aiCalls, 1)
  await api.answerChat(db, { ...incoming, messageId: 'another', text: 'other question' })
  assert.deepEqual(sent, ['AI answer', 'AI answer'])
  assert.equal(aiCalls, 2)
  assert.deepEqual(tables, [])
})

test('Inbox state does not read bot rules or expose keyword reply content', async () => {
  const tables = []
  const rows = {
    customers: [{ id: 'customer', inbound_seq: 2 }],
    conversation_reads: [],
    tenant_members: [],
    tenants: { name: 'Shop', auto_reply_enabled: true },
  }
  const db = {
    from(table) {
      tables.push(table)
      assert.ok(Object.hasOwn(rows, table), `Inbox state must not read ${table}`)
      const q = {
        select() {
          return q
        },
        eq() {
          return q
        },
        order() {
          return q
        },
        range() {
          return q
        },
        limit() {
          return q
        },
        in() {
          return q
        },
        returns() {
          return q
        },
        single() {
          return q
        },
        then(resolve) {
          return Promise.resolve({ data: rows[table], error: null }).then(resolve)
        },
      }
      return q
    },
  }
  const api = load(
    'app/api/inbox/state/route.ts',
    {
      'next/server': next,
      '@/lib/utils': { UUID: /^[a-f0-9-]{36}$/ },
      '@/lib/features/inbox/inbox-server': {
        inboxTenant: async () => ({ db, tenantId: 'tenant', actor: { id: 'admin' } }),
        inboxError: (e) => {
          throw e
        },
      },
      '@/lib/feature-access': { hasFeature: async () => true },
    },
    { Map, Date, process: { env: {} } },
  )
  const result = await api.GET({
    nextUrl: { searchParams: new URLSearchParams({ tenantId: 'tenant' }) },
  })
  assert.equal(result.status, 200)
  assert.equal(result.body.conversations[0].unread_count, 2)
  assert.equal(Object.hasOwn(result.body, 'quickReplies'), false)
  assert.equal(tables.includes('chat_rules'), false)
  assert.equal(tables.includes('inbox_quick_replies'), false)
})

test('Saved Replies reads only manual reply storage and returns literal numeric text unchanged', async () => {
  const tables = []
  const db = {
    from(table) {
      tables.push(table)
      assert.equal(table, 'inbox_quick_replies')
      const q = {
        select() {
          return q
        },
        eq(key, value) {
          assert.equal(key, 'tenant_id')
          assert.equal(value, 'tenant')
          return q
        },
        order() {
          return q
        },
        limit() {
          return q
        },
        then(resolve) {
          return Promise.resolve({
            data: [{ id: 'saved', body: '200', shortcut: 'price' }],
            error: null,
          }).then(resolve)
        },
      }
      return q
    },
  }
  const api = load('app/api/inbox/quick-replies/route.ts', {
    'next/server': next,
    '@/lib/utils': {},
    '@/lib/features/inbox/inbox-server': {
      inboxTenant: async () => ({ db, tenantId: 'tenant' }),
      inboxError: (e) => {
        throw e
      },
    },
  })
  const result = await api.GET({
    nextUrl: { searchParams: new URLSearchParams({ tenantId: 'tenant' }) },
  })
  assert.equal(result.body.replies.length, 1)
  assert.equal(result.body.replies[0].body, '200')
  assert.deepEqual(tables, ['inbox_quick_replies'])
})
