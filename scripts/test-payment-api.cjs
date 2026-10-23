const assert = require('node:assert/strict')
const { File } = require('node:buffer')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')
const { createHash } = require('node:crypto')

function compile(file) {
  return ts.transpileModule(readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText
}

const code = Object.fromEntries(
  [
    ['signature', 'lib/image-signature.ts'],
    ['banks', 'lib/features/banking/banks.ts'],
    ['plans', 'lib/features/billing/plans.ts'],
    ['payments', 'lib/features/payments/payments.ts'],
    ['validation', 'lib/features/payments/payment-validation.ts'],
    ['create', 'app/api/payments/route.ts'],
    ['verify', 'app/api/payments/verify-slip/route.ts'],
    ['get', 'app/api/payments/[id]/route.ts'],
  ].map(([name, file]) => [name, compile(file)]),
)
const tenantId = '11111111-1111-1111-1111-111111111111'
const sessionId = '22222222-2222-2222-2222-222222222222'
const userId = '33333333-3333-3333-3333-333333333333'
const now = Date.parse('2026-10-14T05:06:00Z')
class TestDate extends Date {
  static now() {
    return now
  }
}
const receiver = {
  NEXT_PUBLIC_PROMPTPAY_ID: '0812345678',
  NEXT_PUBLIC_BANK_ACCOUNT_NO: '1234567890',
  NEXT_PUBLIC_BANK_ACCOUNT_NAME: 'แพลตฟอร์มทดสอบ',
  NEXT_PUBLIC_BANK_NAME: 'KBANK',
  PAYMENT_BANK_CODE: '004',
}
const jpeg = () =>
  new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], 'slip.jpg', { type: 'image/jpeg' })
function form(file = jpeg(), id = sessionId) {
  const data = new FormData()
  data.set('sessionId', id)
  if (file) data.set('file', file)
  return data
}
const req = (body = {}, upload = form(), headers = {}) => ({
  json: async () => body,
  formData: async () => upload,
  headers: new Headers(headers),
})
const validSlip = () => ({
  verdict: 'valid',
  receiverVerifiedByProvider: true,
  amount: 390,
  transRef: 'bank-reference-1',
  raw: {
    success: true,
    data: {
      success: true,
      amount: 390,
      transRef: 'bank-reference-1',
      receivingBank: '004',
      receiver: { account: { value: 'xxxxxx7890' } },
      transDate: '20261014',
      transTime: '12:05:00',
    },
  },
})

