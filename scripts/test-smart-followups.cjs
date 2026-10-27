const assert = require('node:assert/strict'),
  { test } = require('node:test'),
  fs = require('node:fs'),
  vm = require('node:vm'),
  ts = require('typescript')
function load(file, deps = {}, globals = {}) {
  const context = {
    exports: {},
    console,
    Date,
    Intl,
    Set,
    Map,
    process: { env: {} },
    require: (n) => {
      if (n in deps) return deps[n]
      throw Error('Unexpected dependency ' + n)
    },
    ...globals,
  }
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    context,
  )
  return context.exports
}
const next = { NextResponse: { json: (body, opts = {}) => ({ body, status: opts.status ?? 200 }) } }
const types = load('lib/features/follow-ups/smart-followup-types.ts'),
  validation = load('lib/features/follow-ups/smart-followup-validation.ts')
const tenant = '11111111-1111-4111-8111-111111111111',
  id = '22222222-2222-4222-8222-222222222222'
class InboxError extends Error {
  constructor(message, status = 400, code = 'INBOX_ERROR') {
    super(message)
    this.status = status
    this.code = code
  }
}
const errors = {
  InboxError,
  inboxError: (e) =>
    next.NextResponse.json({ error: e.message, code: e.code }, { status: e.status ?? 503 }),
  checkRpc: (error) => {
    if (error)
      throw new InboxError(
        'conflict',
        error.code === '42501' ? 403 : 409,
        error.code === '42501' ? 'FEATURE_LOCKED' : 'CONFLICT',
      )
  },
}
const utils = { UUID: /^[a-f0-9-]{36}$/, customerName: () => 'Customer' }
function validSettings() {
  return {
    policy: { ...types.DEFAULT_POLICY, tenant_id: tenant },
    workflows: ['payment', 'interested', 'after_sales'].map((kind) => ({
      kind,
      version: 0,
      enabled: false,
      use_ai: false,
      stop_on_reply: true,
      steps: types.DEFAULT_STEPS[kind],
    })),
  }
}
test('new payment template uses 30/180 minutes and preserves inserted names literally', () => {
  assert.deepEqual(
    Array.from(types.DEFAULT_STEPS.payment, (s) => s.delay_minutes),
    [30, 180],
  )
  assert.equal(
    types.renderSmartFollowUp('{name} {product}', {
      name: 'Customer {product}',
      product: 'Actual',
      total: 100,
    }),
    'Customer {product} Actual',
  )
})
test('workflow validation preserves three steps and rejects unordered delays, malformed timezone, booleans and limits', () => {
  const data = validSettings()
  assert.equal(validation.parseFollowUpSettings(data).workflows.length, 3)
  for (const change of [
    (s) => (s.policy.timezone = 'Invalid/Timezone'),
    (s) => (s.policy.max_per_customer = 0),
    (s) => (s.policy.quiet_enabled = 'true'),
    (s) =>
      (s.workflows[0].steps = [
        { delay_minutes: 30, text: 'a' },
        { delay_minutes: 10, text: 'b' },
      ]),
    (s) => (s.workflows[0].steps = [{ delay_minutes: 1, text: '' }]),
    (s) => (s.workflows[0].enabled = 'true'),
    (s) => (s.workflows[0].steps = Array(4).fill({ delay_minutes: 1, text: 'a' })),
  ]) {
    const copy = structuredClone(data)
    change(copy)
    assert.throws(() => validation.parseFollowUpSettings(copy))
  }
})
class SendApiError extends Error {
  constructor(status, window = false) {
    super('provider rejected')
    this.status = status
    this.code = window ? 10 : 100
  }
}
function workerFixture({
  enabled = true,
  error = null,
  persistenceError = false,
  persistenceFailures = 0,
  completionCommitted = false,
  prepared = 'ready',
  prepareError = false,
  finalStatus = 'ready',
  finalError = false,
  outsideWindow = false,
  finalWindowExpiresAt = new Date(Date.now() + 60_000).toISOString(),
  disableAfterPrepare = false,
  disableAfterAuthorize = false,
} = {}) {
  const pending = [{ id, tenant_id: tenant, claim_token: 'lease' }],
    calls = [],
    settled = [],
    sends = [],
    writes = [],
    env = { SMART_FOLLOW_UP_SEND_ENABLED: enabled ? 'true' : 'false' },
    logs = []
  let network = 0
  const db = {
    rpc: async (name, args) => {
      calls.push([name, args])
      if (name === 'claim_follow_up_jobs') return { data: pending.splice(0, 1), error: null }
      if (name === 'expire_follow_up_if_outside_window') return { data: outsideWindow, error: null }
      if (name === 'prepare_follow_up') {
        if (prepareError) return { error: { code: '42703' }, data: null }
        if (disableAfterPrepare) env.SMART_FOLLOW_UP_SEND_ENABLED = 'false'
        return {
          data: { status: prepared, psid: 'psid', text: 'real configured text' },
          error: null,
        }
      }
      if (name === 'authorize_follow_up_dispatch') {
        if (disableAfterAuthorize) env.SMART_FOLLOW_UP_SEND_ENABLED = 'false'
        return finalError
          ? { error: { code: 'DB_DOWN' } }
          : { data: { status: finalStatus, windowExpiresAt: finalWindowExpiresAt }, error: null }
      }
      if (name === 'complete_follow_up') {
        settled.push(args)
        return persistenceError || persistenceFailures-- > 0
          ? { error: { code: 'DB_DOWN' } }
          : { data: true, error: null }
      }
      throw Error(name)
    },
    from: (table) => ({
      select() {
        return this
      },
      eq() {
        return this
      },
      is() {
        return this
      },
      update(value) {
        writes.push({ table, value })
        return this
      },
      insert(value) {
        writes.push({ table, value })
        return Promise.resolve({ error: null })
      },
      then(resolve, reject) {
        return Promise.resolve({ error: null }).then(resolve, reject)
      },
      maybeSingle: async () => ({
        data:
          table === 'follow_up_jobs'
            ? completionCommitted
              ? { status: 'sent', provider_message_id: 'mid-confirmed', reason: null }
              : null
            : { page_id: 'page', page_access_token: 'private' },
        error: null,
      }),
    }),
  }
  const api = load(
    'lib/features/follow-ups/follow-ups.ts',
    {
      'server-only': {},
      '@supabase/supabase-js': {},
      '@/lib/integrations/facebook/client': {
        pageTokenFor: (p) => p.page_access_token,
        SendApiError,
        isWindowOrTagError: (e) => e.code === 10,
        sendMessageWithReceipt: async (...args) => {
          network++
          sends.push(args)
          if (error) throw error
          return 'mid-confirmed'
        },
      },
    },
    {
      process: { env },
      console: {
        info: (...args) => logs.push(args),
        warn: (...args) => logs.push(args),
        error: (...args) => logs.push(args),
      },
    },
  )
  return { api, db, calls, settled, logs, sends, writes, network: () => network }
}
test('follow-up is live by default even with the obsolete paused flag', async () => {
  const f = workerFixture({ enabled: false })
  const result = await f.api.runFollowUps(f.db, tenant)
  assert.equal(result.sendEnabled, true)
  assert.equal(f.network(), 1)
})
test('worker logs every send stage without token, message text or PSID and clears remaining when drained', async () => {
  const f = workerFixture()
  const result = await f.api.runFollowUps(f.db, tenant)
  for (const label of [
    '[FOLLOW-UP WORKER] started',
    '[FOLLOW-UP CLAIM] claimed',
    '[FOLLOW-UP PREPARE] result',
    '[FOLLOW-UP SEND] request',
    '[FOLLOW-UP SEND] accepted',
    '[FOLLOW-UP SEND] persisted',
    '[FOLLOW-UP WORKER] complete',
  ])
    assert.ok(
      f.logs.some((row) => row[0] === label),
      label,
    )
  const log = JSON.stringify(f.logs)
  for (const value of ['private', 'real configured text', 'psid'])
    assert.equal(log.includes(value), false)
  assert.equal(result.remaining, false)
})

