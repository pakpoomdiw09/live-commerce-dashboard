import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { NextRequest, NextResponse } from 'next/server'
import { restoreProductOptions } from '../../../lib/features/commerce/quick-product'
import {
  productCombinations,
  resolveProductVariants,
} from '../../../lib/features/commerce/product-options'
import * as core from '../../../lib/features/commerce/commerce-core'

const require = createRequire(import.meta.url)
const load = require('../../../scripts/helpers/load-typescript.cjs')
const tenantId = '11111111-1111-4111-8111-111111111111'
const productId = '33333333-3333-4333-8333-333333333333'

test('restoring complete color/size grids preserves original variant IDs, prices and zero stock', () => {
  const variants = [
    'สี: ขาว / ขนาด: S',
    'สี: ขาว / ขนาด: M',
    'สี: ดำ / ขนาด: S',
    'สี: ดำ / ขนาด: M',
  ].map((label, index) => ({
    id: 'variant-' + index,
    label,
    price: 159 + index,
    stock: index,
  }))
  const restored = restoreProductOptions(variants)
  assert.equal(restored.legacy.length, 0)
  assert.deepEqual(
    restored.groups.map((group) => group.name),
    ['สี', 'ขนาด'],
  )
  const rows = resolveProductVariants(
    '100',
    '6',
    productCombinations(restored.groups),
    restored.overrides,
  )
  assert.deepEqual(
    rows.map((row) => row.id),
    variants.map((variant) => variant.id),
  )
  assert.deepEqual(
    rows.map((row) => Number(row.price)),
    variants.map((variant) => variant.price),
  )
  assert.deepEqual(
    rows.map((row) => Number(row.stock)),
    [0, 1, 2, 3],
  )
  assert.equal(new Map(restored.ids).size, 4)
})

test('identical option names in different products have isolated keys, variant IDs, prices and stock', () => {
  const first = [{ id: 'first-variant', label: 'สี: ขาว', price: 159, stock: 3 }]
  const second = [{ id: 'second-variant', label: 'สี: ขาว', price: 299, stock: 8 }]
  const a = restoreProductOptions(first, 'tenant:first')
  const b = restoreProductOptions(second, 'tenant:second')
  const aKeys = new Set(productCombinations(a.groups).map((row) => row.key))
  assert.ok(productCombinations(b.groups).every((row) => !aKeys.has(row.key)))
  a.overrides[Object.keys(a.overrides)[0]].stock = '0'
  a.groups[0].values[0].label = 'แดง'
  assert.equal(b.groups[0].values[0].label, 'ขาว')
  const rows = resolveProductVariants('299', '8', productCombinations(b.groups), b.overrides)
  assert.deepEqual(
    rows.map((row) => [row.id, row.price, row.stock]),
    [['second-variant', '299', '8']],
  )
  assert.equal(second[0].stock, 8)
  assert.deepEqual(restoreProductOptions([], 'tenant:empty'), {
    groups: [],
    legacy: [],
    overrides: {},
    ids: [],
  })
})

test('irregular and legacy variants remain exact editable rows without inventing combinations', () => {
  for (const labels of [
    ['ขาว', 'ดำ'],
    ['สี: ขาว / ขนาด: S', 'สี: ดำ / ขนาด: M'],
  ]) {
    const variants = labels.map((label, index) => ({
      id: 'id-' + index,
      label,
      price: 200,
      stock: 1,
    }))
    const restored = restoreProductOptions(variants)
    assert.deepEqual(restored.groups, [])
    assert.deepEqual(
      restored.legacy.map((row) => row.label),
      labels,
    )
    assert.equal(restored.legacy.length, variants.length)
    assert.deepEqual(
      resolveProductVariants('100', '2', restored.legacy, restored.overrides).map((row) => row.id),
      ['id-0', 'id-1'],
    )
  }
  assert.deepEqual(restoreProductOptions([]).groups, [])
})

test('edit reads require owner scope, filter both tables by tenant/product and return all private fields with a version', async () => {
  let denied = false,
    missing = false
  const queries: [string, string, unknown][] = []
  const product = {
    id: productId,
    code: 'A1',
    name: 'เสื้อ',
    price: '159',
    stock: 3,
    is_active: true,
    description: 'รายละเอียด',
    commerce_images: ['https://cdn.example/one.webp', 'https://cdn.example/two.webp'],
    commerce_category_id: null,
    commerce_cost: '50',
    commerce_compare_price: '299',
    commerce_featured: true,
    commerce_version: 7,
  }
  const route = load('app/api/commerce/products/[id]/route.ts', {
    'next/server': { NextResponse },
    '@/lib/features/commerce/commerce-core': core,
    '@/lib/features/commerce/commerce-server': {
      async commerceScope(tenant: string, owner: boolean) {
        assert.equal(tenant, tenantId)
        assert.equal(owner, true)
        if (denied) throw new core.CommerceError('ไม่มีสิทธิ์', 403)
        return {
          tenantId,
          db: {
            from(table: string) {
              const query = {
                select: () => query,
                order: () => query,
                limit: () => query,
                eq(key: string, value: unknown) {
                  queries.push([table, key, value])
                  return query
                },
                maybeSingle: async () => ({ data: missing ? null : product, error: null }),
                then(resolve: (value: unknown) => unknown) {
                  return Promise.resolve(resolve({ data: [], error: null }))
                },
              }
              return query
            },
          },
        }
      },
      commerceResponse(error: core.CommerceError) {
        return NextResponse.json({ error: error.message }, { status: error.status ?? 503 })
      },
    },
  })
  const request = () =>
    route.GET(
      new NextRequest(
        'https://shop.example/api/commerce/products/' + productId + '?tenantId=' + tenantId,
      ),
      { params: Promise.resolve({ id: productId }) },
    )
  denied = true
  assert.equal((await request()).status, 403)
  assert.equal(queries.length, 0)
  denied = false
  const response = await request()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  const value = (await response.json()).product
  assert.equal(value.version, 7)
  assert.equal(value.cost, 50)
  assert.equal(value.compare_price, 299)
  assert.equal(value.featured, true)
  assert.deepEqual(value.images, product.commerce_images)
  for (const table of ['products', 'commerce_variants'])
    assert.ok(
      queries.some(([name, key, val]) => name === table && key === 'tenant_id' && val === tenantId),
    )
  assert.ok(
    queries.some(
      ([name, key, val]) =>
        name === 'commerce_variants' && key === 'product_id' && val === productId,
    ),
  )
  product.code = ''
  assert.equal(
    (await (await request()).json()).product.code,
    '',
    'Legacy products can be opened to assign their first SKU',
  )
  missing = true
  assert.equal((await request()).status, 404)
})
