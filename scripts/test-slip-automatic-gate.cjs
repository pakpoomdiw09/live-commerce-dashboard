const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./helpers/load-typescript.cjs')
const orders = load('lib/features/commerce/orders.ts', {
  'server-only': {},
  '@/lib/features/commerce/cf-code': load('lib/features/commerce/cf-code.ts'),
  '@/lib/features/banking/banks': load('lib/features/banking/banks.ts'),
})

test('Messenger slips route on-demand bills even when the claimant is not the global leader', async () => {
  const order = {
    ...pending(),
    source: 'live_auction',
    source_id: 'auction-a:claim:987654321',
    live_auction_id: 'auction-a',
    customer_tab_id: 'tab-a',
  }
  const options = {
    rows: [order],
    auctionRows: [
      {
        id: 'auction-a',
        tenant_id: 'shop-a',
        page_id: '123456789',
        status: 'active',
        leading_bidder_id: 'another-buyer',
      },
    ],
    claimRows: [
      {
        tenant_id: 'shop-a',
        customer_id: 'customer-a',
        bidder_id: '987654321',
        auction_id: 'auction-a',
        order_id: order.id,
      },
    ],
    tabRows: [
      { id: 'tab-a', tenant_id: 'shop-a', customer_id: 'customer-a', remaining_amount: 300 },
    ],
  }
  const f = fixture(options)
  await f.run()
  assert.equal(f.calls.processInputs.length, 1)
  assert.equal(f.calls.processInputs[0].expectedAmount, 300)
  assert.equal(f.calls.processInputs[0].auctionSenderId, '987654321')
  const foreign = fixture({
    ...options,
    claimRows: [{ ...options.claimRows[0], bidder_id: 'foreign' }],
  })
  await foreign.run()
  assert.equal(foreign.calls.processInputs.length, 0)
})

test('auction slips settle only the exact pending tab bill belonging to the closed-round winner', async () => {
  const order = {
    ...pending(),
    source: 'live_auction',
    source_id: 'auction-a',
    customer_tab_id: 'tab-a',
  }
  const auction = {
    id: 'auction-a',
    order_id: order.id,
    tenant_id: 'shop-a',
    page_id: '123456789',
    status: 'closed',
    leading_bidder_id: '987654321',
  }
  const winner = fixture({
    rows: [order],
    auctionRows: [auction],
    tabRows: [
      { id: 'tab-a', tenant_id: 'shop-a', customer_id: 'customer-a', remaining_amount: 100 },
    ],
  })
  await winner.run()
  assert.equal(winner.calls.processInputs.length, 1, JSON.stringify(winner.calls))
  assert.equal(winner.calls.checks, 1)
  assert.equal(winner.calls.processInputs[0].customerTabId, 'tab-a')
  assert.equal(winner.calls.processInputs[0].expectedAmount, 100)
  assert.equal(winner.calls.processInputs[0].requireExactAmount, true)
  assert.equal(winner.calls.processInputs[0].auctionSenderId, '987654321')
  assert.equal(winner.calls.paymentCalls.length, 0)

  const notWinner = fixture({
    rows: [{ ...order, status: 'pending_payment' }],
    auctionRows: [{ ...auction, leading_bidder_id: 'different-sender' }],
    tabRows: [
      { id: 'tab-a', tenant_id: 'shop-a', customer_id: 'customer-a', remaining_amount: 100 },
    ],
  })
  await notWinner.run()
  assert.equal(notWinner.calls.checks, 0)
  assert.equal(notWinner.calls.paymentCalls.length, 0)

  const ambiguous = fixture({
    rows: [order, { ...order, id: 'order-b', source_id: 'auction-b', customer_tab_id: 'tab-b' }],
    auctionRows: [auction, { ...auction, id: 'auction-b', order_id: 'order-b' }],
    tabRows: [
      { id: 'tab-a', tenant_id: 'shop-a', customer_id: 'customer-a', remaining_amount: 100 },
      { id: 'tab-b', tenant_id: 'shop-a', customer_id: 'customer-a', remaining_amount: 100 },
    ],
  })
  await ambiguous.run()
  assert.equal(ambiguous.calls.checks, 0)
  assert.equal(ambiguous.calls.paymentCalls.length, 0)
})

