const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function load(file, dependencies, globals = {}) {
  const context = {
    exports: {},
    process: { env: {} },
    console: { error() {}, warn() {}, info() {} },
    AbortSignal,
    require(name) {
      if (name === 'server-only') return {}
      if (name === '@/lib/features/commerce/comment-config')
        return require('./helpers/load-typescript.cjs')('lib/features/commerce/comment-config.ts')
      if (name === '@/lib/safe-logging')
        return require('./helpers/load-safe-logging.cjs')({ info() {}, warn() {}, error() {} })
      if (Object.hasOwn(dependencies, name)) return dependencies[name]
      throw new Error('Unexpected dependency: ' + name)
    },
    ...globals,
  }
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    context,
  )
  return context.exports
}

function fixture({
  rejectCard = false,
  rejectText = false,
  handover = false,
  networkError = false,
  expired = false,
  safetyEnabled = false,
  safetyStopped = false,
  pageName = 'Actual Facebook Page',
  templates = {},
  settingsError = null,
} = {}) {
  const requests = []
  const confirms = []
  const rpcCalls = []
  const rows = []
  const statuses = []
  const logs = []
  const claims = new Set()
  let credits = 0,
    windowChecks = 0,
    safetyChecks = 0
  let activeTenant = 'tenant-a'
  const client = load(
    'lib/integrations/facebook/client.ts',
    {},
    {
      process: {
        env: {
          FB_GRAPH_VERSION: 'v24.0',
          FB_PAGE_ID: 'page-shared',
          FB_PAGE_TOKEN: 'mock-shared-token',
        },
      },
      fetch: async (url, options) => {
        const body = JSON.parse(options.body)
        requests.push({ url, headers: options.headers, body })
        if (networkError) throw new Error('mock network timeout')
        if (rejectCard && body.message.attachment)
          return Response.json(
            { error: { code: 100, message: 'Template rejected' } },
            { status: 400 },
          )
        if (rejectText && body.message.text)
          return Response.json(
            { error: { code: 10, error_subcode: 2018278, message: 'Sending rejected' } },
            { status: 400 },
          )
        return Response.json({ message_id: 'mid-' + requests.length })
      },
    },
  )
  const notify = load(
    'lib/features/slips/notify.ts',
    {
      ...require('./helpers/slip-confirmation-dependencies.cjs'),
      '@/lib/integrations/facebook/client': client,
      '@/lib/message-quota': {
        sendWithMessageCredit: async (_db, tenantId, send) => {
          assert.equal(tenantId, activeTenant)
          credits++
          return send()
        },
      },
      '@/lib/features/inbox/inbox-automation-window': {
        assertAutomationWindow: async () => {
          windowChecks++
          if (expired)
            throw Object.assign(new Error('Window closed'), { code: 'MESSAGING_WINDOW_CLOSED' })
        },
      },
      '@/lib/automation-safety': {
        assertAutomationRunning: async () => {
          safetyChecks++
          if (safetyStopped)
            throw Object.assign(new Error('Stopped'), { code: 'AUTOMATION_STOPPED' })
        },
      },
    },
    {
      process: { env: { SNAPBOT_SAFETY_ENABLED: safetyEnabled ? 'true' : 'false' } },
      console: {
        error: (...args) => logs.push(args),
        info: (...args) => logs.push(args),
        warn() {},
      },
    },
  )
  const db = {
    rpc: async (name) => {
      rpcCalls.push(name)
      if (name === 'start_inbox_delivery' && handover)
        return { data: null, error: { code: '40001' } }
      return { data: 'lease', error: null }
    },
    from(table) {
      let inserted
      const filters = {}
      const q = {
        select() {
          return q
        },
        insert(value) {
          inserted = value
          return q
        },
        update(values) {
          if (table === 'slips') confirms.push(values)
          if (table === 'messages') statuses.push(values.delivery_status)
          return q
        },
        eq(key, value) {
          filters[key] = value
          return q
        },
        single: async () => {
          if (table === 'messages' && inserted) {
            if (claims.has(inserted.external_id)) return { error: { code: '23505' } }
            claims.add(inserted.external_id)
            rows.push(inserted)
            return { data: { id: 'message-' + rows.length }, error: null }
          }
          return { data: { tenant_id: activeTenant }, error: null }
        },
        maybeSingle: async () => ({
          data:
            table === 'slip_settings'
              ? { slip_confirmation_template: templates[filters.tenant_id] ?? null }
              : table === 'customers'
                ? {
                    id: 'customer-uuid',
                    tenant_id: activeTenant,
                    platform: 'facebook',
                    platform_user_id: '123456789',
                  }
                : {
                    name: 'Test shop',
                    page_name: pageName,
                    page_id: '11111',
                    page_access_token: 'mock-token-a',
                  },
          error: table === 'slip_settings' ? settingsError : null,
        }),
        then(resolve, reject) {
          return Promise.resolve({ data: null, error: null }).then(resolve, reject)
        },
      }
      return q
    },
  }
  return {
    client,
    notify,
    db,
    requests,
    confirms,
    rows,
    rpcCalls,
    statuses,
    logs,
    metrics: () => ({ credits, windowChecks, safetyChecks }),
    tenant: (id) => {
      activeTenant = id
    },
  }
}

