const fs = require('node:fs'),
  vm = require('node:vm'),
  ts = require('typescript'),
  assert = require('node:assert/strict'),
  { test } = require('node:test'),
  React = require('react'),
  { renderToStaticMarkup } = require('react-dom/server')
function load(file, deps = {}, globals = {}) {
  const context = {
    exports: {},
    console,
    Date,
    JSON,
    Object,
    Number,
    Math,
    URLSearchParams,
    require: (n) => {
      if (n in deps) return deps[n]
      throw Error('Unexpected dependency ' + n)
    },
    ...globals,
  }
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    context,
  )
  return context.exports
}
const tenant = '11111111-1111-4111-8111-111111111111',
  account = '22222222-2222-4222-8222-222222222222',
  actor = { kind: 'user', id: '33333333-3333-4333-8333-333333333333' }
class InboxError extends Error {
  constructor(message, status = 400, code = 'BAD_REQUEST') {
    super(message)
    this.status = status
    this.code = code
  }
}
const errors = {
  InboxError,
  inboxError: (e) => ({ status: e.status ?? 503, body: { code: e.code } }),
  checkRpc: (e) => {
    if (e) throw e
  },
}
test('bank guard rejects unauthenticated, internal, foreign tenant and staff writes before sensitive reads', async () => {
  for (const [who, member, owner, write, status] of [
    [null, true, true, false, 401],
    [{ kind: 'internal' }, true, true, false, 401],
    [actor, false, false, false, 404],
    [actor, true, false, true, 403],
  ]) {
    let reads = 0
    const api = load('lib/features/slips/slip-bank-server.ts', {
      'server-only': {},
      '@/lib/auth': {
        getActor: async () => who,
        canAccessTenant: async (a, t, r) => (r === 'owner' ? owner : member),
      },
      '@/lib/supabase/server': {
        supabaseAdmin() {
          reads++
          throw Error('Must not read')
        },
      },
      '@/lib/features/inbox/inbox-server': errors,
      '@/lib/utils': { UUID: /^[0-9a-f-]{36}$/ },
      'promptpay-qr': {
        default: () => {
          throw Error('Must not create QR')
        },
      },
    })
    await assert.rejects(api.slipBankTenant({}, tenant, write), (e) => e.status === status)
    assert.equal(reads, 0)
  }
})
test('QR only encodes an active registered supported PromptPay identifier, never a bank account', () => {
  let identifiers = []
  const api = load('lib/features/slips/slip-bank-server.ts', {
    'server-only': {},
    '@/lib/auth': {},
    '@/lib/supabase/server': {},
    '@/lib/features/inbox/inbox-server': errors,
    '@/lib/utils': {},
    'promptpay-qr': {
      default: (id) => {
        identifiers.push(id)
        return 'QR:' + id
      },
    },
  })
  for (const a of [
    { bank_code: 'KTB', account_number: '9260337828', is_active: true },
    { bank_code: 'PROMPTPAY', account_number: '0932576114', is_active: false },
    { bank_code: 'PROMPTPAY', account_number: 'invalid', is_active: true },
  ])
    assert.equal(api.bankQr(a), null)
  assert.equal(
    api.bankQr({ bank_code: 'PROMPTPAY', account_number: '0932576114', is_active: true }),
    'QR:0932576114',
  )
  assert.deepEqual(identifiers, ['0932576114'])
})
const request = (body) => ({
  nextUrl: new URL('https://test/api/bank-accounts?tenantId=' + tenant),
  json: async () => body,
})
const banks = load('lib/features/banking/banks.ts')
const bankValidation = load('lib/features/banking/bank-accounts.ts', {
  '@/lib/features/banking/banks': banks,
})
function bankApi(owner = true) {
  let calls = []
  const rows = [
      {
        id: account,
        tenant_id: tenant,
        bank_code: 'KBANK',
        account_name: 'Owner',
        account_number: '0932576114',
        is_active: true,
        is_primary: true,
      },
    ],
    q = {
      select() {
        return q
      },
      eq() {
        return q
      },
      order() {
        return q
      },
      limit() {
        return q
      },
      maybeSingle: async () => ({ data: rows[0], error: null }),
      then(resolve) {
        return Promise.resolve({ data: rows, error: null }).then(resolve)
      },
    }
  const db = {
    from: () => q,
    rpc: async (name, args) => {
      calls.push({ name, args })
      return { data: account, error: null }
    },
  }
  const api = load('app/api/bank-accounts/route.ts', {
    'next/server': {
      NextResponse: { json: (body, opts = {}) => ({ body, status: 200, ...opts }) },
    },
    '@/lib/features/slips/slip-bank-server': {
      slipBankTenant: async (req, t, write) => {
        if (write && !owner) throw new InboxError('Forbidden', 403)
        return { db, tenantId: tenant, actor, owner }
      },
      bankQr: (a) => 'QR:' + a.account_number,
    },
    '@/lib/features/banking/banks': banks,
    '@/lib/features/banking/bank-accounts': bankValidation,
    '@/lib/features/inbox/inbox-server': errors,
    '@/lib/utils': { UUID: /^[0-9a-f-]{36}$/ },
  })
  return { api, calls, rows }
}
test('staff bank response masks account numbers and never includes a decodable QR', async () => {
  const f = bankApi(false),
    r = await f.api.GET(request())
  assert.equal(r.body.accounts[0].account_number, '••••6114')
  assert.equal(r.body.accounts[0].qrPayload, null)
  assert.equal(r.body.canManage, false)
  assert.ok(!JSON.stringify(r.body).includes('0932576114'))
  assert.equal(r.headers['Cache-Control'], 'private, no-store')
})
test('bank mutation requires confirmation and ignores forged actor, tenant, primary and credit fields', async () => {
  const f = bankApi()
  assert.equal((await f.api.POST(request({ action: 'primary', id: account }))).status, 409)
  assert.equal(f.calls.length, 0)
  assert.equal(
    (
      await f.api.POST(
        request({
          action: 'primary',
          id: account,
          confirmed: true,
          tenantId: 'foreign',
          actor: 'forged',
          slip_quota: 999,
        }),
      )
    ).status,
    200,
  )
  assert.equal(f.calls[0].args.p_tenant, tenant)
  assert.equal(f.calls[0].args.p_actor, actor.id)
  assert.deepEqual(Object.keys(f.calls[0].args.p_data), [])
  assert.equal(
    (await bankApi(false).api.POST(request({ action: 'primary', id: account, confirmed: true })))
      .status,
    403,
  )
})
test('report ranges use Bangkok boundaries, validate dates and bound search input', () => {
  const core = load('lib/features/payments/payment-pro-core.ts')
  const f = core.paymentReportFilters('7', ' own ', new Date('2026-10-15T18:00:00Z'))
  assert.equal(f.from, '2026-10-09T17:00:00.000Z')
  assert.equal(f.q, 'own')
  assert.throws(() => core.paymentReportFilters('all'))
  assert.throws(() => core.paymentReportFilters('30', 'x'.repeat(101)))
})
test('UI-only rollback switch leaves verification master logic unchanged', () => {
  const core = load('lib/features/payments/payment-pro-core.ts'),
    flags = load(
      'lib/features/payments/payment-pro-flags.ts',
      { 'server-only': {}, '@/lib/features/payments/payment-pro-core': core },
      { process: { env: { NODE_ENV: 'development', PAYMENT_PRO_UI_ENABLED: 'false' } } },
    )
  assert.equal(flags.paymentProUiEnabled(), false)
  assert.equal(flags.paymentProAvailable(), true)
})
const jsx = require('react/jsx-runtime'),
  link = {
    default: ({ href, children, scroll, ...p }) =>
      React.createElement('a', { href, ...p }, children),
  },
  icons = require('lucide-react')