// Fake env and SlipOK; real route, receiver configuration and proof validation code.
// No live credentials, actual Next/Supabase clients, external requests, or database writes.
function fixture(options = {}) {
  const actor = Object.hasOwn(options, 'actor')
    ? options.actor
    : { kind: 'user', id: userId, isPlatformAdmin: false }
  const state = {
    session: {
      id: sessionId,
      tenant_id: tenantId,
      plan: 'starter',
      price_baht: 390,
      credits: 1500,
      status: 'pending',
      requested_by: userId,
      created_at: '2026-10-14T05:00:00Z',
      expires_at: '2026-10-14T05:20:00Z',
      receiver_promptpay_id: receiver.NEXT_PUBLIC_PROMPTPAY_ID,
      receiver_account_no: receiver.NEXT_PUBLIC_BANK_ACCOUNT_NO,
      receiver_account_name: receiver.NEXT_PUBLIC_BANK_ACCOUNT_NAME,
      receiver_bank_name: receiver.NEXT_PUBLIC_BANK_NAME,
      receiver_bank_code: receiver.PAYMENT_BANK_CODE,
      ...options.session,
    },
    receipts: options.receipts ? [...options.receipts] : [],
    billing: { plan: 'free', planExpiresAt: null, monthly: 200, allowance: 200, topup: 0 },
    activations: 0,
  }
  const queries = [],
    calls = [],
    permissions = [],
    logs = [],
    billingCalls = []
  let activationFailures = options.activationFailures ?? 0
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
        insert(value) {
          query.insert = value
          return this
        },
        async single() {
          assert.equal(table, 'payment_sessions')
          state.session = { ...state.session, ...query.insert }
          return { data: state.session, error: null }
        },
        async maybeSingle() {
          const rows = table === 'payment_sessions' ? [state.session] : state.receipts
          return {
            data:
              rows.find((row) => query.filters.every(([column, value]) => row[column] === value)) ??
              null,
            error: null,
          }
        },
        then(resolve, reject) {
          assert.equal(table, 'payment_receipts')
          assert.ok(query.insert)
          const error = options.proofSaveError ?? null
          if (!error) state.receipts.push(query.insert)
          return Promise.resolve({ error }).then(resolve, reject)
        },
      }
    },
    async rpc(name, params) {
      assert.equal(name, 'activate_payment')
      assert.equal(params.p_session, sessionId)
      calls.push({ type: 'activate', params })
      if (activationFailures-- > 0) return { error: { code: 'mock-failure' }, data: null }
      assert.ok(state.receipts.some((proof) => proof.session_id === sessionId))
      // Emulate the SQL's idempotent activation contract; repeated requests cannot mint credits.
      if (state.session.status !== 'paid') {
        state.activations++
        state.billing = {
          ...state.billing,
          plan: state.session.plan,
          monthly: state.billing.monthly + state.session.credits,
          allowance: state.session.credits,
        }
        state.session.status = 'paid'
      }
      return { data: state.billing, error: null }
    },
  }
  const modules = {
    '@/lib/safe-logging': require('./helpers/load-safe-logging.cjs')({
      info: (...args) => logs.push(args),
      warn: (...args) => logs.push(args),
      error: (...args) => logs.push(args),
    }),
    'server-only': {},
    'node:crypto': { createHash },
    'promptpay-qr': (id, { amount }) => `mock-qr:${id}:${amount}`,
    'next/server': {
      NextResponse: {
        json: (json, init = {}) => ({
          json,
          status: init.status ?? 200,
          headers: init.headers ?? {},
        }),
      },
    },
    '@/lib/utils': { UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i },
    '@/lib/auth': {
      getActor: async () => {
        if (options.authError) throw options.authError
        return actor
      },
      canAccessTenant: async (_, id, need) => {
        permissions.push({ id, need })
        return options.role !== 'staff' && id === tenantId
      },
    },
    '@/lib/supabase/server': { supabaseAdmin: () => db },
    '@/lib/features/billing/billing': {
      getBilling: async (_, id) => {
        if (options.billingError) throw options.billingError
        billingCalls.push(id)
        return state.billing
      },
    },
    '@/lib/features/slips/slipok': {
      verifyWithSlipOK: async (input) => {
        calls.push({ type: 'slipok', input })
        if (options.providerError) throw options.providerError
        return options.slip ?? validSlip()
      },
    },
  }
  function load(name) {
    const exports = {}
    vm.runInNewContext(code[name], {
      exports,
      Date: TestDate,
      File,
      Buffer,
      Uint8Array,
      process: {
        env: {
          ...receiver,
          SLIPOK_BRANCH_ID: 'fake-branch',
          SLIPOK_API_KEY: 'fake-key',
          ...options.env,
        },
      },
      console: {
        error: (...args) => logs.push(args),
        warn: (...args) => logs.push(args),
        log: (...args) => logs.push(args),
      },
      require(id) {
        if (id === '@/lib/full-access') return { temporaryFullAccess: false }
        assert.ok(Object.hasOwn(modules, id), `Unexpected route dependency: ${id}`)
        return modules[id]
      },
    })
    return exports
  }
  modules['@/lib/image-signature'] = load('signature')
  modules['@/lib/features/banking/banks'] = load('banks')
  modules['@/lib/features/billing/plans'] = load('plans')
  modules['@/lib/features/payments/payments'] = load('payments')
  modules['@/lib/features/payments/payment-validation'] = load('validation')
  return {
    create: load('create').POST,
    verify: load('verify').POST,
    get: load('get').GET,
    state,
    queries,
    calls,
    permissions,
    logs,
    billingCalls,
  }
}

module.exports = { fixture, validSlip, req }