test('payment workflow shares the master switch without changing other opt-ins or mutating input', () => {
  const input = validSettings()
  input.policy.enabled = true
  const result = validation.parseFollowUpSettings(input)
  assert.equal(result.workflows[0].enabled, true)
  assert.equal(input.workflows[0].enabled, false)
  assert.equal(result.workflows[1].enabled, false)
  input.policy.enabled = false
  input.workflows[0].enabled = true
  assert.equal(validation.parseFollowUpSettings(input).workflows[0].enabled, false)
})
test('last-moment payment/slip cancellation or a failed final check never calls Facebook', async () => {
  for (const finalStatus of ['cancelled', 'requires_review', 'skipped']) {
    const f = workerFixture({ finalStatus })
    await f.api.runFollowUps(f.db, tenant)
    assert.equal(f.network(), 0)
    assert.equal(f.settled.length, 0)
  }
  const f = workerFixture({ finalError: true })
  await f.api.runFollowUps(f.db, tenant)
  assert.equal(f.network(), 0)
  assert.equal(f.settled[0].p_result, 'failed')
  assert.equal(f.settled[0].p_reason, 'precheck_failed')
})
test('obsolete send flag does not pause the live worker', async () => {
  for (const options of [{ disableAfterPrepare: true }, { disableAfterAuthorize: true }]) {
    const f = workerFixture(options)
    await f.api.runFollowUps(f.db, tenant)
    assert.equal(f.network(), 1)
    assert.equal(f.settled[0].p_result, 'sent')
  }
})
test('two workers cannot send the same atomic claim twice', async () => {
  const f = workerFixture()
  await Promise.all([f.api.runFollowUps(f.db, tenant), f.api.runFollowUps(f.db, tenant)])
  assert.equal(f.network(), 1)
  assert.equal(f.settled.length, 1)
  assert.equal(f.settled[0].p_result, 'sent')
  assert.equal(f.settled[0].p_provider, 'mid-confirmed')
})
test('network uncertainty goes to review; explicit refusal is failed; neither is retried', async () => {
  for (const [error, status] of [
    [Error('timeout'), 'requires_review'],
    [new SendApiError(400), 'failed'],
    [new SendApiError(403, true), 'cancelled'],
  ]) {
    const f = workerFixture({ error })
    await f.api.runFollowUps(f.db, tenant)
    await f.api.runFollowUps(f.db, tenant)
    assert.equal(f.network(), 1)
    assert.equal(f.settled[0].p_result, status)
  }
})
test('provider success with DB failure stays reviewable instead of re-sending', async () => {
  const f = workerFixture({ persistenceError: true })
  const first = await f.api.runFollowUps(f.db, tenant)
  await f.api.runFollowUps(f.db, tenant)
  assert.equal(first.review, 1)
  assert.equal(f.network(), 1)
})

