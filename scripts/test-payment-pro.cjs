const assert = require('node:assert/strict'),
  { test } = require('node:test'),
  fs = require('node:fs'),
  vm = require('node:vm'),
  ts = require('typescript')
test('local development enables every Pro flag without tenant configuration; kill switch still wins', async () => {
  for (const master of [undefined, 'false', 'true']) {
    const flags = load(
      'lib/features/payments/payment-pro-flags.ts',
      { 'server-only': {}, '@/lib/features/payments/payment-pro-core': core },
      { process: { env: { NODE_ENV: 'development', PAYMENT_PRO_ENABLED: master } } },
    )
    assert.equal(flags.paymentProAvailable(), true)
    const config = await flags.paymentProConfig(
      {
        from() {
          throw Error('Local defaults must not query settings')
        },
      },
      tenant,
    )
    assert.equal(Object.keys(config).length, 8)
    assert.ok(Object.values(config).every((v) => v === true))
  }
  const flags = load(
    'lib/features/payments/payment-pro-flags.ts',
    { 'server-only': {}, '@/lib/features/payments/payment-pro-core': core },
    { process: { env: { NODE_ENV: 'development', PAYMENT_PRO_KILL_SWITCH: 'true' } } },
  )
  assert.equal(
    await flags.paymentProConfig(
      {
        from() {
          throw Error('Kill switch must not query')
        },
      },
      tenant,
    ),
    null,
  )
})
function load(file, deps = {}, globals = {}) {
  const context = {
    exports: {},
    console,
    Date,
    JSON,
    Math,
    Object,
    Number,
    Buffer,
    File,
    FormData,
    AbortSignal,
    crypto: require('node:crypto').webcrypto,
    process: { env: {} },
    require: (n) => {
      if (n === '@/lib/single-flight') return load('lib/single-flight.ts')
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
const core = load('lib/features/payments/payment-pro-core.ts'),
  tenant = '11111111-1111-4111-8111-111111111111',
  id = '22222222-2222-4222-8222-222222222222'
const valid = {
  providerVerified: true,
  transactionRef: 'reference',
  expectedAmountSatang: 10000,
  verifiedAmountSatang: 10000,
  receiverMatches: true,
  duplicateTransaction: false,
}
test('all new feature flags default false and money conversion never rounds fractional satang', () => {
  assert.ok(Object.values(core.DEFAULT_PAYMENT_PRO_FLAGS).every((v) => v === false))
  for (const [value, expected] of [
    ['0.30', 30],
    [9, 900],
    ['19.00', 1900],
    ['1.01', 101],
  ])
    assert.equal(core.amountSatang(value), expected)
  for (const value of [0, -1, '0.001', '9.999', Infinity, NaN, '1e9', {}, '1000000000000'])
    assert.equal(core.amountSatang(value), null)
})
test('decision engine requires trusted provider, reference, exact satang, receiver and unused transfer', () => {
  assert.equal(core.evaluatePayment(valid).decision, 'VERIFIED')
  for (const [patch, reason] of [
    [{ providerError: true }, 'PROVIDER_ERROR'],
    [{ duplicateTransaction: true }, 'DUPLICATE_TRANSACTION'],
    [{ providerVerified: false }, 'NOT_PROVIDER_VERIFIED'],
    [{ transactionRef: '' }, 'MISSING_TRANSACTION_REFERENCE'],
    [{ verifiedAmountSatang: 9999 }, 'AMOUNT_MISMATCH'],
    [{ receiverMatches: false }, 'RECEIVER_NOT_CONFIRMED'],
    [{ expectedAmountSatang: null }, 'INVALID_AMOUNT'],
  ])
    assert.equal(core.evaluatePayment({ ...valid, ...patch }).reason, reason)
})
test('state machine never reopens terminal payments or skips verification', () => {
  assert.equal(core.canTransition('VERIFYING', 'VERIFIED'), true)
  assert.equal(core.canTransition('REVIEW_REQUIRED', 'VERIFIED'), true)
  for (const status of ['VERIFIED', 'REJECTED', 'CANCELLED'])
    assert.equal(core.canTransition(status, 'VERIFYING'), false)
  assert.throws(() => core.assertTransition('PENDING', 'VERIFIED'))
})
test('provider transfer times accept documented ISO or Bangkok date/time and reject absent values', () => {
  assert.equal(
    core.providerPaidAt({ data: { transDate: '20261016', transTime: '10:11:12' } }),
    '2026-10-16T03:11:12.000Z',
  )
  assert.equal(
    core.providerPaidAt({ data: { transTimestamp: '2026-10-16T03:11:12.000Z' } }),
    '2026-10-16T03:11:12.000Z',
  )
  assert.equal(core.providerPaidAt({ data: { transDate: '20261016' } }), null)
})
test('CSV quotes delimiters and neutralizes spreadsheet formulas', () => {
  assert.equal(core.csvCell('=SUM(A1:A3)'), `"'=SUM(A1:A3)"`)
  assert.equal(core.csvCell('\t+1'), `"'\t+1"`)
  assert.equal(core.csvCell('a,"b"'), `"a,""b"""`)
})
test('disabled master flag or emergency switch performs zero configuration queries', async () => {
  for (const env of [
    {},
    { PAYMENT_PRO_ENABLED: 'false' },
    { PAYMENT_PRO_ENABLED: 'true', PAYMENT_PRO_KILL_SWITCH: 'true' },
  ]) {
    const flags = load(
      'lib/features/payments/payment-pro-flags.ts',
      { 'server-only': {}, '@/lib/features/payments/payment-pro-core': core },
      { process: { env } },
    )
    assert.equal(
      await flags.paymentProConfig(
        {
          from() {
            throw Error('Must not query DB')
          },
        },
        tenant,
      ),
      null,
    )
  }
})
test('flags load only booleans from backend and ignore unknown keys', async () => {
  const flags = load(
    'lib/features/payments/payment-pro-flags.ts',
    { 'server-only': {}, '@/lib/features/payments/payment-pro-core': core },
    { process: { env: { PAYMENT_PRO_ENABLED: 'true' } } },
  )
  const q = {
    select() {
      return q
    },
    eq() {
      return q
    },
    maybeSingle: async () => ({
      data: { enabled: true, flags: { riskEngine: true, autoConfirmation: 'true', forged: true } },
    }),
  }
  const result = await flags.paymentProConfig({ from: () => q }, tenant)
  assert.equal(result.riskEngine, true)
  assert.equal(result.autoConfirmation, false)
  assert.equal('forged' in result, false)
})
function fixture({
  enabled = true,
  existing = false,
  claimExisting = false,
  start = true,
  verdict = 'valid',
  providerFault = false,
  saveFailure = false,
  production = false,
  send = false,
  foreignCustomer = false,
} = {}) {
  let providerCalls = 0,
    claims = 0,
    starts = 0,
    completed = 0,
    recovered = 0
  const records = [],
    filters = []
  const db = {
    from(table) {
      const q = {
        select() {
          return q
        },
        eq(key, value) {
          filters.push([table, key, value])
          return q
        },
        maybeSingle: async () => ({
          data:
            table === 'payment_pro_attempts' && existing
              ? { id, slip_id: 'slip', customer_id: foreignCustomer ? 'someone-else' : 'customer' }
              : null,
        }),
        single: async () => ({
          data: {
            id: 'slip',
            status: verdict === 'valid' ? 'valid' : 'error',
            amount: 100,
            trans_ref: 'ref',
            note: null,
          },
        }),
        then(resolve, reject) {
          return Promise.resolve({
            data:
              table === 'bank_accounts'
                ? [{ bank_code: 'KTB', account_number: '9260337828', is_active: true }]
                : null,
          }).then(resolve, reject)
        },
      }
      return q
    },
    rpc: async (name, args) => {
      records.push([name, args])
      if (name === 'claim_payment_pro') {
        claims++
        return {
          data: {
            id,
            slip_id: 'slip',
            customer_id: 'customer',
            claim_token: claimExisting || claims > 1 ? null : 'claim',
            expected_satang: 10000,
            image_path: null,
          },
        }
      }
      if (name === 'start_payment_pro_provider') {
        starts++
        return { data: start }
      }
      if (name === 'complete_payment_pro') {
        completed++
        return saveFailure ? { error: { code: 'DB_DOWN' } } : { data: null }
      }
      if (name === 'review_payment_pro_failure') {
        recovered++
        return { data: null }
      }
      throw Error(name)
    },
  }
  const config = { riskEngine: enabled, messengerAutomation: true }
  const api = load(
    'lib/features/payments/payment-pro.ts',
    {
      'server-only': {},
      'node:crypto': require('node:crypto'),
      '@/lib/features/payments/payment-pro-flags': {
        paymentProConfig: async () => config,
        paymentProAvailable: () => true,
      },
      '@/lib/features/payments/payment-pro-core': core,
      '@/lib/features/slips/slipok': {
        verifyWithSlipOK: async (input) => {
          providerCalls++
          assert.equal(input.expectedAmount, 100)
          assert.equal('log' in input, false)
          return {
            verdict,
            providerFault,
            amount: 100,
            transRef: 'ref',
            receiverBank: '006',
            receiverAccount: '9260337828',
            raw: { data: { transTimestamp: new Date().toISOString() } },
          }
        },
      },
      '@/lib/features/slips/receiver-matching': { receiverMatchesAny: () => true },
      '@/lib/features/vision/vision-image': { validateVisionFile: async () => true },
    },
    {
      process: {
        env: {
          NODE_ENV: production ? 'production' : 'development',
          PAYMENT_PRO_SEND_ENABLED: send ? 'true' : 'false',
        },
      },
    },
  )
  return {
    api,
    db,
    records,
    filters,
    run: () =>
      api.processPaymentPro(db, {
        qr: 'test-qr',
        tenant: { id: tenant, account_number: '9260337828', bank_code: 'KTB' },
        customerId: 'customer',
        expectedAmount: 0.01,
      }),
    counts: () => ({ providerCalls, claims, starts, completed, recovered }),
  }
}
test('Pro off returns control to legacy with no storage/provider work', async () => {
  const f = fixture({ enabled: false })
  assert.equal(await f.run(), null)
  assert.equal(f.counts().providerCalls, 0)
  assert.equal(f.counts().claims, 0)
})
test('verified flow uses DB snapshot amount, existing adapter defaults, and one atomic completion', async () => {
  const f = fixture()
  const r = await f.run()
  assert.equal(f.counts().providerCalls, 1)
  assert.equal(f.counts().completed, 1)
  assert.equal(r.paymentPro, true)
  assert.equal(r.automationAllowed, false)
  const evidence = f.records.find(([name]) => name === 'complete_payment_pro')[1].p_evidence
  assert.equal(evidence.amount_satang, 10000)
  assert.equal(evidence.engine_decision, 'VERIFIED')
  assert.equal(evidence.provider_verified, true)
  assert.ok(
    f.filters.some(
      ([table, key, value]) => table === 'bank_accounts' && key === 'tenant_id' && value === tenant,
    ),
  )
})
test('duplicate proof or lost atomic claim never re-calls provider', async () => {
  for (const config of [{ existing: true }, { claimExisting: true }, { start: false }]) {
    const f = fixture(config)
    await f.run()
    assert.equal(f.counts().providerCalls, 0)
    assert.equal(f.counts().completed, 0)
  }
})
test('concurrent identical uploads result in one provider call at most', async () => {
  const f = fixture()
  await Promise.all([f.run(), f.run()])
  assert.equal(f.counts().providerCalls, 1)
  assert.equal(f.counts().completed, 1)
})
test('proof from a different customer never becomes that customer payment confirmation', async () => {
  const f = fixture({ existing: true, foreignCustomer: true, production: true, send: true })
  const result = await f.run()
  assert.equal(result.status, 'duplicate')
  assert.equal(result.id, undefined)
  assert.equal(result.automationAllowed, false)
  assert.equal(f.counts().providerCalls, 0)
})
test('provider outage is recorded for transactional refund; persistence failure goes to durable review', async () => {
  const outage = fixture({ providerFault: true, verdict: 'error' })
  await outage.run()
  const evidence = outage.records.find(([name]) => name === 'complete_payment_pro')[1].p_evidence
  assert.equal(evidence.provider_fault, true)
  assert.equal(evidence.engine_reason, 'PROVIDER_ERROR')
  const fail = fixture({ saveFailure: true })
  await fail.run()
  assert.equal(fail.counts().providerCalls, 1)
  assert.equal(fail.counts().recovered, 1)
})
test('Pro customer automation requires production and explicit separate live-send flag', async () => {
  for (const [production, send, expected] of [
    [false, false, false],
    [false, true, false],
    [true, false, false],
    [true, true, true],
  ]) {
    const f = fixture({ production, send })
    assert.equal((await f.run()).automationAllowed, expected)
  }
})
test('existing Messenger notifier stops Pro results before any send or database mutation when not allowed', async () => {
  const notify = load('lib/features/slips/notify.ts', {
    'server-only': {},
    '@/lib/integrations/facebook/client': {},
    '@/lib/message-quota': {},
  })
  await notify.notifySlipResult(
    {
      from() {
        throw Error('No writes')
      },
      rpc() {
        throw Error('No sends')
      },
    },
    { id, paymentPro: true, automationAllowed: false, status: 'valid', amount: 100 },
    { id: 'customer', psid: 'psid', token: 'fake' },
  )
})
class InboxError extends Error {
  constructor(message, status = 400, code = 'INBOX_ERROR') {
    super(message)
    this.status = status
    this.code = code
  }
}
const errors = {
    InboxError,
    inboxError: (e) => ({ status: e.status ?? 503, body: { code: e.code, error: e.message } }),
  },
  next = {
    NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) },
  }
test('session, tenant, owner and DB feature guards fail closed before reading payments', async () => {
  for (const [actor, member, owner, feature, available, status] of [
    [null, true, true, true, true, 401],
    [{ kind: 'internal' }, true, true, true, true, 401],
    [{ kind: 'user' }, false, true, true, true, 404],
    [{ kind: 'user' }, true, false, true, true, 403],
    [{ kind: 'user' }, true, true, false, true, 403],
    [{ kind: 'user' }, true, true, true, false, 403],
  ]) {
    let queries = 0
    const server = load('lib/features/payments/payment-pro-server.ts', {
      'server-only': {},
      '@/lib/auth': {
        getActor: async () => actor,
        canAccessTenant: async (a, t, role) => (role === 'owner' ? owner : member),
      },
      '@/lib/supabase/server': {
        supabaseAdmin: () => ({
          from() {
            queries++
            throw Error('No reads allowed')
          },
        }),
      },
      '@/lib/feature-access': { hasFeature: async () => feature },
      '@/lib/features/inbox/inbox-server': errors,
      '@/lib/features/payments/payment-pro-flags': {
        paymentProAvailable: () => available,
        paymentProConfig: async () => ({ advancedDashboard: true }),
      },
      '@/lib/features/payments/payment-pro-core': core,
      '@/lib/utils': { UUID: /^[0-9a-f-]{36}$/ },
    })
    await assert.rejects(server.paymentProTenant({}, tenant, true), (e) => e.status === status)
    assert.equal(queries, 0)
  }
})
test('dashboard, CSV and review direct API calls cannot bypass guard', async () => {
  for (const [file, method] of [
    ['app/api/payment-pro/route.ts', 'GET'],
    ['app/api/payment-pro/[id]/review/route.ts', 'POST'],
  ]) {
    const api = load(file, {
      'next/server': next,
      '@/lib/features/payments/payment-pro-server': {
        paymentProTenant: async () => {
          throw new InboxError('locked', 403, 'FEATURE_LOCKED')
        },
      },
      '@/lib/features/inbox/inbox-server': errors,
      '@/lib/features/payments/payment-pro-core': core,
      '@/lib/utils': { UUID: /./ },
    })
    for (const format of ['json', 'csv']) {
      const r = await api[method](
        { nextUrl: { searchParams: new URLSearchParams({ tenantId: tenant, format }) } },
        { params: Promise.resolve({ id }) },
      )
      assert.equal(r.status, 403)
      assert.equal(r.body.code, 'FEATURE_LOCKED')
    }
  }
})
test('manual review uses server actor and whitelisted action, ignores forged evidence and credits', async () => {
  let args
  const api = load('app/api/payment-pro/[id]/review/route.ts', {
    'next/server': next,
    '@/lib/features/payments/payment-pro-server': {
      paymentProTenant: async () => ({
        tenantId: tenant,
        actor: { id: 'actual-owner' },
        db: {
          rpc: async (name, input) => {
            args = input
            return { data: true }
          },
        },
      }),
    },
    '@/lib/features/inbox/inbox-server': errors,
    '@/lib/utils': { UUID: /^[0-9a-f-]{36}$/ },
  })
  const body = {
    action: 'approve',
    reason: 'Reviewed real evidence',
    actorId: 'fake',
    provider_verified: true,
    amount_satang: 1,
    slip_quota_credits: 999999,
  }
  const r = await api.POST(
    {
      nextUrl: { searchParams: new URLSearchParams({ tenantId: tenant }) },
      json: async () => body,
    },
    { params: Promise.resolve({ id }) },
  )
  assert.equal(r.status, 200)
  assert.equal(args.p_actor, 'actual-owner')
  assert.equal('provider_verified' in args, false)
  assert.equal('slip_quota_credits' in args, false)
})
test('cron requires secret and does not run recovery with emergency switch', async () => {
  let calls = 0
  for (const env of [{}, { CRON_SECRET: 'test-secret' }]) {
    const api = load(
      'app/api/cron/payment-pro/route.ts',
      {
        'next/server': next,
        '@/lib/supabase/server': {
          supabaseAdmin: () => {
            calls++
            throw Error('No DB')
          },
        },
        '@/lib/features/payments/payment-pro-flags': { paymentProAvailable: () => false },
      },
      { process: { env } },
    )
    assert.equal((await api.POST({ headers: new Headers() })).status, 401)
    if (env.CRON_SECRET)
      assert.equal(
        (await api.POST({ headers: new Headers({ authorization: 'Bearer test-secret' }) })).body
          .enabled,
        false,
      )
  }
  assert.equal(calls, 0)
})