function expectedReceipt(pageName, amount) {
  return `✅ ชำระเงินสำเร็จ · ${pageName}\nทางร้านได้รับยอดชำระเงินเรียบร้อยแล้วครับ จำนวน ${amount} บาท 💸✨\nขอขอบพระคุณที่ไว้วางใจครับผม 🙏📦 ทางร้านจะรีบดำเนินการจัดส่งสินค้าให้โดยเร็วที่สุดครับ 🚚💨`
}

test('plain-text receipts use each Page token/PSID and exactly match the stored chat body', async () => {
  const f = fixture()
  for (const [tenant, page, psid, token, pageName] of [
    ['tenant-a', '11111', '123456789', 'mock-token-a', 'เพจ เอ'],
    ['tenant-b', '22222', '987654321', 'mock-token-b', 'เพจ บี'],
  ]) {
    f.tenant(tenant)
    await f.notify.notifySlipResult(
      f.db,
      { id: 'slip-' + tenant, status: 'valid', amount: 123.45, transRef: 'mock-transfer' },
      {
        id: 'customer-uuid-' + tenant,
        psid,
        token: f.client.pageTokenFor({ page_id: page, page_access_token: token }),
      },
      pageName,
    )
    const request = f.requests.at(-1)
    assert.equal(request.url, 'https://graph.facebook.com/v24.0/me/messages')
    assert.equal(request.headers.Authorization, 'Bearer ' + token)
    assert.equal(request.body.recipient.id, psid)
    assert.equal(request.body.messaging_type, 'RESPONSE')
    assert.equal(Object.hasOwn(request.body, 'tag'), false)
    assert.deepEqual(request.body.message, {
      text: expectedReceipt(pageName, '123.45'),
      metadata: `snapbot:slip-confirm:slip-${tenant}`,
    })
    assert.equal(f.rows.at(-1).body, request.body.message.text)
    assert.equal(request.body.message.text.includes('mock-transfer'), false)
    assert.equal(request.body.message.text.includes('อ้างอิง'), false)
  }
  assert.equal(f.confirms.length, 2)
})

test('slip confirmations send one plain-text message and never attempt a payment template', async () => {
  const f = fixture({ rejectCard: true, handover: true })
  await f.notify.notifySlipResult(
    f.db,
    { id: 'slip-test', status: 'valid', amount: 250, transRef: 'mock-transfer' },
    { id: 'customer-uuid', psid: '123456789', token: 'mock-token-a' },
  )
  assert.equal(f.requests.length, 1)
  const text = f.requests[0].body
  assert.equal(text.recipient.id, '123456789')
  assert.equal(text.messaging_type, 'RESPONSE')
  assert.ok(text.message.text.includes('250.00'))
  assert.equal(Object.hasOwn(text.message, 'attachment'), false)
  assert.equal(f.rows[0].body, text.message.text)
  assert.equal(Object.hasOwn(text, 'tag'), false)
  assert.equal(f.confirms.length, 1)
})

const verifiedSlip = {
  id: 'verified-slip',
  status: 'valid',
  amount: 250,
  transRef: 'mock-transfer',
}
const recipient = { id: 'customer-uuid', psid: '123456789', token: 'mock-token-a' }

