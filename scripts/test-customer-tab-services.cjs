const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const load = require('./helpers/load-typescript.cjs')
const types = load('lib/features/commerce/customer-tab-types.ts')
const sessionTypes = load('lib/features/commerce/live-session-types.ts')
const banks = load('lib/features/banking/banks.ts')
const receiver = load('lib/features/slips/receiver-matching.ts', {
  '@/lib/features/banking/banks': banks,
})
const timestamps = load('lib/features/payments/payment-pro-core.ts', {}, { Date })
const silent = { info() {}, warn() {}, error() {} }
const tenantId = '11111111-1111-4111-8111-111111111111'
const customerId = '22222222-2222-4222-8222-222222222222'
const tabId = '33333333-3333-4333-8333-333333333333'
test('mixed auction/CF bills label provenance and retain the shared ledger total', () => {
  const bill = tab()
  bill.customer_tab_items = [
    { ...bill.customer_tab_items[0], item_name: 'พระสมเด็จ', amount: 500, order_type: 'auction' },
    {
      ...bill.customer_tab_items[1],
      item_name: 'เหรียญหลวงพ่อทวด',
      amount: 300,
      order_type: 'cf',
      source_code: 'a1',
    },
  ]
  Object.assign(bill, {
    shipping_fee: 50,
    total_amount: 850,
    paid_amount: 200,
    remaining_amount: 650,
  })
  const text = types.customerTabText(bill, 'https://shop.example/bill')
  assert.match(text, /\[ประมูล\] พระสมเด็จ/)
  assert.match(text, /\[CF-A1\] เหรียญหลวงพ่อทวด/)
  assert.match(text, /ยอดรวมสะสม: 850\.00/)
  assert.match(text, /โอนแล้วและตรวจสอบผ่าน: 200\.00/)
  assert.match(text, /ยอดค้างชำระสุทธิที่ต้องโอนเพิ่ม: 650\.00/)
  assert.equal((text.match(/ค่าจัดส่งครั้งเดียว/g) ?? []).length, 1)
  assert.equal(types.customerTabItemLabel({ item_name: 'Legacy' }), 'Legacy')
})
function tab() {
  return {
    id: tabId,
    tenant_id: tenantId,
    customer_id: customerId,
    customer_fb_id: '900',
    page_id: '100',
    live_session_id: 'live',
    bank_account_id: 'bank',
    shipping_fee: 0,
    total_amount: 1000,
    paid_amount: 200,
    remaining_amount: 800,
    credit_amount: 0,
    status: 'pending_payment',
    created_at: new Date(Date.now() - 600000).toISOString(),
    customer_tab_items: [200, 300, 500].map((amount, index) => ({
      order_id: 'order' + index,
      item_name: 'พระ ' + index,
      variant_label: null,
      amount,
      cancelled: false,
      closed_at: new Date().toISOString(),
    })),
    customer_tab_payments: [],
  }
}
function memory(tables) {
  return {
    from(table) {
      const filters = []
      let patch = null
      const finish = () => {
        const rows = (tables[table] ?? []).filter((row) =>
          filters.every((predicate) => predicate(row)),
        )
        if (patch) rows.forEach((row) => Object.assign(row, patch))
        return { data: rows.map((row) => ({ ...row })), error: null }
      }
      const q = {
        select: () => q,
        order: () => q,
        limit: () => q,
        eq(key, value) {
          filters.push((row) => row[key] === value)
          return q
        },
        in(key, values) {
          filters.push((row) => values.includes(row[key]))
          return q
        },
        update(value) {
          patch = value
          return q
        },
        async maybeSingle() {
          const r = finish()
          return { ...r, data: r.data[0] ?? null }
        },
        async single() {
          return q.maybeSingle()
        },
        then(resolve, reject) {
          return Promise.resolve(finish()).then(resolve, reject)
        },
      }
      return q
    },
  }
}

