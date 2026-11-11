const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./helpers/load-typescript.cjs')

function fixture({ amount, requireAuctionSender = false }) {
  const rpcCalls = []
  let verifierCalls = 0
  const db = {
    storage: {
      from: () => ({ upload: async () => ({ error: null }) }),
    },
    rpc: async (name, args) => {
      rpcCalls.push({ name, args })
      if (name === 'claim_customer_tab_slip')
        return { data: { claimed: true, slipId: 'slip-a' }, error: null }
      if (name === 'complete_auction_customer_tab_slip' || name === 'complete_customer_tab_slip')
        return {
          data: {
            tabId: 'tab-a',
            totalAmount: 500,
            paidAmount: amount,
            remainingAmount: Math.max(0, 500 - amount),
            status: amount >= 500 ? 'fully_paid' : 'pending_payment',
            verdict: args.p_verdict ?? (amount <= 500 ? 'valid' : 'amount_mismatch'),
            note: args.p_note ?? null,
          },
          error: null,
        }
      return { data: true, error: null }
    },
    from(table) {
      const query = {
        select() {
          return query
        },
        eq() {
          return query
        },
        in() {
          return query
        },
        order() {
          return query
        },
        limit() {
          return query
        },
        maybeSingle: async () => ({
          data:
            table === 'customer_tabs'
              ? { id: 'tab-a', remaining_amount: 500, created_at: '2020-01-01T00:00:00Z' }
              : null,
          error: null,
        }),
        then(resolve, reject) {
          const data =
            table === 'bank_accounts'
              ? [{ bank_code: 'KBANK', account_number: '1234567890', is_active: true }]
              : []
          return Promise.resolve({ data, error: null }).then(resolve, reject)
        },
      }
      return query
    },
  }
  const { processCustomerTabSlip } = load(
    'lib/features/slips/customer-tab-slip.ts',
    {
      'server-only': {},
      'node:crypto': require('node:crypto'),
      './verification': {
        verifySlip: async () => {
          verifierCalls += 1
          return {
            verdict: 'valid',
            amount,
            transRef: 'transfer-a',
            raw: {},
          }
        },
      },
      './receiver-matching': { receiverMatchesAny: () => true },
      '@/lib/features/payments/payment-pro-core': {
        providerPaidAt: () => new Date().toISOString(),
      },
    },
    { Buffer, crypto: require('node:crypto') },
  )
  return {
    rpcCalls,
    get verifierCalls() {
      return verifierCalls
    },
    run: () =>
      processCustomerTabSlip(
        db,
        {
          file: { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer, type: 'image/png' },
          customerId: 'customer-a',
          messageId: 'message-a',
          tenant: { id: 'tenant-a' },
          expectedAmount: 500,
          customerTabId: 'tab-a',
          requireAuctionSender,
          auctionSenderId: requireAuctionSender ? 'winner-a' : undefined,
        },
        ['tab-a'],
        'image/png',
      ),
  }
}

test('customer tab accepts a verified partial transfer and stores the remaining balance', async () => {
  const f = fixture({ amount: 2 })
  const result = await f.run()

  assert.equal(f.verifierCalls, 1)
  assert.equal(result.status, 'valid')
  assert.equal(result.tabBalance.paidAmount, 2)
  assert.equal(result.tabBalance.remainingAmount, 498)
  const completion = f.rpcCalls.find((call) => call.name === 'complete_customer_tab_slip')
  assert.equal(completion.args.p_amount, 2)
  assert.equal(completion.args.p_verdict, 'valid')
})

test('auction customer tab accepts a winner-scoped partial transfer through its guarded RPC', async () => {
  const f = fixture({ amount: 250, requireAuctionSender: true })
  const result = await f.run()

  assert.equal(result.status, 'valid')
  assert.equal(result.tabBalance.remainingAmount, 250)
  const completion = f.rpcCalls.find((call) => call.name === 'complete_auction_customer_tab_slip')
  assert.equal(completion.args.p_sender, 'winner-a')
  assert.equal(completion.args.p_amount, 250)
})

test('amount above the outstanding tab balance is recorded as a mismatch, not credited', async () => {
  const f = fixture({ amount: 501 })
  const result = await f.run()

  assert.equal(result.status, 'amount_mismatch')
  const completion = f.rpcCalls.find((call) => call.name === 'complete_customer_tab_slip')
  assert.equal(completion.args.p_verdict, 'amount_mismatch')
  assert.equal(completion.args.p_amount, 501)
})
