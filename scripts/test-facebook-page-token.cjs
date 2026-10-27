const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

// Isolated credentials and mocked fetch: these tests never read .env or contact Meta.
const code = ts.transpileModule(
  readFileSync(path.join(__dirname, '../lib/integrations/facebook/client.ts'), 'utf8'),
  {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  },
).outputText

function facebook({ env = {}, status = 200, json = null, networkError = false } = {}) {
  const calls = []
  const exports = {}
  vm.runInNewContext(code, {
    exports,
    require: (name) => {
      assert.equal(name, '@/lib/safe-logging')
      return require('./helpers/load-safe-logging.cjs')()
    },
    process: { env },
    AbortSignal,
    URL,
    fetch: async (url, options) => {
      calls.push({ url, options })
      if (networkError) throw new Error('mock timeout')
      return { ok: status >= 200 && status < 300, status, json: async () => json }
    },
  })
  return { ...exports, calls }
}

const validData = () => ({
  is_valid: true,
  type: 'PAGE',
  profile_id: 'page-123',
  scopes: ['pages_show_list', 'pages_messaging'],
  expires_at: 0,
  data_access_expires_at: 0,
})

test('messaging Page is verified without profile-reading permissions', async () => {
  const api = facebook({ json: { data: validData() } })
  assert.equal(await api.getPageTokenStatus('saved-page-token', 'page-123'), 'verified')
  assert.equal(api.calls.length, 1)
  assert.match(api.calls[0].url, /\/debug_token\?input_token=saved-page-token$/)
  assert.equal(api.calls[0].options.headers.Authorization, 'Bearer saved-page-token')
  assert.equal(api.calls[0].options.cache, 'no-store')
})

test('customer profile uses the configured Graph version and bearer token without URL leakage', async () => {
  const api = facebook({
    env: { FB_GRAPH_VERSION: 'v24.0' },
    json: {
      first_name: 'Test',
      last_name: 'Customer',
      profile_pic: 'https://platform-lookaside.fbsbx.com/avatar',
    },
  })
  const profile = await api.getCustomerProfile('saved-page-token', '123456')
  assert.equal(profile.display_name, 'Test Customer')
  assert.equal(profile.avatar_url, 'https://platform-lookaside.fbsbx.com/avatar')
  assert.equal(api.calls.length, 1)
  assert.match(
    api.calls[0].url,
    /^https:\/\/graph\.facebook\.com\/v24\.0\/123456\?fields=first_name,last_name,name,profile_pic$/,
  )
  assert.ok(!api.calls[0].url.includes('saved-page-token'))
  assert.equal(api.calls[0].options.headers.Authorization, 'Bearer saved-page-token')
})

for (const [name, override] of [
  ['revoked token', { is_valid: false }],
  ['another Page', { profile_id: 'page-other' }],
  ['User token', { type: 'USER' }],
  ['expired token', { expires_at: Math.floor(Date.now() / 1000) - 60 }],
  ['expired data access', { data_access_expires_at: Math.floor(Date.now() / 1000) - 60 }],
]) {
  test(`${name} is invalid; validation performs no exchange`, async () => {
    const api = facebook({ json: { data: { ...validData(), ...override } } })
    assert.equal(await api.getPageTokenStatus('saved-page-token', 'page-123'), 'invalid')
    assert.equal(api.calls.length, 1)
  })
}

test('future expiry remains valid', async () => {
  const future = Math.floor(Date.now() / 1000) + 3600
  const api = facebook({
    json: { data: { ...validData(), expires_at: future, data_access_expires_at: future } },
  })
  assert.equal(await api.getPageTokenStatus('saved-page-token', 'page-123'), 'verified')
})

for (const scopes of [[], ['pages_show_list']]) {
  test(`known scopes without messaging are limited: ${JSON.stringify(scopes)}`, async () => {
    const api = facebook({ json: { data: { ...validData(), scopes } } })
    assert.equal(await api.getPageTokenStatus('saved-page-token', 'page-123'), 'limited')
  })
}

