const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./helpers/load-typescript.cjs')

function fixture(verdict) {
  const rpcCalls = []
  const db = {
    storage: {
      from: () => ({ upload: async () => ({ error: null }) }),
    },
    rpc: async (name, args) => {
      rpcCalls.push({ name, args })
      if (name === 'claim_customer_tab_slip')
        return { data: { claimed: true, slipId: 'slip-a' }, error: null }
      if (name === 'complete_auction_customer_tab_slip')
        return { data: { status: 'fully_paid' }, error: null }
      if (name === 'complete_customer_tab_slip') return { data: { status: 'unpaid' }, error: null }
      return { data: true, error: null }
    },
    from(table) {
      const filters = {}
      const query = {
        select() {
          return query
        },
        eq(key, value) {
          filters[key] = value
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
              ? { id: 'tab-a', remaining_amount: 100, created_at: '2020-01-01T00:00:00Z' }
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
      './slipok': {
        verifyWithSlipOK: async () => ({
          verdict,
          amount: 100,
          transRef: 'transfer-a',
          raw: {},
        }),
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
    run: () =>
      processCustomerTabSlip(
        db,
        {
          file: { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer, type: 'image/png' },
          customerId: 'customer-a',
          messageId: 'message-a',
          tenant: { id: 'tenant-a' },
          expectedAmount: 100,
          customerTabId: 'tab-a',
          requireExactAmount: true,
          auctionSenderId: 'winner-a',
        },
        ['tab-a'],
      ),
  }
}

test('auction amount mismatches are recorded as invalid and never use the paid auction settlement RPC', async () => {
  const f = fixture('amount_mismatch')
  const result = await f.run()

  assert.equal(result.status, 'amount_mismatch')
  const completion = f.rpcCalls.find((call) => call.name.startsWith('complete_'))
  assert.equal(completion.name, 'complete_customer_tab_slip')
  assert.equal(completion.args.p_verdict, 'amount_mismatch')
})

test('valid exact auction slips settle through the winner-scoped database function', async () => {
  const f = fixture('valid')
  const result = await f.run()

  assert.equal(result.status, 'valid')
  assert.equal(result.tabBalance.status, 'fully_paid')
  const completion = f.rpcCalls.find((call) => call.name.startsWith('complete_'))
  assert.equal(completion.name, 'complete_auction_customer_tab_slip')
  assert.equal(completion.args.p_sender, 'winner-a')
  assert.equal(completion.args.p_amount, 100)
})