function slipFixture({
  verdict = 'valid',
  wrongReceiver = false,
  missingTime = false,
  providerFault = false,
  saveUncertain = false,
} = {}) {
  const tables = {
    customer_tabs: [tab()],
    customer_tab_slip_attempts: [],
    slips: [],
    bank_accounts: [
      { tenant_id: tenantId, bank_code: 'KBANK', account_number: '1234567890', is_active: true },
    ],
  }
  const calls = { provider: [], credit: 0, refund: 0, saves: [], uploads: 0 }
  const db = memory(tables)
  db.storage = {
    from: () => ({
      async upload() {
        calls.uploads++
        return { error: null }
      },
      async remove() {
        return { error: null }
      },
    }),
  }
  db.rpc = async (name, input) => {
    if (name === 'claim_customer_tab_slip') {
      const id = randomUUID()
      tables.slips.push({
        id,
        tenant_id: tenantId,
        customer_id: customerId,
        customer_tab_id: tabId,
        image_path: input.p_image,
        status: 'pending',
      })
      tables.customer_tab_slip_attempts.push({
        slip_id: id,
        tenant_id: tenantId,
        image_sha256: input.p_hash,
      })
      return { data: { claimed: true, slipId: id, imagePath: input.p_image }, error: null }
    }
    if (name === 'consume_slip_credit') {
      calls.credit++
      return { data: true, error: null }
    }
    if (name === 'refund_slip_credit') {
      calls.refund++
      return { data: true, error: null }
    }
    if (name === 'complete_customer_tab_slip') {
      calls.saves.push(input)
      const s = tables.slips.find((s) => s.id === input.p_slip)
      if (s.status === 'pending') {
        Object.assign(s, {
          status: input.p_verdict,
          amount: input.p_amount,
          trans_ref: input.p_ref,
          note: input.p_note,
        })
        if (input.p_verdict === 'valid') {
          tables.customer_tabs[0].paid_amount += input.p_amount
          tables.customer_tabs[0].remaining_amount -= input.p_amount
        }
      }
      if (saveUncertain) return { data: null, error: { code: 'NETWORK_RESPONSE_LOST' } }
      const t = tables.customer_tabs[0]
      return {
        data: {
          tabId,
          totalAmount: t.total_amount,
          paidAmount: t.paid_amount,
          remainingAmount: t.remaining_amount,
          status: t.status,
        },
        error: null,
      }
    }
    throw new Error('Unexpected RPC ' + name)
  }
  const service = load(
    'lib/features/slips/customer-tab-slip.ts',
    {
      'server-only': {},
      'node:crypto': require('node:crypto'),
      './receiver-matching': receiver,
      '@/lib/features/payments/payment-pro-core': timestamps,
      './slipok': {
        verifyWithSlipOK: async (input) => {
          calls.provider.push(input)
          return {
            verdict,
            amount: 250,
            transRef: 'TRANSFER-123',
            receiverBank: '004',
            receiverAccount: wrongReceiver ? '9999999999' : '1234567890',
            providerFault,
            raw: missingTime ? {} : { data: { transTimestamp: new Date().toISOString() } },
          }
        },
      },
    },
    { Buffer, crypto: { randomUUID }, Date, console: silent },
  )
  const input = {
    file: new File([new Uint8Array([255, 216, 255])], 'slip.jpg', { type: 'image/jpeg' }),
    customerId,
    tenant: { id: tenantId, account_number: '1234567890', bank_code: 'KBANK' },
  }
  return { calls, tables, run: () => service.processCustomerTabSlip(db, input, [tabId]) }
}
test('tab SlipOK path omits a full-amount constraint, accepts partials, and replays an image without another provider charge', async () => {
  const f = slipFixture()
  const first = await f.run()
  assert.equal(first.status, 'valid')
  assert.equal(first.tabBalance.remainingAmount, 550)
  assert.equal(first.tabBalance.paidAmount, 450)
  assert.equal(f.calls.provider[0].expectedAmount, undefined)
  const second = await f.run()
  assert.equal(second.status, 'valid')
  assert.equal(second.tabBalance.remainingAmount, 550)
  assert.equal(f.calls.provider.length, 1)
  assert.equal(f.calls.credit, 1)
})
test('wrong receivers, missing provider timestamps, fake/duplicate slips and outages never reduce the balance', async () => {
  for (const options of [
    { wrongReceiver: true },
    { missingTime: true },
    { verdict: 'fake' },
    { verdict: 'duplicate' },
    { verdict: 'error', providerFault: true },
  ]) {
    const f = slipFixture(options)
    const result = await f.run()
    assert.notEqual(result.status, 'valid')
    assert.equal(f.tables.customer_tabs[0].paid_amount, 200)
    assert.equal(f.tables.customer_tabs[0].remaining_amount, 800)
    assert.equal(f.calls.saves[0].p_verdict === 'valid', false)
    if (options.providerFault) assert.equal(f.calls.refund, 1)
  }
})
test('a lost database response cannot downgrade or re-credit a committed valid transfer', async () => {
  const f = slipFixture({ saveUncertain: true })
  const result = await f.run()
  assert.equal(result.status, 'valid')
  assert.equal(result.tabBalance.remainingAmount, 550)
  assert.equal(f.calls.provider.length, 1)
})