test('unsupported and unknown bank writes fail before RPC; old rows remain readable and can be disabled', async () => {
  for (const code of ['SCBT', 'PROMPTPAY', 'UNKNOWN']) {
    const f = bankApi()
    f.rows[0].bank_code = code
    assert.equal((await f.api.GET(request())).body.accounts[0].bank_code, code)
    assert.equal(
      (
        await f.api.POST(
          request({
            action: 'save',
            bank_code: code,
            account_name: 'Owner',
            account_number: '0932576114',
            is_active: true,
            confirmed: true,
          }),
        )
      ).status,
      400,
    )
    assert.equal(
      (await f.api.POST(request({ action: 'primary', id: account, confirmed: true }))).status,
      400,
    )
    assert.equal(f.calls.length, 0)
    assert.equal(
      (await f.api.POST(request({ action: 'toggle', id: account, confirmed: true }))).status,
      200,
    )
    f.rows[0].is_active = false
    f.calls.length = 0
    assert.equal(
      (await f.api.POST(request({ action: 'toggle', id: account, confirmed: true }))).status,
      400,
    )
    assert.equal(f.calls.length, 0)
  }
  for (const bank of banks.SUPPORTED_BANKS) {
    const f = bankApi()
    assert.equal(
      (
        await f.api.POST(
          request({
            action: 'save',
            bank_code: bank.code,
            account_name: 'Owner',
            account_number: '0932576114',
            is_active: true,
            confirmed: true,
          }),
        )
      ).status,
      200,
    )
    assert.equal(f.calls.length, 1)
  }
})
test('tabs use same-route query links, proper selected tab and keyboard focus navigation', () => {
  const nodes = [
    {
      focus() {
        focused = 0
      },
    },
    {
      focus() {
        focused = 1
      },
    },
  ]
  let focused = -1
  const Tabs = load(
    'components/slips/SlipTabs.tsx',
    {
      'react/jsx-runtime': jsx,
      'next/link': link,
      'lucide-react': icons,
      '@/components/slips/PaymentChannelsGuide': { paymentTabHelp: {} },
    },
    { document: { activeElement: nodes[0] } },
  ).SlipTabs
  const tree = Tabs({ activeTab: 'settings' }),
    html = renderToStaticMarkup(tree)
  assert.ok(html.includes('/slips?tab=overview'))
  assert.ok(html.includes('/slips?tab=settings'))
  assert.ok(html.includes('role="tablist"'))
  assert.ok(html.includes('aria-controls="slip-tab-panel"'))
  assert.ok(!html.includes('/slips/settings'))
  tree.props.onKeyDown({
    key: 'ArrowRight',
    preventDefault() {},
    currentTarget: { querySelectorAll: () => nodes },
  })
  assert.equal(focused, 1)
})
test('both panels share one Pro header; flag-off retains legacy overview and settings stays in place', () => {
  const tabs = load('components/slips/SlipTabs.tsx', {
    'react/jsx-runtime': jsx,
    'next/link': link,
    'lucide-react': icons,
    '@/components/slips/PaymentChannelsGuide': { paymentTabHelp: {} },
  })
  const component = load('components/slips/SlipsDashboard.tsx', {
    'react/jsx-runtime': jsx,
    'next/link': link,
    'lucide-react': icons,
    '@/components/slips/SlipsWorkspace': {
      SlipsWorkspace: () => React.createElement('div', { 'data-panel': 'legacy' }),
    },
    '@/components/slips/SlipSettingsTab': {
      SlipSettingsTab: () => React.createElement('div', { 'data-panel': 'settings' }),
    },
    '@/components/slips/SlipOverviewTab': {
      SlipOverviewTab: () => React.createElement('div', { 'data-panel': 'pro' }),
    },
    '@/components/slips/SlipTabs': tabs,
    '@/components/slips/BankQrWorkspace': {},
    '@/components/slips/ReceivingCodeManager': {},
    '@/components/settings/BankAccountsManager': {},
    '@/components/slips/PaymentAutomationSettings': {},
    '@/components/slips/PaymentChannelStatus': {},
    '@/components/slips/PaymentChannelsGuide': {},
  }).SlipsDashboard
  for (const activeTab of ['overview', 'settings']) {
    const html = renderToStaticMarkup(
      React.createElement(component, {
        tenant: {
          id: tenant,
          name: 'Own shop',
          slip_quota: 100,
          slip_quota_credits: 50,
          slip_used: 20,
        },
        billing: {},
        role: 'owner',
        initial: [],
        activeTab,
        proEnabled: true,
      }),
    )
    assert.equal((html.match(/<h1/g) ?? []).length, 1)
    assert.ok(html.includes('Payment Verification Pro'))
    assert.ok(html.includes('role="tabpanel"'))
    assert.ok(html.includes('data-panel="' + (activeTab === 'settings' ? 'settings' : 'pro') + '"'))
    assert.ok(html.includes('130'))
  }
  const legacy = renderToStaticMarkup(
    React.createElement(component, {
      tenant: { id: tenant, slip_quota: 0, slip_quota_credits: 0, slip_used: 0 },
      billing: {},
      role: 'staff',
      initial: [],
      activeTab: 'overview',
      proEnabled: false,
    }),
  )
  assert.ok(legacy.includes('data-panel="legacy"'))
})