test('tenant templates apply immediately to automatic/manual receipts and match stored text during takeover', async () => {
  const templates = {
    'tenant-a': 'เพจ {pageName}\nรับยอด {amount} บาท ขอบคุณครับ',
    'tenant-b': 'B: {amount}',
  }
  const f = fixture({ handover: true, templates })
  await f.notify.notifySlipResult(f.db, { ...verifiedSlip, amount: 1 }, recipient, 'เพจ เอ')
  assert.equal(f.requests[0].body.message.text, 'เพจ เพจ เอ\nรับยอด 1.00 บาท ขอบคุณครับ')
  templates['tenant-a'] = 'แก้ไขแล้ว {amount} / {pageName}'
  await f.notify.sendSlipConfirmation(
    f.db,
    { id: 'manual-new', amount: 2, trans_ref: null },
    recipient,
    'เพจ เอ',
  )
  assert.equal(f.requests[1].body.message.text, 'แก้ไขแล้ว 2.00 / เพจ เอ')
  f.tenant('tenant-b')
  await f.notify.notifySlipResult(f.db, { ...verifiedSlip, id: 'slip-b' }, recipient, 'เพจ บี')
  assert.equal(f.requests[2].body.message.text, 'B: 250.00')
  for (let i = 0; i < f.requests.length; i++) {
    assert.equal(f.rows[i].body, f.requests[i].body.message.text)
    assert.equal(f.requests[i].body.recipient.id, recipient.psid)
    assert.equal(f.requests[i].body.messaging_type, 'RESPONSE')
  }
  assert.deepEqual(f.rpcCalls, [])
})

test('missing migration retains default receipts; other lookup failures never send a wrong template', async () => {
  const missing = fixture({ settingsError: { code: '42P01' } })
  await missing.notify.notifySlipResult(missing.db, verifiedSlip, recipient)
  assert.equal(missing.requests[0].body.message.text, expectedReceipt('ร้านค้า', '250.00'))
  const failure = fixture({ settingsError: { code: '57014' } })
  await assert.rejects(
    failure.notify.notifySlipResult(failure.db, verifiedSlip, recipient),
    /TEMPLATE_LOOKUP_FAILED/,
  )
  assert.equal(failure.requests.length, 0)
  assert.equal(failure.rows.length, 0)
})

test('verified receipts bypass takeover without resuming the bot, and deduplicate automatic/manual confirmation', async () => {
  const f = fixture({ handover: true, safetyEnabled: true })
  await f.notify.notifySlipResult(f.db, verifiedSlip, recipient)
  await f.notify.notifySlipResult(f.db, verifiedSlip, recipient)
  const sentAgain = await f.notify.sendSlipConfirmation(
    f.db,
    { id: verifiedSlip.id, amount: verifiedSlip.amount, trans_ref: verifiedSlip.transRef },
    recipient,
  )
  assert.equal(sentAgain, false)
  assert.equal(f.requests.length, 1)
  assert.equal(f.requests[0].body.recipient.id, recipient.psid)
  assert.equal(f.requests[0].body.messaging_type, 'RESPONSE')
  assert.equal(f.rows[0].external_id, 'slip-confirm:' + verifiedSlip.id)
  assert.deepEqual(f.rpcCalls, [], 'no takeover, bot-resume, or delivery-lease RPC is called')
  assert.equal(f.metrics().credits, 1)
  assert.equal(f.metrics().windowChecks, 1)
  assert.equal(f.metrics().safetyChecks, 1)
  assert.deepEqual(f.statuses, ['sent'])
  assert.equal(f.confirms.length, 1)
})

test('unverified verdicts are silent and ordinary bot replies remain blocked during takeover', async () => {
  for (const status of ['fake', 'duplicate', 'wrong_receiver', 'amount_mismatch', 'error']) {
    for (const handover of [false, true]) {
      const f = fixture({ handover })
      assert.equal(
        await f.notify.notifySlipResult(f.db, { ...verifiedSlip, status }, recipient),
        false,
      )
      assert.equal(f.requests.length, 0)
      assert.equal(f.rows.length, 0)
      assert.equal(f.metrics().credits, 0)
    }
  }
  const f = fixture({ handover: true })
  await assert.rejects(
    f.notify.deliverOnce(f.db, recipient, 'reply:ordinary', 'hello'),
    (error) => error.code === 'BOT_DELIVERY_BLOCKED',
  )
  assert.equal(f.requests.length, 0)
})

