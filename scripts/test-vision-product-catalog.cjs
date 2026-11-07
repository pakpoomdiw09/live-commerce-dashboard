const { test } = require('node:test')
const assert = require('node:assert/strict')
const load = require('./helpers/load-typescript.cjs')
const types = load('lib/features/vision/vision-types.ts', {
  '@/lib/features/vision/image-rules': load('lib/features/vision/image-rules.ts'),
})
const globals = { URL, process: { env: { NEXT_PUBLIC_APP_URL: 'https://shop.test' } } }
const catalog = load(
  'lib/features/vision/vision-catalog.ts',
  {
    'server-only': {},
    './vision-types': types,
    '@/lib/features/commerce/messenger-product': load(
      'lib/features/commerce/messenger-product.ts',
      {},
      { URL },
    ),
  },
  globals,
)
const product = (id, tenant = 'shop-a', extra = {}) => ({
  id,
  tenant_id: tenant,
  name: 'Catalog shirt',
  code: id,
  price: 299,
  stock: 3,
  description: null,
  is_active: true,
  commerce_archived: false,
  ...extra,
})
function database(products, { open = true, error = null } = {}) {
  const queries = []
  return {
    queries,
    from(table) {
      const filters = []
      let range = null
      queries.push({ table, filters })
      const rows = () => {
        const source =
          table === 'products'
            ? products
            : [
                { tenant_id: 'shop-a', slug: 'our-shop', is_open: open },
                { tenant_id: 'shop-b', slug: 'foreign-shop', is_open: true },
              ]
        const filtered = source.filter((row) => filters.every(([key, value]) => row[key] === value))
        return range ? filtered.slice(range[0], range[1] + 1) : filtered
      }
      const q = {
        select: () => q,
        order: () => q,
        eq: (key, value) => {
          filters.push([key, value])
          return q
        },
        range: (start, end) => {
          range = [start, end]
          return q
        },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error }),
        then: (resolve, reject) => Promise.resolve({ data: rows(), error }).then(resolve, reject),
      }
      return q
    },
  }
}
const match = (productId, confidence = 0.95) => ({
  category: 'PRODUCT',
  confidence,
  productId,
  description: 'Model must not set prices',
})

test('catalog pagination loads all active tenant products and excludes other shops/archived rows', async () => {
  const own = Array.from({ length: 103 }, (_, i) => product(`p${i}`))
  const db = database([
    ...own,
    product('foreign', 'shop-b'),
    product('inactive', 'shop-a', { is_active: false }),
    product('archived', 'shop-a', { commerce_archived: true }),
  ])
  const rows = await catalog.loadVisionCatalog(db, 'shop-a')
  assert.equal(rows.length, 103)
  assert.equal(db.queries.length, 2)
  assert.ok(rows.every((p) => p.tenant_id === 'shop-a' && p.is_active && !p.commerce_archived))
})

test('confident reply re-reads price/stock and links to the tenant storefront product', async () => {
  for (const stock of [3, 0]) {
    const db = database([
      product('p1', 'shop-a', { price: 450, stock }),
      product('p1', 'shop-b', { price: 1 }),
    ])
    const reply = await catalog.catalogVisionDecision(db, 'shop-a', match('p1'), [product('p1')])
    assert.equal(reply.reason, 'CATALOG_MATCH')
    assert.match(reply.responseText, /Catalog shirt/)
    assert.match(reply.responseText, /450\.00/)
    assert.ok(reply.responseText.includes(stock ? 'มีสินค้า' : 'สินค้าหมด'))
    assert.match(reply.responseText, /https:\/\/shop\.test\/s\/our-shop\?product=p1/)
    assert.ok(
      db.queries.every((q) =>
        q.filters.some(([key, value]) => key === 'tenant_id' && value === 'shop-a'),
      ),
    )
  }
})

test('unknown, low confidence and foreign/invented IDs return the inquiry without product reads', async () => {
  for (const result of [
    match('foreign'),
    match('p1', 0.79),
    { ...match('p1'), category: 'UNKNOWN' },
  ]) {
    const db = database([product('foreign', 'shop-b')])
    const reply = await catalog.catalogVisionDecision(db, 'shop-a', result, [product('p1')])
    assert.equal(reply.responseText, catalog.CATALOG_INQUIRY)
    assert.equal(db.queries.length, 0)
  }
})

test('products removed/deactivated during inference and closed storefronts cannot produce checkout links', async () => {
  for (const db of [
    database([]),
    database([product('p1', 'shop-a', { is_active: false })]),
    database([product('p1')], { open: false }),
  ]) {
    assert.equal(
      (await catalog.catalogVisionDecision(db, 'shop-a', match('p1'), [product('p1')]))
        .responseText,
      catalog.CATALOG_INQUIRY,
    )
  }
  await assert.rejects(
    catalog.loadVisionCatalog(database([], { error: Error('database unavailable') }), 'shop-a'),
  )
})

test('model receives gallery bytes beyond the first twelve products; IDs without visual evidence are rejected', async () => {
  const products = Array.from({ length: 15 }, (_, i) =>
    product(`p${i}`, 'shop-a', {
      image_url: `https://storage.test/${i}.png`,
      commerce_images: [`https://storage.test/${i}-back.png`],
    }),
  )
  let requested,
    returnedId = 'p14'
  const provider = load(
    'lib/features/vision/vision-provider.ts',
    {
      'server-only': {},
      '@google/genai': {
        GoogleGenAI: class {
          constructor() {
            this.models = {
              generateContent: async (request) => {
                requested = request
                return { text: JSON.stringify(match(returnedId)) }
              },
            }
          }
        },
      },
      '@/lib/features/agents/ai-agent': { aiModel: () => 'test-model' },
      '@/lib/features/vision/vision-types': types,
      '@/lib/features/vision/vision-image': {
        validateVisionFile: async () => Buffer.from('customer'),
      },
      '@/lib/features/agents/llm-vision': {
        loadCatalogImages: async (gallery, tenantId, limit) => {
          assert.equal(tenantId, 'shop-a')
          assert.equal(limit, Infinity)
          assert.equal(gallery.length, 30)
          return gallery.map((p) => ({
            code: p.code,
            image: { mimeType: 'image/webp', data: 'catalog-photo' },
          }))
        },
      },
    },
    { process: { env: { GEMINI_API_KEY: 'test' } } },
  )
  assert.equal(
    (await provider.analyzeVision({ type: 'image/png' }, products, 'shop-a')).productId,
    'p14',
  )
  const parts = requested.contents[0].parts
  assert.equal(parts.filter((part) => part.inlineData).length, 31)
  assert.equal(parts[1].inlineData.data, Buffer.from('customer').toString('base64'))
  returnedId = 'foreign'
  const rejected = await provider.analyzeVision({ type: 'image/png' }, products, 'shop-a')
  assert.equal(rejected.productId, undefined)
  assert.equal(rejected.confidence, 0)
})
