const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm'),
  ts = require('typescript')
function load(file, deps = {}, env = {}) {
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
      Date,
      Map,
      Set,
      crypto: require('node:crypto').webcrypto,
      process: { env },
      require: (name) => {
        if (name in deps) return deps[name]
        if (name === '@/lib/full-access') return { temporaryFullAccess: false }
        throw Error('Unexpected dependency ' + name)
      },
    },
  )
  return exports
}
const core = load('lib/features/agents/agent-overview-core.ts'),
  now = new Date('2026-10-17T05:00:00Z')
test('all six capabilities require AI entitlement and quota, plus feature-specific slip/follow-up access', () => {
  const access = { ai: true, slips: true, followup: true }
  for (const value of Object.values(core.agentCapabilityEntitlements(access, 0, 10)))
    assert.equal(value.code, 'AI_QUOTA_EXHAUSTED')
  for (const value of Object.values(
    core.agentCapabilityEntitlements({ ...access, ai: false }, 10, 10),
  ))
    assert.equal(value.code, 'FEATURE_LOCKED')
  const extra = core.agentCapabilityEntitlements(
    { ai: true, slips: false, followup: false },
    10,
    10,
  )
  assert.equal(extra.slips.code, 'FEATURE_LOCKED')
  assert.equal(extra.followup.code, 'FEATURE_LOCKED')
  assert.equal(extra.answers.allowed, true)
  const credits = core.agentCapabilityEntitlements(access, 10, 0)
  assert.equal(credits.slips.code, 'SLIP_QUOTA_EXHAUSTED')
  assert.equal(credits.products.allowed, true)
  for (const value of Object.values(core.agentCapabilityEntitlements(access, 10, 10)))
    assert.equal(value.allowed, true)
})
const job = (
  id,
  customer_id,
  route,
  status,
  created_at = '2026-10-17T01:00:00Z',
  updated_at = '2026-10-17T01:00:04Z',
) => ({ id, customer_id, route, status, created_at, updated_at })
test('overview uses Bangkok dates, distinct lifetime AI customers, exact chart range and honest completion metrics', () => {
  const jobs = [
    job('1', 'a', 'AI', 'sent'),
    job('2', 'a', 'AI', 'sent'),
    job('3', 'b', 'AI', 'failed'),
    job('4', 'c', 'ADMIN', 'review'),
    job('5', 'd', 'KEYWORD', 'sent'),
    job('6', 'e', 'AI', 'draft'),
    job('7', 'old', 'AI', 'sent', '2026-09-01T00:00:00Z', '2026-09-01T00:00:01Z'),
    job('8', 'night', 'AI', 'sent', '2026-10-16T18:00:00Z', '2026-10-16T18:00:02Z'),
    job('9', 'future', 'AI', 'sent', '2027-01-01T00:00:00Z'),
  ]
  const result = core.summarizeAgentJobs(jobs, 7, now)
  assert.equal(result.repliesToday, 3)
  assert.equal(result.customersTotal, 3)
  assert.equal(result.handoffs, 1)
  assert.equal(result.averageSeconds, 10 / 3)
  assert.equal(result.successRate, 75)
  assert.equal(result.points.length, 7)
  assert.equal(result.points.at(-1).day, '2026-10-17')
  assert.equal(result.points.at(-1).messages, 3)
  assert.equal(result.points.at(-1).customers, 2)
  const empty = core.summarizeAgentJobs([], 30, now)
  assert.equal(empty.successRate, null)
  assert.equal(empty.averageSeconds, null)
  assert.equal(empty.points.length, 30)
})
test('overview reader uses one bounded aggregate RPC and never exposes names without entitlement', async () => {
  class InboxError extends Error {}
  const scopes = [],
    ranges = [],
    rpcCalls = []
  const entries = Array.from({ length: 1001 }, (_, i) =>
    job(
      String(i),
      'customer',
      'AI',
      'sent',
      new Date(Date.now() - 10000).toISOString(),
      new Date().toISOString(),
    ),
  )
  const db = {
    rpc: async (name, args) => {
      rpcCalls.push({ name, args })
      return {
        data:
          name === 'agent_overview_stats'
            ? {
                ...core.summarizeAgentJobs(entries, args.p_days, new Date(args.p_now)),
                recent: entries.slice(0, 10),
              }
            : args.p_feature === 'ai_agent',
        error: null,
      }
    },
    from(table) {
      let start = 0,
        end = 999
      const record = { table, filters: [] }
      scopes.push(record)
      const q = {
        select() {
          return q
        },
        eq(k, v) {
          record.filters.push([k, v])
          return q
        },
        lte() {
          return q
        },
        order() {
          return q
        },
        in() {
          return q
        },
        range(a, b) {
          start = a
          end = b
          ranges.push([a, b])
          return q
        },
        maybeSingle() {
          return q
        },
        then(resolve) {
          let data =
            table === 'tenants'
              ? {
                  name: 'Shop',
                  auto_reply_enabled: true,
                  auto_verify_enabled: false,
                  page_id: 'page',
                  page_token_set: true,
                  plan: 'pro',
                }
              : table === 'agent_control_settings'
                ? { flags: { agent_orchestrator_enabled: true }, ai_monthly_limit: 20 }
                : table === 'agent_ai_monthly_usage'
                  ? { used: 3 }
                  : table === 'follow_up_policies'
                    ? { enabled: true }
                    : entries.slice(start, end + 1)
          return Promise.resolve({ data, error: null }).then(resolve)
        },
      }
      return q
    },
  }
  const api = load(
    'lib/features/agents/agent-overview-server.ts',
    {
      'server-only': {},
      '@/lib/features/agents/agent-overview-core': core,
      '@/lib/features/agents/agent-control-flags': { agentControlAvailable: () => true },
      '@/lib/feature-access': { hasFeature: async () => false },
      '@/lib/automation-safety': { automationStopped: async () => false },
      '@/lib/features/agents/ai-agent': { aiConfigured: () => true },
      '@/lib/features/billing/plans': { PLANS: { pro: { name: 'Pro' } } },
      '@/lib/features/inbox/inbox-server': { InboxError },
    },
    { NODE_ENV: 'production', AGENT_CONTROL_ENABLED: 'true', AGENT_CONTROL_SEND_ENABLED: 'true' },
  )
  const result = await api.loadAgentOverview(db, 'own-tenant', 7, true)
  assert.equal(result.repliesToday, 1001)
  assert.equal(result.customersTotal, 1)
  assert.equal(result.quota.remaining, 17)
  assert.equal(result.ready, true)
  assert.equal(result.recent.length, 10)
  assert.ok(result.recent.every((row) => row.customer === null))
  assert.equal(result.available.slips, false)
  assert.deepEqual(ranges, [])
  assert.equal(rpcCalls.filter((call) => call.name === 'agent_overview_stats').length, 1)
  for (const call of rpcCalls) assert.equal(call.args.p_tenant, 'own-tenant')
  assert.ok(!scopes.some((record) => record.table === 'agent_message_jobs'))
  for (const record of scopes)
    assert.ok(
      record.filters.some(
        ([key, value]) =>
          key === (record.table === 'tenants' ? 'id' : 'tenant_id') && value === 'own-tenant',
      ),
    )
  assert.ok(!scopes.some((record) => record.table === 'customers'))
})
test('overview controls reject cross-origin requests, require owner and write only validated capabilities', async () => {
  class InboxError extends Error {
    constructor(message, status = 400) {
      super(message)
      this.status = status
    }
  }
  let guards = 0,
    writes = 0,
    owner = false,
    rpcError = null
  const response = { json: (value, options) => ({ value, status: options?.status ?? 200 }) }
  const api = load('app/api/agent-control/overview/route.ts', {
    'next/server': { NextResponse: response },
    '@/lib/features/agents/agent-control-server': {
      agentControlTenant: async (_req, _id, needOwner) => {
        guards++
        if (needOwner && !owner) throw new InboxError('owner', 403)
        return {
          db: {
            rpc: async (name, args) => {
              writes++
              assert.equal(name, 'set_agent_overview_capability')
              assert.equal(args.p_tenant, 'own')
              return { error: rpcError }
            },
          },
          tenantId: 'own',
          actor: { id: 'actor' },
        }
      },
    },
    '@/lib/auth': {},
    '@/lib/features/agents/agent-overview-server': {},
    '@/lib/features/agents/agent-overview-core': core,
    '@/lib/features/inbox/inbox-server': {
      InboxError,
      inboxError: (e) => ({ status: e.status ?? 500 }),
      checkRpc: (e) => {
        if (e) throw e
      },
    },
    '@/lib/features/banking/banks': {},
  })
  const req = (origin, input) => ({
    headers: { get: () => origin },
    nextUrl: new URL('http://localhost:3000/api/agent-control/overview?tenantId=own'),
    json: async () => input,
  })
  assert.equal(
    (await api.PATCH(req('https://evil.test', { capability: 'master', enabled: true }))).status,
    403,
  )
  assert.equal(guards, 0)
  assert.equal(
    (await api.PATCH(req('http://localhost:3000', { capability: 'master', enabled: true }))).status,
    403,
  )
  owner = true
  assert.equal(
    (await api.PATCH(req('http://localhost:3000', { capability: 'arbitrary', enabled: true })))
      .status,
    400,
  )
  assert.equal(writes, 0)
  assert.equal(
    (await api.PATCH(req('http://localhost:3000', { capability: 'master', enabled: true }))).status,
    200,
  )
  assert.equal(writes, 1)
  for (const [sqlCode, code, status] of [
    ['P0403', 'FEATURE_LOCKED', 403],
    ['P0402', 'AI_QUOTA_EXHAUSTED', 409],
    ['P0404', 'SLIP_QUOTA_EXHAUSTED', 409],
  ]) {
    rpcError = { code: sqlCode }
    const result = await api.PATCH(
      req('http://localhost:3000', { capability: 'products', enabled: true }),
    )
    assert.equal(result.status, status)
    assert.equal(result.value.code, code)
    assert.equal(result.value.upgradeUrl, '/billing')
  }
})
test('capability switches affect real routing while keywords retain priority and mandatory handoff stays active', async () => {
  for (const scenario of [
    { capabilities: { answers: false }, keyword: false, ai: 0, sent: 0 },
    { capabilities: { intent: false }, keyword: false, ai: 0, sent: 0 },
    { capabilities: { answers: false, intent: false }, keyword: true, ai: 0, sent: 1 },
    { capabilities: { handoff: false }, keyword: false, risk: true, ai: 0, sent: 0 },
  ]) {
    let ai = 0,
      sent = 0,
      handoff = 0
    const writes = []
    const db = {
      rpc: async (name) => ({
        data:
          name === 'claim_agent_message'
            ? [{ id: 'job', claim_token: 'claim' }]
            : name === 'begin_agent_dispatch'
              ? true
              : 'lease',
      }),
      from() {
        const q = {
          order() {
            return q
          },
          limit() {
            return q
          },
          select() {
            return q
          },
          eq() {
            return q
          },
          update(value) {
            writes.push(value)
            return q
          },
          maybeSingle: async () => ({ data: { id: 'job' } }),
          then(resolve) {
            return Promise.resolve({ data: [] }).then(resolve)
          },
        }
        return q
      },
    }
    const api = load(
      'lib/features/agents/agent-orchestrator.ts',
      {
        'server-only': {},
        '@/lib/features/agents/agent-control-flags': {
          agentControlConfig: async () => ({
            flags: { agent_orchestrator_enabled: true },
            monthlyLimit: 10,
            capabilities: scenario.capabilities,
          }),
          agentControlAvailable: () => true,
        },
        '@/lib/features/agents/agent-control-core': {
          inputRisk: () => (scenario.risk ? 'PROTECTED_ACTION' : null),
        },
        '@/lib/features/agents/chatbot-actions': {
          loadBotSettings: async () => ({
            handover_keywords: [],
            reply_mode: scenario.keyword ? 'keyword' : 'ai',
          }),
          sendRule: async () => {
            sent++
            return true
          },
          handover: async () => {
            handoff++
          },
        },
        '@/lib/features/agents/chatbot': {
          matchChatRule: () => (scenario.keyword ? { id: 'rule' } : null),
          ruleOrder: () => 0,
          chatReplyStrategy: (keyword, allowed) => (keyword ? 'keyword' : allowed ? 'ai' : 'none'),
          wantsHuman: () => false,
        },
        '@/lib/features/agents/ai-agent': {
          aiReply: async () => {
            ai++
            return 'reply'
          },
          HANDOVER_TOKEN: '[HANDOVER]',
        },
        '@/lib/feature-access': { hasFeature: async () => true },
        '@/lib/features/agents/fallback-messages': { randomFallback: () => null },
        '@/lib/features/slips/notify': {
          deliverOnce: async () => {
            sent++
            return true
          },
        },
      },
      { NODE_ENV: 'production', AGENT_CONTROL_SEND_ENABLED: 'true' },
    )
    assert.equal(
      await api.orchestrateAgentMessage(db, {
        tenant: { id: 'tenant' },
        customer: { id: 'customer' },
        messageId: 'msg',
        recipient: {},
        text: 'text',
      }),
      true,
    )
    assert.equal(ai, scenario.ai)
    assert.equal(sent, scenario.sent)
    assert.equal(handoff, scenario.keyword ? 0 : 1)
    if (!scenario.keyword && !scenario.risk)
      assert.ok(writes.some((row) => row.route === 'ADMIN' && row.reason === 'AI_NOT_AVAILABLE'))
  }
})
test('disabling product search removes the catalog from actual managed AI generation', async () => {
  class AiAgentError extends Error {}
  let reservations = 0
  const policy = load('lib/features/agents/agent-control-core.ts', {
    '@/lib/domain-state': load('lib/domain-state.ts'),
  })
  const api = load('lib/features/agents/agent-control-ai.ts', {
    'server-only': {},
    '@/lib/features/agents/ai-agent': { AiAgentError },
    '@/lib/features/agents/ai-errors': { AiAgentError },
    '@/lib/features/store-rules/store-rule-items': load(
      'lib/features/store-rules/store-rule-items.ts',
    ),
    '@/lib/features/agents/agent-control-flags': {
      agentControlConfig: async () => ({
        flags: { agent_orchestrator_enabled: true, agent_knowledge_base_enabled: false },
        capabilities: { products: false },
      }),
    },
    '@/lib/features/store-rules/shop-persona-settings': load(
      'lib/features/store-rules/shop-persona-settings.ts',
      {
        '@/lib/features/store-rules/store-rule-items': load(
          'lib/features/store-rules/store-rule-items.ts',
        ),
      },
    ),
    '@/lib/features/agents/agent-control-core': policy,
  })
  const db = {
    from(table) {
      assert.ok(['bot_settings', 'inbox_quick_replies', 'agent_knowledge_sources'].includes(table))
      return {
        select() {
          return this
        },
        eq() {
          return this
        },
        order() {
          return this
        },
        limit: async () => ({ data: [], error: null }),
        maybeSingle: async () => ({ data: { ai_instructions: 'Store instructions' }, error: null }),
      }
    },
    rpc: async () => {
      reservations++
      return { data: { id: 'usage' } }
    },
  }
  const result = await api.prepareAgentGeneration(
    db,
    { tenantId: 'own', customerId: '', instructions: 'Store instructions' },
    'สินค้ามีอะไรบ้าง',
  )
  assert.equal(reservations, 1)
  assert.equal(result.products.length, 0)
  assert.match(result.systemInstruction, /Catalog: \[\]/)
})
test('sandbox uses current store settings, keyword-first routing and managed usage without a real customer or sender', async () => {
  class InboxError extends Error {}
  class AiAgentError extends Error {}
  let matched = true,
    calls = 0
  const db = {
    from(table) {
      const q = {
        select() {
          return q
        },
        eq() {
          return q
        },
        maybeSingle() {
          return q
        },
        then(resolve) {
          return Promise.resolve({
            data: table === 'tenants' ? { name: 'Own shop' } : [],
            error: null,
          }).then(resolve)
        },
      }
      return q
    },
  }
  const api = load('app/api/agent-control/overview/test/route.ts', {
    'next/server': { NextResponse: { json: (value) => value } },
    '@/lib/features/agents/agent-control-server': {
      agentControlTenant: async () => ({
        db,
        tenantId: 'own',
        config: { flags: { agent_playground_enabled: true }, capabilities: {} },
      }),
    },
    '@/lib/features/inbox/inbox-server': {
      InboxError,
      inboxError: (e) => {
        throw e
      },
    },
    '@/lib/features/agents/chatbot-server': {
      loadBotSettings: async () => ({
        ai_instructions: 'Current saved instructions',
        handover_keywords: [],
      }),
    },
    '@/lib/features/agents/chatbot': {
      matchChatRule: () => (matched ? { reply_text: 'Saved rule' } : null),
      ruleOrder: () => 0,
      wantsHuman: () => false,
    },
    '@/lib/features/agents/agent-control-core': { inputRisk: () => null },
    '@/lib/features/agents/ai-agent': {
      AiAgentError,
      HANDOVER_TOKEN: '[HANDOVER]',
      aiReply: async (_db, ctx, _messages, report, managed) => {
        calls++
        assert.equal(ctx.customerId, '')
        assert.equal(ctx.tenantId, 'own')
        assert.equal(ctx.instructions, 'Current saved instructions')
        assert.equal(report, true)
        assert.equal(managed, true)
        return 'Trial reply'
      },
    },
  })
  const req = {
    headers: { get: () => 'http://localhost:3000' },
    nextUrl: new URL('http://localhost:3000/api?tenantId=own'),
    json: async () => ({ messages: [{ role: 'user', text: 'ราคา' }] }),
  }
  assert.equal((await api.POST(req)).text, 'Saved rule')
  assert.equal(calls, 0)
  matched = false
  assert.equal((await api.POST(req)).text, 'Trial reply')
  assert.equal(calls, 1)
})
