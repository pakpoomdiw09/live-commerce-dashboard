const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'),
  vm = require('node:vm'),
  ts = require('typescript')
const jsx = require('react/jsx-runtime')
function load(file, dependencies) {
  const exports = {}
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    {
      exports,
      console,
      process: { env: {} },
      require(name) {
        if (name === 'react/jsx-runtime') return jsx
        if (Object.hasOwn(dependencies, name)) return dependencies[name]
        throw Error('Unexpected dependency: ' + name)
      },
    },
  )
  return exports
}

test('shell starts independent reads together and renders before Facebook profile resolves', async () => {
  const started = new Set(),
    active = { id: 'tenant', name: 'Shop', slip_quota: 10, slip_quota_credits: 0, slip_used: 1 }
  let finishBilling,
    profileReads = 0
  const billing = new Promise((resolve) => {
    finishBilling = resolve
  })
  const db = {
    from() {
      started.add('expiry')
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: { plan_expires_at: null } }),
      }
      return q
    },
  }
  const api = load('app/(dashboard)/layout.tsx', {
    react: { Suspense: Symbol.for('react.suspense') },
    '@/lib/auth': {
      requireDashboardUser: async () => ({ email: 'test@example.test' }),
      getActor: async () => ({ kind: 'user' }),
    },
    '@/lib/tenant': {
      getActiveTenant: async () => active,
      tenantPages: () => {
        profileReads++
        return new Promise(() => {})
      },
    },
    '@/lib/supabase/server': { supabaseAdmin: () => db },
    '@/lib/features/billing/billing': {
      getBilling() {
        started.add('billing')
        return billing
      },
    },
    '@/lib/feature-access': {
      LOCKED_ACCESS: {},
      loadFeatureAccess: async () => {
        started.add('access')
        return {}
      },
    },
    '@/components/shell/AppShell': { AppShell: 'shell' },
    '@/components/shell/PageStatus': { PageStatus: 'status' },
    '@/components/ui/BrandLoader': { BrandLoader: 'loader' },
  })
  const boundary = api.default({ children: 'page' })
  assert.equal(boundary.props.fallback.type, 'loader')
  const pending = boundary.props.children.type(boundary.props.children.props)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual([...started].sort(), ['access', 'billing', 'expiry'])
  finishBilling({ monthly: 5, topup: 2 })
  const shell = await pending
  assert.equal(shell.props.children, 'page')
  assert.equal(shell.props.messagesRemaining, 7)
  assert.equal(profileReads, 0)
  const fallback = shell.props.page.props.fallback
  const status = fallback.type(fallback.props)
  assert.equal(status.props.page.name, 'Shop')
  assert.equal(status.props.page.creditsLeft, 9)
})

test('guard and actor share verified session; session errors deny access despite a returned user', async () => {
  for (const rejected of [false, true]) {
    let reads = 0,
      adminReads = 0
    // A fresh cache scope models a separate Server Component request.
    const cache = (fn) => {
      let pending
      return () => (pending ??= fn())
    }
    const api = load('lib/auth.ts', {
      'server-only': {},
      react: { cache },
      'next/navigation': {
        redirect() {
          throw Error('LOGIN_REDIRECT')
        },
      },
      '@/lib/supabase/server': {
        supabaseServer: async () => ({
          auth: {
            getUser: async () => {
              reads++
              return {
                data: { user: { id: 'user' } },
                error: rejected ? Error('invalid session') : null,
              }
            },
          },
        }),
        supabaseAdmin() {
          adminReads++
          const q = {
            select: () => q,
            eq: () => q,
            maybeSingle: async () => ({ data: null, error: null }),
          }
          return { from: () => q }
        },
      },
    })
    if (rejected) {
      await assert.rejects(api.requireDashboardUser(), /LOGIN_REDIRECT/)
      assert.equal(await api.getActor(), null)
      assert.equal(adminReads, 0)
    } else {
      const [user, actor] = await Promise.all([api.requireDashboardUser(), api.getActor()])
      assert.equal(user.id, 'user')
      assert.equal(actor.id, 'user')
      assert.equal(adminReads, 1)
    }
    assert.equal(reads, 1)
  }
})
