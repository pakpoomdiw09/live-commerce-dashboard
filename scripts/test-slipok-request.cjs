const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')
const code = ts.transpileModule(fs.readFileSync('lib/features/slips/slipok.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
test('platform checks disable branch logging for files/QR while default callers retain it', async () => {
  const bodies = []
  const context = {
    exports: {},
    FormData,
    AbortSignal,
    process: { env: { SLIPOK_API_KEY: 'test', SLIPOK_BRANCH_ID: 'test' } },
    fetch: async (_url, options) => {
      bodies.push(options.body)
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            success: true,
            amount: 9,
            transRef: 'ref',
            receivingBank: '006',
            receiver: { account: { value: '9260337828' } },
          },
        }),
      }
    },
  }
  vm.runInNewContext(code, context)
  const file = new File(['test'], 'slip.jpg', { type: 'image/jpeg' })
  const local = await context.exports.verifyWithSlipOK({ file, log: false })
  assert.equal(local.verdict, 'valid')
  assert.equal(local.receiverVerifiedByProvider, false)
  assert.equal(bodies[0].get('log'), 'false')
  await context.exports.verifyWithSlipOK({ qr: 'qr', log: false })
  assert.equal(JSON.parse(bodies[1]).log, false)
  assert.equal((await context.exports.verifyWithSlipOK({ file })).receiverVerifiedByProvider, true)
  assert.equal(bodies[2].get('log'), 'true')
  context.fetch = async () => ({
    ok: false,
    json: async () => ({ success: true, data: { success: true } }),
  })
  assert.equal((await context.exports.verifyWithSlipOK({ file })).verdict, 'error')
  context.fetch = async () => ({ ok: true, json: async () => ({ success: false, code: 1014 }) })
  assert.equal((await context.exports.verifyWithSlipOK({ file })).verdict, 'wrong_receiver')
})

test('ZWIZ API v2 uses server credentials and receiver accounts, then normalizes matched transfers', async () => {
  const calls = []
  const context = {
    exports: {},
    FormData,
    URL,
    AbortSignal,
    process: {
      env: {
        SLIP_VERIFICATION_PROVIDER: 'zwiz',
        ZWIZ_API_KEY: 'test-zwiz-key',
      },
    },
    fetch: async (url, options) => {
      calls.push({ url: String(url), options })
      return {
        ok: true,
        json: async () => ({
          success: true,
          result: {
            verification_result: 'matched',
            verify: {
              data: {
                amount: '125.50',
                transRef: 'zwiz-ref',
                transDate: '20261106',
                transTime: '12:30:45',
                sender: { displayName: 'Test Sender' },
              },
            },
          },
        }),
      }
    },
  }
  vm.runInNewContext(code, context)
  const file = new File(['test'], 'slip.jpg', { type: 'image/jpeg' })
  const result = await context.exports.verifyWithSlipOK({
    file,
    expectedAmount: 125.5,
    shopName: 'Test Shop',
    bankAccounts: [{ accountNo: '123-456-7890', bankCode: 'SCB' }],
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api-sme-prod.zwiz.app/api/slips/v1/verify')
  assert.equal(calls[0].options.headers['x-api-key'], 'test-zwiz-key')
  assert.equal(result.verdict, 'valid')
  assert.equal(result.amount, 125.5)
  assert.equal(result.transRef, 'zwiz-ref')
  assert.equal(result.receiverVerifiedByProvider, true)
  assert.equal(result.matchedBankAccount, true)
  assert.equal(result.raw.data.success, true)
  assert.equal(result.raw.data.transDate, '20261106')
  assert.deepEqual(JSON.parse(calls[0].options.body.get('match_bank_account_list')), [
    { account_no: '1234567890', code: 'scb' },
  ])
  assert.equal(calls[0].options.body.get('requested_by'), 'SnapBot: Test Shop')
})