test('Meta refusal is logged and marks only delivery failed, without marking the slip confirmed', async () => {
  const f = fixture({ handover: true, rejectCard: true, rejectText: true })
  await assert.rejects(
    f.notify.notifySlipResult(f.db, verifiedSlip, recipient),
    (error) => error instanceof f.client.SendApiError && error.status === 400,
  )
  assert.deepEqual(f.statuses, ['failed'])
  assert.equal(f.confirms.length, 0)
  const errorLog = f.logs.find(([label]) => label === '[slip/confirmation] delivery failed')
  assert.ok(errorLog)
  assert.equal(errorLog[1].slipId, verifiedSlip.id)
  assert.equal(errorLog[1].httpStatus, 400)
  assert.equal(errorLog[1].errorCode, 10)
  assert.equal(errorLog[1].errorSubcode, 2018278)
  assert.equal(JSON.stringify(f.logs).includes(recipient.token), false)
})

test('network uncertainty never falls back or resends a possibly delivered receipt', async () => {
  const f = fixture({ handover: true, networkError: true })
  await assert.rejects(f.notify.notifySlipResult(f.db, verifiedSlip, recipient))
  assert.equal(f.requests.length, 1)
  assert.deepEqual(f.statuses, ['unknown'])
  assert.equal(f.confirms.length, 0)
  await f.notify.notifySlipResult(f.db, verifiedSlip, recipient)
  assert.equal(f.requests.length, 1)
  assert.equal(f.metrics().credits, 1)
})

test('takeover exception still checks the Messenger window and emergency stop before sending', async () => {
  for (const [options, code] of [
    [{ expired: true }, 'MESSAGING_WINDOW_CLOSED'],
    [{ safetyEnabled: true, safetyStopped: true }, 'AUTOMATION_STOPPED'],
  ]) {
    const f = fixture({ handover: true, ...options })
    await assert.rejects(
      f.notify.notifySlipResult(f.db, verifiedSlip, recipient),
      (error) => error.code === code,
    )
    assert.equal(f.requests.length, 0)
    assert.equal(f.confirms.length, 0)
    assert.deepEqual(f.statuses, ['failed'])
    assert.equal(f.metrics().windowChecks, 1)
  }
})

test('a verified Pro payment sends its receipt even when general Pro automation is disabled', async () => {
  const f = fixture({ handover: true })
  await f.notify.notifySlipResult(
    f.db,
    { ...verifiedSlip, amount: 1, paymentPro: true, automationAllowed: false },
    recipient,
  )
  assert.equal(f.requests.length, 1)
  assert.equal(f.requests[0].body.message.text, expectedReceipt('ร้านค้า', '1.00'))
  assert.equal(f.rows[0].body, f.requests[0].body.message.text)
  assert.ok(f.logs.some(([label]) => label === '[slip/confirmation] sent'))
})

test('manual verification resolves the tenant Page token and customer PSID before sending a 1.00 receipt', async () => {
  const f = fixture({ handover: true })
  const status = await f.notify.notifyVerifiedSlipForCustomer(
    f.db,
    { ...verifiedSlip, amount: 1 },
    'customer-uuid',
    'tenant-a',
  )
  assert.equal(status, 'sent')
  assert.equal(f.requests[0].headers.Authorization, 'Bearer mock-token-a')
  assert.equal(f.requests[0].body.recipient.id, '123456789')
  assert.equal(f.requests[0].body.messaging_type, 'RESPONSE')
  assert.equal(f.requests[0].body.message.text, expectedReceipt('Actual Facebook Page', '1.00'))
  assert.equal(f.rows[0].body, f.requests[0].body.message.text)
  assert.equal(
    await f.notify.notifyVerifiedSlipForCustomer(f.db, verifiedSlip, 'customer-uuid', 'tenant-a'),
    'already_processed',
  )
  assert.equal(f.requests.length, 1)
})