test('verified follow-up uses the tenant token and RESPONSE body before atomically persisting sent', async () => {
  const f = workerFixture()
  const result = await f.api.runFollowUps(f.db, tenant)
  assert.equal(f.sends[0][0], 'private')
  assert.equal(f.sends[0][1], 'psid')
  assert.equal(f.sends[0][2].text, 'real configured text')
  assert.equal(f.sends[0][3], 'RESPONSE')
  assert.equal(result.sent, 1)
  assert.equal(result.jobs[0].status, 'sent')
})

test('expired due jobs are cancelled before token lookup, preparation or Facebook', async () => {
  const f = workerFixture({ outsideWindow: true })
  const result = await f.api.runFollowUps(f.db, tenant)
  assert.equal(f.network(), 0)
  assert.equal(
    f.calls.some(([name]) => name === 'prepare_follow_up'),
    false,
  )
  assert.equal(f.settled.length, 0)
  assert.equal(result.cancelled, 1)
  assert.equal(result.jobs[0].reason, 'outside_24h_window')
})

test('a window expiring after database authorization is cancelled without a network send', async () => {
  for (const finalWindowExpiresAt of [new Date(Date.now() - 1).toISOString(), null, 'invalid']) {
    const f = workerFixture({ finalWindowExpiresAt })
    const result = await f.api.runFollowUps(f.db, tenant)
    assert.equal(f.network(), 0)
    assert.equal(result.cancelled, 1)
    assert.equal(f.settled[0].p_result, 'cancelled')
    assert.equal(f.settled[0].p_reason, 'outside_24h_window')
  }
})

