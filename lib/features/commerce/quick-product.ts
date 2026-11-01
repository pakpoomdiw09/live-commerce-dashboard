import {
  productCombinations,
  type ProductCombination,
  type ProductOptionGroup,
  type ProductVariantOverride,
} from './product-options'
import type { parseProduct } from './commerce-core'

export type QuickProductDetails = Omit<ReturnType<typeof parseProduct>, 'variants'> & {
  id: string
  version: number
  variants: ExistingVariant[]
}
type ExistingVariant = {
  id: string
  label: string
  price: number
  stock: number
  variant_code?: string | null
}

/** Reconstruct only complete, unambiguous grids. Keep irregular/legacy choices as editable rows. */
export function restoreProductOptions(variants: readonly ExistingVariant[], productKey = '') {
  const namespace = productKey ? `${productKey}:` : ''
  let groups: ProductOptionGroup[] = []
  let combinations: ProductCombination[] = []
  let legacy: ProductCombination[] = []
  try {
    if (variants.length) {
      const split = variants.map((variant) =>
        variant.label.split(' / ').map((part) => {
          const separator = part.indexOf(': ')
          if (separator < 1) throw new Error('Flat label')
          return { name: part.slice(0, separator), value: part.slice(separator + 2) }
        }),
      )
      if (split[0].length > 2) throw new Error('Too many groups')
      groups = split[0].map((part, index) => {
        if (split.some((row) => row.length !== split[0].length || row[index].name !== part.name))
          throw new Error('Mixed groups')
        const values = [...new Set(split.map((row) => row[index].value))]
        return {
          id: namespace + 'saved-group-' + index,
          name: part.name,
          draft: '',
          values: values.map((label, valueIndex) => ({
            id: namespace + 'saved-value-' + valueIndex,
            label,
          })),
        }
      })
      combinations = productCombinations(groups)
      if (
        combinations.length !== variants.length ||
        combinations.some((row) => !variants.some((variant) => variant.label === row.label))
      )
        throw new Error('Incomplete grid')
    }
  } catch {
    groups = []
    legacy = variants.map((variant) => ({ key: variant.id, label: variant.label }))
    combinations = legacy
  }
  const ids: [string, string][] = []
  const overrides: Record<string, ProductVariantOverride> = {}
  for (const row of combinations) {
    const variant = variants.find((item) => item.label === row.label)!
    ids.push([row.key, variant.id])
    overrides[row.key] = {
      id: variant.id,
      price: String(variant.price),
      stock: String(variant.stock),
    }
  }
  return { groups, legacy, overrides, ids }
}
