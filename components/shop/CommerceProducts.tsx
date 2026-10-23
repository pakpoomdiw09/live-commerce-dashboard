'use client'
import { useMemo, useState } from 'react'
import { Copy, Package, Pencil, Plus, Trash2 } from 'lucide-react'
import type { CommerceFilters } from '@/lib/features/commerce/commerce-server'
import { CategorySelector } from '@/components/shop/CategorySelector'
import { ProductImageGrid } from '@/components/shop/ProductImageGrid'
import { categoryOptions, parseProduct } from '@/lib/features/commerce/commerce-core'
import {
  commerceButton as btn,
  commerceInput as input,
  commercePrimary as primary,
  type ShopMutation,
} from '@/components/shop/CommerceEditor'
export function CommerceProducts({
  products,
  variants,
  categories,
  mutate,
  upload,
  busy,
  canManage,
  serverFilters,
  onSearch,
}: {
  serverFilters?: CommerceFilters
  onSearch?: (value: { q: string; category: string; sort: string }) => void
  products: any[]
  variants: any[]
  categories: any[]
  mutate: ShopMutation
  upload: (file: File) => Promise<string | null>
  busy: boolean
  canManage: boolean
}) {
  const [editing, setEditing] = useState<any>(null),
    [draft, setDraft] = useState<any>(null),
    [error, setError] = useState(''),
    [preview, setPreview] = useState(false)
  const [search, setSearch] = useState(serverFilters?.q ?? ''),
    [category, setCategory] = useState(serverFilters?.category ?? ''),
    [sort, setSort] = useState(serverFilters?.sort ?? 'new')
  const options = categoryOptions(categories)
  const selectedCategory = options.find((c) => c.id === category || c.databaseId === category)
  const activeCategory = selectedCategory?.id ?? ''
  const list = useMemo(
    () =>
      serverFilters
        ? products
        : products
            .filter(
              (p) =>
                `${p.name} ${p.code}`.toLowerCase().includes(search.toLowerCase()) &&
                (!activeCategory ||
                  (!!selectedCategory?.databaseId &&
                    p.commerce_category_id === selectedCategory.databaseId)),
            )
            .sort((a, b) =>
              sort === 'price'
                ? Number(a.price) - Number(b.price)
                : sort === 'price_desc'
                  ? Number(b.price) - Number(a.price)
                  : b.created_at.localeCompare(a.created_at),
            ),
    [products, search, selectedCategory?.databaseId, activeCategory, sort, serverFilters],
  )
  const open = (p?: any, copy = false) => {
    setEditing(p && !copy ? p : null)
    setError('')
    setPreview(false)
    setDraft({
      code: copy ? '' : (p?.code ?? ''),
      name: p ? `${p.name}${copy ? ' (สำเนา)' : ''}` : '',
      description: p?.description ?? '',
      price: Number(p?.price ?? 1),
      stock: copy ? 0 : (p?.stock ?? 0),
      images: p?.commerce_images?.length ? p.commerce_images : p?.image_url ? [p.image_url] : [],
      category_id: p?.commerce_category_id ?? '',
      compare_price: p?.commerce_compare_price == null ? null : Number(p.commerce_compare_price),
      cost: p?.commerce_cost == null ? null : Number(p.commerce_cost),
      featured: p?.commerce_featured ?? false,
      is_active: copy ? false : (p?.is_active ?? false),
      variants: variants
        .filter((v) => v.product_id === p?.id)
        .map((v) => ({
          ...v,
          id: copy ? undefined : v.id,
          stock: copy ? 0 : v.stock,
          price: Number(v.price),
        })),
    })
  }
  const change = (key: string, value: any) => setDraft((d: any) => ({ ...d, [key]: value }))
  const save = async () => {
    try {
      const value = parseProduct({
        ...draft,
        price: Number(draft.price),
        stock: Number(draft.stock),
        compare_price:
          draft.compare_price == null || draft.compare_price === ''
            ? null
            : Number(draft.compare_price),
        cost: draft.cost == null || draft.cost === '' ? null : Number(draft.cost),
        variants: draft.variants.map((v: any) => ({
          ...v,
          price: Number(v.price),
          stock: Number(v.stock),
        })),
      })
      setError('')
      const id = await mutate('product', value, editing?.id, editing?.commerce_version)
      if (id) setDraft(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  if (draft)
    return (
      <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{editing ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า'}</h2>
          <div className="flex gap-2">
            <button className={btn} disabled={busy} onClick={() => setDraft(null)}>
              กลับ
            </button>
            <button className={btn} onClick={() => setPreview(!preview)}>
              {preview ? 'แก้ไขต่อ' : 'ดูตัวอย่าง'}
            </button>
          </div>
        </header>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        {preview ? (
          <div className="mx-auto max-w-md space-y-4 rounded-2xl bg-orange-50 p-6">
            {draft.images[0] && (
              <img
                src={draft.images[0]}
                alt={draft.name}
                className="aspect-square w-full rounded-xl object-cover"
              />
            )}
            <h3 className="break-words text-xl font-bold">{draft.name || 'ชื่อสินค้า'}</h3>
            <p className="text-xl text-orange-700">
              ฿{Number(draft.price).toLocaleString('th-TH')}
            </p>
            <p className="whitespace-pre-wrap break-words text-sm">{draft.description}</p>
          </div>
        ) : (
          <fieldset disabled={busy || !canManage} className="grid gap-4 md:grid-cols-2">
            {(
              [
                ['code', 'รหัสสินค้า / SKU'],
                ['name', 'ชื่อสินค้า'],
              ] as const
            ).map(([key, label]) => (
              <label className="text-sm" key={key}>
                {label}
                <input
                  className={input}
                  value={draft[key]}
                  maxLength={key === 'code' ? 20 : 120}
                  onChange={(e) => change(key, e.target.value)}
                />
              </label>
            ))}
            <CategorySelector
              categories={categories}
              value={draft.category_id}
              onChange={(value) => change('category_id', value)}
              disabled={busy || !canManage}
            />
            <label className="text-sm">
              ราคาขาย (บาท)
              <input
                type="number"
                onFocus={(e) => e.currentTarget.select()}
                step="0.01"
                min="0.01"
                className={input}
                value={draft.price}
                onChange={(e) => change('price', e.target.value.replace(/^0+(?=\d)/, ''))}
              />
            </label>
            <label className="text-sm">
              ราคาเปรียบเทียบ (ไม่บังคับ)
              <input
                type="number"
                onFocus={(e) => e.currentTarget.select()}
                step="0.01"
                className={input}
                value={draft.compare_price ?? ''}
                onChange={(e) => change('compare_price', e.target.value.replace(/^0+(?=\d)/, ''))}
              />
            </label>
            <label className="text-sm">
              ต้นทุน (เห็นเฉพาะในระบบจัดการ)
              <input
                type="number"
                onFocus={(e) => e.currentTarget.select()}
                min="0"
                step="0.01"
                className={input}
                value={draft.cost ?? ''}
                onChange={(e) => change('cost', e.target.value.replace(/^0+(?=\d)/, ''))}
              />
            </label>
            <label className="text-sm md:col-span-2">
              รายละเอียด
              <textarea
                className={input}
                rows={4}
                maxLength={2000}
                value={draft.description}
                onChange={(e) => change('description', e.target.value)}
              />
            </label>
            <label className="text-sm">
              สต็อก {draft.variants.length ? '(นับรวมจากตัวเลือก)' : ''}
              <input
                type="number"
                onFocus={(e) => e.currentTarget.select()}
                className={input}
                min="0"
                max="1000000"
                disabled={!!draft.variants.length}
                value={
                  draft.variants.length
                    ? draft.variants.reduce((n: number, v: any) => n + Number(v.stock), 0)
                    : draft.stock
                }
                onChange={(e) => change('stock', e.target.value.replace(/^0+(?=\d)/, ''))}
              />
            </label>
            <div className="flex flex-wrap items-center gap-5 text-sm">
              <label>
                <input
                  type="checkbox"
                  checked={draft.is_active}
                  onChange={(e) => change('is_active', e.target.checked)}
                />{' '}
                เปิดขาย
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.featured}
                  onChange={(e) => change('featured', e.target.checked)}
                />{' '}
                สินค้าแนะนำ
              </label>
            </div>
            <ProductImageGrid
              images={draft.images}
              disabled={busy || !canManage}
              upload={upload}
              onChange={(images) => change('images', images)}
            />
            <div className="space-y-3 md:col-span-2">
              <h3 className="font-medium">ตัวเลือกสินค้า เช่น สี / ขนาด</h3>
              <p className="text-xs leading-6 text-slate-500">
                สินค้าที่มีตัวเลือกให้ลูกค้าเลือกซื้อผ่านหน้าร้านเว็บเท่านั้น ระบบแชท CF
                เดิมจะไม่สร้างออเดอร์ที่ยังไม่ได้ระบุสีหรือขนาด
              </p>
              {draft.variants.map((v: any, i: number) => (
                <div
                  className="grid items-end gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-[2fr_1fr_1fr_auto]"
                  key={v.id ?? i}
                >
                  {[
                    ['label', 'ชื่อ เช่น ดำ / M'],
                    ['price', 'ราคา'],
                    ['stock', 'สต็อก'],
                  ].map(([key, title]) => (
                    <label key={key} className="text-xs">
                      {title}
                      <input
                        type={key === 'label' ? 'text' : 'number'}
                        onFocus={(e) => {
                          if (key !== 'label') e.currentTarget.select()
                        }}
                        className={input}
                        value={v[key]}
                        step={key === 'price' ? '0.01' : '1'}
                        min="0"
                        onChange={(e) =>
                          change(
                            'variants',
                            draft.variants.map((r: any, j: number) =>
                              i === j
                                ? {
                                    ...r,
                                    [key]:
                                      key === 'label'
                                        ? e.target.value
                                        : e.target.value.replace(/^0+(?=\d)/, ''),
                                  }
                                : r,
                            ),
                          )
                        }
                      />
                    </label>
                  ))}
                  <button
                    type="button"
                    aria-label={`ลบตัวเลือกที่ ${i + 1}`}
                    className={btn}
                    onClick={() =>
                      change(
                        'variants',
                        draft.variants.filter((_: any, j: number) => i !== j),
                      )
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className={btn}
                disabled={draft.variants.length >= 40}
                onClick={() =>
                  change('variants', [
                    ...draft.variants,
                    { label: '', price: draft.price, stock: 0 },
                  ])
                }
              >
                เพิ่มตัวเลือก
              </button>
            </div>
            <button type="button" className={primary} onClick={() => void save()}>
              บันทึกสินค้า
            </button>
            <p className="text-xs leading-6 text-slate-500">
              หากสต็อกเปลี่ยนระหว่างแก้ไข ระบบจะให้โหลดข้อมูลใหม่เพื่อไม่ทับยอดขายที่เกิดขึ้น
            </p>
          </fieldset>
        )}
      </section>
    )
  return (
    <div className="space-y-5">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSearch?.({ q: search, category: activeCategory, sort })
        }}
        className="flex flex-wrap gap-3"
      >
        <input
          aria-label="ค้นหาสินค้า"
          placeholder="ค้นหาชื่อหรือรหัสสินค้า"
          className={input + ' sm:max-w-xs'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="กรองหมวดหมู่"
          className={input + ' sm:max-w-48'}
          value={activeCategory}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">ทุกหมวดหมู่</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon} {c.name}
            </option>
          ))}
        </select>
        <select
          aria-label="เรียงสินค้า"
          className={input + ' sm:max-w-48'}
          value={sort}
          onChange={(e) => setSort(e.target.value as CommerceFilters['sort'])}
        >
          <option value="new">ใหม่ล่าสุด</option>
          <option value="price">ราคาต่ำไปสูง</option>
          <option value="price_desc">ราคาสูงไปต่ำ</option>
        </select>
        {serverFilters && (
          <button type="submit" className={btn}>
            ค้นหา
          </button>
        )}
        <button
          type="button"
          className={primary}
          disabled={!canManage || busy}
          onClick={() => open()}
        >
          <Plus className="h-4 w-4" />
          เพิ่มสินค้า
        </button>
      </form>
      {!list.length && (
        <div className="rounded-2xl border border-dashed border-orange-200 bg-white p-12 text-center">
          <Package className="mx-auto mb-3 h-10 w-10 text-orange-400" />
          <h3 className="break-words font-semibold">ยังไม่มีสินค้าที่ตรงกับรายการนี้</h3>
          <p className="mt-2 text-sm text-slate-500">
            เพิ่มสินค้าชิ้นแรก หรือเปลี่ยนคำค้นหาเพื่อเริ่มต้น
          </p>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((p) => (
          <article
            key={p.id}
            className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
          >
            {p.image_url ? (
              <img src={p.image_url} alt={p.name} className="aspect-[4/3] w-full object-cover" />
            ) : (
              <div className="grid aspect-[4/3] place-items-center bg-orange-50 text-orange-300">
                <Package className="h-12 w-12" />
              </div>
            )}
            <div className="space-y-3 p-4">
              <p className="text-xs text-slate-500">
                {p.code} · {p.is_active ? 'เปิดขาย' : 'ปิดขาย'}
              </p>
              <h3 className="break-words font-semibold">{p.name}</h3>
              <div className="flex justify-between">
                <strong className="text-orange-700">
                  ฿{Number(p.price).toLocaleString('th-TH')}
                </strong>
                <span className={p.stock <= 3 ? 'text-sm text-red-700' : 'text-sm text-slate-500'}>
                  เหลือ {p.stock} ชิ้น
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button disabled={!canManage || busy} className={btn} onClick={() => open(p)}>
                  <Pencil className="h-4 w-4" />
                  แก้ไข
                </button>
                <button disabled={!canManage || busy} className={btn} onClick={() => open(p, true)}>
                  <Copy className="h-4 w-4" />
                  คัดลอก
                </button>
                <button
                  disabled={!canManage || busy}
                  className={btn}
                  aria-label={`ลบสินค้า ${p.name}`}
                  onClick={() => {
                    if (
                      confirm(`นำสินค้า ${p.name} ออกจากการขายหรือไม่? ประวัติคำสั่งซื้อจะยังอยู่`)
                    )
                      void mutate('archive', {}, p.id)
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