test('unauthorized and non-owner callers cannot create, inspect or verify package payments', async () => {
  for (const options of [{ actor: null }, { role: 'staff' }]) {
    const api = fixture(options)
    assert.equal(
      (await api.create(req({ tenantId, plan: 'starter' }))).status,
      options.actor === null ? 401 : 403,
    )
    assert.equal((await api.verify(req())).status, options.actor === null ? 401 : 404)
    assert.equal(
      (await api.get(req(), { params: Promise.resolve({ id: sessionId }) })).status,
      options.actor === null ? 401 : 404,
    )
    assert.equal(api.calls.length, 0)
    assert.ok(api.queries.every((query) => !query.insert))
    assert.ok(api.permissions.every((permission) => permission.need === 'owner'))
  }
})

test('purchase amount, credits, receiving account and QR come from server configuration', async () => {
  for (const [plan, price, credits] of [
    ['starter', 9, 1500],
    ['pro', 19, 7500],
  ]) {
    const api = fixture()
    const result = await api.create(
      req({ tenantId, plan, amount: 1, credits: 999999, receiver_promptpay_id: 'attacker' }),
    )
    assert.equal(result.status, 201)
    assert.equal(result.headers['Cache-Control'], 'no-store')
    const inserted = api.queries.find((query) => query.insert).insert
    assert.equal(inserted.price_baht, price)
    assert.equal(inserted.credits, credits)
    assert.equal(inserted.requested_by, userId)
    assert.equal(inserted.receiver_promptpay_id, receiver.NEXT_PUBLIC_PROMPTPAY_ID)
    assert.equal(inserted.receiver_account_no, receiver.NEXT_PUBLIC_BANK_ACCOUNT_NO)
    assert.equal(inserted.receiver_bank_code, '004')
    assert.equal(result.json.session.amount, price)
    assert.equal(
      result.json.session.qrPayload,
      `mock-qr:${receiver.NEXT_PUBLIC_PROMPTPAY_ID}:${price}`,
    )
    assert.equal(Object.hasOwn(result.json.session, 'requested_by'), false)
  }
})

test('invalid IDs, plan, absent receiver configuration and invalid uploads do not call SlipOK', async () => {
  const api = fixture()
  assert.equal((await api.create(req({ tenantId: 'bad', plan: 'starter' }))).status, 400)
  assert.equal((await api.create(req({ tenantId, plan: 'free' }))).status, 400)
  assert.equal((await api.get(req(), { params: Promise.resolve({ id: 'bad' }) })).status, 400)
  assert.equal((await api.verify(req({}, form(jpeg(), 'bad')))).status, 400)
  assert.equal(
    (
      await fixture({ env: { NEXT_PUBLIC_PROMPTPAY_ID: '' } }).create(
        req({ tenantId, plan: 'starter' }),
      )
    ).status,
    503,
  )
  for (const file of [
    null,
    new File(['disguised-text'], 'fake.jpg', { type: 'image/jpeg' }),
    new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.jpg', { type: 'image/jpeg' }),
  ])
    assert.equal((await api.verify(req({}, form(file)))).status, 400)
  assert.equal(
    (await api.verify(req({}, form(), { 'content-length': String(6 * 1024 * 1024) }))).status,
    413,
  )
  assert.equal(api.calls.length, 0)
})

test('server receiver aliases take precedence for new payment snapshots and QR', async () => {
  const api = fixture({
    env: {
      BANK_ACCOUNT_NO: '9260337828',
      PROMPTPAY_NO: '0932576114',
      NEXT_PUBLIC_BANK_NAME: 'KTB',
      PAYMENT_BANK_CODE: '006',
    },
  })
  const result = await api.create(req({ tenantId, plan: 'starter' }))
  assert.equal(result.status, 201)
  assert.equal(api.state.session.receiver_account_no, '9260337828')
  assert.equal(api.state.session.receiver_promptpay_id, '0932576114')
  assert.equal(api.state.session.receiver_bank_code, '006')
  assert.equal(result.json.session.qrPayload, 'mock-qr:0932576114:9')
})

