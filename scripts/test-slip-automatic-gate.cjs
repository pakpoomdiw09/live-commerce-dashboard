const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./helpers/load-typescript.cjs')
const orders = load('lib/features/commerce/orders.ts', {
  'server-only': {},
  '@/lib/features/commerce/cf-code': load('lib/features/commerce/cf-code.ts'),
  '@/lib/features/banking/banks': load('lib/features/banking/banks.ts'),
})

function fixture({
  rows = [],
  bot = true,
  enabled = true,
  verdict = 'valid',
  orderError = false,
} = {}) {
  const calls = {
    downloads: 0,
    checks: 0,
    receipts: [],
    ai: 0,
    images: 0,
    queries: [],
    persisted: 0,
  }
  const steps = new Map()
  const db = {
    from(table) {
      const filters = {}
      const result = () => {
        if (table === 'tenants')
          return {
            data: {
              id: 'shop-a',
              name: 'Shop',
              page_name: 'My Page',
              auto_verify_enabled: enabled,
              auto_reply_enabled: true,
              page_access_token: 'fake',
            },
            error: null,
          }
        if (table === 'customers')
          return { data: { id: 'customer-a', bot_enabled: bot }, error: null }
        if (table === 'orders') {
          calls.queries.push({ ...filters })
          return {
            data: rows.filter((row) =>
              Object.entries(filters).every(([key, value]) => row[key] === value),
            ),
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
        maybeSingle: async () => result(),
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
      '@/lib/features/commerce/live-cf-comment': {},
      '@/lib/features/banking/banks': {},
      '@/lib/features/slips/process': {
        processSlip: async (_db, input) => {
          calls.checks++
          assert.equal(input.customerId, 'customer-a')
          assert.equal(input.tenant.id, 'shop-a')
          if (verdict === 'valid')
            for (const row of rows)
              if (
                row.customer_id === 'customer-a' &&
                row.tenant_id === 'shop-a' &&
                row.status === 'pending_payment'
              )
                row.status = 'paid'
          return { id: 'slip-' + calls.checks, status: verdict, amount: 100, transRef: 'test-ref' }
        },
      },
      '@/lib/features/slips/notify': {
        notifySlipResult: async (_db, slip, customer) => {
          calls.receipts.push({ slip, customer })
        },
      },
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
        facebookInboundMessage: () => ({ senderId: '987654321' }),
      },
      '@/lib/features/inbox/inbox-automation-window': {
        InboxAutomationWindowError: class extends Error {},
      },
      'node:crypto': require('node:crypto'),
    },
    { console: { log() {}, info() {}, warn() {}, error() {} }, process: { env: {} } },
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
  return { calls, execution, run: () => api.handleFacebookWebhookEvent(execution) }
}
const pending = () => ({
  id: 'order-a',
  tenant_id: 'shop-a',
  customer_id: 'customer-a',
  status: 'pending_payment',
  amount: 100,
})

test('no pending order, paid/cancelled orders and other customer/shop orders never download or verify a slip', async () => {
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
    assert.equal(f.calls.ai, 1, 'ordinary image AI remains available')
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
