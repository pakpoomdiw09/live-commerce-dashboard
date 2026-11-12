import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const load = require('../scripts/helpers/load-typescript.cjs')
const core = load('lib/features/payments/payment-pro-core.ts')
const timestamps = load('lib/features/slips/slip-timestamp.ts', {
  'server-only': {},
  '@/lib/features/payments/payment-pro-core': core,
})
const banks = load('lib/features/banking/banks.ts')
const matching = load('lib/features/slips/receiver-matching.ts', {
  '@/lib/features/banking/banks': banks,
})
const ordersApi = load('lib/features/commerce/orders.ts', {
  'server-only': {},
  '@/lib/features/banking/banks': banks,
  '@/lib/features/commerce/cf-code': {},
})

const createdAt = '2026-11-01T03:00:00.000Z'
const rejection = 'สลิปนี้ทำรายการก่อนสร้างออเดอร์ ไม่สามารถใช้ชำระเงินได้'
type Order = {
  id: string
  tenant_id: string
  customer_id: string
  status: string
  amount: number
  created_at: string | null
}
const order = (patch: Partial<Order> = {}): Order => ({
  id: 'order-1',
  tenant_id: 'shop',
  customer_id: 'buyer',
  status: 'pending_payment',
  amount: 159,
  created_at: createdAt,
  ...patch,
})

function fixture(
  options: {
    raw?: unknown
    rows?: Order[]
    verdict?: string
    timestampQueryError?: boolean
    orderDisappears?: boolean
  } = {},
) {
  const rows = options.rows ?? [order()]
  const mutations: { table: string; value: Record<string, unknown> }[] = []
  const timestampFilters: [string, unknown][] = []
  let providerCalls = 0
  const db = {
    rpc: async () => ({ data: true, error: null }),
    from(table: string) {
      let columns = ''
      let operation = 'select'
      const filters: [string, unknown][] = []
      const query = {
        select(value: string) {
          columns = value
          return this
        },
        insert() {
          operation = 'insert'
          return this
        },
        update(value: Record<string, unknown>) {
          operation = 'update'
          mutations.push({ table, value })
          return this
        },
        eq(key: string, value: unknown) {
          filters.push([key, value])
          return this
        },
        in(key: string, value: unknown[]) {
          filters.push([key, value])
          return this
        },
        single: async () => ({ data: { id: 'slip-1' }, error: null }),
        then(resolve: (value: object) => unknown, reject: (reason: unknown) => unknown) {
          const timestampQuery = table === 'orders' && columns.includes('created_at')
          if (timestampQuery) timestampFilters.push(...filters)
          let data: Record<string, unknown>[] =
            table === 'bank_accounts'
              ? [
                  {
                    tenant_id: 'shop',
                    bank_code: 'KBANK',
                    account_number: '1234567890',
                    is_active: true,
                  },
                ]
              : table === 'orders'
                ? rows
                : []
          if (operation === 'select')
            data = data.filter((row) =>
              filters.every(([key, value]) =>
                Array.isArray(value) ? value.includes(row[key]) : value === row[key],
              ),
            )
          if (timestampQuery && options.orderDisappears) data = []
          return Promise.resolve({
            data,
            error: timestampQuery && options.timestampQueryError ? { code: 'DB_DOWN' } : null,
          }).then(resolve, reject)
        },
      }
      return query
    },
  }
  const api = load(
    'lib/features/slips/process.ts',
    {
      'server-only': {},
      '@/lib/feature-access': { requireFeature: async () => {} },
      '@/lib/features/commerce/orders': ordersApi,
      '@/lib/features/slips/receiver-matching': matching,
      '@/lib/features/slips/slip-timestamp': timestamps,
      '@/lib/features/payments/payment-validation': { isPaymentImage: () => true },
      '@/lib/features/slips/verification': {
        verifySlip: async ({ expectedAmount }: { expectedAmount: number }) => {
          providerCalls++
          return {
            verdict: options.verdict ?? 'valid',
            amount: expectedAmount,
            transRef: 'provider-ref',
            receiverBank: '004',
            receiverAccount: '1234567890',
            raw: options.raw,
          }
        },
      },
    },
    { process: { env: { NODE_ENV: 'production' } }, console: { error() {}, info() {} } },
  )
  return {
    mutations,
    timestampFilters,
    get providerCalls() {
      return providerCalls
    },
    run: () =>
      api.processSlip(db, { qr: 'provider-proof', customerId: 'buyer', tenant: { id: 'shop' } }),
  }
}

function assertNoPaymentWrites(f: ReturnType<typeof fixture>) {
  assert.equal(
    f.mutations.some(
      ({ table, value }) =>
        (table === 'orders' && value.status === 'paid') ||
        (table === 'customers' && value.order_status === 'paid') ||
        (table === 'slips' && value.status === 'valid'),
    ),
    false,
  )
}

test('legacy slip timestamps allow transfers after creation and at the 60-second drift boundary', async () => {
  for (const offset of [1000, 0, -59_999, -60_000]) {
    const f = fixture({
      raw: { data: { transTimestamp: new Date(Date.parse(createdAt) + offset).toISOString() } },
    })
    const result = await f.run()
    assert.equal(result.status, 'valid', `offset=${offset}`)
    assert.ok(f.mutations.some(({ table, value }) => table === 'orders' && value.status === 'paid'))
  }
})

