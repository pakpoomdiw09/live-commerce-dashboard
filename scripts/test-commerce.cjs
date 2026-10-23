const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm'),
  ts = require('typescript')
function load(file, deps = {}, env = {}) {
  const context = {
    exports: {},
    URL,
    console,
    process: { env },
    require: (name) => {
      if (name === '@/lib/feature-flags') return load('lib/feature-flags.ts', {}, env)
      assert.ok(name in deps, 'Unexpected dependency ' + name)
      return deps[name]
    },
  }
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    context,
  )
  return context.exports
}
const env = { SALES_PAGE_V2_ENABLED: 'true' },
  core = load('lib/features/commerce/commerce-core.ts', {}, env),
  id = '11111111-1111-4111-8111-111111111111',
  product = {
    code: 'A1',
    name: 'Product',
    price: 10,
    stock: 1,
    images: [],
    variants: [],
    is_active: true,
  }

test('snapshot loads all tenant category options separately from the management page', async () => {
  const categories = Array.from({ length: 405 }, (_, i) => ({
      id: String(i).padStart(5, '0'),
      name: `Category ${i}`,
    })),
    queries = []
  const db = {
    from(table) {
      const record = { table }
      queries.push(record)
      const q = {
        select() {
          return q
        },
        eq(key, value) {
          record[key] = value
          return q
        },
        order() {
          return q
        },
        limit(n) {
          record.limit = n
          return q
        },
        gt(key, value) {
          record.after = value
          return q
        },
        async maybeSingle() {
          return { data: null, error: null }
        },
        then(resolve, reject) {
          return Promise.resolve({
            data: categories
              .filter((c) => !record.after || c.id > record.after)
              .slice(0, record.limit),
            error: null,
          }).then(resolve, reject)
        },
      }
      return q
    },
    async rpc(name) {
      return {
        data:
          name === 'commerce_dashboard_stats'
            ? {}
            : { categories: categories.slice(0, 50), categoryRows: categories.slice(50, 100) },
        error: null,
      }
    },
  }
  const api = load(
    'lib/features/commerce/commerce-server.ts',
    {
      'server-only': {},
      'node:crypto': require('node:crypto'),
      'next/server': {},
      '@/lib/auth': {},
      '@/lib/supabase/server': {},
      '@/lib/features/commerce/commerce-core': core,
    },
    env,
  )
  const result = await api.commerceSnapshot(
    { db, tenantId: id, tenant: { name: 'Store' }, limits: { reports: false }, canManage: true },
    { categoryPage: '2' },
  )
  assert.equal(result.categories.length, 405)
  assert.equal(new Set(result.categories.map((c) => c.id)).size, 405)
  assert.equal(result.categoryRows.length, 50)
  const reads = queries.filter((q) => q.table === 'commerce_categories')
  assert.equal(reads.length, 3)
  assert.ok(reads.every((q) => q.tenant_id === id && q.limit === 200))
})

test('presets are immediately available, preserve existing categories and reject invented keys', () => {
  assert.equal(core.PRESET_CATEGORIES.length, 11)
  const preset = core.PRESET_CATEGORIES[0]
  const options = core.categoryOptions([
    { id, name: preset.name },
    { id: 'legacy', name: 'Legacy category' },
  ])
  assert.equal(options.length, 12)
  assert.equal(options[0].databaseId, id)
  assert.equal(options.at(-1).legacy, true)
  assert.equal(
    core.parseProduct({ ...product, category_id: `preset:${preset.key}` }).category_id,
    `preset:${preset.key}`,
  )
  assert.throws(() => core.parseProduct({ ...product, category_id: 'preset:fake' }))
})

