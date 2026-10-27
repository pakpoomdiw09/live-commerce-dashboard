const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

// Isolated module contracts: no environment files, database connections or real sends.
function load(file, dependencies = {}, globals = {}) {
  const context = {
    exports: {},
    process: { env: {} },
    console,
    URL,
    AbortSignal,
    require: (name) => {
      if (name === '@/lib/safe-logging') return require('./helpers/load-safe-logging.cjs')()
      if (name in dependencies) return dependencies[name]
      throw Error('Unexpected dependency: ' + name)
    },
    ...globals,
  }
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    context,
  )
  return context.exports
}

test('send receipt preserves messaging type, tag and bearer authorization', async () => {
  const calls = []
  const api = load(
    'lib/integrations/facebook/client.ts',
    {},
    {
      fetch: async (url, options) => {
        calls.push({ url, options })
        return { ok: true, status: 200, json: async () => ({ message_id: 'mid-real' }) }
      },
    },
  )
  for (const type of ['RESPONSE', 'UPDATE', { tag: 'POST_PURCHASE_UPDATE' }]) {
    assert.equal(
      await api.sendMessageWithReceipt('test-token', 'customer', { text: 'hello' }, type),
      'mid-real',
    )
    const request = calls.at(-1)
    const body = JSON.parse(request.options.body)
    assert.equal(request.options.headers.Authorization, 'Bearer test-token')
    assert.equal(body.recipient.id, 'customer')
    assert.equal(body.messaging_type, typeof type === 'string' ? type : 'MESSAGE_TAG')
    assert.equal(body.tag, typeof type === 'object' ? type.tag : undefined)
  }
})

test('explicit Send API refusal exposes structured error; missing receipt remains uncertain', async () => {
  let response = {
    ok: false,
    status: 400,
    text: async () =>
      JSON.stringify({ error: { code: 10, error_subcode: 2018278, message: 'window closed' } }),
  }
  const api = load('lib/integrations/facebook/client.ts', {}, { fetch: async () => response })
  await assert.rejects(
    api.sendMessageWithReceipt('token', 'psid', { text: 'hello' }),
    (error) =>
      error instanceof api.SendApiError &&
      error.status === 400 &&
      error.code === 10 &&
      api.isWindowOrTagError(error),
  )
  response = { ok: true, status: 200, json: async () => ({}) }
  await assert.rejects(
    api.sendMessageWithReceipt('token', 'psid', { text: 'hello' }),
    (error) => !(error instanceof api.SendApiError),
  )
  assert.equal(api.isWindowOrTagError(new Error('network timeout')), false)
  response = { ok: true, status: 200, json: async () => ({ error: { code: 190 } }) }
  await assert.rejects(
    api.sendMessageWithReceipt('token', 'psid', { text: 'hello' }),
    (error) => error instanceof api.SendApiError && error.code === 190,
  )
  response = { ok: true, status: 200, json: async () => ({ message_id: ' ' }) }
  await assert.rejects(api.sendMessageWithReceipt('token', 'psid', { text: 'hello' }))
})

test('quick replies omit empty labels and respect title/count limits', () => {
  const api = load('lib/integrations/facebook/client.ts')
  assert.equal(Object.keys(api.quickReplies([' ', ''])).length, 0)
  const buttons = api.quickReplies([' ', 'x'.repeat(30), ...Array(20).fill('choice')]).quick_replies
  assert.equal(buttons.length, 13)
  assert.equal(buttons[0].title.length, 20)
  assert.equal(buttons[0].payload.length, 30)
})

test('Meta error messages retain diagnostic text while masking the Page token and reflected payload', async () => {
  const pageToken = 'EAA_TEST_SECRET_12345678'
  const explanation = '(#2022) Your Page is temporarily restricted.'
  const api = load(
    'lib/integrations/facebook/client.ts',
    {},
    {
      fetch: async () => ({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            error: {
              message: explanation + ' access_token=' + pageToken + ' body=private outbound text',
              code: 2022,
              error_subcode: 1404132,
            },
          }),
      }),
    },
  )
  await assert.rejects(
    api.sendMessageWithReceipt(pageToken, '1234567890', { text: 'private outbound text' }),
    (error) => {
      assert.equal(error.code, 2022)
      assert.equal(error.subcode, 1404132)
      assert.ok(error.providerMessage.includes(explanation))
      assert.ok(!JSON.stringify(error).includes(pageToken))
      assert.ok(!JSON.stringify(error).includes('private outbound text'))
      assert.equal(api.isWindowOrTagError(error), false)
      return true
    },
  )
  assert.equal(
    api.isWindowOrTagError(
      new api.SendApiError(400, 10, null, 'Application does not have permission'),
    ),
    false,
  )
  assert.equal(
    api.isWindowOrTagError(
      new api.SendApiError(400, 10, null, 'Message sent outside the 24-hour messaging window'),
    ),
    true,
  )
})