test('UTC and Bangkok offset expiries compare as the same instant', async () => {
  const utc = new Date(Date.now() + 60_000).toISOString()
  const bangkok = new Date(Date.parse(utc) + 7 * 60 * 60 * 1000)
    .toISOString()
    .replace('Z', '+07:00')
  assert.equal(Date.parse(utc), Date.parse(bangkok))
  for (const finalWindowExpiresAt of [utc, bangkok]) {
    const f = workerFixture({ finalWindowExpiresAt })
    assert.equal((await f.api.runFollowUps(f.db, tenant)).sent, 1)
    assert.equal(f.network(), 1)
  }
})

test('result persistence retries and lost completion responses never resend the provider request', async () => {
  for (const options of [
    { persistenceFailures: 1 },
    { persistenceError: true, completionCommitted: true },
  ]) {
    const f = workerFixture(options)
    const result = await f.api.runFollowUps(f.db, tenant)
    assert.equal(f.network(), 1)
    assert.equal(f.settled.length, 2)
    assert.equal(result.sent, 1)
    assert.equal(result.errors, 0)
  }
})

test('provider rejection stores safe structured HTTP/code diagnostics in the execution log', async () => {
  const error = new SendApiError(400)
  error.code = 2022
  error.subcode = 1404132
  error.providerMessage = '(#2022) Your Page is temporarily restricted'
  const f = workerFixture({ error })
  const result = await f.api.runFollowUps(f.db, tenant)
  const audit = f.writes.find((write) => write.table === 'follow_up_execution_logs')
  assert.equal(result.failed, 1)
  assert.equal(f.settled[0].p_reason, 'page_restricted')
  assert.equal(JSON.parse(audit.value.reason).httpStatus, 400)
  assert.equal(JSON.parse(audit.value.reason).facebookCode, 2022)
  assert.equal(JSON.parse(audit.value.reason).facebookSubcode, 1404132)
  assert.equal(JSON.parse(audit.value.reason).message, error.providerMessage)
  assert.equal(audit.value.tenant_id, tenant)
  assert.equal(f.network(), 1, 'an unrelated provider refusal never triggers a tagged retry')
  const log = f.logs.find((entry) => typeof entry[0] === 'string' && entry[0].startsWith('{'))
  assert.equal(JSON.parse(log[0]).error.message, error.providerMessage)
  assert.equal(JSON.parse(log[0]).error.error_subcode, 1404132)
})
test('failed preflight eligibility never reaches provider', async () => {
  for (const status of ['cancelled', 'requires_review', 'deferred', 'skipped']) {
    const f = workerFixture({ prepared: status })
    await f.api.runFollowUps(f.db, tenant)
    assert.equal(f.network(), 0)
    assert.equal(f.settled.length, 0)
  }
})

