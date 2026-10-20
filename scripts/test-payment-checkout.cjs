const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const { test } = require('node:test')
function load(file, deps = {}) {
  const context = { exports: {}, Date, require: name => deps[name] }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context)
  return context.exports
}
const plans = load('lib/features/billing/plans.ts')
const { canResumeCheckout } = load('lib/features/payments/payment-checkout.ts', { '@/lib/features/billing/plans': plans })
const now = Date.now()
const session = (plan, amount) => ({ tenantId: 'shop', plan, amount, credits: plans.PLANS[plan].credits, expiresAt: new Date(now + 60000).toISOString() })
test('old unpaid 390/990 checkouts are replaced; new 9/19 checkouts can resume', () => {
  for (const [plan, oldPrice, price] of [['starter', 390, 9], ['pro', 990, 19]]) {
    assert.equal(plans.PLANS[plan].price, price)
    assert.equal(canResumeCheckout(session(plan, oldPrice), 'shop', plan, 'pending', now), false)
    assert.equal(canResumeCheckout(session(plan, price), 'shop', plan, 'pending', now), true)
  }
})
test('expired, different tenant/plan and obsolete credit snapshots cannot resume', () => {
  const s = session('starter', 9)
  assert.equal(canResumeCheckout(s, 'other', 'starter', 'pending', now), false)
  assert.equal(canResumeCheckout(s, 'shop', 'pro', 'pending', now), false)
  assert.equal(canResumeCheckout(s, 'shop', 'starter', 'expired', now), false)
  assert.equal(canResumeCheckout(s, 'shop', 'starter', 'pending', now + 120000), false)
  assert.equal(canResumeCheckout({ ...s, credits: 1 }, 'shop', 'starter', 'pending', now), false)
})
test('verified proof and completed payments retain original price for safe recovery', () => {
  for (const status of ['verified', 'paid']) {
    assert.equal(canResumeCheckout(session('starter', 390), 'shop', 'starter', status, now), true)
  }
})