test('all four PromptPay env aliases normalize to the same phone and KTB bank snapshot', async () => {
  for (const key of [
    'PROMPTPAY_NO',
    'NEXT_PUBLIC_PROMPTPAY_ID',
    'PROMPTPAY_ID',
    'NEXT_PUBLIC_PROMPTPAY_NO',
  ]) {
    for (const code of ['KTB', '006', '6', '']) {
      const api = fixture({
        env: {
          PROMPTPAY_NO: '',
          NEXT_PUBLIC_PROMPTPAY_ID: '',
          PROMPTPAY_ID: '',
          NEXT_PUBLIC_PROMPTPAY_NO: '',
          [key]: '+66 93-257-6114',
          BANK_ACCOUNT_NO: '9260337828',
          NEXT_PUBLIC_BANK_NAME: 'ธนาคารกรุงไทย',
          PAYMENT_BANK_CODE: code,
        },
      })
      const result = await api.create(req({ tenantId, plan: 'starter' }))
      assert.equal(result.status, 201, `${key}/${code}`)
      assert.equal(api.state.session.receiver_promptpay_id, '0932576114')
      assert.equal(api.state.session.receiver_bank_code, '006')
    }
  }
})

test('unpaid sessions with an outdated receiving account require a new QR', async () => {
  const api = fixture({ session: { receiver_account_no: '9260337828', receiver_bank_code: '006' } })
  const result = await api.get(req(), { params: Promise.resolve({ id: sessionId }) })
  assert.equal(result.json.receiverChanged, true)
  const current = fixture()
  assert.equal(
    (await current.get(req(), { params: Promise.resolve({ id: sessionId }) })).json.receiverChanged,
    false,
  )
})

test('fresh genuine payment uses checkout amount, saves proof and activates only once on retry', async () => {
  const api = fixture()
  const upload = form()
  upload.set('amount', '1')
  upload.set('credits', '999999')
  const result = await api.verify(req({}, upload))
  assert.equal(result.status, 200)
  assert.equal(result.json.success, true)
  assert.equal(result.json.billing.plan, 'starter')
  assert.equal(
    api.calls.filter((call) => call.type === 'slipok')[0].input.expectedAmount,
    undefined,
  )
  assert.equal(api.calls.filter((call) => call.type === 'slipok')[0].input.log, true)
  assert.equal(api.state.receipts[0].amount, 390)
  assert.match(api.state.receipts[0].image_sha256, /^[a-f0-9]{64}$/)
  assert.equal(api.state.activations, 1)
  const retry = await api.verify(req({}, form(null)))
  assert.equal(retry.status, 200)
  assert.equal(api.state.activations, 1)
  assert.equal(api.calls.filter((call) => call.type === 'slipok').length, 1)
})

test('9/19 baht slips mark paid and grant plan credits once; underpayments show both amounts', async () => {
  for (const [plan, price, credits] of [
    ['starter', 9, 1500],
    ['pro', 19, 7500],
  ]) {
    const slip = validSlip()
    slip.amount = price
    slip.raw.data.amount = price
    const api = fixture({ session: { plan, price_baht: price, credits }, slip })
    const result = await api.verify(req())
    assert.equal(result.status, 200)
    assert.equal(api.state.session.status, 'paid')
    assert.equal(result.json.billing.plan, plan)
    assert.equal(result.json.billing.monthly, 200 + credits)
    await api.verify(req({}, form(null)))
    assert.equal(api.state.activations, 1)
    const low = validSlip()
    low.amount = price - 1
    low.raw.data.amount = price - 1
    const denied = fixture({ session: { plan, price_baht: price, credits }, slip: low })
    const response = await denied.verify(req())
    assert.equal(response.status, 422)
    assert.ok(response.json.error.includes(price.toFixed(2)))
    assert.ok(response.json.error.includes((price - 1).toFixed(2)))
    assert.equal(denied.state.session.status, 'pending')
    assert.equal(denied.state.activations, 0)
  }
})

test('duplicate, wrong receiver, missing amount or forged SlipOK success cannot activate credits', async () => {
  for (const slip of [
    { ...validSlip(), verdict: 'duplicate' },
    { ...validSlip(), verdict: 'wrong_receiver', branchReceiverMismatch: true },
    { ...validSlip(), amount: undefined },
    { ...validSlip(), raw: { success: false } },
    { ...validSlip(), amount: 1 },
  ]) {
    const api = fixture({ slip })
    assert.ok((await api.verify(req())).status >= 400)
    assert.equal(api.state.receipts.length, 0)
    assert.equal(api.state.activations, 0)
    assert.equal(api.calls.filter((call) => call.type === 'activate').length, 0)
  }
})

