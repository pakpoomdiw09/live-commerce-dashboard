const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm'),
  ts = require('typescript')
const { test } = require('node:test')
function load(file, deps) {
  const context = { exports: {}, console, process: { env: {} }, require: (n) => deps[n] }
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    context,
  )
  return context.exports
}
function fixture(remaining) {
  let balance = remaining,
    sent = 0
  const claims = new Set()
  const quota = load('lib/message-quota.ts', {
    'server-only': {},
    '@/lib/features/inbox/inbox-automation-window': { assertAutomationWindow: async () => {} },
    '@/lib/features/billing/billing': {
      reserveCredits: async () => {
        if (balance <= 0) return { monthly: 0, topup: 0 }
        balance--
        return { monthly: 1, topup: 0 }
      },
      settleCredits: async (_db, _tenant, r, used) => {
        balance += r.monthly + r.topup - used
      },
    },
  })
  const db = {
    rpc: async (name) => ({ data: name === 'start_inbox_delivery' ? 'lease' : null, error: null }),
    from: () => {
      let external
      return {
        insert(v) {
          external = v.external_id
          return this
        },
        select() {
          return this
        },
        eq() {
          return this
        },
        update() {
          return this
        },
        single: async () => {
          if (claims.has(external)) return { error: { code: '23505' } }
          claims.add(external)
          return { data: { id: 'message' } }
        },
        maybeSingle: async () => ({ data: { tenant_id: 'shop' } }),
      }
    },
  }
  const notify = load('lib/features/slips/notify.ts', {
    'server-only': {},
    '@/lib/features/inbox/inbox-automation-window': { assertAutomationWindow: async () => {} },
    '@/lib/message-quota': quota,
    '@/lib/integrations/facebook/client': {
      SendApiError: class extends Error {},
      sendMessage: async () => {
        sent++
      },
      sendText: async () => {
        sent++
      },
      sendPaymentCard: async () => {
        sent++
      },
      isWindowOrTagError: () => false,
    },
  })
  return {
    quota,
    notify,
    db,
    customer: { id: 'customer', psid: '123', token: 'test' },
    balance: () => balance,
    sent: () => sent,
  }
}
test('Auto-reply cannot send message 101 and duplicate delivery never consumes extra credits', async () => {
  const f = fixture(100)
  for (let i = 0; i < 100; i++)
    assert.equal(await f.notify.deliverOnce(f.db, f.customer, 'reply:' + i, 'hello'), true)
  assert.equal(await f.notify.deliverOnce(f.db, f.customer, 'reply:0', 'hello'), false)
  await assert.rejects(
    f.notify.deliverOnce(f.db, f.customer, 'reply:101', 'hello'),
    (error) => error.code === 'MESSAGE_QUOTA_EXHAUSTED',
  )
  assert.equal(f.sent(), 100)
  assert.equal(f.balance(), 0)
})
test('failed delivery refunds one reserved message and a retry uses the same shared balance', async () => {
  const f = fixture(1)
  await assert.rejects(
    f.quota.sendWithMessageCredit(f.db, 'shop', async () => {
      throw Error('Meta unavailable')
    }),
    /Meta unavailable/,
  )
  assert.equal(f.balance(), 1)
  await f.notify.deliverOnce(f.db, f.customer, 'next', 'hello')
  assert.equal(f.balance(), 0)
})
test('rich replies charge per physical message; batch-reserved broadcasts are not charged twice', async () => {
  const f = fixture(2)
  await assert.rejects(
    f.notify.deliverRichOnce(f.db, f.customer, 'rich', 'three parts', [
      { text: 'a' },
      { text: 'b' },
      { text: 'c' },
    ]),
    /เครดิตข้อความหมด/,
  )
  assert.equal(f.sent(), 2)
  assert.equal(f.balance(), 0)
  const broadcast = fixture(99)
  await broadcast.notify.deliverRichOnce(
    broadcast.db,
    broadcast.customer,
    'bc:campaign:customer',
    'hello',
    [{ text: 'hello' }],
  )
  assert.equal(broadcast.balance(), 99)
  assert.equal(broadcast.sent(), 1)
})
test('human handoff blocks bot sends before message insertion or quota consumption', async () => {
  const f = fixture(100)
  f.db.rpc = async () => ({ error: { code: '40001' } })
  await assert.rejects(
    f.notify.deliverOnce(f.db, f.customer, 'reply:paused', 'hello'),
    (e) => e.code === 'BOT_DELIVERY_BLOCKED',
  )
  assert.equal(f.sent(), 0)
  assert.equal(f.balance(), 100)
})