function fixture({
  rows = [],
  auctionRows = [],
  claimRows = [],
  tabRows = [],
  bot = true,
  enabled = true,
  verdict = 'valid',
  orderError = false,
  autoReply = true,
  standaloneSuccess = true,
  shipping = false,
  senderId = '987654321',
} = {}) {
  const calls = {
    downloads: 0,
    checks: 0,
    receipts: [],
    ai: 0,
    images: 0,
    queries: [],
    persisted: 0,
    standaloneChecks: 0,
    standaloneReplies: [],
    shipping: 0,
    paymentCalls: [],
    processInputs: [],
  }
  const steps = new Map()
  const db = {
    rpc: async (name, args) => {
      calls.paymentCalls.push({ name, args })
      throw Error('Unexpected RPC ' + name)
    },
    from(table) {
      const filters = {}
      const lists = {}
      const result = () => {
        if (table === 'tenants')
          return {
            data: {
              id: 'shop-a',
              name: 'Shop',
              page_name: 'My Page',
              auto_verify_enabled: enabled,
              auto_reply_enabled: autoReply,
              page_access_token: 'fake',
            },
            error: null,
          }
        if (table === 'customers')
          return { data: { id: 'customer-a', bot_enabled: bot }, error: null }
        if (
          table === 'orders' ||
          table === 'auctions' ||
          table === 'customer_tabs' ||
          table === 'auction_winner_claims'
        ) {
          const sourceRows =
            table === 'orders'
              ? rows
              : table === 'auctions'
                ? auctionRows
                : table === 'auction_winner_claims'
                  ? claimRows
                  : tabRows
          const filtered = sourceRows.filter(
            (row) =>
              Object.entries(filters).every(([key, value]) => row[key] === value) &&
              Object.entries(lists).every(([key, values]) => values.includes(row[key])),
          )
          calls.queries.push({
            ...filters,
            table,
            lists: { ...lists },
          })
          return {
            data: filtered,
            error: orderError ? { code: 'DB_DOWN' } : null,
          }
        }
        throw Error('Unexpected table ' + table)
      }
      const q = {
        select: () => q,
        eq(key, value) {
          filters[key] = value
          return q
        },
        in(key, values) {
          lists[key] = values
          return q
        },
        maybeSingle: async () => {
          const value = result()
          return {
            ...value,
            data: Array.isArray(value.data) ? (value.data[0] ?? null) : value.data,
          }
        },
        then(resolve, reject) {
          return Promise.resolve(result()).then(resolve, reject)
        },
      }
      return q
    },
  }
  const api = load(
    'lib/integrations/facebook/webhook-handler.ts',
    {
      '@/lib/supabase/server': { supabaseAdmin: () => db },
      '@/lib/integrations/facebook/client': {
        getCustomerProfile: async () => ({}),
        pageTokenFor: () => 'fake',
      },
      '@/lib/features/comments/comment-rules': {},
      '@/lib/features/comments/live-comment-routing': {},
      '@/lib/features/agents/chatbot-server': {
        loadBotSettings: async () => ({ reply_mode: 'ai' }),
        answerChat: async () => {
          calls.ai++
        },
      },
      '@/lib/features/commerce/orders': orders,
      '@/lib/features/commerce/messenger-product-server': {
        replyToMessengerProduct: async () => false,
      },
      '@/lib/features/commerce/live-cf-comment': {},
      '@/lib/features/commerce/auction-server': { handleAuctionComment: async () => false },
      '@/lib/features/shipping/shipping-messenger': {
        shippingMessageIntent: () => true,
        handleShippingMessage: async () => {
          calls.shipping++
          return true
        },
      },
      '@/lib/features/commerce/live-cf-payment-link': {},
      '@/lib/integrations/facebook/live-cf-adapter': {},
      '@/lib/feature-flags': {},
      '@/lib/features/banking/banks': {},
      '@/lib/features/slips/process': {
        processSlip: async (_db, input) => {
          calls.checks++
          calls.processInputs.push(input)
          assert.equal(input.customerId, 'customer-a')
          assert.equal(input.tenant.id, 'shop-a')
          if (verdict === 'valid' && !input.requireExactAmount)
            for (const row of rows)
              if (
                row.customer_id === 'customer-a' &&
                row.tenant_id === 'shop-a' &&
                row.status === 'pending_payment'
              )
                row.status = 'paid'
          return {
            id: 'slip-' + calls.checks,
            status: verdict,
            amount: 100,
            transRef: 'test-ref',
            ...(input.requireExactAmount ? { tabBalance: { status: 'fully_paid' } } : {}),
          }
        },
      },
      '@/lib/features/slips/notify': {
        deliverOnce: async (_db, recipient, key, body) => {
          calls.standaloneReplies.push({ recipient, key, body })
          return true
        },
        notifySlipResult: async (_db, slip, customer) => {
          calls.receipts.push({ slip, customer })
        },
      },
      '@/lib/features/slips/standalone-verifier': {
        processStandaloneSlip: async (_db, input) => {
          calls.standaloneChecks++
          assert.equal(input.tenantId, 'shop-a')
          assert.equal(input.customerId, 'customer-a')
          assert.equal(input.messageId, 'message-a')
          assert.ok(input.slipImageUrl.startsWith('https://example.test/'))
          return standaloneSuccess
            ? { success: true, message: 'ยอดโอน 159.25 บาท ผู้โอนทดสอบ รหัสอ้างอิง standalone-ref' }
            : { success: false, message: 'สลิปนี้เคยส่งตรวจแล้ว' }
        },
      },
      '@/lib/features/slips/standalone-slip': { standaloneSlipReply: (result) => result.message },
      '@/lib/features/slips/image': {
        downloadSlipImage: async () => {
          calls.downloads++
          return {}
        },
        slipCandidates: (attachments) =>
          (attachments ?? []).filter((a) => a.type === 'image').map((a) => a.payload.url),
      },
      '@/lib/message-quota': {},
      '@/lib/features/follow-ups/followup-ai': { observeFollowUpMessage: async () => null },
      '@/lib/features/vision/vision': {
        queueMessengerVision: async () => {
          calls.images++
          return false
        },
      },
      '@/lib/features/broadcast/broadcast-policy': { inboundBroadcastEvidence: () => null },
      '@/lib/integrations/facebook/message-window': {
        facebookInboundMessage: () => ({ senderId }),
        facebookMessageEcho: () => false,
      },
      '@/lib/features/inbox/inbox-automation-window': {
        InboxAutomationWindowError: class extends Error {},
      },
      'node:crypto': require('node:crypto'),
    },
    {
      console: { log() {}, info() {}, warn() {}, error() {} },
      process: { env: {} },
    },
  )
  const execution = {
    event: {
      id: 'event-a',
      page_id: '123456789',
      kind: 'message',
      created_at: new Date().toISOString(),
      payload: {
        message: {
          mid: 'mid',
          ...(shipping
            ? { text: 'ส่งที่อยู่ ตำบลบางรัก อำเภอเมือง นนทบุรี 11000 โทร 0812345678' }
            : {}),
          attachments: [{ type: 'image', payload: { url: 'https://example.test/photo.png' } }],
        },
      },
    },
    persistRecord: async () => {
      calls.persisted++
      return {
        id: 'message-a',
        duplicate: false,
        customer: { id: 'customer-a', display_name: 'Customer', bot_enabled: bot },
      }
    },
    once: async (key, work) => {
      if (steps.has(key)) return steps.get(key)
      const result = await work()
      steps.set(key, result)
      return result
    },
  }
  return { calls, execution, rows, run: () => api.handleFacebookWebhookEvent(execution) }
}
const pending = () => ({
  id: 'order-a',
  tenant_id: 'shop-a',
  customer_id: 'customer-a',
  status: 'pending_payment',
  amount: 100,
})

