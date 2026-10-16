const assert = require('node:assert/strict')
const { File } = require('node:buffer')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function compile(file) {
  return ts.transpileModule(readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
}

// Real validation and bank helpers, fake receipt data only. No .env, API, or database access.
const banks = {}
vm.runInNewContext(compile('lib/banks.ts'), { exports: banks })
const api = {}
vm.runInNewContext(compile('lib/payment-validation.ts'), {
  exports: api,
  Uint8Array,
  require(name) {
    if (name === 'server-only') return {}
    if (name === '@/lib/banks') return banks
    throw new Error(`Unexpected validation dependency: ${name}`)
  },
})

const now = Date.parse('2026-10-14T05:06:00Z')
const session = {
  price_baht: 390,
  created_at: '2026-10-14T05:00:00Z',
  expires_at: '2026-10-14T05:15:00Z',
  receiver_promptpay_id: '0812345678',
  receiver_account_no: '1234567890',
  receiver_bank_code: 'KBANK',
}

function slip({ amount = 390, data = {}, raw = {}, ...fields } = {}) {
  return {
    verdict: 'valid', amount, transRef: 'transfer-unique-1',
    raw: {
      success: true,
      ...raw,
      data: {
        success: true,
        amount,
        transRef: 'transfer-unique-1',
        receivingBank: '004',
        receiver: { account: { value: 'xxxxxx7890' } },
        transDate: '20261014',
        transTime: '12:05:00',
        ...data,
      },
    },
    ...fields,
  }
}

const check = (result, details = session, clock = now) => api.validatePaymentSlip(result, details, clock)

test('provider-verified payments skip local receiver labels but require exact amount and real verification', () => {
  const details={...session,price_baht:9,receiver_bank_code:''}
  const verified=slip({amount:9,receiverVerifiedByProvider:true,data:{receivingBank:'unknown',receiver:null}})
  assert.equal(api.validatePaymentSlip(verified,details,now,false,'provider').ok,true)
  assert.equal(api.validatePaymentSlip({...verified,receiverVerifiedByProvider:false},details,now,false,'provider').ok,false)
  assert.equal(api.validatePaymentSlip({...verified,verdict:'wrong_receiver'},details,now,false,'provider').ok,false)
  for(const amount of [8,10]) assert.equal(api.validatePaymentSlip(slip({amount,receiverVerifiedByProvider:true}),details,now,false,'provider').ok,false)
  assert.equal(api.validatePaymentSlip(slip({amount:9,receiverVerifiedByProvider:true,raw:{success:false}}),details,now,false,'provider').ok,false)
})

test('KTB aliases and exact registered PromptPay identify the platform receiver', () => {
  const details = { ...session, price_baht: 9, receiver_bank_code: '006', receiver_account_no: '9260337828', receiver_promptpay_id: '0932576114' }
  for (const bank of ['KTB','006',6,'ktb']) {
    assert.equal(check(slip({amount:9,data:{receivingBank:bank,receiver:{account:{value:'9260337828'}}}}),details).ok,true)
  }
  for (const bank of ['PROMPTPAY','พร้อมเพย์','004',null]) {
    assert.equal(check(slip({amount:9,data:{receivingBank:bank,receiver:{proxy:{value:'+66 93-257-6114'}}}}),details).ok,true)
    assert.equal(check(slip({amount:9,data:{receivingBank:bank,receiver:{proxy:{value:'0932576115'}}}}),details).ok,false)
    assert.equal(check(slip({amount:9,data:{receivingBank:bank,receiver:{proxy:{value:'093xxx6114'}}}}),details).ok,false)
    assert.equal(check(slip({amount:9,data:{receivingBank:bank,receiver:{account:{value:'9260337828'}}}}),details).ok,false)
  }
})

test('KTB platform receiver accepts bank account and PromptPay in either SlipOK receiver field', () => {
  const details = { ...session, price_baht: 9, receiver_bank_code: '006', receiver_account_no: '9260337828', receiver_promptpay_id: '0932576114' }
  for (const receiver of [
    { account: { value: '9260337828' } },
    { account: { value: '926-0-33782-8' } },
    { account: { value: 'xxx-x-x3782-8' } },
    { proxy: { value: '0932576114' } },
    { account: { value: '0932576114' } },
    { proxy: { value: '+66932576114' } },
    { proxy: { value: '093-xxx-6114' } },
    { proxy: { value: '9260337828' } },
  ]) assert.equal(check(slip({amount:9,data:{receivingBank:'006',receiver}}),details).ok,true)
  assert.equal(check(slip({amount:9,data:{receivingBank:'004',receiver:{account:{value:'9260337828'}}}}),details).ok,false)
  assert.equal(check(slip({amount:9,data:{receivingBank:'006',receiver:{account:{value:'1863478037'}}}}),details).ok,false)
  for (const name of ['ภาคภูมิ','PAKPHUM','Srichomphu']) {
    assert.equal(check(slip({amount:9,data:{receivingBank:'006',receiver:{name,displayName:name}}}),details).ok,false)
  }
  assert.equal(check(slip({amount:9,verdict:'wrong_receiver',branchReceiverMismatch:true,data:{receivingBank:'006',receiver:{account:{value:'9260337828'}}}}),details).ok,false)
})

test('automatic billing accepts overpayment but rejects underpayment and inconsistent raw amounts', () => {
  for (const amount of [390,390.01,500]) assert.equal(api.validatePaymentSlip(slip({amount}),session,now,true).ok,true)
  for (const amount of [389.99,0,NaN,390.001]) assert.equal(api.validatePaymentSlip(slip({amount}),session,now,true).ok,false)
  assert.equal(api.validatePaymentSlip(slip({amount:500,data:{amount:390}}),session,now,true).ok,false)
  assert.equal(api.validatePaymentSlip(slip({verdict:'duplicate'}),session,now,true).ok,false)
  assert.equal(api.validatePaymentSlip(slip({data:{receiver:{account:{value:'xxxxxx9999'}}}}),session,now,true).ok,false)
})
const reject = (result, details = session, clock = now, status = 422) => {
  const validation = check(result, details, clock)
  assert.equal(validation.ok, false)
  assert.equal(validation.status, status)
  assert.equal(typeof validation.error, 'string')
  assert.ok(validation.error.length > 0)
}

test('Starter and Pro payments require exact server-stored price and return Bangkok transfer time', () => {
  for (const amount of [390, 990]) {
    const result = check(slip({ amount }), { ...session, price_baht: amount })
    assert.equal(result.ok, true)
    assert.equal(result.amount, amount)
    assert.equal(result.transRef, 'transfer-unique-1')
    assert.equal(result.paidAt, '2026-10-14T05:05:00.000Z')
  }
})

test('wrong, non-finite, fractional-satang, missing and inconsistent amounts are rejected', () => {
  for (const amount of [389.99, 390.01, 390.001, NaN, Infinity, -390, 0, null]) {
    reject(slip({ amount }))
  }
  reject({ ...slip(), amount: undefined })
  reject(slip({ data: { amount: 990 } }))
  reject(slip({ data: { amount: '390.001' } }))
  assert.equal(check(slip({ data: { amount: '390.00' } })).ok, true)
  assert.equal(check(slip({ amount: 390.29 }), { ...session, price_baht: 390.29 }).ok, true)
})

test('successful verdict without authoritative provider success or valid transaction reference is rejected', () => {
  for (const result of [
    slip({ raw: { success: false } }),
    slip({ raw: { success: 'true' } }),
    slip({ data: { success: false } }),
    slip({ data: { success: 'true' } }),
    { ...slip(), raw: null },
    { verdict: 'valid', amount: 390, transRef: 'ref', raw: null },
    slip({ transRef: '' }),
    slip({ transRef: 'x'.repeat(201), data: { transRef: 'x'.repeat(201) } }),
    slip({ transRef: 'ref\nsecret', data: { transRef: 'ref\nsecret' } }),
    slip({ data: { transRef: 'different-ref' } }),
  ]) reject(result)
})

test('receiving bank is mandatory and resolves a configured alias or numeric bank code', () => {
  reject(slip({ data: { receivingBank: '006' } }))
  reject(slip({ data: { receivingBank: undefined } }))
  reject(slip({ data: { receivingBank: 'UNKNOWN' } }))
  assert.equal(check(slip(), { ...session, receiver_bank_code: '004' }).ok, true)
  assert.equal(check(slip({ data: { receivingBank: 4 } })).ok, true)
})

test('masked receiving account needs at least four matching visible digits in correct positions', () => {
  for (const printed of ['1234567890', 'xxxxxx7890', '123xxx7890', 'xxx-x-xx7890', '12*****890', '1234x']) {
    assert.equal(check(slip({ data: { receiver: { account: { value: printed } } } })).ok, true, printed)
  }
  for (const printed of ['xxxxxxx890', 'xxxxxx7891', '1234567899', 'xxxxxx7890garbage', '', null]) {
    reject(slip({ data: { receiver: { account: { value: printed } } } }))
  }
  reject(slip({ data: { receiver: null } }))
})

test('PromptPay supports country prefixes and masked digits but still requires receiving bank', () => {
  for (const proxy of ['0812345678', '66812345678', '+66 81-234-5678', '0066812345678', 'xxx2345678']) {
    const result = slip({ data: { receiver: { account: { value: 'unmatched' }, proxy: { value: proxy } } } })
    assert.equal(check(result).ok, true, proxy)
  }
  for (const proxy of ['0812345679', 'xxxxxxx678', 'garbage0812345678', '081234567']) {
    reject(slip({ data: { receiver: { proxy: { value: proxy } } } }))
  }
  assert.equal(check(slip({ data: { receivingBank: '006', receiver: { proxy: { value: session.receiver_promptpay_id } } } })).ok, true)
  for (const id of ['1234567890123', '123456789012345']) {
    assert.equal(check(slip({ data: { receiver: { proxy: { value: id } } } }), { ...session, receiver_promptpay_id: id }).ok, true)
    reject(slip({ data: { receiver: { proxy: { value: id.slice(0, -1) + '9' } } } }), { ...session, receiver_promptpay_id: id })
  }
})

test('wrong receiver and branch receiver mismatch can never be overridden by local account matching', () => {
  reject(slip({ verdict: 'wrong_receiver', branchReceiverMismatch: true }))
  reject(slip({ verdict: 'wrong_receiver' }))
  reject(slip({ branchReceiverMismatch: true }))
  reject(slip({ raw: { code: 1014 } }))
})

test('duplicate, amount mismatch, fake and provider errors remain non-activating', () => {
  reject(slip({ verdict: 'duplicate' }), session, now, 409)
  reject(slip({ verdict: 'amount_mismatch' }))
  reject(slip({ verdict: 'fake' }))
  reject(slip({ verdict: 'error', providerFault: true }), session, now, 503)
  reject(slip({ verdict: 'error', providerFault: false }))
})

test('transfer must be fresh, before payment expiry and no more than two minutes in the future', () => {
  reject(slip({ data: { transTime: '11:57:59' } }))
  reject(slip({ data: { transTime: '12:08:01' } }))
  reject(slip({ data: { transTime: '12:15:01' } }), session, Date.parse('2026-10-14T05:14:00Z'))
  assert.equal(check(slip({ data: { transTime: '11:58:00' } })).ok, true)
  assert.equal(check(slip({ data: { transTime: '12:08:00' } })).ok, true)
  reject(slip(), session, Date.parse('2026-10-14T05:15:01Z'), 409)
})

test('malformed or impossible calendar dates and times cannot pass Date.parse rollover', () => {
  for (const data of [
    { transDate: '20260230' },
    { transDate: '20261301' },
    { transDate: '20260014' },
    { transDate: '20261000' },
    { transDate: '2026-10-14' },
    { transDate: 20261014 },
    { transTime: '24:00:00' },
    { transTime: '12:60:00' },
    { transTime: '12:05:60' },
    { transTime: '12:05' },
    { transTime: undefined },
  ]) reject(slip({ data }))
})

test('invalid price, bank or payment window in a server snapshot fails closed', () => {
  for (const changes of [
    { price_baht: NaN },
    { price_baht: 0 },
    { receiver_bank_code: '' },
    { receiver_bank_code: 'PROMPTPAY' },
    { created_at: 'invalid' },
    { expires_at: 'invalid' },
    { expires_at: session.created_at },
  ]) reject(slip(), { ...session, ...changes }, now, 500)
})

test('images must have matching JPEG, PNG or WebP signatures; empty and oversized files are rejected', async () => {
  const jpeg = [0xff, 0xd8, 0xff, 0xe0]
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  const webp = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]
  for (const [bytes, type] of [[jpeg, 'image/jpeg'], [png, 'image/png'], [webp, 'image/webp']]) {
    assert.equal(await api.isPaymentImage(new File([new Uint8Array(bytes)], 'slip', { type })), true)
  }
  for (const file of [
    new File([], 'empty', { type: 'image/jpeg' }),
    new File(['text disguised as image'], 'fake.png', { type: 'image/png' }),
    new File([new Uint8Array(jpeg)], 'wrong-mime', { type: 'image/webp' }),
    new File(['<svg/>'], 'image.svg', { type: 'image/svg+xml' }),
    new File([new Uint8Array([0xff, 0xd8])], 'truncated.jpg', { type: 'image/jpeg' }),
    new File([new Uint8Array(api.PAYMENT_MAX_BYTES + 1)], 'large.jpg', { type: 'image/jpeg' }),
  ]) assert.equal(await api.isPaymentImage(file), false)
  assert.equal(api.PAYMENT_MAX_BYTES, 5 * 1024 * 1024)
})