test('preparation failure reports an operational error and releases only an undispatched claim', async () => {
  const f = workerFixture({ prepareError: true })
  const result = await f.api.runFollowUps(f.db, tenant)
  assert.equal(f.network(), 0)
  assert.equal(result.errors, 1)
  assert.equal(result.jobs[0].reason, 'prepare_failed')
  assert.equal(f.writes[0].value.status, 'requires_review')
})
test('new follow-up APIs fail closed before cross-tenant DB access', async () => {
  const guarded = {
    followUpTenant: async () => {
      throw new InboxError('forbidden', 403, 'FEATURE_LOCKED')
    },
  }
  for (const [file, methods] of [
    ['app/api/follow-ups/route.ts', ['GET', 'PATCH']],
    ['app/api/chatbot/follow-ups/route.ts', ['PATCH']],
    ['app/api/follow-ups/jobs/[id]/route.ts', ['PATCH']],
    ['app/api/follow-ups/jobs/[id]/draft/route.ts', ['POST']],
    ['app/api/follow-ups/orders/[id]/delivery/route.ts', ['POST']],
    ['app/api/follow-ups/orders/[id]/confirm/route.ts', ['POST']],
    ['app/api/follow-ups/customers/[id]/route.ts', ['GET', 'PATCH']],
    ['app/api/follow-ups/customers/[id]/handoff/route.ts', ['POST']],
  ]) {
    const api = load(file, {
      'next/server': next,
      '@/lib/features/follow-ups/smart-followup-server': guarded,
      '@/lib/features/inbox/inbox-server': errors,
      '@/lib/features/follow-ups/smart-followup-validation': validation,
      '@/lib/auth': {
        canAccessTenant() {
          throw Error('No access')
        },
      },
      '@/lib/feature-access': {
        hasFeature() {
          throw Error('No provider')
        },
      },
      '@/lib/features/follow-ups/manual-followup-ai': {
        draftManualFollowUp() {
          throw Error('No provider')
        },
      },
      '@/lib/features/agents/ai-agent': { AiAgentError: class extends Error {} },
      '@/lib/utils': utils,
    })
    for (const method of methods) {
      const result = await api[method](
        {
          json: async () => ({ tenantId: tenant }),
          nextUrl: { searchParams: new URLSearchParams({ tenantId: tenant }) },
        },
        { params: Promise.resolve({ id }) },
      )
      assert.equal(result.status, 403, file)
    }
  }
})
test('dashboard returns canonical server billing without bypass flags or private credentials', async () => {
  const scopes = []
  let jobStatus = 'failed'
  const db = {
    from(table) {
      const q = {
        select() {
          return q
        },
        eq(key, value) {
          scopes.push([table, key, value])
          return q
        },
        order() {
          return q
        },
        limit() {
          return q
        },
        maybeSingle: async () => ({
          data: table === 'follow_up_policies' ? { approval_mode: 'auto_approve' } : null,
          error: null,
        }),
        then(resolve, reject) {
          const data =
            table === 'follow_up_jobs'
              ? [{ id, status: jobStatus, reason: 'api_rejected' }]
              : table === 'follow_up_execution_logs'
                ? [
                    {
                      job_id: id,
                      status: 'delivery_error',
                      reason: JSON.stringify({
                        message: 'Meta rejected this request',
                        httpStatus: 400,
                        facebookCode: 2022,
                        facebookSubcode: 1404132,
                      }),
                    },
                  ]
                : []
          return Promise.resolve({ data, error: null }).then(resolve, reject)
        },
      }
      return q
    },
    rpc: async () => ({ data: { pending: 1 }, error: null }),
  }
  const server = load('lib/features/follow-ups/smart-followup-server.ts', {
    'server-only': {},
    '@/lib/features/inbox/inbox-server': errors,
    '@/lib/feature-access': { hasFeature: async () => true },
    '@/lib/features/follow-ups/smart-followup-types': types,
    '@/lib/utils': utils,
    '@/lib/features/billing/billing': {
      getBilling: async (gotDb, gotTenant) => {
        assert.equal(gotDb, db)
        assert.equal(gotTenant, tenant)
        return {
          plan: 'starter',
          planExpiresAt: '2099-01-01T00:00:00Z',
          monthly: 12,
          allowance: 1500,
          topup: 34,
          slipRemaining: 56,
          featureBypass: true,
          page_access_token: 'must-not-leak',
        }
      },
    },
  })
  const result = await server.followUpDashboard(db, tenant)
  assert.equal(result.billing.plan, 'starter')
  assert.equal(result.policy.approval_mode, 'auto_approve')
  assert.equal(result.billing.monthly + result.billing.topup, 46)
  assert.equal(result.billing.slipRemaining, 56)
  assert.equal(result.jobs[0].reason, 'api_rejected')
  assert.equal(result.jobs[0].delivery_error.message, 'Meta rejected this request')
  assert.equal(result.jobs[0].delivery_error.facebookSubcode, 1404132)
  for (jobStatus of ['pending', 'sent']) {
    const refreshed = await server.followUpDashboard(db, tenant)
    assert.equal(
      refreshed.jobs[0].delivery_error,
      null,
      'old refusal diagnostics stay in the audit after a retry',
    )
  }
  assert.equal('featureBypass' in result.billing, false)
  assert.equal(JSON.stringify(result).includes('must-not-leak'), false)
  for (const table of [
    'follow_up_jobs',
    'follow_up_workflows',
    'follow_up_execution_logs',
    'follow_up_policies',
  ])
    assert.ok(scopes.some(([t, k, v]) => t === table && k === 'tenant_id' && v === tenant))
})

