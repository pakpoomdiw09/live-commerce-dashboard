import { CommerceError, money, stock } from './commerce-core'

export type ProductOptionGroup = {
  id: string
  name: string
  values: { id: string; label: string }[]
  draft: string
}
export type ProductCombination = { key: string; label: string }
export type ProductVariantOverride = { id: string; price: string; stock: string }

export function productCombinations(groups: readonly ProductOptionGroup[]): ProductCombination[] {
  if (!groups.length) return []
  if (groups.length > 2) throw new CommerceError('เพิ่มกลุ่มตัวเลือกได้สูงสุด 2 กลุ่ม')
  let result: ProductCombination[] = [{ key: '', label: '' }]
  const names = new Set<string>()
  for (const group of groups) {
    const name = group.name.trim()
    if (!name || name.length > 20)
      throw new CommerceError('กรอกชื่อตัวเลือก เช่น สี หรือขนาด ไม่เกิน 20 ตัว')
    if (names.has(name.normalize('NFKC').toLowerCase()))
      throw new CommerceError('ชื่อกลุ่มตัวเลือกซ้ำกัน')
    names.add(name.normalize('NFKC').toLowerCase())
    if (!group.values.length) throw new CommerceError(`เพิ่มค่าอย่างน้อย 1 ค่าในตัวเลือก “${name}”`)
    const values = new Set<string>()
    for (const value of group.values) {
      const label = value.label.trim()
      if (!label || label.length > 20) throw new CommerceError('ค่าตัวเลือกต้องมี 1–20 ตัวอักษร')
      const key = label.normalize('NFKC').toLowerCase()
      if (values.has(key)) throw new CommerceError(`มีค่า “${label}” ซ้ำในตัวเลือก ${name}`)
      values.add(key)
    }
    if (result.length * group.values.length > 40)
      throw new CommerceError('มีตัวเลือกย่อยได้สูงสุด 40 แบบ')
    result = result.flatMap((row) =>
      group.values.map((value) => ({
        key: `${row.key}${group.id}:${value.id}|`,
        label: `${row.label}${row.label ? ' / ' : ''}${name}: ${value.label.trim()}`,
      })),
    )
  }
  if (result.some((row) => row.label.length > 80))
    throw new CommerceError('ชื่อรวมตัวเลือกยาวเกิน 80 ตัว กรุณาย่อชื่อกลุ่มหรือค่า')
  return result
}

/** Missing inventories share the main stock budget; never multiply inventory per option. */
export function resolveProductVariants(
  priceInput: string,
  stockInput: string,
  combinations: readonly ProductCombination[],
  overrides: Record<string, ProductVariantOverride>,
) {
  const price = money(Number(priceInput))
  const explicit = combinations.filter((row) => overrides[row.key]?.stock.trim())
  const assigned = explicit.reduce((sum, row) => sum + stock(Number(overrides[row.key].stock)), 0)
  const missing = combinations.length - explicit.length
  if ((!combinations.length || missing) && !stockInput.trim())
    throw new CommerceError('กรุณากรอกสต็อกสินค้ารวม')
  const total = combinations.length && !missing ? stock(assigned) : stock(Number(stockInput))
  if (assigned > total) throw new CommerceError('สต็อกตัวเลือกที่ระบุรวมกันเกินสต็อกสินค้ารวม')
  const remainder = total - assigned
  let next = 0
  return combinations.map((row) => {
    const override = overrides[row.key]
    if (!override?.id) throw new CommerceError('ข้อมูลตัวเลือกยังไม่พร้อม กรุณาลองใหม่')
    const count = override.stock.trim()
      ? stock(Number(override.stock))
      : Math.floor(remainder / missing) + (next++ < remainder % missing ? 1 : 0)
    return {
      id: override.id,
      label: row.label,
      variant_code: '',
      price: String(override.price.trim() ? money(Number(override.price)) : price),
      stock: String(count),
    }
  })
}