test('shipping address text is handled before chat AI while attached slips still complete the payment route', async () => {
  const withSlip = fixture({ rows: [pending()], shipping: true })
  await withSlip.run()
  assert.equal(withSlip.calls.shipping, 1)
  assert.equal(withSlip.calls.checks, 1)
  assert.equal(withSlip.calls.ai, 0)
  const textOnly = fixture({ shipping: true })
  textOnly.execution.event.payload.message.attachments = []
  await textOnly.run()
  assert.equal(textOnly.calls.shipping, 1)
  assert.equal(textOnly.calls.ai, 0)
  assert.equal(textOnly.calls.checks, 0)
})

test('no pending order, paid/cancelled orders and unrelated orders route images to standalone without paying orders', async () => {
  for (const rows of [
    [],
    [{ ...pending(), status: 'paid' }],
    [{ ...pending(), status: 'cancelled' }],
    [{ ...pending(), customer_id: 'customer-b' }],
    [{ ...pending(), tenant_id: 'shop-b' }],
  ]) {
    const f = fixture({ rows })
    await f.run()
    assert.equal(f.calls.downloads, 0)
    assert.equal(f.calls.checks, 0)
    assert.equal(f.calls.receipts.length, 0)
    assert.equal(f.calls.standaloneChecks, 1)
    assert.equal(f.calls.standaloneReplies.length, 1)
    assert.equal(f.calls.standaloneReplies[0].recipient.psid, '987654321')
    assert.equal(f.calls.standaloneReplies[0].recipient.token, 'fake')
    assert.equal(f.calls.ai, 0)
    assert.equal(
      f.calls.images,
      1,
      'catalog routing is offered once before the standalone fallback',
    )
    assert.ok(
      f.calls.queries.every(
        (q) =>
          q.tenant_id === 'shop-a' &&
          q.customer_id === 'customer-a' &&
          q.status === 'pending_payment',
      ),
    )
  }
})