test('approval mode API validates choices and uses a scoped setting RPC without rewriting workflows', async () => {
  const calls = []
  const api = load('app/api/chatbot/follow-ups/route.ts', {
    'next/server': next,
    '@/lib/features/inbox/inbox-server': errors,
    '@/lib/features/follow-ups/smart-followup-server': {
      followUpTenant: async () => ({
        tenantId: tenant,
        actor: { id },
        db: {
          rpc: async (name, args) => {
            calls.push({ name, args })
            return { data: args.p_mode, error: null }
          },
        },
      }),
    },
  })
  assert.equal(
    (await api.PATCH({ json: async () => ({ tenantId: tenant, approvalMode: 'invalid' }) })).status,
    400,
  )
  assert.equal(calls.length, 0)
  for (const approvalMode of ['manual_review', 'auto_approve']) {
    const response = await api.PATCH({ json: async () => ({ tenantId: tenant, approvalMode }) })
    assert.equal(response.status, 200)
    assert.equal(response.body.approvalMode, approvalMode)
    assert.equal(calls.at(-1).name, 'set_follow_up_approval_mode')
    assert.equal(calls.at(-1).args.p_tenant, tenant)
    assert.equal(calls.at(-1).args.p_actor, id)
  }
})

test('dashboard flags restricted Pages and offers retries only for confirmed rejections', () => {
  assert.equal(types.isMetaPageRestricted({ facebookCode: 2022 }), true)
  assert.equal(types.isMetaPageRestricted({ facebookSubcode: 1404132 }), true)
  assert.equal(types.isMetaPageRestricted({ facebookCode: 100 }), false)
  assert.equal(types.canRetryRejectedFollowUp({ status: 'failed', reason: 'api_rejected' }), true)
  assert.equal(
    types.canRetryRejectedFollowUp({ status: 'failed', reason: 'page_restricted' }),
    true,
  )
  for (const job of [
    { status: 'sent', reason: 'api_rejected' },
    { status: 'failed', reason: 'worker_restarted' },
    { status: 'requires_review', reason: 'delivery_unknown' },
  ])
    assert.equal(types.canRetryRejectedFollowUp(job), false)
})