test('slips older than an order by more than 60 seconds throw the explicit error before any paid/valid write', async () => {
  for (const offset of [-60_001, -3_600_000]) {
    const f = fixture({
      raw: { data: { transTimestamp: new Date(Date.parse(createdAt) + offset).toISOString() } },
    })
    await assert.rejects(f.run(), (error: unknown) => {
      const failure = error as Error & { code: string }
      return failure.message === rejection && failure.code === 'SLIP_TIMESTAMP_REJECTED'
    })
    assertNoPaymentWrites(f)
    assert.ok(
      f.mutations.some(
        ({ table, value }) =>
          table === 'slips' && value.status === 'error' && value.note === rejection,
      ),
    )
    assert.equal(f.providerCalls, 1)
  }
})

test('every order in a combined payment must be created no later than provider time plus 60 seconds', async () => {
  const f = fixture({
    rows: [order(), order({ id: 'order-2', created_at: '2026-11-01T03:05:00.000Z' })],
    raw: { data: { transTimestamp: createdAt } },
  })
  await assert.rejects(f.run(), { message: rejection })
  assertNoPaymentWrites(f)
})

test('SlipOK transDate/transTime uses Bangkok time; ISO timestamps with timezone offsets are equivalent', async () => {
  for (const data of [
    { transDate: '20261101', transTime: '10:00:00' },
    { transTimestamp: '2026-11-01T10:00:00+07:00' },
  ]) {
    assert.equal((await fixture({ raw: { data } }).run()).status, 'valid')
  }
})

test('missing/invalid provider or order timestamps fail closed without accepting payment', async () => {
  for (const f of [
    fixture(),
    fixture({ raw: { data: { transTimestamp: 'invalid' } } }),
    fixture({ raw: { data: { transTimestamp: createdAt } }, rows: [order({ created_at: null })] }),
    fixture({
      raw: { data: { transTimestamp: createdAt } },
      rows: [order({ created_at: 'invalid' })],
    }),
    fixture({ raw: { data: { transTimestamp: createdAt } }, orderDisappears: true }),
  ]) {
    await assert.rejects(
      f.run(),
      (error: unknown) => (error as { code: string }).code === 'SLIP_TIMESTAMP_REJECTED',
    )
    assertNoPaymentWrites(f)
  }
  const unavailable = fixture({
    raw: { data: { transTimestamp: createdAt } },
    timestampQueryError: true,
  })
  assert.equal((await unavailable.run()).status, 'error')
  assertNoPaymentWrites(unavailable)
})

test('order timestamp queries are scoped to the tenant/customer and selected pending orders', async () => {
  const f = fixture({
    raw: { data: { transTimestamp: createdAt } },
    rows: [
      order(),
      order({
        id: 'other-shop-order',
        tenant_id: 'other-shop',
        created_at: '2099-01-01T00:00:00Z',
      }),
      order({
        id: 'other-buyer-order',
        customer_id: 'other-buyer',
        created_at: '2099-01-01T00:00:00Z',
      }),
      order({ id: 'already-paid', status: 'paid', created_at: '2099-01-01T00:00:00Z' }),
    ],
  })
  assert.equal((await f.run()).status, 'valid')
  for (const [key, value] of [
    ['tenant_id', 'shop'],
    ['customer_id', 'buyer'],
    ['status', 'pending_payment'],
  ]) {
    assert.ok(f.timestampFilters.some(([k, v]) => k === key && v === value))
  }
  assert.deepEqual(Array.from(f.timestampFilters.find(([k]) => k === 'id')![1] as string[]), [
    'order-1',
  ])
})

test('a provider-rejected slip keeps its original verdict and cannot pay an order', async () => {
  const f = fixture({ verdict: 'fake' })
  assert.equal((await f.run()).status, 'fake')
  assertNoPaymentWrites(f)
  assert.equal(f.timestampFilters.length, 0)
})

test('manual verification exposes timestamp rejection as HTTP 400 with the exact message', async () => {
  const tenantId = '11111111-1111-4111-8111-111111111111'
  const form = new FormData()
  form.set('qr', 'provider-proof')
  form.set('tenantId', tenantId)
  const route = load(
    'app/api/slips/verify/route.ts',
    {
      '@/lib/feature-access': {
        hasSlipAccess: async () => true,
        FeatureLockedError: class extends Error {},
      },
      'next/server': {
        NextResponse: {
          json: (body: unknown, init?: { status?: number }) => ({
            body,
            status: init?.status ?? 200,
          }),
        },
      },
      '@/lib/supabase/server': {
        supabaseAdmin: () => ({
          from: () => {
            const query = {
              select() {
                return this
              },
              eq() {
                return this
              },
              maybeSingle: async () => ({ data: { id: tenantId }, error: null }),
            }
            return query
          },
        }),
      },
      '@/lib/auth': {
        getActor: async () => ({ kind: 'user', id: 'staff' }),
        canAccessTenant: async () => true,
        isPlatformAdmin: () => false,
      },
      '@/lib/features/slips/process': {
        SlipTimestampError: timestamps.SlipTimestampError,
        processSlip: async () => {
          throw new timestamps.SlipTimestampError(rejection)
        },
      },
      '@/lib/features/slips/notify': {
        notifyVerifiedSlipForCustomer: () => {
          throw new Error('Rejected slips must not send payment confirmations')
        },
      },
      '@/lib/utils': { UUID: /^[0-9a-f-]{36}$/ },
      '@/lib/upload-security': {
        acquireUploadSlot: () => () => {},
        readUploadForm: async () => form,
        UploadError: class extends Error {},
        UPLOAD_FILE_BYTES: 5 * 1024 * 1024,
      },
    },
    { File },
  )
  const response = await route.POST({})
  assert.equal(response.status, 400)
  assert.equal(response.body.error, rejection)
})