function reminderFixture({
  windowClosed = false,
  payDuringAI = false,
  providerFails = false,
  greeting = 'ขออนุญาตแจ้งยอดค้างครับ',
  paused = false,
  optedOut = false,
  killSwitch = false,
  template = null,
} = {}) {
  const bill = tab()
  const job = {
    id: randomUUID(),
    tab_id: tabId,
    claim_token: 'claim',
    status: 'pending',
    message_template: template,
  }
  const tables = {
    customers: [
      {
        id: customerId,
        tenant_id: tenantId,
        platform_user_id: '900',
        bot_enabled: !paused,
        agent_opted_out: optedOut,
      },
    ],
    tenants: [
      {
        id: tenantId,
        page_id: '100',
        page_access_token: 'TEST_TOKEN',
        is_active: true,
        auto_reply_enabled: true,
      },
    ],
    customer_tab_reminders: [job],
    agent_ai_usage: [{ id: 'usage', tenant_id: tenantId }],
  }
  const db = memory(tables)
  let reads = 0
  const calls = { sends: [], policy: [], ai: 0 }
  db.rpc = async (name) => {
    if (name === 'claim_customer_tab_reminder') {
      if (job.status !== 'pending') return { data: [], error: null }
      job.status = 'processing'
      return { data: [{ ...job }], error: null }
    }
    if (name === 'start_agent_ai_call') return { data: { id: 'usage' }, error: null }
    throw new Error(name)
  }
  const service = load(
    'lib/features/commerce/customer-tab-reminders.ts',
    {
      'server-only': {},
      '@google/genai': {
        GoogleGenAI: class {
          constructor() {
            this.models = {
              generateContent: async () => {
                calls.ai++
                return { text: JSON.stringify({ greeting }), usageMetadata: {} }
              },
            }
          }
        },
      },
      '@/lib/features/agents/ai-agent': { aiModel: () => 'test-model' },
      '@/lib/feature-access': { hasFeature: async () => true },
      '@/lib/integrations/facebook/client': { pageTokenFor: (row) => row.page_access_token },
      '@/lib/features/inbox/inbox-policy-server': {
        assertInboxPolicy: async (...args) => {
          calls.policy.push(args)
          if (windowClosed) throw { code: 'MESSAGING_WINDOW_CLOSED' }
        },
      },
      '@/lib/features/slips/notify': {
        deliverRichOnce: async (...args) => {
          calls.sends.push(args)
          if (providerFails) throw new Error('transport uncertain')
          return true
        },
      },
      './customer-tabs-server': {
        loadCustomerTab: async () => {
          reads++
          if (payDuringAI && reads === 2) {
            bill.remaining_amount = 0
            bill.paid_amount = 1000
          }
          return bill
        },
        customerTabSummary: async (_db, t, intro) => ({
          text: types.customerTabText(
            t,
            'https://shop.example/pay/live/signed',
            'KBANK 1234567890',
            intro,
          ),
          link: 'https://shop.example/pay/live/signed',
        }),
      },
      './customer-tab-types': types,
      './live-session-types': sessionTypes,
    },
    {
      Date,
      console: silent,
      process: {
        env: {
          GEMINI_API_KEY: 'TEST_KEY',
          AGENT_CONTROL_KILL_SWITCH: killSwitch ? 'true' : 'false',
        },
      },
    },
  )
  return { calls, job, run: () => service.runCustomerTabReminders(db) }
}
test('AI reminders append authoritative items and net balance, reject invented model amounts, and include a payment button', async () => {
  const f = reminderFixture({ greeting: 'โอนด่วน 999999 บาท https://evil.example' })
  const result = await f.run()
  assert.equal(result.sent, 1)
  assert.equal(f.calls.ai, 1)
  const body = f.calls.sends[0][3]
  assert.match(body, /1,000\.00/)
  assert.match(body, /200\.00/)
  assert.match(body, /800\.00/)
  assert.ok(!body.includes('999999'))
  assert.ok(!body.includes('evil.example'))
  const parts = f.calls.sends[0][4]
  assert.equal(
    parts.at(-1).attachment.payload.buttons[0].url,
    'https://shop.example/pay/live/signed',
  )
  assert.equal(f.calls.policy[0].at(-1), false)
  await f.run()
  assert.equal(f.calls.sends.length, 1)
})
test('session reminders render custom variables from current balances and always append the verified bill/account', async () => {
  const f = reminderFixture({
    template: 'คุณ {name} ค้าง {short} บาท / {due} / จ่ายแล้ว {paid}\n{items}',
  })
  assert.equal((await f.run()).sent, 1)
  assert.equal(f.calls.ai, 0)
  const body = f.calls.sends[0][3]
  assert.match(body, /ค้าง 800\.00/)
  assert.match(body, /200\.00 \+ 300\.00 \+ 500\.00 = 1,000\.00/)
  assert.match(body, /KBANK 1234567890/)
  assert.match(body, /https:\/\/shop.example\/pay\/live\/signed/)
  const invalid = reminderFixture({ template: '{invented_total}' })
  assert.equal((await invalid.run()).blocked, 1)
  assert.equal(invalid.calls.sends.length, 0)
})