test('QR package checkout rejects overpayment when the amount must match exactly', async () => {
  const slip = validSlip()
  slip.amount = 400
  slip.raw.data.amount = 400
  const api = fixture({ slip })
  const result = await api.verify(req())
  assert.equal(result.status, 422)
  assert.equal(api.state.receipts.length, 0)
  assert.equal(api.state.activations, 0)
  assert.equal(api.state.session.credits, 1500)
})

test('expired unpaid checkout and image already used by another checkout do not call SlipOK', async () => {
  const expired = fixture({ session: { expires_at: '2026-10-14T05:05:00Z' } })
  assert.equal((await expired.verify(req())).status, 410)
  assert.equal(expired.calls.length, 0)
  const hash = createHash('sha256')
    .update(Buffer.from(await jpeg().arrayBuffer()))
    .digest('hex')
  const duplicate = fixture({
    receipts: [{ session_id: '44444444-4444-4444-4444-444444444444', image_sha256: hash }],
  })
  assert.equal((await duplicate.verify(req())).status, 409)
  assert.equal(duplicate.calls.length, 0)
})

test('proof saving failure never activates and tells a payer not to transfer a second time', async () => {
  const api = fixture({ proofSaveError: { code: 'mock-storage-failure' } })
  const result = await api.verify(req())
  assert.equal(result.status, 503)
  assert.match(result.json.error, /ไม่ต้องโอนซ้ำ/)
  assert.equal(api.state.receipts.length, 0)
  assert.equal(api.state.activations, 0)
})

test('activation failure retains trusted proof and retry requires no file or second SlipOK call', async () => {
  const api = fixture({ activationFailures: 1 })
  const failed = await api.verify(req())
  assert.equal(failed.status, 503)
  assert.equal(api.state.receipts.length, 1)
  assert.equal(api.state.activations, 0)
  const retry = await api.verify(req({}, form(null)))
  assert.equal(retry.status, 200)
  assert.equal(api.state.activations, 1)
  assert.equal(api.calls.filter((call) => call.type === 'slipok').length, 1)

  const stored = fixture({
    session: { expires_at: '2026-10-14T05:05:00Z' },
    receipts: [
      {
        session_id: sessionId,
        trans_ref: 'earlier-reference',
        amount: 390,
        paid_at: '2026-10-14T05:04:00Z',
      },
    ],
  })
  assert.equal((await stored.verify(req({}, form(null)))).status, 200)
  assert.equal(stored.calls.filter((call) => call.type === 'slipok').length, 0)
  assert.equal(stored.state.activations, 1)
})

test('an already paid checkout returns current billing without an upload or another verification', async () => {
  const api = fixture({ session: { status: 'paid' } })
  const result = await api.verify(req({}, form(null)))
  assert.equal(result.status, 200)
  assert.equal(result.json.success, true)
  assert.equal(api.calls.length, 0)
  assert.deepEqual(api.billingCalls, [tenantId])
})

test('owner status distinguishes pending, expired, stored verified proof and paid purchases', async () => {
  for (const [session, status, receipts] of [
    [{}, 'pending', []],
    [{ expires_at: '2026-10-14T05:05:00Z' }, 'expired', []],
    [{ expires_at: '2026-10-14T05:05:00Z' }, 'verified', [{ session_id: sessionId }]],
    [{ status: 'paid', expires_at: '2026-10-14T05:05:00Z' }, 'paid', []],
  ]) {
    const api = fixture({ session, receipts })
    const result = await api.get(req(), { params: Promise.resolve({ id: sessionId }) })
    assert.equal(result.status, 200)
    assert.equal(result.json.status, status)
    assert.equal(result.headers['Cache-Control'], 'no-store')
    assert.equal(Object.hasOwn(result.json.session, 'receiver_account_no'), false)
    assert.equal(Object.hasOwn(result.json, 'billing'), status === 'paid')
  }
})
