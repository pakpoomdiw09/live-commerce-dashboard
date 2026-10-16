const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')
const compile = p => ts.transpileModule(readFileSync(join(__dirname, '..', p), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
function fixture({ amount = 0.3, error = null, empty = false, accounts = [{tenant_id:'shop',bank_code:'KBANK',account_number:'1234567890',is_active:true}], slip = {} } = {}) {
  const queries = [], checks = []
  const rows = empty ? [] : [
    { id: 'one', customer_id: 'customer', tenant_id: 'shop', status: 'pending_payment', amount: 0.1 },
    { id: 'two', customer_id: 'customer', tenant_id: 'shop', status: 'pending_payment', amount: 0.2 },
    { id: 'other', customer_id: 'customer', tenant_id: 'other-shop', status: 'pending_payment', amount: 900 },
    { id: 'paid', customer_id: 'customer', tenant_id: 'shop', status: 'paid', amount: 900 },
  ]
  const db = { rpc: async () => ({ data: true, error: null }), from(table) {
    const q = { table, filters: [], operation: 'select' }; queries.push(q)
    const builder = {
      select() { return this }, insert(v) { q.operation = 'insert'; q.value = v; return this },
      update(v) { q.operation = 'update'; q.value = v; return this },
      eq(k, v) { q.filters.push([k, v]); return this }, in(k, v) { q.filters.push([k, v]); return this },
      single: async () => ({ data: { id: 'slip' }, error: null }),
      then(resolve, reject) { return Promise.resolve({
        data: (table === 'bank_accounts' ? accounts : rows).filter(r => q.filters.every(([k, v]) => r[k] === v)),
        error: q.operation === 'select' && table === 'orders' ? error : null,
      }).then(resolve, reject) },
    }; return builder
  } }
  const orders = {}
  vm.runInNewContext(compile('lib/orders.ts'), { exports: orders, console, require: () => ({}) })
  const banks={}
  vm.runInNewContext(compile('lib/banks.ts'),{exports:banks})
  const process = {}
  vm.runInNewContext(compile('lib/slip/process.ts'), { exports: process, console, Date,
    process: { env: { NODE_ENV: 'production' } }, require(name) {
      if (name === '@/lib/banks') return banks
      if (name === '@/lib/orders') return orders
      if (name === '@/lib/feature-access') return { requireFeature: async () => {} }
      if (name === '@/lib/auth') return { tenantHasFeatureBypass: async () => true }
      if (name === './slipok') return { verifyWithSlipOK: async args => {
        checks.push(args); return { verdict: 'valid', amount, transRef: 'ref', receiverBank: '004', receiverAccount: '1234567890', ...slip }
      } }
      return {}
    },
  })
  return { queries, checks, run: () => process.processSlip(db, { qr: 'fake-qr', customerId: 'customer',
    tenant: { id: 'shop', bank_code: 'KBANK', account_number: '1234567890' }, expectedAmount: 999 }) }
}
test('Order total overrides caller amount and excludes paid/other-Page orders', async () => {
  const f = fixture()
  assert.equal((await f.run()).status, 'valid')
  assert.equal(f.checks[0].expectedAmount, 0.3)
  assert.equal(f.queries.find(q => q.table === 'slips' && q.operation === 'insert').value.expected_amount, 0.3)
  assert.deepEqual(f.queries.find(q => q.table === 'orders' && q.operation === 'update').filters[0][1], ['one', 'two'])
})

test('receiver can match a second active account, but disabled accounts and other shops are excluded', async () => {
 const scb={tenant_id:'shop',bank_code:'SCB',account_number:'9876543210',is_active:true}
 const kbank={tenant_id:'shop',bank_code:'KBANK',account_number:'1234567890',is_active:true}
 assert.equal((await fixture({accounts:[scb,kbank]}).run()).status,'valid')
 assert.equal((await fixture({accounts:[scb,{...kbank,is_active:false}]}).run()).status,'wrong_receiver')
 assert.equal((await fixture({accounts:[scb,{...kbank,tenant_id:'other-shop'}]}).run()).status,'wrong_receiver')
 assert.equal((await fixture({accounts:[scb],slip:{receiverBank:'004',receiverAccount:'9876543210'}}).run()).status,'wrong_receiver')
})

test('PromptPay proxy matches an active identifier and branch 1014 is checked against all accounts', async () => {
 const pp={tenant_id:'shop',bank_code:'PROMPTPAY',account_number:'0812345678',is_active:true}
 assert.equal((await fixture({accounts:[pp],slip:{receiverProxy:'+66812345678',receiverAccount:'wrong',verdict:'wrong_receiver',branchReceiverMismatch:true}}).run()).status,'valid')
 assert.equal((await fixture({accounts:[pp],slip:{receiverProxy:'0819999999'}}).run()).status,'wrong_receiver')
 assert.equal((await fixture({accounts:[pp],slip:{receiverProxy:'0812345678',verdict:'duplicate'}}).run()).status,'duplicate')
 const none=fixture({accounts:[]})
 assert.equal((await none.run()).status,'error')
 assert.equal(none.checks.length,0)
})
test('Wrong or unreadable slip amount never marks orders paid', async () => {
  for (const amount of [10, undefined, NaN]) {
    const f = fixture({ amount: amount === undefined ? NaN : amount })
    assert.equal((await f.run()).status, 'amount_mismatch')
    assert.equal(f.queries.some(q => q.table === 'orders' && q.operation === 'update'), false)
  }
})
test('Order lookup failure stops before storing proof or calling SlipOK', async () => {
  const f = fixture({ error: { message: 'database offline' } })
  await assert.rejects(f.run(), /ออเดอร์/)
  assert.equal(f.checks.length, 0)
  assert.equal(f.queries.some(q => q.operation === 'insert'), false)
})

test('missing provider reference or non-positive amount cannot accept a slip without an order total', async () => {
  for (const slip of [{transRef:undefined},{transRef:''},{transRef:'   '},{amount:0},{amount:-1},{amount:NaN}]) {
    const f=fixture({empty:true,slip})
    const result=await f.run()
    assert.notEqual(result.status,'valid')
    assert.equal(f.queries.some(q=>q.table==='orders'&&q.operation==='update'),false)
  }
})
test('customer payment synchronization is tenant-scoped and cannot regress paid/approved/shipped state',async()=>{
  const f=fixture({slip:{verdict:'fake'}})
  await f.run()
  const update=f.queries.find(q=>q.table==='customers'&&q.operation==='update')
  assert.ok(update.filters.some(([key,value])=>key==='tenant_id'&&value==='shop'))
  assert.deepEqual(Array.from(update.filters.find(([key])=>key==='order_status')[1]),['new','pending_review'])
})