test('customer profiles retain usable names/photos and do not erase saved data after errors', async () => {
  let response = {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({
      first_name: 'Test',
      last_name: 'Customer',
      profile_pic: 'https://example.com/avatar.png',
    }),
  }
  const api = load('lib/integrations/facebook/client.ts', {}, { fetch: async () => response })
  const profile = await api.getCustomerProfile('token', '123456')
  assert.equal(profile.display_name, 'Test Customer')
  assert.equal(profile.avatar_url, 'https://example.com/avatar.png')
  response = { ok: false, status: 403, json: async () => ({ error: { code: 10 } }) }
  assert.equal(Object.keys(await api.getCustomerProfile('token', 'psid')).length, 0)
  assert.equal(Object.keys(await api.getCustomerProfile(null, 'psid')).length, 0)
})

test('receiver matching requires an active account with matching bank and visible digits', () => {
  const banks = load('lib/features/banking/banks.ts')
  const api = load('lib/features/slips/process.ts', {
    'server-only': {},
    '@/lib/features/slips/receiver-matching': load('lib/features/slips/receiver-matching.ts', {
      '@/lib/features/banking/banks': banks,
    }),
    '@/lib/features/slips/slipok': {},
    '@/lib/features/banking/banks': banks,
    '@/lib/feature-access': {},
    '@/lib/features/commerce/orders': {},
  })
  const accounts = [
    { bank_code: 'KBANK', account_number: '1234567890', is_active: false },
    { bank_code: 'TTB', account_number: '9876543210', is_active: true },
  ]
  assert.equal(api.receiverMatchesAny(accounts, '011', '987xxx3210'), true)
  assert.equal(api.receiverMatchesAny(accounts, '004', '1234567890'), false)
  assert.equal(api.receiverMatchesAny(accounts, '004', '9876543210'), false)
  assert.equal(api.receiverMatchesAny(accounts, '011', 'xxxxxx10'), false)
  assert.equal(api.receiverMatchesAny(null, '011', '9876543210'), false)
  assert.equal(
    api.receiverMatchesAny(
      [{ bank_code: 'PROMPTPAY', account_number: '0812345678', is_active: true }],
      '004',
      undefined,
      '0812345678',
    ),
    true,
  )
  for (const alias of ['TMB', 'TTBNK', '011', 'CIMBT', 'UOBT'])
    assert.equal(banks.isSupportedBank(alias), true)
  for (const unsupported of ['UNKNOWN', '', 'PROMPTPAY', 'SCBT'])
    assert.equal(banks.isSupportedBank(unsupported), false)
})

test('connected Page lookup scopes by user and Page and exposes no access token', async () => {
  const filters = []
  let columns
  const query = {
    select(value) {
      columns = value
      return this
    },
    eq(key, value) {
      filters.push([key, value])
      return this
    },
    maybeSingle: async () => ({
      data: { page_id: 'page', name: 'Shop', picture: null },
      error: null,
    }),
  }
  const api = load('lib/tenant.ts', {
    'server-only': {},
    react: { cache: (fn) => fn },
    'next/headers': {},
    '@/lib/supabase/server': { supabaseAdmin: () => ({ from: () => query }) },
    '@/lib/auth': {},
    '@/lib/integrations/facebook/client': {},
    '@/lib/types': {},
  })
  const page = await api.connectedFacebookPage('owner', 'page')
  assert.equal(page.page_id, 'page')
  assert.equal(columns.replace(/\s/g, ''), 'page_id,name,picture')
  assert.deepEqual(filters, [
    ['user_id', 'owner'],
    ['page_id', 'page'],
  ])
  assert.equal('access_token' in page, false)
})