test('notification failure is reported separately from the successful verification result', async () => {
  const f = fixture({ handover: true, networkError: true })
  assert.equal(
    await f.notify.notifyVerifiedSlipForCustomer(f.db, verifiedSlip, 'customer-uuid', 'tenant-a'),
    'failed',
  )
  assert.equal(f.confirms.length, 0)
  assert.equal(
    f.logs.some(([label]) => label === '[slip/confirmation] post-verification failed'),
    true,
  )
})

test('unlinked or unverified slips cannot trigger the post-verification notification hook', async () => {
  const f = fixture()
  assert.equal(
    await f.notify.notifyVerifiedSlipForCustomer(f.db, verifiedSlip, null, 'tenant-a'),
    'not_applicable',
  )
  assert.equal(
    await f.notify.notifyVerifiedSlipForCustomer(
      f.db,
      { ...verifiedSlip, status: 'fake' },
      'customer-uuid',
      'tenant-a',
    ),
    'not_applicable',
  )
  assert.equal(f.requests.length, 0)
})

test('manual confirmation uses the same exact three-line text with two-decimal amounts and no reference', async () => {
  for (const [amount, formatted] of [
    [1, '1.00'],
    [1234.5, '1,234.50'],
    [0.01, '0.01'],
  ]) {
    const f = fixture({ handover: true })
    await f.notify.sendSlipConfirmation(
      f.db,
      { id: 'manual-slip', amount, trans_ref: 'DO_NOT_INCLUDE_REFERENCE' },
      recipient,
      'เพจตัวอย่าง',
    )
    const message = f.requests[0].body.message
    assert.deepEqual(message, {
      text: expectedReceipt('เพจตัวอย่าง', formatted),
      metadata: 'snapbot:slip-confirm:manual-slip',
    })
    assert.equal(message.text.split('\n').length, 3)
    assert.equal(f.rows[0].body, message.text)
    assert.equal(message.text.includes('DO_NOT_INCLUDE_REFERENCE'), false)
  }
})

test('receipt uses the configured tenant name when no Facebook page_name is stored', async () => {
  const f = fixture({ pageName: null })
  assert.equal(
    await f.notify.notifyVerifiedSlipForCustomer(
      f.db,
      { ...verifiedSlip, amount: 1 },
      'customer-uuid',
      'tenant-a',
    ),
    'sent',
  )
  assert.equal(f.requests[0].body.message.text, expectedReceipt('Test shop', '1.00'))
  assert.equal(f.rows[0].body, f.requests[0].body.message.text)
})

test('an unavailable or invalid amount cannot generate a fabricated payment receipt', async () => {
  for (const amount of [null, NaN, Infinity, 0, -1]) {
    const f = fixture()
    await assert.rejects(
      f.notify.notifySlipResult(f.db, { ...verifiedSlip, amount }, recipient, 'Test page'),
      /SLIP_CONFIRMATION_AMOUNT_INVALID/,
    )
    assert.equal(f.requests.length, 0)
    assert.equal(f.rows.length, 0)
  }
})

test('the admin confirmation API selects the real page name and stores exactly the text sent to its PSID', async () => {
  for (const pageName of ['ชื่อเพจจริง', null]) {
    const f = fixture({ handover: true })
    const slipId = '11111111-1111-4111-8111-111111111111'
    const stored = {
      id: slipId,
      tenant_id: 'tenant-a',
      status: 'valid',
      amount: 1,
      trans_ref: 'DO_NOT_INCLUDE_REFERENCE',
      approved_at: null,
      customers: { id: recipient.id, platform_user_id: recipient.psid },
      tenants: {
        name: 'ชื่อร้าน',
        page_name: pageName,
        page_id: '11111',
        page_access_token: recipient.token,
      },
    }
    const lookupDb = {
      from(table) {
        assert.equal(table, 'slips')
        const q = {
          select(columns) {
            assert.ok(columns.includes('page_name'))
            return q
          },
          eq() {
            return q
          },
          maybeSingle: async () => ({ data: stored, error: null }),
        }
        return q
      },
    }
    const api = load('app/api/slips/[id]/confirm/route.ts', {
      'next/server': {
        NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) },
      },
      '@/lib/feature-access': { hasFeature: async () => true },
      '@/lib/supabase/server': { supabaseAdmin: () => lookupDb },
      '@/lib/auth': {
        getActor: async () => ({ kind: 'user', id: 'owner' }),
        canAccessTenant: async () => true,
      },
      '@/lib/integrations/facebook/client': f.client,
      '@/lib/features/slips/notify': {
        sendSlipConfirmation: (_db, slip, customer, name) =>
          f.notify.sendSlipConfirmation(f.db, slip, customer, name),
      },
      '@/lib/utils': { UUID: /^[a-f0-9-]{36}$/ },
    })
    const response = await api.POST({}, { params: Promise.resolve({ id: slipId }) })
    assert.equal(response.status, 200)
    assert.equal(response.body.ok, true)
    assert.equal(f.requests[0].body.recipient.id, recipient.psid)
    assert.equal(f.requests[0].body.message.text, expectedReceipt(pageName || 'ชื่อร้าน', '1.00'))
    assert.equal(f.rows[0].body, f.requests[0].body.message.text)
  }
})

