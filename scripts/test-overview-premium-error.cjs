const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'),
  vm = require('node:vm'),
  ts = require('typescript')
const load = require('./helpers/load-typescript.cjs')
const core = load('lib/features/overview/premium-overview-core.ts', {}, { process: { env: {} } })

test('Premium layout survives failed/incomplete loads, uses unknown metrics and never imports Basic', async () => {
  const valid = core.emptyPremiumOverview(
    { id: 'tenant', name: 'Shop' },
    core.overviewFilters({}),
    'fixture',
  )
  for (const mode of ['error', 'incomplete', 'success']) {
    const exports = {},
      jsx = (type, props) => ({ type, props })
    const deps = {
      'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
      '@/lib/auth': {
        requireDashboardUser: async () => ({ email: 'user@example.test', user_metadata: {} }),
        getActor: async () => ({ kind: 'user' }),
      },
      '@/lib/tenant': {
        getActiveTenant: async () => ({ id: 'tenant', name: 'Shop' }),
        getTenants: async () => ({ tenants: [{ id: 'tenant' }], error: null }),
      },
      '@/components/shared/SetupNotice': { SetupNotice: 'setup' },
      '@/components/shared/ErrorState': { InlineError: 'error' },
      '@/lib/features/overview/premium-overview-core': core,
      '@/components/overview/PremiumOverview': { PremiumOverview: 'premium' },
      '@/lib/features/overview/premium-overview-server': {
        loadPremiumOverview: async () => {
          if (mode === 'error') throw Error('unavailable')
          if (mode === 'incomplete') return { ...valid, metrics: undefined }
          return valid
        },
      },
    }
    vm.runInNewContext(
      ts.transpileModule(fs.readFileSync('components/overview/PremiumOverviewPage.tsx', 'utf8'), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
      {
        exports,
        console: { error() {} },
        require(name) {
          if (name in deps) return deps[name]
          if (name === '@/lib/features/overview/overview-diagnostics')
            return { logOverviewError() {} }
          throw Error('Unexpected import: ' + name)
        },
      },
    )
    const tree = await exports.PremiumOverviewPage({ filters: { range: '7', q: 'test' } })
    const [alert, premium] = tree.props.children
    assert.equal(premium.type, 'premium')
    assert.equal(premium.props.data.shop.id, 'tenant')
    if (mode === 'success') {
      assert.equal(alert.props.role, 'status')
      assert.equal(premium.props.data, valid)
    } else {
      assert.equal(alert.props.role, 'alert')
      assert.equal(premium.props.data.metrics.uniqueCustomers, null)
      assert.equal(premium.props.data.metrics.incomingMessages, null)
      assert.equal(premium.props.data.results, null)
      assert.equal(premium.props.data.activity, null)
      assert.equal(premium.props.data.filters.range, '7')
      assert.equal(premium.props.data.filters.q, 'test')
    }
  }
})
