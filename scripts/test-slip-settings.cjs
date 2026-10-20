const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')
const compile = file => ts.transpileModule(readFileSync(join(__dirname, '..', file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText
const plans = {}
vm.runInNewContext(compile('lib/features/billing/plans.ts'), { exports: plans })
const summary = {}
vm.runInNewContext(compile('lib/features/slips/slip-summary.ts'), { exports: summary })

test('Slip dashboard totals distinguish passed, rejected, pending and provider errors', () => {
  const rows = [
    { status: 'valid', amount: 390 }, { status: 'valid', amount: 990 },
    { status: 'duplicate', amount: 990 }, { status: 'wrong_receiver', amount: 100 },
    { status: 'pending', amount: null }, { status: 'error', amount: null },
  ]
  assert.deepEqual(JSON.parse(JSON.stringify(summary.summarizeSlips(rows))), { amount: 1380, passed: 2, failed: 2, pending: 1, errors: 1 })
  assert.equal(summary.summarizeSlips([]).amount, 0)
})

async function submit(section, role = 'owner', featureBypass = false, tenantId = 'shop') {
  const requests = []
  let refreshes = 0
  const tenant = { id: tenantId, name: 'Page', page_id: '1234567', bank_code: 'KBANK', account_name: 'Owner',
    account_number: '1234567890', expected_amount: 390, auto_verify_enabled: true, auto_reply_enabled: true, slip_quota: 100, slip_used: 1 }
  const exports = {}
  const jsx = (type, props) => ({ type, props })
  vm.runInNewContext(compile('components/settings/TenantSettingsForm.tsx'), { exports,
    fetch: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ tenant }) } },
    require(name) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
      if (name === 'react') return { useState: initial => [initial, () => {}] }
      if (name === 'next/navigation') return { useRouter: () => ({ refresh() { refreshes++ }, replace() { throw new Error('Saving existing settings must not navigate away') } }) }
      if (name === '@/lib/features/billing/plans') return plans
      if (name === '@/lib/features/banking/banks') return { BANKS: [] }
      if (name === '@/lib/utils') return { cn: (...args) => args.join(' '), apiError: async () => 'error' }
      return new Proxy({}, { get: (_, key) => String(key) })
    },
  })
  const form = exports.TenantSettingsForm({ section, role, tenant, pages: [], isFirst: false,
    billing: { plan: 'free', planExpiresAt: null, featureBypass }, slipCredits: { quota: 100, used: 1 } })
  await form.props.onSubmit({ preventDefault() {} })
  assert.equal(requests[0].url, `/api/tenants/${tenantId}`)
  assert.equal(refreshes, 1)
  return requests[0].body
}
test('Facebook settings save cannot overwrite bank, slip switches or credit quota', async () => {
  assert.deepEqual(await submit('facebook', 'admin'), { name: 'Page', page_id: '1234567' })
})
test('Bank/slip settings save cannot overwrite Facebook identity or access token', async () => {
  const body = await submit('bank-slip')
  for (const field of ['bank_code', 'account_number', 'account_name']) assert.equal(Object.hasOwn(body, field), false)
  assert.equal(body.auto_verify_enabled, false) // ordinary Free customer is gated
  for (const field of ['name', 'page_id', 'page_access_token', 'slip_quota']) assert.equal(Object.hasOwn(body, field), false)
  const admin = await submit('bank-slip', 'admin')
  assert.equal(admin.auto_verify_enabled, true)
  assert.equal(admin.slip_quota, 100)
  const staff = await submit('bank-slip', 'staff')
  assert.deepEqual(Object.keys(staff).sort(), ['auto_reply_enabled', 'auto_verify_enabled'])
})

test('Saving settings for Page A/B uses its own tenant endpoint and only refreshes the current tab', async () => {
  for (const id of ['page-A-tenant', 'page-B-tenant', 'page-A-tenant']) await submit('bank-slip', 'owner', false, id)
})
