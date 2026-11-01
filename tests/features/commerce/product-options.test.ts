import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  productCombinations,
  resolveProductVariants,
  type ProductOptionGroup,
} from '../../../lib/features/commerce/product-options'
const groups: ProductOptionGroup[] = [
  {
    id: 'color',
    name: 'สี',
    draft: '',
    values: [
      { id: 'white', label: 'ขาว' },
      { id: 'black', label: 'ดำ' },
    ],
  },
  {
    id: 'size',
    name: 'ขนาด',
    draft: '',
    values: [
      { id: 's', label: 'S' },
      { id: 'm', label: 'M' },
    ],
  },
]
test('option groups create stable Cartesian combinations without duplicate names/values or more than 40 variants', () => {
  const rows = productCombinations(groups)
  assert.deepEqual(
    rows.map((row) => row.label),
    ['สี: ขาว / ขนาด: S', 'สี: ขาว / ขนาด: M', 'สี: ดำ / ขนาด: S', 'สี: ดำ / ขนาด: M'],
  )
  assert.equal(
    productCombinations([{ ...groups[0], name: 'โทนสี' }, groups[1]])[0].key,
    rows[0].key,
  )
  assert.throws(() => productCombinations([{ ...groups[0], values: [] }]))
  assert.throws(() => productCombinations([groups[0], { ...groups[1], name: 'สี' }]))
  assert.throws(() =>
    productCombinations([
      {
        ...groups[0],
        values: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'a' },
        ],
      },
    ]),
  )
  assert.throws(
    () =>
      productCombinations([
        {
          ...groups[0],
          values: Array.from({ length: 21 }, (_, i) => ({ id: String(i), label: String(i) })),
        },
        groups[1],
      ]),
    /40/,
  )
})
test('blank variant prices inherit the current main price and unspecified stock shares a finite inventory budget', () => {
  const rows = productCombinations(groups)
  const defaults = Object.fromEntries(
    rows.map((row, index) => [row.key, { id: `id-${index}`, price: '', stock: '' }]),
  )
  const resolved = resolveProductVariants('159.50', '10', rows, defaults)
  assert.deepEqual(
    resolved.map((row) => row.stock),
    ['3', '3', '2', '2'],
  )
  assert.ok(resolved.every((row) => row.price === '159.5' && row.variant_code === ''))
  const override = { ...defaults, [rows[0].key]: { id: 'id-0', price: '259', stock: '0' } }
  assert.equal(resolveProductVariants('159', '10', rows, override)[0].stock, '0')
  assert.equal(resolveProductVariants('159', '10', rows, override)[0].price, '259')
  assert.equal(resolveProductVariants('199', '10', rows, override)[1].price, '199')
  const allExplicit = Object.fromEntries(
    rows.map((row, index) => [row.key, { id: `id-${index}`, price: '', stock: '2' }]),
  )
  assert.deepEqual(
    resolveProductVariants('159', '', rows, allExplicit).map((row) => row.stock),
    ['2', '2', '2', '2'],
  )
  assert.throws(
    () =>
      resolveProductVariants('159', '1', rows, {
        ...defaults,
        [rows[0].key]: { id: 'id-0', price: '', stock: '2' },
      }),
    /เกิน/,
  )
  assert.throws(() =>
    resolveProductVariants('159', '10', rows, {
      ...defaults,
      [rows[0].key]: { id: 'id-0', price: '0', stock: '' },
    }),
  )
})
