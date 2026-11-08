const { test } = require('node:test')
const assert = require('node:assert/strict')
const load = require('./helpers/load-typescript.cjs')

function facebook(responses) {
  const calls = []
  const api = load(
    'lib/integrations/facebook/client.ts',
    {
      '@/lib/safe-logging': {
        createLogRequestId: () => 'test',
        logSafeEvent() {},
        maskErrorCode() {},
      },
    },
    {
      process: { env: { FB_GRAPH_VERSION: 'v22.0' } },
      AbortSignal,
      URL,
      console: { error() {} },
      fetch: async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) })
        const response = responses.shift()
        assert.ok(response, 'unexpected extra send')
        if (response instanceof Error) throw response
        return Response.json(response.body, { status: response.status ?? 200 })
      },
    },
  )
  return { api, calls }
}
const invoice = 'บิลประมูล 500 บาท ชำระเงิน https://shop.test/pay/signed'
const comment = { id: '100_200', pageId: '100' }
const windowError = {
  status: 400,
  body: { error: { code: 10, error_subcode: 2018278, message: 'Outside messaging window' } },
}
const success = { body: { message_id: 'receipt' } }

test('invoice uses MESSAGE_TAG and POST_PURCHASE_UPDATE; normal chat remains RESPONSE', async () => {
  const f = facebook([success, success])
  await f.api.sendAuctionInvoiceWithReceipt('token', 'psid', invoice, comment)
  assert.equal(f.calls[0].url, 'https://graph.facebook.com/v22.0/me/messages')
  assert.deepEqual(f.calls[0].body, {
    recipient: { id: 'psid' },
    message: { text: invoice },
    messaging_type: 'MESSAGE_TAG',
    tag: 'POST_PURCHASE_UPDATE',
  })
  await f.api.sendMessageWithReceipt('token', 'psid', { text: 'hello' })
  assert.equal(f.calls[1].body.messaging_type, 'RESPONSE')
  assert.equal(f.calls[1].body.tag, undefined)
})

test('definite window or missing-recipient rejection falls back to the winning comment exactly once', async () => {
  for (const error of [
    windowError,
    { status: 400, body: { error: { code: 100, message: 'No matching user found' } } },
    { status: 400, body: { error: { code: 551, message: 'Recipient unavailable' } } },
  ]) {
    const f = facebook([error, { body: { id: 'private-receipt' } }])
    const receipt = await f.api.sendAuctionInvoiceWithReceipt('token', 'psid', invoice, comment)
    assert.equal(receipt.privateReply, true)
    assert.equal(receipt.message_id, 'private-receipt')
    assert.equal(f.calls[1].url, 'https://graph.facebook.com/v22.0/100_200/private_replies')
    assert.deepEqual(f.calls[1].body, { message: invoice })
  }
})

test('unsupported legacy tags fall back to RESPONSE, then private reply only on a definite rejection', async () => {
  const retired = {
    status: 400,
    body: { error: { code: 100, message: 'POST_PURCHASE_UPDATE tag is deprecated' } },
  }
  const f = facebook([retired, success])
  assert.equal(
    (await f.api.sendAuctionInvoiceWithReceipt('token', 'psid', invoice, comment)).privateReply,
    false,
  )
  assert.equal(f.calls[1].body.messaging_type, 'RESPONSE')
  const g = facebook([retired, windowError, { body: { id: 'private' } }])
  assert.equal(
    (await g.api.sendAuctionInvoiceWithReceipt('token', 'psid', invoice, comment)).privateReply,
    true,
  )
  assert.equal(g.calls.length, 3)
})

test('permissions, rate limits, token errors, missing receipts and transport failures never blindly resend', async () => {
  for (const response of [
    new Error('timeout'),
    { body: {} },
    { status: 500, body: { error: { code: 10, error_subcode: 2018278 } } },
    ...[10, 190, 4, 613].map((code) => ({
      status: 400,
      body: { error: { code, message: 'Permission denied' } },
    })),
  ]) {
    const f = facebook([response])
    await assert.rejects(f.api.sendAuctionInvoiceWithReceipt('token', 'psid', invoice, comment))
    assert.equal(f.calls.length, 1)
  }
  const f = facebook([windowError])
  await assert.rejects(f.api.sendAuctionInvoiceWithReceipt('token', 'psid', invoice), (e) =>
    f.api.needsMessengerSession(e),
  )
  assert.equal(f.calls.length, 1, 'no comment ID means no private reply')
})