for (const [name, override] of [
  ['scope information missing', { scopes: undefined }],
  ['malformed scope information', { scopes: ['pages_messaging', null] }],
  ['validity missing', { is_valid: undefined }],
  ['Page identity missing', { profile_id: undefined }],
  ['token type missing', { type: undefined }],
  ['malformed expiry', { expires_at: 'invalid' }],
]) {
  test(`${name} is unverified`, async () => {
    const api = facebook({ json: { data: { ...validData(), ...override } } })
    assert.equal(await api.getPageTokenStatus('saved-page-token', 'page-123'), 'unverified')
  })
}

for (const [name, options] of [
  ['permission error', { status: 403, json: { error: { code: 10 } } }],
  ['network timeout', { networkError: true }],
  ['malformed response', { json: null }],
  ['Graph error in successful HTTP response', { json: { error: { code: 10 } } }],
]) {
  test(`${name} remains unverified`, async () => {
    const api = facebook(options)
    assert.equal(await api.getPageTokenStatus('saved-page-token', 'page-123'), 'unverified')
  })
}

for (const idKey of ['FB_APP_ID', 'NEXT_PUBLIC_FB_APP_ID']) {
  test(`${idKey} and app secret authorize debugging without replacing the input token`, async () => {
    const api = facebook({
      env: { [idKey]: 'app-id', FB_APP_SECRET: 'app-secret' },
      json: { data: validData() },
    })
    assert.equal(await api.getPageTokenStatus('saved-page-token', 'page-123'), 'verified')
    assert.equal(api.calls[0].options.headers.Authorization, 'Bearer app-id|app-secret')
    assert.equal(new URL(api.calls[0].url).searchParams.get('input_token'), 'saved-page-token')
  })
}

test('rejected app authorization does not mark the Page token invalid', async () => {
  const api = facebook({
    env: { FB_APP_ID: 'app-id', FB_APP_SECRET: 'bad-app-secret' },
    status: 400,
    json: { error: { code: 190, message: 'Invalid OAuth access token' } },
  })
  assert.equal(await api.getPageTokenStatus('saved-page-token', 'page-123'), 'unverified')
})

test('empty token is invalid without contacting Meta', async () => {
  const api = facebook()
  assert.equal(await api.getPageTokenStatus('  ', 'page-123'), 'invalid')
  assert.equal(api.calls.length, 0)
})

test('own Page token takes precedence over the shared token', () => {
  const api = facebook({ env: { FB_PAGE_TOKEN: 'shared-token', FB_PAGE_ID: 'page-other' } })
  assert.equal(
    api.pageTokenFor({ page_id: 'page-123', page_access_token: ' own-token ' }),
    'own-token',
  )
})

test('shared token requires a matching configured Page ID for tenant sources', () => {
  const source = { page_id: 'page-123', page_access_token: null }
  assert.equal(facebook({ env: { FB_PAGE_TOKEN: 'shared-token' } }).pageTokenFor(source), null)
  assert.equal(
    facebook({ env: { FB_PAGE_TOKEN: 'shared-token', FB_PAGE_ID: 'page-other' } }).pageTokenFor(
      source,
    ),
    null,
  )
  assert.equal(
    facebook({ env: { FB_PAGE_TOKEN: 'shared-token', FB_PAGE_ID: 'page-123' } }).pageTokenFor(
      source,
    ),
    'shared-token',
  )
})

test('legacy fallback without a tenant source still uses configured shared token', () => {
  assert.equal(
    facebook({ env: { FB_PAGE_TOKEN: 'shared-token' } }).pageTokenFor(null),
    'shared-token',
  )
  assert.equal(
    facebook({ env: { FB_PAGE_TOKEN: '', PAGE_ACCESS_TOKEN: 'legacy-token' } }).pageTokenFor(null),
    'legacy-token',
  )
})