test('standalone verification and replies are checkpointed separately and never repeat on webhook replay', async () => {
  const f = fixture()
  await f.run()
  await f.run()
  assert.equal(f.calls.standaloneChecks, 1)
  assert.equal(f.calls.standaloneReplies.length, 1)
  assert.ok(f.calls.standaloneReplies[0].key.startsWith('standalone-slip:message-a:'))
})

test('standalone rejection sends the reason and does not fall through to AI or order confirmation', async () => {
  const f = fixture({ standaloneSuccess: false })
  await f.run()
  assert.equal(f.calls.standaloneReplies[0].body, 'สลิปนี้เคยส่งตรวจแล้ว')
  assert.equal(f.calls.receipts.length, 0)
  assert.equal(f.calls.checks, 0)
  assert.equal(f.calls.ai, 0)
})

test('standalone images respect paused bot, shop auto reply and Auto-Pilot switches', async () => {
  for (const settings of [{ bot: false }, { autoReply: false }, { enabled: false }]) {
    const f = fixture(settings)
    await f.run()
    assert.equal(f.calls.standaloneChecks, 0)
    assert.equal(f.calls.standaloneReplies.length, 0)
  }
})

test('pending verified receipts still send to the sender PSID during admin takeover', async () => {
  const f = fixture({ rows: [pending()], bot: false })
  await f.run()
  assert.equal(f.calls.checks, 1)
  assert.equal(f.calls.receipts.length, 1)
  assert.equal(f.calls.receipts[0].customer.psid, '987654321')
  assert.equal(f.calls.receipts[0].customer.token, 'fake')
  assert.equal(f.calls.ai, 0)
  assert.equal(f.calls.images, 0)
})

test('unclear/ordinary images and provider failures are silent even with a pending order and auto replies enabled', async () => {
  for (const verdict of ['error', 'fake', 'duplicate', 'wrong_receiver', 'amount_mismatch']) {
    const f = fixture({ rows: [pending()], verdict })
    await f.run()
    assert.equal(f.calls.checks, 1)
    assert.equal(f.calls.receipts.length, 0)
    assert.equal(f.calls.ai, 0)
  }
})

test('an album rechecks pending orders before each image; replay never verifies again or changes to Vision after payment', async () => {
  const f = fixture({ rows: [pending()] })
  f.execution.event.payload.message.attachments.push({
    type: 'image',
    payload: { url: 'https://example.test/second.png' },
  })
  await f.run()
  await f.run()
  assert.equal(f.calls.checks, 1)
  assert.equal(f.calls.downloads, 1)
  assert.equal(f.calls.receipts.length, 1)
  assert.equal(f.calls.images, 0)
  assert.equal(f.calls.ai, 0)
})

test('order lookup errors fail closed and an explicit Auto-Pilot opt-out is preserved', async () => {
  const failed = fixture({ rows: [pending()], orderError: true })
  await assert.rejects(failed.run(), /อ่านยอดรวมออเดอร์ไม่ได้/)
  assert.equal(failed.calls.downloads, 0)
  assert.equal(failed.calls.checks, 0)
  assert.equal(failed.calls.receipts.length, 0)
  const off = fixture({ rows: [pending()], enabled: false })
  await off.run()
  assert.equal(off.calls.queries.length, 0)
  assert.equal(off.calls.checks, 0)
  assert.equal(off.calls.ai, 1)
})