test('reminders respect paused conversations/24-hour policy and recheck payment after AI generation', async () => {
  for (const options of [{ windowClosed: true }, { paused: true }, { payDuringAI: true }]) {
    const f = reminderFixture(options)
    await f.run()
    assert.equal(f.calls.sends.length, 0)
    assert.equal(f.job.status, options.payDuringAI ? 'cancelled' : 'blocked')
  }
})
test('an uncertain reminder send stays reviewable and cannot be automatically dispatched again', async () => {
  const f = reminderFixture({ providerFails: true })
  const result = await f.run()
  assert.equal(result.review, 1)
  assert.equal(f.job.status, 'requires_review')
  await f.run()
  assert.equal(f.calls.sends.length, 1)
})

test('global agent shutdown and customer opt-outs prevent automatic debt messages', async () => {
  const stopped = reminderFixture({ killSwitch: true })
  await stopped.run()
  assert.equal(stopped.calls.sends.length, 0)
  assert.equal(stopped.calls.ai, 0)
  assert.equal(stopped.job.status, 'pending')
  const opted = reminderFixture({ optedOut: true })
  await opted.run()
  assert.equal(opted.calls.sends.length, 0)
  assert.equal(opted.job.status, 'blocked')
})

test('signed tab loading exposes variant-selection links and compact private bills keep full details in the linked bill', async () => {
  const bill = tab()
  bill.customer_tab_items = Array.from({ length: 30 }, (_, index) => ({
    order_id: `order-${index}`,
    item_name: 'พระเครื่องรายการ ' + index + ' รายละเอียดรุ่น '.repeat(12),
    variant_label: null,
    amount: 200,
    closed_at: new Date().toISOString(),
    cancelled: false,
  }))
  const tables = {
    customer_tabs: [bill],
    orders: bill.customer_tab_items.map((item, index) => ({
      id: item.order_id,
      customer_tab_id: tabId,
      tenant_id: tenantId,
      live_variant_selection_required: index === 0,
      live_variant_confirmed_at: null,
    })),
    bank_accounts: [
      {
        id: 'bank',
        tenant_id: tenantId,
        bank_code: 'KBANK',
        account_name: 'Shop',
        account_number: '1234567890',
        is_active: true,
      },
    ],
  }
  const service = load('lib/features/commerce/customer-tabs-server.ts', {
    'server-only': {},
    './customer-tab-types': types,
    './live-cf-payment-link': {
      createLiveCfPaymentLink: (id) => 'https://shop.example/pay/live/' + id,
    },
    '@/lib/features/banking/banks': banks,
  })
  const loaded = await service.loadCustomerTab(memory(tables), tabId, tenantId)
  assert.equal(loaded.customer_tab_items[0].requires_variant, true)
  assert.match(loaded.customer_tab_items[0].selection_link, /order-0$/)
  const summary = await service.customerTabSummary(memory(tables), loaded)
  assert.ok(summary.text.length > 2000)
  assert.ok(summary.privateText.length < 1900)
  assert.match(summary.privateText, /800/)
  assert.ok(summary.text.includes('29'))
})

test('end-live and bulk-reminder actions require owner access even when a customer ID is supplied', async () => {
  const { NextRequest, NextResponse } = require('next/server')
  class InboxError extends Error {
    constructor(message, status = 400) {
      super(message)
      this.status = status
    }
  }
  const calls = []
  const route = load(
    'app/api/customer-tabs/route.ts',
    {
      'next/server': { NextResponse, after() {} },
      '@/lib/auth': { canAccessTenant: async () => false },
      '@/lib/features/inbox/inbox-server': {
        InboxError,
        inboxError: (error) =>
          NextResponse.json({ error: error.message }, { status: error.status || 503 }),
        inboxCustomer: async () => ({
          db: {
            rpc: async (name, args) => {
              calls.push({ name, args })
              return { data: 1, error: null }
            },
          },
          tenantId,
          actor: { id: 'member', kind: 'user' },
        }),
        inboxTenant: async () => {
          throw new Error('Unexpected tenant scope')
        },
      },
      '@/lib/features/commerce/customer-tabs-server': {},
      '@/lib/features/commerce/customer-tab-reminders': {},
      '@/lib/utils': { UUID: /^[a-f0-9-]{36}$/ },
    },
    { console: silent },
  )
  const request = (action) =>
    new NextRequest('https://shop.example/api/customer-tabs', {
      method: 'POST',
      headers: { origin: 'https://shop.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        customerId,
        tenantId,
        requestId: randomUUID(),
        livePostId: '456',
      }),
    })
  for (const action of ['end_live', 'remind_all'])
    assert.equal((await route.POST(request(action))).status, 403)
  assert.equal(calls.length, 0)
  assert.equal((await route.POST(request('remind'))).status, 200)
  assert.equal(calls[0].args.p_customer, customerId)
  assert.equal(calls[0].args.p_tenant, tenantId)
})
