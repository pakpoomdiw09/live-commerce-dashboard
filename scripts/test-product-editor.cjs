const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm'),
  ts = require('typescript')
test('product numeric inputs can clear, remove leading zeroes and save numeric payloads', async () => {
  const states = []
  let cursor = 0,
    tree,
    saved
  const jsx = (type, props) => ({ type, props })
  const react = {
    useState(initial) {
      const i = cursor++
      if (!(i in states)) states[i] = initial
      return [states[i], (v) => (states[i] = typeof v === 'function' ? v(states[i]) : v)]
    },
    useMemo: (fn) => fn(),
  }
  const core = {}
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync('lib/features/commerce/commerce-core.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { exports: core, URL, require: () => ({}) },
  )
  const api = {}
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync('components/shop/CommerceProducts.tsx', 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    {
      exports: api,
      require: (name) => {
        if (name === 'react') return react
        if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
        if (name === '@/lib/features/commerce/commerce-core') return core
        return new Proxy({}, { get: (_, key) => key })
      },
    },
  )
  const props = {
    products: [],
    variants: [],
    categories: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Category' }],
    canManage: true,
    busy: false,
    upload: async () => null,
    mutate: async (_, v) => {
      saved = v
      return 'saved'
    },
  }
  const render = () => {
    cursor = 0
    tree = api.CommerceProducts(props)
  }
  const all = (node) =>
    !node || typeof node !== 'object'
      ? []
      : Array.isArray(node)
        ? node.flatMap(all)
        : [node, ...all(node.props?.children)]
  const nodes = () => all(tree)
  render()
  nodes()
    .find((n) => n.type === 'button' && n.props.className === 'commercePrimary')
    .props.onClick()
  render()
  const numeric = () => nodes().filter((n) => n.type === 'input' && n.props.type === 'number')
  for (let i = 0; i < 4; i++) {
    numeric()[i].props.onChange({ target: { value: '' } })
    render()
    assert.equal(numeric()[i].props.value, '')
    numeric()[i].props.onChange({ target: { value: '00123' } })
    render()
    assert.equal(numeric()[i].props.value, '123')
  }
  numeric()[0].props.onChange({ target: { value: '0.25' } })
  render()
  assert.equal(numeric()[0].props.value, '0.25')
  const text = nodes().filter((n) => n.type === 'input' && !n.props.type)
  text[0].props.onChange({ target: { value: 'SKU1' } })
  text[1].props.onChange({ target: { value: 'Product' } })
  render()
  const select = nodes().find((n) => n.type === 'CategorySelector')
  select.props.onChange(props.categories[0].id)
  render()
  await nodes()
    .find((n) => n.type === 'button' && n.props.className === 'commercePrimary')
    .props.onClick()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(saved.price, 0.25)
  assert.equal(saved.stock, 123)
  assert.equal(saved.cost, 123)
  assert.equal(saved.compare_price, 123)
  assert.equal(saved.category_id, props.categories[0].id)
  render()
  props.categories.push({ id: '22222222-2222-4222-8222-222222222222', name: 'New category' })
  render()
  assert.ok(nodes().some((n) => n.type === 'option' && n.props.value === props.categories[1].id))
  nodes()
    .find((n) => n.type === 'select')
    .props.onChange({ target: { value: props.categories[1].id } })
  render()
  assert.equal(nodes().find((n) => n.type === 'select').props.value, props.categories[1].id)
  props.categories.pop()
  render()
  assert.equal(nodes().find((n) => n.type === 'select').props.value, '')
  let search
  props.onSearch = (value) => {
    search = value
  }
  render()
  nodes()
    .find((n) => n.type === 'form')
    .props.onSubmit({ preventDefault() {} })
  assert.equal(search.category, '')
  props.products = [
    {
      id: 'uncategorized',
      name: 'No category',
      code: 'NONE',
      commerce_category_id: null,
      created_at: '2026-10-20',
    },
  ]
  render()
  assert.ok(nodes().some((n) => n.type === 'option' && n.props.value === 'preset:beauty'))
  nodes()
    .find((n) => n.type === 'select')
    .props.onChange({ target: { value: 'preset:beauty' } })
  render()
  assert.equal(nodes().filter((n) => n.type === 'article').length, 0)
})