class InboxError extends Error {
  constructor(message, status = 400, code = 'INBOX_ERROR') {
    super(message)
    this.status = status
    this.code = code
  }
}
const customerId = '11111111-1111-4111-8111-111111111111'
const tabId = '22222222-2222-4222-8222-222222222222'
const clientId = '33333333-3333-4333-8333-333333333333'
class FakeSendApiError extends Error {
  status = 400
}
function routeFixture({ foreign = false, previous = null, fail = null, inactive = false } = {}) {
  const writes = [],
    sends = [],
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
        insert(value) {
          writes.push(value)
          return q
        },
        update(value) {
          writes.push(value)
          return q
        },
        async maybeSingle() {
          return { data: table === 'customers' ? { id: customerId } : previous }
        },
        async single() {
          return {
            data:
              table === 'tenants'
                ? inactive
                  ? null
                  : { page_id: '100', page_access_token: 'token' }
                : { id: 'message' },
          }
        },
        then(resolve) {
          return Promise.resolve({ error: null }).then(resolve)
        },
      }
      return q
    },
  }
  const api = load('app/api/customer-tabs/invoice/route.ts', {
    'next/server': {
      NextResponse: { json: (data, options) => ({ data, status: options?.status ?? 200 }) },
    },
    '@/lib/utils': { UUID: /^[a-f0-9-]{36}$/ },
    '@/lib/features/inbox/inbox-server': {
      InboxError,
      inboxError: (e) => ({ status: e.status ?? 500, data: { code: e.code, error: e.message } }),
      inboxCustomer: async () => ({
        db,
        tenantId: 'tenant',
        customer: { id: customerId, platform_user_id: 'psid' },
      }),
    },
    '@/lib/features/commerce/customer-tabs-server': {
      loadCustomerTab: async (_db, _id, tenant) => {
        assert.equal(tenant, 'tenant')
        return {
          id: tabId,
          customer_id: foreign ? 'other' : customerId,
          customer_fb_id: 'psid',
          page_id: '100',
          total_amount: 500,
          paid_amount: 0,
          remaining_amount: 500,
        }
      },
      customerTabSummary: async () => ({
        link: 'https://shop.test/pay/signed',
        account: 'TEST BANK',
      }),
    },
    '@/lib/features/commerce/customer-tab-types': { tabMoney: (n) => String(n) },
    '@/lib/integrations/facebook/client': {
      pageTokenFor: (row) => row.page_access_token,
      SendApiError: FakeSendApiError,
      needsMessengerSession: (e) => e === fail,
      isUnsupportedPurchaseTag: () => false,
      MESSENGER_FIRST_MESSAGE_REQUIRED: 'Ask the buyer to message the Page first',
      sendAuctionInvoiceWithReceipt: async (...args) => {
        sends.push(args)
        if (fail) throw fail
        return { message_id: 'receipt' }
      },
    },
  })
  return {
    writes,
    sends,
    filters,
    send: (origin = 'https://shop.test') =>
      api.POST({
        headers: { get: () => origin },
        nextUrl: { origin: 'https://shop.test' },
        json: async () => ({ customerId, tabId, clientId, text: 'PROMOTION supplied by client' }),
      }),
  }
}

test('invoice endpoint generates ledger text, checks tenant/page, and permits a bill without inbound evidence', async () => {
  const f = routeFixture()
  assert.equal((await f.send()).status, 200)
  assert.equal(f.sends.length, 1)
  assert.match(f.sends[0][2], /500/)
  assert.match(f.sends[0][2], /https:\/\/shop.test\/pay\/signed/)
  assert.doesNotMatch(f.sends[0][2], /PROMOTION/)
  assert.ok(
    f.filters.some((row) => row[0] === 'tenants' && row[1] === 'is_active' && row[2] === true),
  )
  assert.equal(f.writes.at(-1).delivery_status, 'sent')
})

test('invoice endpoint rejects foreign bills/origins/inactive Pages and does not repeat existing sends', async () => {
  for (const [options, status] of [
    [{ foreign: true }, 404],
    [{ inactive: true }, 409],
    [{ previous: { id: 'message', delivery_status: 'sent' } }, 200],
    [{ previous: { id: 'message', delivery_status: 'pending' } }, 409],
  ]) {
    const f = routeFixture(options)
    assert.equal((await f.send()).status, status)
    assert.equal(f.sends.length, 0)
  }
  const f = routeFixture()
  assert.equal((await f.send('https://foreign.test')).status, 403)
  assert.equal(f.sends.length, 0)
})

test('invoice rejection prompts first contact; ambiguous outcomes retain unknown status for reconciliation', async () => {
  const rejected = routeFixture({ fail: new FakeSendApiError('No session') })
  const result = await rejected.send()
  assert.equal(result.data.code, 'MESSENGER_SESSION_REQUIRED')
  assert.match(result.data.error, /message the Page first/)
  assert.equal(rejected.writes.at(-1).delivery_status, 'failed')
  const timeout = routeFixture({ fail: new Error('timeout') })
  assert.equal((await timeout.send()).data.code, 'SEND_UNKNOWN')
  assert.equal(timeout.writes.at(-1).delivery_status, 'unknown')
  assert.equal(timeout.sends.length, 1)
})