test('retry-send endpoint uses the confirmed-refusal RPC and returns window cancellation', async () => {
  const api = load('app/api/follow-ups/jobs/[id]/route.ts', {
    'next/server': next,
    '@/lib/utils': utils,
    '@/lib/features/inbox/inbox-server': errors,
    '@/lib/features/follow-ups/smart-followup-server': {
      followUpTenant: async () => ({
        tenantId: tenant,
        actor: { id },
        db: {
          rpc: async (name, args) => {
            assert.equal(name, 'retry_rejected_follow_up')
            assert.equal(args.p_tenant, tenant)
            assert.equal(args.p_job, id)
            return { data: 'cancelled', error: null }
          },
        },
      }),
    },
  })
  const response = await api.PATCH(
    { json: async () => ({ tenantId: tenant, action: 'retry_send' }) },
    { params: Promise.resolve({ id }) },
  )
  assert.equal(response.status, 200)
  assert.equal(response.body.status, 'cancelled')
})
function handoffFixture({ missing = false, conflict = false } = {}) {
  const calls = [],
    scope = []
  const db = {
    from: () => {
      const q = {
        select() {
          return q
        },
        eq(k, v) {
          scope.push([k, v])
          return q
        },
        maybeSingle: async () => ({
          data: missing ? null : { id, conversation_version: 7 },
          error: null,
        }),
      }
      return q
    },
    rpc: async (name, args) => {
      calls.push([name, args])
      return { error: conflict ? { code: '40001' } : null }
    },
  }
  const api = load('app/api/follow-ups/customers/[id]/handoff/route.ts', {
    'next/server': next,
    '@/lib/features/inbox/inbox-server': errors,
    '@/lib/utils': utils,
    '@/lib/features/follow-ups/smart-followup-server': {
      followUpTenant: async () => ({ db, tenantId: tenant, actor: { id: 'server-actor' } }),
    },
  })
  const run = () =>
    api.POST(
      {
        json: async () => ({
          tenantId: tenant,
          userId: 'forged-user',
          version: 999,
          plan: 'pro',
          credits: 999999,
        }),
      },
      { params: Promise.resolve({ id }) },
    )
  return { run, calls, scope }
}
test('handoff uses tenant-scoped customer and server actor/version through existing audited RPC', async () => {
  const f = handoffFixture()
  assert.equal((await f.run()).status, 200)
  assert.ok(f.scope.some(([key, value]) => key === 'tenant_id' && value === tenant))
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0][0], 'manage_inbox_conversation')
  assert.equal(f.calls[0][1].p_actor, 'server-actor')
  assert.equal(f.calls[0][1].p_version, 7)
  assert.equal(f.calls[0][1].p_action, 'claim')
})
test('handoff rejects missing/cross-tenant customers and concurrent assignment changes', async () => {
  const missing = handoffFixture({ missing: true })
  assert.equal((await missing.run()).status, 404)
  assert.equal(missing.calls.length, 0)
  const conflict = handoffFixture({ conflict: true })
  assert.equal((await conflict.run()).status, 409)
})
test('stop-customer API accepts opt-out only and ignores forged credits/package values', async () => {
  const writes = []
  const db = {
    from: () => {
      const q = {
        update: (value) => {
          writes.push(value)
          return q
        },
        eq() {
          return q
        },
        select() {
          return q
        },
        maybeSingle: async () => ({ data: { id }, error: null }),
      }
      return q
    },
  }
  const api = load('app/api/follow-ups/customers/[id]/route.ts', {
    'next/server': next,
    '@/lib/features/inbox/inbox-server': errors,
    '@/lib/utils': utils,
    '@/lib/auth': {},
    '@/lib/features/follow-ups/smart-followup-server': {
      followUpTenant: async () => ({ db, tenantId: tenant, actor: { id: 'server-actor' } }),
    },
  })
  const send = (action) =>
    api.PATCH(
      {
        json: async () => ({
          tenantId: tenant,
          action,
          plan: 'pro',
          broadcast_credits: 999999,
          followup_opted_out: false,
        }),
      },
      { params: Promise.resolve({ id }) },
    )
  assert.equal((await send('opt_out')).status, 200)
  assert.equal(writes[0].followup_opted_out, true)
  assert.equal('plan' in writes[0], false)
  assert.equal('broadcast_credits' in writes[0], false)
  assert.equal((await send('opt_in')).status, 400)
  assert.equal(writes.length, 1)
})
test('database feature guard rejects Starter AI and expired subscriptions before drafting', async () => {
  let ai = 0
  const api = load('app/api/follow-ups/jobs/[id]/draft/route.ts', {
    'next/server': next,
    '@/lib/features/follow-ups/smart-followup-server': {
      followUpTenant: async () => ({ db: {}, tenantId: tenant }),
    },
    '@/lib/features/inbox/inbox-server': errors,
    '@/lib/feature-access': { hasFeature: async () => false },
    '@/lib/features/follow-ups/manual-followup-ai': {
      draftManualFollowUp: async () => {
        ai++
      },
    },
    '@/lib/features/agents/ai-agent': {
      aiReply: async () => {
        ai++
      },
      AiAgentError: class extends Error {},
    },
    '@/lib/utils': utils,
  })
  const result = await api.POST(
    { json: async () => ({ tenantId: tenant }) },
    { params: Promise.resolve({ id }) },
  )
  assert.equal(result.status, 403)
  assert.equal(result.body.code, 'FEATURE_LOCKED')
  assert.equal(ai, 0)
})
function aiFixture({
  allowed = true,
  value = { intent: 'interested', productId: 'catalog-id', draft: 'Ask about product' },
  providerError = false,
} = {}) {
  let calls = 0
  const filters = []
  const db = {
    rpc: async () => ({ data: { id: 'usage-id' }, error: null }),
    from(table) {
      const q = {
        update() {
          return q
        },
        select() {
          return q
        },
        eq(k, v) {
          filters.push([table, k, v])
          return q
        },
        order() {
          return q
        },
        limit() {
          return q
        },
        maybeSingle: async () => ({
          data: { id, body: 'interested in this product' },
          error: null,
        }),
        then(resolve, reject) {
          return Promise.resolve({
            data:
              table === 'products'
                ? [{ id: 'catalog-id', name: 'Actual catalog product', price: 100 }]
                : [{ sender: 'customer', body: 'hello' }],
            error: null,
          }).then(resolve, reject)
        },
      }
      return q
    },
  }
  const api = load(
    'lib/features/follow-ups/followup-ai.ts',
    {
      'server-only': {},
      '@google/genai': {
        GoogleGenAI: class {
          models = {
            generateContent: async () => {
              calls++
              if (providerError) throw Error('timeout')
              return { text: JSON.stringify(value) }
            },
          }
        },
      },
      '@/lib/features/agents/ai-agent': { aiModel: () => 'model' },
      '@/lib/feature-access': { hasFeature: async () => allowed },
    },
    { process: { env: { GEMINI_API_KEY: 'test-not-real' } } },
  )
  return { api, db, filters, calls: () => calls }
}
test('AI classification validates catalog IDs and tenant/source filters', async () => {
  const f = aiFixture()
  const result = await f.api.analyzeFollowUp(f.db, tenant, 'customer', id)
  assert.equal(result.productId, 'catalog-id')
  assert.ok(f.filters.some(([t, k, v]) => t === 'products' && k === 'tenant_id' && v === tenant))
  assert.ok(
    f.filters.some(([t, k, v]) => t === 'messages' && k === 'customers.tenant_id' && v === tenant),
  )
  const forged = aiFixture({
    value: { intent: 'interested', productId: 'foreign', draft: 'invented' },
  })
  assert.equal(await forged.api.analyzeFollowUp(forged.db, tenant, 'customer', id), null)
})
test('AI is unavailable for locked packages and failures never invent interest or send messages', async () => {
  for (const options of [
    { allowed: false },
    { providerError: true },
    { value: { intent: 'unrecognized' } },
  ]) {
    const f = aiFixture(options)
    assert.equal(await f.api.analyzeFollowUp(f.db, tenant, 'customer', id), null)
    if (!options.allowed && options.allowed !== undefined) assert.equal(f.calls(), 0)
  }
})