function verificationRoute(kind, confirmationStatus) {
  const tenantId = '11111111-1111-4111-8111-111111111111'
  const customerId = '22222222-2222-4222-8222-222222222222'
  const messageId = '33333333-3333-4333-8333-333333333333'
  const calls = []
  const db = {
    from(table) {
      const q = {
        select() {
          return q
        },
        eq() {
          return q
        },
        maybeSingle: async () => ({
          data:
            table === 'customers'
              ? { tenant_id: tenantId }
              : table === 'tenants'
                ? { id: tenantId, bank_code: 'KTB', account_number: 'mock-account' }
                : {
                    id: messageId,
                    customer_id: customerId,
                    attachments: [{ type: 'image', payload: { url: 'mock-image' } }],
                    customers: { tenant_id: tenantId, tenants: { id: tenantId } },
                  },
          error: null,
        }),
        then(resolve, reject) {
          return Promise.resolve({ data: [], error: null }).then(resolve, reject)
        },
      }
      return q
    },
  }
  class FeatureLockedError extends Error {}
  class UploadError extends Error {}
  const api = load(
    kind === 'message' ? 'app/api/messages/[id]/verify/route.ts' : 'app/api/slips/verify/route.ts',
    {
      'next/server': {
        NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) },
      },
      '@/lib/supabase/server': { supabaseAdmin: () => db },
      '@/lib/auth': {
        getActor: async () => ({ kind: 'user', id: 'owner' }),
        canAccessTenant: async () => true,
        isPlatformAdmin: () => false,
      },
      '@/lib/feature-access': { hasSlipAccess: async () => true, FeatureLockedError },
      '@/lib/features/slips/process': { processSlip: async () => ({ ...verifiedSlip, amount: 1 }) },
      '@/lib/features/slips/notify': {
        notifyVerifiedSlipForCustomer: async (gotDb, slip, customer, tenant) => {
          assert.equal(gotDb, db)
          assert.equal(slip.status, 'valid')
          assert.equal(slip.amount, 1)
          assert.equal(customer, customerId)
          assert.equal(tenant, tenantId)
          calls.push(slip.id)
          return confirmationStatus
        },
      },
      '@/lib/features/slips/image': {
        slipCandidates: () => ['mock-image'],
        downloadSlipImage: async () => ({}),
      },
      '@/lib/status': { STALE_PENDING_MS: 180000 },
      '@/lib/utils': { UUID: /^[a-f0-9-]{36}$/ },
      '@/lib/upload-security': {
        UploadError,
        acquireUploadSlot: () => () => {},
        readUploadForm: async () =>
          new Map([
            ['tenantId', tenantId],
            ['customerId', customerId],
            ['qr', 'mock-qr'],
          ]),
        UPLOAD_FILE_BYTES: 5000000,
      },
    },
    { File },
  )
  return { api, calls, messageId }
}

for (const kind of ['message', 'upload']) {
  test(`${kind} verification calls the receipt hook and keeps payment valid even when Messenger fails`, async () => {
    for (const status of ['sent', 'failed']) {
      const f = verificationRoute(kind, status)
      const response = await f.api.POST({}, { params: Promise.resolve({ id: f.messageId }) })
      assert.equal(response.status, 200)
      const result = kind === 'message' ? response.body.results[0] : response.body
      assert.equal(result.status, 'valid')
      assert.equal(result.confirmation, status)
      assert.equal(f.calls.length, 1)
    }
  })
}
