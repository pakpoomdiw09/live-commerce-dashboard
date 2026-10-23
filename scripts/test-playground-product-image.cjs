const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm'),
  ts = require('typescript')
const compile = (file) =>
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText
const jsx = (type, props) => ({ type, props }),
  all = (node) =>
    !node || typeof node !== 'object'
      ? []
      : Array.isArray(node)
        ? node.flatMap(all)
        : [node, ...all(node.props?.children)]
test('product image preview hides on load error and rejects invalid URLs', () => {
  let failed = false
  const api = {}
  vm.runInNewContext(compile('components/chatbot/PlaygroundProductImage.tsx'), {
    exports: api,
    URL,
    require: (name) =>
      name === 'react'
        ? {
            useState: () => [
              failed,
              (value) => {
                failed = value
              },
            ],
          }
        : name === 'react/jsx-runtime'
          ? { jsx, jsxs: jsx }
          : { __esModule: true, default: 'Image' },
  })
  const props = { src: 'https://store.test/photo.webp' }
  const image = api.PlaygroundProductImage(props)
  assert.equal(image.props.src, props.src)
  image.props.onError()
  assert.equal(api.PlaygroundProductImage(props), null)
  failed = false
  assert.equal(api.PlaygroundProductImage({ src: 'javascript:alert(1)' }), null)
})
test('chat simulator retains text and displays product preview from image_url API responses', async () => {
  const values = []
  let cursor = 0,
    tree
  const react = {
    useEffect() {},
    useRef(initial) {
      const i = cursor++
      if (!(i in values)) values[i] = { current: initial }
      return values[i]
    },
    useState(initial) {
      const i = cursor++
      if (!(i in values)) values[i] = initial
      return [values[i], (v) => (values[i] = typeof v === 'function' ? v(values[i]) : v)]
    },
  }
  const api = {}
  vm.runInNewContext(compile('components/chatbot/AiTestingStudio.tsx'), {
    exports: api,
    Date,
    fetch: async () => ({
      ok: true,
      json: async () => ({
        text: 'Product from database',
        image_url: 'https://store.test/product.webp',
        route: 'ai',
        handover: false,
        providerCalled: true,
      }),
    }),
    require: (name) =>
      name === 'react'
        ? react
        : name === 'react/jsx-runtime'
          ? { jsx, jsxs: jsx }
          : new Proxy({}, { get: (_, key) => key }),
  })
  const render = () => {
    cursor = 0
    tree = api.AiTestingStudio({
      tenantId: 'tenant',
      settings: { reply_mode: 'ai' },
      activeRuleCount: 0,
      aiAllowed: true,
    })
  }
  render()
  all(tree)
    .find((n) => n.type === 'textarea')
    .props.onChange({ target: { value: 'Show product' } })
  render()
  all(tree)
    .find((n) => n.type === 'form')
    .props.onSubmit({ preventDefault() {} })
  await new Promise((resolve) => setImmediate(resolve))
  render()
  assert.equal(
    all(tree).find((n) => n.type === 'PlaygroundProductImage').props.src,
    'https://store.test/product.webp',
  )
  assert.ok(JSON.stringify(tree).includes('Product from database'))
})
