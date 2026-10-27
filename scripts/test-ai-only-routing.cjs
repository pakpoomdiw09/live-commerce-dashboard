const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  load = require('./helpers/load-typescript.cjs')
const incoming = {
  tenant: { id: 'tenant', name: 'Shop' },
  customer: { id: 'customer', display_name: null },
  recipient: {},
  messageId: 'message',
  text: 'price',
}
function fixture({
  orchestrated = false,
  answer = 'Grounded answer',
  failure = false,
  entitled = true,
  human = false,
  quota = 10,
  keyword = false,
  unmatched = false,
  image = false,
  tenantQuota = 1000,
  dispatchQuota = true,
  duplicateQuota = false,
} = {}) {
  let calls = 0,
    handoffs = 0
  const sent = [],
    writes = [],
    quotaCalls = []
  const config = {
    flags: { agent_orchestrator_enabled: true },
    capabilities: {},
    monthlyLimit: quota,
  }
  const deps = {
    'server-only': {},
    '@/lib/features/agents/tenant-ai-quota': load(
      'lib/features/agents/tenant-ai-quota.ts',
      { 'server-only': {} },
      { console },
    ),
    '@/lib/features/agents/agent-control-flags': {
      agentControlConfig: async () => config,
      agentControlAvailable: () => true,
    },
    '@/lib/features/inbox/inbox-automation-window': { assertAutomationWindow: async () => {} },
    '@/lib/features/agents/agent-control-core': { inputRisk: () => null },
    '@/lib/features/agents/ai-agent': {
      HANDOVER_TOKEN: '[HANDOVER]',
      aiReply: async (_db, ctx) => {
        assert.equal(ctx.aiQuotaReservation, 'reservation')
        calls++
        if (failure) throw Error('Provider unavailable')
        if (image)
          ctx.onProductResult({
            has_product: true,
            product_id: 'product',
            image_url: 'https://store.test/photo',
          })
        return answer
      },
    },
    '@/lib/feature-access': { hasFeature: async () => entitled },
    '@/lib/features/agents/chatbot': {
      defaultBotSettings: () => ({ handover_keywords: [] }),
      wantsHuman: () => human,
      CHAT_RULE_COLUMNS: 'id,reply_text',
      ruleOrder: () => 0,
      matchChatRule: () => (keyword ? { id: 'rule', reply_text: 'Keyword answer' } : null),
    },
    '@/lib/features/agents/chatbot-actions': {
      loadBotSettings: async () => ({
        reply_mode: keyword || unmatched ? 'keyword' : 'ai',
        handover_keywords: [],
        fallback_text: 'MUST NOT SEND',
      }),
      handover: async () => {
        handoffs++
      },
      sendRule: async () => {
        sent.push('Keyword answer')
        return true
      },
    },
    '@/lib/features/slips/notify': {
      deliverOnce: async (_db, _to, _key, text) => {
        sent.push(text)
        return true
      },
    },
    '@/lib/features/agents/product-reply': {
      deliverProductReply: async (_db, _to, _key, text, url) => {
        sent.push({ text, url })
        return true
      },
    },
  }
  const db = {
    rpc: async (name) => {
      quotaCalls.push(name)
      if (name === 'reserve_tenant_ai_reply')
        return {
          data: duplicateQuota
            ? { status: 'duplicate' }
            : tenantQuota > 0
              ? { status: 'reserved', id: 'reservation' }
              : { status: 'quota_exceeded' },
        }
      if (name === 'authorize_tenant_ai_reply')
        return { data: dispatchQuota ? 'authorized' : 'quota_exceeded' }
      if (name === 'settle_tenant_ai_reply') return { data: 'released' }
      if (name === 'handover_tenant_ai_quota') {
        handoffs++
        return { data: true }
      }
      return {
        data: name === 'claim_agent_message' ? [{ id: 'job', claim_token: 'claim' }] : true,
        error: null,
      }
    },
    from(table) {
      if (table === 'chat_rules') {
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
            return Promise.resolve({ data: [], error: null }).then(resolve)
          },
        }
        return q
      }
      assert.equal(table, 'agent_message_jobs')
      const q = {
        update(v) {
          writes.push(v)
          return q
        },
        eq() {
          return q
        },
        select() {
          return q
        },
        maybeSingle: async () => ({ data: { id: 'job' }, error: null }),
      }
      return q
    },
  }
  const worker = load('lib/features/agents/agent-orchestrator.ts', deps, { console, Date })
  deps['@/lib/features/agents/agent-orchestrator'] = {
    orchestrateAgentMessage: orchestrated ? worker.orchestrateAgentMessage : async () => false,
  }
  const api = load('lib/features/agents/chatbot-server.ts', deps, { console })
  return {
    run: () => api.answerChat(db, incoming),
    sent,
    writes,
    quotaCalls,
    calls: () => calls,
    handoffs: () => handoffs,
  }
}
for (const orchestrated of [false, true]) {
  test(`tenant quota exhaustion stops ${orchestrated ? 'orchestrated' : 'legacy'} AI before generation and hands off`, async () => {
    const f = fixture({ orchestrated, tenantQuota: 0 })
    await f.run()
    assert.equal(f.calls(), 0)
    assert.equal(f.sent.length, 0)
    assert.equal(f.handoffs(), 1)
    if (orchestrated)
      assert.ok(f.writes.some((row) => row.reason === 'quota_exceeded' && row.route === 'ADMIN'))
  })
  test(`tenant quota is rechecked before ${orchestrated ? 'orchestrated' : 'legacy'} delivery and the reservation settles`, async () => {
    const f = fixture({ orchestrated, dispatchQuota: false })
    await f.run()
    assert.equal(f.calls(), 1)
    assert.equal(f.sent.length, 0)
    assert.equal(f.handoffs(), 1)
    assert.equal(f.quotaCalls.filter((name) => name === 'settle_tenant_ai_reply').length, 1)
  })
  test(`duplicate quota reservation cannot regenerate ${orchestrated ? 'orchestrated' : 'legacy'} reply`, async () => {
    const f = fixture({ orchestrated, duplicateQuota: true })
    await f.run()
    assert.equal(f.calls(), 0)
    assert.equal(f.sent.length, 0)
    assert.equal(f.handoffs(), 0)
  })
  test(`product images reach ${orchestrated ? 'orchestrated' : 'legacy'} delivery`, async () => {
    const f = fixture({ orchestrated, image: true })
    await f.run()
    assert.deepEqual(f.sent, [{ text: 'Grounded answer', url: 'https://store.test/photo' }])
  })
  test(`Unmatched ${orchestrated ? 'orchestrated' : 'legacy'} messages use AI knowledge`, async () => {
    const k = fixture({ orchestrated, keyword: true })
    await k.run()
    assert.deepEqual(k.sent, ['Keyword answer'])
    assert.equal(k.calls(), 0)
    assert.equal(k.quotaCalls.includes('reserve_tenant_ai_reply'), false)
    const f = fixture({ orchestrated })
    await f.run()
    assert.deepEqual(f.sent, ['Grounded answer'])
    assert.equal(f.calls(), 1)
    assert.equal(f.handoffs(), 0)
  })
  test(`AI-only ${orchestrated ? 'orchestrated' : 'legacy'} errors, empty and handoff results transfer to staff`, async () => {
    for (const options of [
      { failure: true },
      { answer: null },
      { answer: '[HANDOVER]' },
      { entitled: false },
      { human: true },
    ]) {
      const f = fixture({ orchestrated, ...options })
      await f.run()
      assert.equal(f.handoffs(), 1)
      assert.equal(f.sent.length, 0)
      assert.ok(!f.writes.some((row) => row.route === 'FALLBACK' || row.route === 'KEYWORD'))
    }
  })
}
test('orchestrator uses tenant quota even when the old monthly generation ceiling is zero', async () => {
  const f = fixture({ orchestrated: true, quota: 0, tenantQuota: 1000 })
  await f.run()
  assert.equal(f.calls(), 1)
  assert.equal(f.handoffs(), 0)
})

test('keyword mode without a matching rule never calls AI or sends a fallback', async () => {
  for (const orchestrated of [false, true]) {
    const f = fixture({ orchestrated, unmatched: true })
    await f.run()
    assert.equal(f.calls(), 0)
    assert.equal(f.sent.length, 0)
    assert.equal(f.handoffs(), 0)
  }
})
