const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript')

function load(file, deps = {}, globals = {}) {
  const context = { exports: {}, URL, URLSearchParams, console: { error() {} }, require: name => {
    if (name in deps) return deps[name]
    throw Error('Unexpected dependency ' + name)
  }, ...globals }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context)
  return context.exports
}

test('Facebook login sends all requested Business scopes and a stable callback URL', async () => {
  const location = { origin: 'https://shop.example', protocol: 'https:' }, document = {}
  const oauth = load('lib/oauth.ts', {}, { location, document })
  let request
  const component = load('components/LoginForm.tsx', {
    react: { useState: value => [value, () => {}] }, 'react/jsx-runtime': require('react/jsx-runtime'),
    'next/navigation': { useRouter: () => ({}) }, '@/lib/oauth': oauth,
    '@/lib/supabase/browser': { supabaseBrowser: () => ({ auth: { signInWithOAuth: async value => { request = value; return { error: null } } } }) },
  }, { location }).LoginForm
  const tree = component({ next: '/slips?tab=history' })
  await tree.props.children.find(child => child?.type === 'button').props.onClick()
  assert.equal(request.provider, 'facebook')
  assert.equal(request.options.scopes, 'public_profile,email,pages_show_list,pages_messaging,pages_read_engagement,pages_manage_metadata')
  assert.equal(request.options.redirectTo, 'https://shop.example/auth/callback')
  assert.match(document.cookie, /%2Fslips%3Ftab%3Dhistory/)
})

test('Supabase authorization URL carries every requested Facebook permission', async () => {
  const { createClient } = require('@supabase/supabase-js')
  const oauth = load('lib/oauth.ts')
  const client = createClient('https://test-project.supabase.co', 'test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data, error } = await client.auth.signInWithOAuth({
    provider: 'facebook',
    options: { scopes: oauth.FACEBOOK_SCOPES, redirectTo: 'https://shop.example/auth/callback', skipBrowserRedirect: true },
  })
  assert.equal(error, null)
  const url = new URL(data.url)
  assert.equal(url.searchParams.get('provider'), 'facebook')
  assert.equal(url.searchParams.get('scopes'), 'public_profile,email,pages_show_list,pages_messaging,pages_read_engagement,pages_manage_metadata')
  assert.equal(oauth.FACEBOOK_LOGIN_SCOPES, oauth.FACEBOOK_SCOPES)
})

function callback(exchange = { data: { session: { access_token: 'mock-session', refresh_token: 'mock-refresh' } }, error: null }) {
  let exchanges = 0
  const cleared = []
  const oauth = load('lib/oauth.ts')
  const api = load('app/auth/callback/route.ts', {
    'next/server': { NextResponse: { redirect: url => ({ location: String(url), cookies: { set: (...args) => cleared.push(args) } }) } },
    '@/lib/oauth': oauth,
    '@/lib/facebook-oauth': {},
    '@/lib/supabase/server': { supabaseServer: async () => ({ auth: { exchangeCodeForSession: async code => { exchanges++; assert.equal(code, 'mock-code'); return exchange } } }) },
  })
  return { run: (query, next = '/slips') => {
    const url = new URL('https://shop.example/auth/callback' + query)
    return api.GET({ url: String(url), nextUrl: url, cookies: { get: () => ({ value: encodeURIComponent(next) }) } })
  }, count: () => exchanges, cleared }
}

test('callback exchanges PKCE code, requires a session and consumes only its routing hint', async () => {
  const f = callback(), result = await f.run('?code=mock-code')
  assert.equal(result.location, 'https://shop.example/slips')
  assert.equal(f.count(), 1)
  assert.equal(f.cleared[0][0], 'auth_oauth_next')
  assert.equal(f.cleared[0][2].path, '/auth/callback')
  assert.equal(f.cleared[0][2].maxAge, 0)
  assert.equal(new URL((await callback().run('?code=mock-code&next=%2F%5Cevil.example')).location).origin, 'https://shop.example')
})

test('cancelled authorization and missing code never attempt exchange', async () => {
  const f = callback()
  assert.equal(new URL((await f.run('?error=access_denied')).location).searchParams.get('error_code'), 'access_denied')
  assert.equal(new URL((await f.run('')).location).searchParams.get('error_code'), 'missing_code')
  assert.equal(f.count(), 0)
})

test('missing session and expired PKCE state return login with safe errors', async () => {
  for (const error of [null, { code: 'flow_state_expired', message: 'private detail' }]) {
    const result = await callback({ data: { session: null }, error }).run('?code=mock-code')
    assert.equal(new URL(result.location).pathname, '/login')
    assert.equal(new URL(result.location).searchParams.get('error_code'), error?.code ?? 'oauth')
    assert.ok(!result.location.includes('private'))
  }
})