test('preset save resolves a canonical tenant category and filters translate to the stored UUID', async () => {
  const preset = core.PRESET_CATEGORIES[0],
    categories = [],
    writes = [],
    rpcCalls = []
  const db = {
    from(table) {
      const q = {
        select() {
          return q
        },
        eq(key, value) {
          q[key] = value
          return q
        },
        order() {
          return q
        },
        limit() {
          return q
        },
        async upsert(value, options) {
          writes.push({ table, value, options })
          if (!categories.length) categories.push({ id, name: value.name })
          return { error: null }
        },
        async single() {
          return { data: categories.find((c) => c.name === q.name), error: null }
        },
        async maybeSingle() {
          return { data: null, error: null }
        },
        then(resolve, reject) {
          return Promise.resolve({ data: categories, error: null }).then(resolve, reject)
        },
      }
      return q
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args })
      return { data: name === 'commerce_save_product' ? id : {}, error: null }
    },
  }
  const api = load(
    'lib/features/commerce/commerce-server.ts',
    {
      'server-only': {},
      'node:crypto': require('node:crypto'),
      'next/server': {},
      '@/lib/auth': {},
      '@/lib/supabase/server': {},
      '@/lib/features/commerce/commerce-core': core,
    },
    env,
  )
  const scope = {
    db,
    tenantId: id,
    actor: { id },
    tenant: { name: 'Store' },
    limits: { reports: false },
    canManage: true,
  }
  const key = `preset:${preset.key}`
  await api.commerceSnapshot(scope, { category: key })
  assert.equal(
    rpcCalls.find((c) => c.name === 'commerce_dashboard_page').args.p_category,
    '00000000-0000-0000-0000-000000000000',
  )
  rpcCalls.length = 0
  await api.commerceMutation(scope, { action: 'product', value: { ...product, category_id: key } })
  assert.equal(writes[0].value.tenant_id, id)
  assert.equal(writes[0].value.name, preset.name)
  assert.equal(writes[0].options.ignoreDuplicates, true)
  assert.equal(
    rpcCalls.find((c) => c.name === 'commerce_save_product').args.p_value.category_id,
    id,
  )
  rpcCalls.length = 0
  await api.commerceSnapshot(scope, { category: key })
  assert.equal(rpcCalls.find((c) => c.name === 'commerce_dashboard_page').args.p_category, id)
  assert.throws(() => api.commerceFilters({ category: 'preset:invented' }))
})
test('products validate money, inventory, variants, SKU, images and existing description limit', () => {
  assert.equal(core.parseProduct(product).price, 10)
  for (const patch of [
    { price: -1 },
    { price: 1.001 },
    { stock: 0.1 },
    { code: 'A 1' },
    { images: ['javascript:alert(1)'] },
    { images: ['https://user:password@example.com/image'] },
    { description: 'x'.repeat(2001) },
    { variants: [null] },
    {
      variants: [
        { label: 'M', price: 1, stock: 1 },
        { label: 'm', price: 1, stock: 1 },
      ],
    },
  ])
    assert.throws(() => core.parseProduct({ ...product, ...patch }))
  assert.equal(
    core.parseProduct({
      ...product,
      variants: [
        { label: 'M', price: 10, stock: 2 },
        { label: 'L', price: 12, stock: 3 },
      ],
    }).stock,
    5,
  )
})
test('editor stores text, never HTML markup to execute; denies unsafe images and unknown blocks', () => {
  const d = {
    theme: '#f97316',
    blocks: [
      { id, type: 'text', title: '<script>alert(1)</script>', text: '<img onerror=alert(1)>' },
    ],
  }
  assert.equal(core.parseDesign(d).blocks[0].text, d.blocks[0].text)
  for (const value of [
    { ...d, theme: 'url(javascript:bad)' },
    { ...d, blocks: [{ ...d.blocks[0], type: '__proto__' }] },
    { ...d, blocks: [{ ...d.blocks[0], image: 'data:image/svg+xml,bad' }] },
    { ...d, blocks: [d.blocks[0], d.blocks[0]] },
  ])
    assert.throws(() => core.parseDesign(value))
})
test('checkout ignores browser price/tenant, normalizes payload and rejects duplicate or excessive quantities', () => {
  const p = {
    key: id,
    name: 'Buyer',
    phone: '080-000-0000',
    address: 'Test address',
    items: [{ product_id: id, qty: 1, price: 0.01 }],
    tenantId: 'foreign',
  }
  const result = core.parseCheckout(p)
  assert.equal(result.phone, '0800000000')
  assert.equal(result.items[0].price, undefined)
  assert.equal(result.tenantId, undefined)
  assert.throws(() => core.parseCheckout({ ...p, items: [...p.items, ...p.items] }))
  assert.throws(() => core.parseCheckout({ ...p, items: [{ product_id: id, qty: 100 }] }))
})
test('flags default off and master switch overrides individually enabled features', () => {
  assert.equal(load('lib/features/commerce/commerce-core.ts').shopV2(), false)
  assert.equal(
    load(
      'lib/features/commerce/commerce-core.ts',
      {},
      { PRODUCT_MANAGER_V2_ENABLED: 'true' },
    ).commerceFlag('PRODUCT_MANAGER_V2_ENABLED'),
    false,
  )
  assert.equal(
    load(
      'lib/features/commerce/commerce-core.ts',
      {},
      { ...env, PRODUCT_MANAGER_V2_ENABLED: 'false' },
    ).commerceFlag('PRODUCT_MANAGER_V2_ENABLED'),
    false,
  )
})
function server({
  actor = { kind: 'user', id },
  allowed = true,
  rpcResult = { data: { checkout: true }, error: null },
} = {}) {
  let reads = 0,
    calls = []
  const query = {
    select() {
      return this
    },
    eq() {
      return this
    },
    maybeSingle: async () => {
      reads++
      return { data: { id, is_active: true }, error: null }
    },
  }
  const db = {
    from: () => query,
    rpc: async (name, args) => {
      calls.push({ name, args })
      return rpcResult
    },
  }
  const api = load(
    'lib/features/commerce/commerce-server.ts',
    {
      'server-only': {},
      'node:crypto': require('node:crypto'),
      'next/server': { NextResponse: { json: (value, options) => ({ value, options }) } },
      '@/lib/auth': { getActor: async () => actor, canAccessTenant: async () => allowed },
      '@/lib/supabase/server': { supabaseAdmin: () => db },
      '@/lib/features/commerce/commerce-core': core,
    },
    env,
  )
  return { api, db, calls, reads: () => reads }
}
test('scope denies missing session, internal actor, malformed tenant and foreign ownership before service reads', async () => {
  for (const options of [{ actor: null }, { actor: { kind: 'internal' } }, { allowed: false }]) {
    const f = server(options)
    await assert.rejects(f.api.commerceScope(id, true))
    assert.equal(f.reads(), 0)
  }
  const f = server()
  await assert.rejects(f.api.commerceScope('invalid', true))
  assert.equal(f.reads(), 0)
})
test('same-origin guard rejects cross-site and missing-origin mutations', () => {
  const { api } = server()
  for (const origin of [null, 'https://foreign.example'])
    assert.throws(() =>
      api.sameOrigin({
        headers: new Headers(origin ? { origin } : {}),
        nextUrl: new URL('https://shop.example/api'),
      }),
    )
  api.sameOrigin({
    headers: new Headers({ origin: 'https://shop.example' }),
    nextUrl: new URL('https://shop.example/api'),
  })
})
test('server prevents premium preset and unsupported actions independent of browser controls', async () => {
  const f = server(),
    scope = { db: f.db, actor: { id }, tenantId: id, limits: { advanced_templates: false } }
  await assert.rejects(
    f.api.commerceMutation(scope, { action: 'page', value: { design: { template: 'premium' } } }),
    /แพ็กเกจ/,
  )
  await assert.rejects(f.api.commerceMutation(scope, { action: 'unknown' }))
  assert.equal(f.calls.length, 0)
})
test('checkout invokes rate limiting first; no real transport; sends only parsed server payload to atomic RPC', async () => {
  const f = server({ rpcResult: { data: true, error: null } }),
    req = {
      headers: new Headers({ origin: 'https://shop.example', 'x-forwarded-for': '127.0.0.1' }),
      nextUrl: new URL('https://shop.example/api'),
    }
  const coreWithPublic = load('lib/features/commerce/commerce-core.ts', {}, env)
  assert.equal(coreWithPublic.commerceFlag('STOREFRONT_V2_ENABLED'), true)
  await f.api.checkout(req, 'test-shop', {
    key: id,
    name: 'Test',
    phone: '0800000000',
    address: 'Sandbox',
    items: [{ product_id: id, qty: 1, price: 0.01 }],
  })
  assert.deepEqual(
    f.calls.map((c) => c.name),
    ['commerce_rate_limit', 'commerce_rate_limit', 'commerce_checkout'],
  )
  assert.equal(f.calls[2].args.p_value.items[0].price, undefined)
})
test('public catalog returns only safe columns and excludes variants of hidden products', async () => {
  const selected = [],
    hidden = '22222222-2222-4222-8222-222222222222'
  const db = {
    rpc: async () => ({
      data: [{ checkout: false, max_pages: 1, advanced_templates: false }],
      error: null,
    }),
    from(table) {
      let columns = ''
      const q = {
        select(c) {
          columns = c
          selected.push({ table, columns: c })
          return this
        },
        eq() {
          return this
        },
        order() {
          return this
        },
        not() {
          return this
        },
        limit() {
          return this
        },
        maybeSingle: async () => ({
          data:
            table === 'commerce_stores'
              ? { tenant_id: id, slug: 'shop', name: 'Shop', is_open: true }
              : null,
          error: null,
        }),
        range: async () => ({
          data:
            table === 'products'
              ? [{ id, name: 'Safe', price: 10, stock: 1 }]
              : [
                  { id: 'variant-visible', product_id: id, label: 'M', price: 10, stock: 1 },
                  {
                    id: 'variant-hidden',
                    product_id: hidden,
                    label: 'Hidden',
                    price: 999,
                    stock: 1,
                  },
                ],
          error: null,
        }),
        then(resolve, reject) {
          return Promise.resolve({ data: [], error: null }).then(resolve, reject)
        },
      }
      return q
    },
  }
  const api = load(
    'lib/features/commerce/commerce-server.ts',
    {
      'server-only': {},
      'node:crypto': require('node:crypto'),
      'next/server': {},
      '@/lib/auth': {},
      '@/lib/supabase/server': { supabaseAdmin: () => db },
      '@/lib/features/commerce/commerce-core': core,
    },
    env,
  )
  const result = await api.publicStore('shop')
  assert.equal(result.variants.length, 1)
  assert.equal(result.variants[0].id, 'variant-visible')
  assert.equal(result.checkout, false)
  assert.equal(result.store.tenant_id, undefined)
  for (const entry of selected)
    assert.ok(!/cost|access_token|shipping|phone|secret/.test(entry.columns))
  assert.equal(await api.publicStore('../bad'), null)
})
