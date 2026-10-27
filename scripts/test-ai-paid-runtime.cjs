const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm'),
  ts = require('typescript')
function load(file, deps = {}, env = {}) {
  const exports = {}
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      console: { warn() {}, error() {} },
      Date,
      Map,
      Set,
      crypto: require('node:crypto').webcrypto,
      process: { env },
      require: (name) => {
        if (name in deps) return deps[name]
        throw Error('Unexpected dependency ' + name)
      },
    },
  )
  return exports
}
function textFixture({ paid = true, quota = 2, fail = false } = {}) {
  let calls = 0,
    reserves = 0,
    completed = 0
  const db = {
    rpc: async (name) => {
      reserves++
      if (quota <= 0) return { data: { reason: 'AI_QUOTA_EXHAUSTED' } }
      quota--
      return { data: { id: 'receipt' } }
    },
    from() {
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
    },
  }
  class ApiError extends Error {}
  class GoogleGenAI {
    constructor() {
      this.models = {
        generateContent: async () => {
          calls++
          if (fail) throw new ApiError('provider unavailable')
          return { text: 'Provider response' }
        },
      }
    }
  }
  const managed = {
    prepareAgentGeneration: async (db, context) => {
      if (context.simulation)
        return { simulation: true, systemInstruction: 'Only approved store facts' }
      const reserved = await db.rpc('start_agent_ai_call')
      return reserved.data.id
        ? { usageId: reserved.data.id, systemInstruction: 'Only approved store facts' }
        : null
    },
    sanitizeAgentHistory: (text) => text,
    finishAgentGeneration: async (_db, control) => {
      if (!control.simulation) completed++
      return 'คำตอบจากข้อมูลร้าน'
    },
    failAgentGeneration: async () => {},
  }
  const api = load(
    'lib/features/agents/ai-agent.ts',
    {
      'server-only': {},
      '@/lib/features/agents/ai-errors': load('lib/features/agents/ai-errors.ts'),
      '@/lib/feature-access': { hasFeature: async () => paid },
      '@google/genai': { GoogleGenAI, ApiError },
      '@/lib/features/agents/agent-control-ai': managed,
    },
    {
      GEMINI_API_KEY: 'fixture-key-only',
      AGENT_CONTROL_ENABLED: 'false',
      AGENT_CONTROL_SEND_ENABLED: 'false',
    },
  )
  return {
    run: (managedFlag = false, bypassFlag = true, simulation = false) =>
      api.aiReply(
        db,
        {
          tenantId: 'own',
          simulation,
          shopName: 'Shop',
          customerId: '',
          customerName: null,
          instructions: null,
        },
        [{ role: 'user', text: 'สอบถามข้อมูล' }],
        true,
        managedFlag,
        bypassFlag,
      ),
    metrics: () => ({ calls, reserves, completed, remaining: quota }),
  }
}
test('free stores cannot reach the provider or consume AI quota', async () => {
  const f = textFixture({ paid: false })
  await assert.rejects(f.run(), (e) => e.code === 'FEATURE_LOCKED')
  assert.deepEqual(f.metrics(), { calls: 0, reserves: 0, completed: 0, remaining: 2 })
})
test('paid trials and drafts always reserve quota despite legacy environment and bypass parameters', async () => {
  const f = textFixture()
  assert.equal(await f.run(false, true), 'คำตอบจากข้อมูลร้าน')
  assert.equal(await f.run(false, false), 'คำตอบจากข้อมูลร้าน')
  assert.deepEqual(f.metrics(), { calls: 2, reserves: 2, completed: 2, remaining: 0 })
  await assert.rejects(f.run(), (e) => e.code === 'AI_QUOTA_EXHAUSTED')
  assert.equal(f.metrics().calls, 2)
})
test('an uncertain provider failure is charged once and never automatically retried', async () => {
  const f = textFixture({ fail: true })
  await assert.rejects(f.run())
  assert.deepEqual(f.metrics(), { calls: 1, reserves: 1, completed: 0, remaining: 1 })
})
test('simulator bypasses paid-package and quota checks without any database RPC', async () => {
  const f = textFixture({ paid: false, quota: 1 })
  assert.equal(await f.run(false, true, true), 'คำตอบจากข้อมูลร้าน')
  assert.equal(f.metrics().calls, 1)
  assert.equal(f.metrics().reserves, 0)
  assert.equal(f.metrics().remaining, 1)
  assert.equal(await f.run(false, true, true), 'คำตอบจากข้อมูลร้าน')
  assert.equal(f.metrics().calls, 2)
  assert.equal(f.metrics().reserves, 0)
})
test('follow-up analysis reserves paid quota before the provider and skips exhausted or repeated messages', async () => {
  for (const allowed of [false, true]) {
    let calls = 0,
      reservations = 0,
      saves = 0
    const db = {
      rpc: async (name, args) => {
        assert.equal(name, 'start_agent_ai_call')
        assert.equal(args.p_tenant, 'own')
        assert.equal(args.p_key, 'source-message')
        reservations++
        return { data: allowed ? { id: 'usage' } : { reason: 'AI_QUOTA_EXHAUSTED' } }
      },
      from(table) {
        let update = false,
          single = false
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
          maybeSingle() {
            single = true
            return q
          },
          update() {
            update = true
            saves++
            return q
          },
          then(resolve) {
            return Promise.resolve({
              data: update
                ? { id: 'usage' }
                : table === 'products' || !single
                  ? []
                  : { id: 'source-message', body: 'สอบถามสินค้า' },
              error: null,
            }).then(resolve)
          },
        }
        return q
      },
    }
    class GoogleGenAI {
      constructor() {
        this.models = {
          generateContent: async () => {
            calls++
            return {
              text: '{"intent":"none","productId":null,"draft":null}',
              usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 },
            }
          },
        }
      }
    }
    const api = load(
      'lib/features/follow-ups/followup-ai.ts',
      {
        'server-only': {},
        '@google/genai': { GoogleGenAI },
        '@/lib/features/agents/ai-agent': { aiModel: () => 'fixture-model' },
        '@/lib/feature-access': { hasFeature: async () => true },
      },
      { GEMINI_API_KEY: 'fixture-key-only' },
    )
    await api.analyzeFollowUp(db, 'own', 'customer', 'source-message')
    assert.equal(reservations, 1)
    assert.equal(calls, allowed ? 1 : 0)
    assert.equal(saves, allowed ? 1 : 0)
  }
})
test('control center no longer needs a deployment flag, but retains its emergency stop', async () => {
  const core = {
    AGENT_FLAGS: {
      agent_control_center_enabled: false,
      agent_orchestrator_enabled: false,
      agent_playground_enabled: false,
    },
  }
  const api = load(
    'lib/features/agents/agent-control-flags.ts',
    { 'server-only': {}, '@/lib/features/agents/agent-control-core': core },
    { AGENT_CONTROL_ENABLED: 'false' },
  )
  assert.equal(api.agentControlAvailable(), true)
  const result = await api.agentControlConfig(
    {
      from() {
        return {
          select() {
            return this
          },
          eq() {
            return this
          },
          maybeSingle: async () => ({
            data: {
              flags: { agent_orchestrator_enabled: true },
              ai_monthly_limit: 20,
              requests_per_minute: 10,
            },
            error: null,
          }),
        }
      },
    },
    'own',
  )
  assert.equal(result.flags.agent_control_center_enabled, true)
  assert.equal(result.monthlyLimit, 20)
  const stopped = load(
    'lib/features/agents/agent-control-flags.ts',
    { 'server-only': {}, '@/lib/features/agents/agent-control-core': core },
    { AGENT_CONTROL_KILL_SWITCH: 'true' },
  )
  assert.equal(stopped.agentControlAvailable(), false)
})
