const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm'),
  ts = require('typescript')
function load(file, overrides = {}, globals = {}) {
  const api = {},
    jsx = (type, props) => ({ type, props })
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    {
      exports: api,
      require: (name) => {
        if (name in overrides) return overrides[name]
        if (name === 'react')
          return {
            useEffect() {},
            useMemo: (fn) => fn(),
            useCallback: (fn) => fn,
            useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
          }
        if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
        if (name === 'next/navigation') return { useRouter: () => ({ refresh() {} }) }
        if (name === '@/lib/supabase/browser') return { supabaseBrowser: () => ({}) }
        if (name === '@/lib/features/vision/image-rules')
          return { IMAGE_TRIGGERS: { product: { label: 'Product' } } }
        if (name === '@/lib/features/vision/vision-types')
          return { VISION_CONFIDENCE_THRESHOLD: 0.8 }
        return new Proxy({}, { get: (_, key) => key })
      },
      ...globals,
    },
  )
  return api
}
test('Vision overview defaults missing arrays and numeric usage and rejects null responses', () => {
  const { normalizeVisionOverview } = load('components/chatbot/VisionCenter.tsx')
  for (const value of [
    {},
    { jobs: null, usage: null },
    { jobs: [null, {}], usage: { used: null, limit: '10', remaining: NaN } },
  ]) {
    const result = normalizeVisionOverview(value)
    assert.equal(result.jobs.length, 0)
    assert.equal(result.usage.used, 0)
    assert.equal(result.usage.limit, 0)
    assert.equal(result.settings, null)
  }
  assert.throws(() => normalizeVisionOverview(null))
  assert.throws(() => normalizeVisionOverview([]))
})

test('Vision Master Switch saves immediately and retains the saved value on API failure', async () => {
  for (const ok of [true, false]) {
    const overview = {
      settings: {
        enabled: false,
        mode: 'rules',
        confidence_threshold: 0.8,
        handoff_enabled: false,
      },
      usage: { remaining: 10 },
      jobs: [],
    }
    let index = 0
    const writes = [],
      requests = []
    const { VisionCenter } = load(
      'components/chatbot/VisionCenter.tsx',
      {
        react: {
          useEffect() {},
          useCallback: (fn) => fn,
          useState(initial) {
            const key = index++
            return [
              key === 0 ? overview : key === 1 ? overview.settings : initial,
              (value) => writes.push({ key, value }),
            ]
          },
        },
      },
      {
        fetch: async (url, options) => {
          requests.push({ url, options })
          return {
            ok,
            json: async () =>
              ok
                ? { ...overview, settings: { ...overview.settings, enabled: true } }
                : { error: 'Cannot save' },
          }
        },
      },
    )
    function nodes(node) {
      if (Array.isArray(node)) return node.flatMap(nodes)
      if (!node || typeof node !== 'object') return []
      return [node, ...nodes(node.props?.children)]
    }
    const switches = nodes(
      VisionCenter({ tenantId: 'tenant', canManage: true, children: null }),
    ).filter((node) => node.props?.role === 'switch')
    assert.equal(switches.length, 1)
    switches[0].props.onClick()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(requests.length, 1)
    assert.equal(requests[0].options.method, 'PATCH')
    assert.equal(JSON.parse(requests[0].options.body).enabled, true)
    const savedSettings = writes.find((write) => write.key === 1)
    if (ok) assert.equal(savedSettings.value.enabled, true)
    else {
      assert.equal(savedSettings, undefined)
      assert.ok(writes.some((write) => write.key === 3 && write.value === 'Cannot save'))
    }
  }
})
test('Image rules render empty state with null, missing and malformed rules', () => {
  const { ImageRulesClient } = load('components/chatbot/ImageRulesClient.tsx')
  for (const initialRules of [
    null,
    undefined,
    {},
    [null, { id: 'one', name: 'Bad trigger', trigger_type: 'removed' }],
  ]) {
    assert.doesNotThrow(() =>
      ImageRulesClient({ tenantId: 'tenant', tenantName: 'Store', initialRules, canManage: false }),
    )
  }
})
test('Vision page renders loading and incomplete-data states without throwing', () => {
  const base = load('components/chatbot/VisionCenter.tsx')
  for (const payload of [null, base.normalizeVisionOverview({ jobs: null, usage: null })]) {
    let index = 0
    const { VisionCenter } = load('components/chatbot/VisionCenter.tsx', {
      react: {
        useCallback: (fn) => fn,
        useEffect() {},
        useState: (initial) => [index++ === 0 ? payload : initial, () => {}],
      },
    })
    assert.doesNotThrow(() =>
      VisionCenter({ tenantId: 'tenant', canManage: false, children: null }),
    )
  }
})
