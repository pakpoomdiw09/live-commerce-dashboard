'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { LoaderCircle, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { ProductImageGrid } from '@/components/shop/ProductImageGrid'
import type { LiveProductOption } from '@/lib/features/comments/comment-rules'
import { categoryOptions, isUuid, safeImage } from '@/lib/features/commerce/commerce-core'
import { quickLiveProduct } from '@/lib/features/commerce/live-cf-setup'
import {
  restoreProductOptions,
  type QuickProductDetails,
} from '@/lib/features/commerce/quick-product'
import {
  productCombinations,
  resolveProductVariants,
  type ProductOptionGroup,
  type ProductCombination,
  type ProductVariantOverride,
} from '@/lib/features/commerce/product-options'

const field =
  'mt-1.5 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100 disabled:bg-slate-50 disabled:text-slate-400'
type Draft = {
  name: string
  cf_code: string
  category_id: string
  price: string
  stock: string
  description: string
  images: string[]
}

function appendValues(group: ProductOptionGroup): ProductOptionGroup {
  const incoming = group.draft
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter(Boolean)
  if (!incoming.length) throw new Error('กรอกค่าตัวเลือกก่อนเพิ่ม')
  const seen = new Set(group.values.map((value) => value.label.normalize('NFKC').toLowerCase()))
  const values = [...group.values]
  for (const label of incoming) {
    if (label.length > 20) throw new Error('ค่าตัวเลือกต้องไม่เกิน 20 ตัวอักษร')
    const key = label.normalize('NFKC').toLowerCase()
    if (seen.has(key)) throw new Error(`มีค่า “${label}” อยู่แล้ว`)
    seen.add(key)
    values.push({ id: crypto.randomUUID(), label })
  }
  if (values.length > 40) throw new Error('มีตัวเลือกย่อยได้สูงสุด 40 แบบ')
  return { ...group, values, draft: '' }
}

type QuickProductModalProps = {
  tenantId: string
  salesPageUrl: string | null
  initialData?: LiveProductOption | null
  onSaved: (product: LiveProductOption) => void
  onDismiss: () => void
}

/** Every product/tenant owns a fresh form, including refs and pending requests. */
export function QuickProductModal(props: QuickProductModalProps) {
  return (
    <QuickProductForm key={`${props.tenantId}:${props.initialData?.id ?? 'create'}`} {...props} />
  )
}

function QuickProductForm({
  tenantId,
  salesPageUrl,
  initialData = null,
  onSaved,
  onDismiss,
}: QuickProductModalProps) {
  const productId = initialData?.id
  const dialogRef = useRef<HTMLDialogElement>(null)
  const codeInputRef = useRef<HTMLInputElement>(null)
  const savingRef = useRef(false),
    uploadingRef = useRef(false)
  const variantIds = useRef(new Map<string, string>())
  const mounted = useRef(false)
  const pendingRequests = useRef(new Set<AbortController>())
  const [loaded, setLoaded] = useState<QuickProductDetails | null>(null)
  const [detailsReady, setDetailsReady] = useState(!initialData)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailAttempt, setDetailAttempt] = useState(0)
  const [needsReload, setNeedsReload] = useState(false)
  const [saving, setSaving] = useState(false),
    [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
  const [categoriesReady, setCategoriesReady] = useState(false)
  const [categoryError, setCategoryError] = useState<string | null>(null)
  const [categoryAttempt, setCategoryAttempt] = useState(0)
  const [draft, setDraft] = useState<Draft>({
    name: initialData?.name ?? '',
    cf_code: initialData?.code ?? '',
    category_id: '',
    price: initialData ? String(initialData.price) : '',
    stock: String(initialData?.stock ?? 0),
    description: initialData?.description ?? '',
    images: [...(initialData?.images ?? (initialData?.image_url ? [initialData.image_url] : []))],
  })
  const [groups, setGroups] = useState<ProductOptionGroup[]>([])
  const [legacyVariants, setLegacyVariants] = useState<ProductCombination[]>([])
  const [overrides, setOverrides] = useState<Record<string, ProductVariantOverride>>({})
  const busy = saving || uploading
  const formDisabled = busy || !detailsReady
  const options = categoryOptions(categories)
  const combinations = useMemo(() => {
    try {
      return legacyVariants.length ? legacyVariants : productCombinations(groups)
    } catch {
      return []
    }
  }, [groups, legacyVariants])
  const preview = useMemo(() => {
    try {
      return resolveProductVariants(
        draft.price,
        draft.stock,
        combinations,
        Object.fromEntries(
          combinations.map((row) => [
            row.key,
            {
              id: row.key,
              price: overrides[row.key]?.price ?? '',
              stock: overrides[row.key]?.stock ?? '',
            },
          ]),
        ),
      )
    } catch {
      return []
    }
  }, [draft.price, draft.stock, combinations, overrides])
  const allStocksSet =
    combinations.length > 0 && combinations.every((row) => overrides[row.key]?.stock.trim())
  const displayedStock = allStocksSet
    ? combinations.reduce((sum, row) => sum + (Number(overrides[row.key].stock) || 0), 0)
    : draft.stock

  useEffect(() => {
    mounted.current = true
    const requests = pendingRequests.current
    const dialog = dialogRef.current,
      previousOverflow = document.body.style.overflow
    dialog?.showModal()
    codeInputRef.current?.focus()
    document.body.style.overflow = 'hidden'
    return () => {
      mounted.current = false
      requests.forEach((controller) => controller.abort())
      requests.clear()
      dialog?.close()
      document.body.style.overflow = previousOverflow
    }
  }, [])

  useEffect(() => {
    if (!productId) return
    const controller = new AbortController()
    // Clear the complete editable snapshot before every load/reload, including
    // products without variants. Never show or submit the previous option grid.
    setLoaded(null)
    setGroups([])
    setLegacyVariants([])
    setOverrides({})
    variantIds.current = new Map()
    setDetailsReady(false)
    setDetailError(null)
    void (async () => {
      try {
        const response = await fetch(
          `/api/commerce/products/${encodeURIComponent(productId)}?tenantId=${encodeURIComponent(tenantId)}`,
          { signal: controller.signal, cache: 'no-store' },
        )
        const result = await response.json()
        if (!response.ok) throw new Error(result.error ?? 'โหลดข้อมูลสินค้าไม่สำเร็จ')
        const product = structuredClone(result.product) as QuickProductDetails
        if (
          !product ||
          product.id !== productId ||
          !Number.isSafeInteger(product.version) ||
          !Array.isArray(product.variants) ||
          !Array.isArray(product.images)
        )
          throw new Error('ข้อมูลสินค้าไม่สมบูรณ์ กรุณาลองใหม่')
        const restored = restoreProductOptions(product.variants, `${tenantId}:${productId}`)
        if (!controller.signal.aborted) {
          setLoaded(product)
          setDraft({
            name: product.name,
            cf_code: product.code,
            category_id: product.category_id ?? '',
            price: String(product.price),
            stock: String(product.stock),
            description: product.description,
            images: [...product.images],
          })
          setGroups(restored.groups)
          setLegacyVariants(restored.legacy)
          setOverrides(restored.overrides)
          variantIds.current = new Map(restored.ids)
          setDetailsReady(true)
          setNeedsReload(false)
          setError(null)
        }
      } catch (failure) {
        if (!controller.signal.aborted)
          setDetailError(failure instanceof Error ? failure.message : 'โหลดข้อมูลสินค้าไม่สำเร็จ')
      }
    })()
    return () => controller.abort()
  }, [productId, tenantId, detailAttempt])

  useEffect(() => {
    const controller = new AbortController()
    setCategoriesReady(false)
    setCategoryError(null)
    void (async () => {
      try {
        const response = await fetch(
          `/api/commerce/product-options?tenantId=${encodeURIComponent(tenantId)}`,
          { signal: controller.signal, cache: 'no-store' },
        )
        const result = await response.json()
        if (!response.ok) throw new Error(result.error ?? 'โหลดหมวดหมู่ไม่สำเร็จ')
        if (
          !Array.isArray(result.categories) ||
          result.categories.some(
            (row: { id: string; name: string }) =>
              !row || !isUuid(row.id) || typeof row.name !== 'string',
          )
        )
          throw new Error('ข้อมูลหมวดหมู่ไม่ถูกต้อง กรุณาลองใหม่')
        if (!controller.signal.aborted) {
          setCategories(result.categories)
          setCategoriesReady(true)
        }
      } catch (failure) {
        if (!controller.signal.aborted)
          setCategoryError(failure instanceof Error ? failure.message : 'โหลดหมวดหมู่ไม่สำเร็จ')
      }
    })()
    return () => controller.abort()
  }, [tenantId, categoryAttempt])

  function change<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }
  function addValues(id: string) {
    try {
      const next = groups.map((group) => (group.id === id ? appendValues(group) : group))
      if (next.reduce((total, group) => total * Math.max(1, group.values.length), 1) > 40)
        throw new Error('มีตัวเลือกย่อยได้สูงสุด 40 แบบ')
      setGroups(next)
      setError(null)
    } catch (failure) {
      setError((failure as Error).message)
    }
  }
  function changeOverride(key: string, name: 'price' | 'stock', value: string) {
    setOverrides((current) => ({
      ...current,
      [key]: {
        id: current[key]?.id ?? '',
        price: current[key]?.price ?? '',
        stock: current[key]?.stock ?? '',
        [name]: value,
      },
    }))
  }
  async function upload(file: File): Promise<string | null> {
    if (savingRef.current || uploadingRef.current) return null
    uploadingRef.current = true
    const controller = new AbortController()
    pendingRequests.current.add(controller)
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.set('file', file)
      const response = await fetch(`/api/commerce/media?tenantId=${encodeURIComponent(tenantId)}`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      })
      const result = await response.json()
      if (!mounted.current || controller.signal.aborted) return null
      if (!response.ok) throw new Error(result.error ?? 'อัปโหลดรูปภาพไม่สำเร็จ')
      const url = safeImage(result.url)
      if (!url) throw new Error('ไม่ได้รับที่อยู่รูปภาพ กรุณาลองใหม่')
      return url
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : 'อัปโหลดรูปภาพไม่สำเร็จ')
      return null
    } finally {
      uploadingRef.current = false
      pendingRequests.current.delete(controller)
      if (mounted.current) setUploading(false)
    }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (savingRef.current || uploadingRef.current || !categoriesReady || !detailsReady) return
    const controller = new AbortController()
    pendingRequests.current.add(controller)
    setError(null)
    try {
      if (productId && (!loaded || loaded.id !== productId))
        throw new Error('ข้อมูลสินค้าไม่ตรงกัน กรุณาโหลดข้อมูลใหม่ก่อนบันทึก')
      const finalGroups = groups.map((group) => (group.draft.trim() ? appendValues(group) : group))
      const rows = legacyVariants.length ? legacyVariants : productCombinations(finalGroups)
      const supplied = Object.fromEntries(
        rows.map((row) => {
          if (!variantIds.current.has(row.key)) variantIds.current.set(row.key, crypto.randomUUID())
          return [
            row.key,
            {
              price: overrides[row.key]?.price ?? '',
              stock: overrides[row.key]?.stock ?? '',
              id: variantIds.current.get(row.key)!,
            },
          ]
        }),
      )
      const value = quickLiveProduct({
        ...draft,
        variants: resolveProductVariants(draft.price, draft.stock, rows, supplied).map(
          (variant) => ({
            ...variant,
            variant_code:
              loaded?.variants.find((old) => old.id === variant.id)?.variant_code ??
              variant.variant_code,
          }),
        ),
        is_active: loaded?.is_active ?? true,
        featured: loaded?.featured ?? false,
        cost: loaded?.cost,
        compare_price: loaded?.compare_price,
      })
      setGroups(finalGroups)
      savingRef.current = true
      setSaving(true)
      const response = await fetch('/api/commerce', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          action: 'product',
          value,
          ...(productId ? { id: productId, version: loaded!.version } : {}),
        }),
      })
      const result = await response.json()
      if (!mounted.current || controller.signal.aborted) return
      if (!response.ok) {
        setNeedsReload(
          !!initialData &&
            response.status === 409 &&
            String(result.error).includes('ข้อมูลเปลี่ยน'),
        )
        throw new Error(result.error ?? 'บันทึกสินค้าไม่สำเร็จ กรุณาลองใหม่')
      }
      if (!isUuid(result.id))
        throw new Error('ไม่ได้รับรหัสสินค้าที่บันทึก กรุณาตรวจสอบรายการในหน้าร้านค้า')
      if (initialData && result.id !== initialData.id)
        throw new Error('รหัสสินค้าที่บันทึกไม่ตรงกัน กรุณาโหลดข้อมูลใหม่')
      onSaved({
        id: result.id,
        name: value.name,
        code: value.code,
        sku: value.code,
        price: value.price,
        stock: value.stock,
        image_url: value.images[0] ?? null,
        images: value.images,
        description: value.description || null,
        is_active: value.is_active,
        sales_page_url: initialData?.sales_page_url ?? salesPageUrl,
        variants: value.variants,
      })
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : 'บันทึกสินค้าไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      savingRef.current = false
      pendingRequests.current.delete(controller)
      if (mounted.current) setSaving(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="quick-product-title"
      aria-describedby="quick-product-description"
      onCancel={(event) => {
        event.preventDefault()
        if (!savingRef.current && !uploadingRef.current) onDismiss()
      }}
      className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-3xl overflow-hidden rounded-2xl border-0 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/40"
    >
      <form onSubmit={save} aria-busy={busy} className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-7">
          <div>
            <h2 id="quick-product-title" className="text-xl font-semibold tracking-tight">
              {initialData ? 'แก้ไขข้อมูลสินค้า' : 'เพิ่มสินค้า'}
            </h2>
            <p id="quick-product-description" className="mt-1 text-sm text-slate-500">
              {initialData
                ? 'ปรับปรุงข้อมูล รูปภาพ และตัวเลือกสินค้า'
                : 'เพิ่มข้อมูลสินค้า รูปภาพ และตัวเลือกสำหรับร้านค้า'}
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onDismiss}
            aria-label={initialData ? 'ปิดหน้าต่างแก้ไขสินค้า' : 'ปิดหน้าต่างเพิ่มสินค้า'}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="min-h-0 space-y-7 overflow-y-auto px-5 py-6 sm:px-7">
          {!detailsReady && (
            <div
              role={detailError ? 'alert' : 'status'}
              className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600"
            >
              {detailError ?? 'กำลังโหลดข้อมูลสินค้าล่าสุด...'}
              {detailError && (
                <button
                  type="button"
                  onClick={() => setDetailAttempt((attempt) => attempt + 1)}
                  className="ml-2 font-semibold text-orange-600 underline"
                >
                  ลองโหลดสินค้าใหม่
                </button>
              )}
            </div>
          )}
          <fieldset disabled={formDisabled} className="grid min-w-0 gap-x-5 gap-y-5 sm:grid-cols-2">
            <label className="block text-sm font-medium sm:col-span-2">
              ชื่อสินค้า <span className="text-red-500">*</span>
              <input
                name="name"
                required
                maxLength={120}
                value={draft.name}
                onChange={(event) => change('name', event.target.value)}
                className={field}
                placeholder="เช่น เสื้อยืด กางเกง แก้วเก็บความเย็น"
              />
            </label>
            <label className="block min-w-0 text-sm font-medium">
              รหัสสินค้า / รหัส CF <span className="text-red-500">*</span>
              <input
                ref={codeInputRef}
                name="cf_code"
                required
                maxLength={20}
                value={draft.cf_code}
                onChange={(event) => change('cf_code', event.target.value)}
                className={field}
                placeholder="เช่น A1 หรือ 159"
              />
            </label>
            <div className="min-w-0">
              <label className="block text-sm font-medium">
                หมวดหมู่
                <select
                  name="category_id"
                  disabled={!categoriesReady}
                  value={draft.category_id}
                  onChange={(event) => change('category_id', event.target.value)}
                  className={field}
                >
                  <option value="">
                    {categoriesReady
                      ? 'เลือกหมวดหมู่ (ไม่บังคับ)'
                      : categoryError
                        ? 'โหลดหมวดหมู่ไม่สำเร็จ'
                        : 'กำลังโหลดหมวดหมู่...'}
                  </option>
                  {categoriesReady &&
                    options.map((option) => (
                      <option key={option.id} value={option.databaseId ?? option.id}>
                        {option.name}
                      </option>
                    ))}
                </select>
              </label>
              {categoryError && (
                <div id="quick-category-error" role="alert" className="mt-2 text-xs text-red-600">
                  <p>{categoryError}</p>
                  <button
                    type="button"
                    onClick={() => setCategoryAttempt((attempt) => attempt + 1)}
                    className="mt-1 inline-flex items-center gap-1 underline"
                  >
                    <RefreshCw className="h-3 w-3" />
                    ลองโหลดใหม่
                  </button>
                </div>
              )}
            </div>
            <label className="block text-sm font-medium">
              ราคาขาย (บาท) <span className="text-red-500">*</span>
              <input
                name="price"
                type="number"
                required
                min="0.01"
                max="9999999"
                step="0.01"
                inputMode="decimal"
                value={draft.price}
                onChange={(event) => change('price', event.target.value)}
                className={field}
                placeholder="0.00"
              />
            </label>
            <label className="block text-sm font-medium">
              สต็อกสินค้ารวม <span className="text-red-500">*</span>
              <input
                name="stock"
                type="number"
                required
                min="0"
                max="1000000"
                step="1"
                inputMode="numeric"
                disabled={allStocksSet}
                value={displayedStock}
                onChange={(event) => change('stock', event.target.value)}
                className={field}
              />
              {allStocksSet && (
                <span className="mt-1 block text-xs text-slate-400">
                  รวมจากสต็อกตัวเลือกที่ระบุ
                </span>
              )}
            </label>
            <label className="block text-sm font-medium sm:col-span-2">
              รายละเอียด <span className="font-normal text-slate-400">(ไม่บังคับ)</span>
              <textarea
                name="description"
                rows={2}
                maxLength={2000}
                value={draft.description}
                onChange={(event) => change('description', event.target.value)}
                className={`${field} resize-y`}
                placeholder="รายละเอียดสินค้า วัสดุ ขนาด หรือวิธีดูแล"
              />
            </label>
          </fieldset>

          <ProductImageGrid
            compact
            images={draft.images}
            disabled={formDisabled}
            upload={upload}
            onChange={(images) => change('images', images)}
          />

          <fieldset
            disabled={formDisabled}
            className="min-w-0 space-y-4 border-t border-slate-100 pt-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">ตัวเลือกสินค้า</h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  {legacyVariants.length
                    ? 'แก้ไขชื่อ ราคา และสต็อกของตัวเลือกเดิม'
                    : 'เช่น สี ขนาด ไซส์ เพิ่มได้ 2 กลุ่ม และรวมไม่เกิน 40 แบบ'}
                </p>
              </div>
              <button
                type="button"
                disabled={legacyVariants.length ? legacyVariants.length >= 40 : groups.length >= 2}
                onClick={() =>
                  legacyVariants.length
                    ? setLegacyVariants((current) => [
                        ...current,
                        { key: crypto.randomUUID(), label: '' },
                      ])
                    : setGroups((current) => [
                        ...current,
                        { id: crypto.randomUUID(), name: '', values: [], draft: '' },
                      ])
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium hover:bg-slate-50 disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
                เพิ่มตัวเลือก
              </button>
            </div>
            {groups.map((group, index) => (
              <div key={group.id} className="space-y-3 rounded-xl border border-slate-200 p-4">
                <div className="flex items-end gap-3">
                  <label className="min-w-0 flex-1 text-xs font-medium text-slate-600">
                    ชื่อตัวเลือก
                    <input
                      name={`option_name_${index}`}
                      required
                      maxLength={20}
                      value={group.name}
                      onChange={(event) =>
                        setGroups((current) =>
                          current.map((row) =>
                            row.id === group.id ? { ...row, name: event.target.value } : row,
                          ),
                        )
                      }
                      className={field}
                      placeholder={index === 0 ? 'เช่น สี' : 'เช่น ขนาด'}
                    />
                  </label>
                  <button
                    type="button"
                    aria-label={`ลบกลุ่มตัวเลือกที่ ${index + 1}`}
                    onClick={() =>
                      setGroups((current) => current.filter((row) => row.id !== group.id))
                    }
                    className="mb-1 rounded-lg p-2.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {group.values.map((value) => (
                    <span
                      key={value.id}
                      className="inline-flex max-w-full items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700"
                    >
                      <span className="break-all">{value.label}</span>
                      <button
                        type="button"
                        aria-label={`ลบค่า ${value.label}`}
                        onClick={() =>
                          setGroups((current) =>
                            current.map((row) =>
                              row.id === group.id
                                ? {
                                    ...row,
                                    values: row.values.filter((item) => item.id !== value.id),
                                  }
                                : row,
                            ),
                          )
                        }
                        className="rounded p-1 text-slate-400 hover:text-slate-800"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex items-end gap-2">
                  <label className="min-w-0 flex-1 text-xs text-slate-500">
                    ค่าตัวเลือก
                    <input
                      name={`option_values_${index}`}
                      value={group.draft}
                      onChange={(event) =>
                        setGroups((current) =>
                          current.map((row) =>
                            row.id === group.id ? { ...row, draft: event.target.value } : row,
                          ),
                        )
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                          event.preventDefault()
                          addValues(group.id)
                        }
                      }}
                      className={field}
                      placeholder={
                        index === 0 ? 'เช่น ขาว, ดำ, แดง แล้วกด Enter' : 'เช่น S, M, L แล้วกด Enter'
                      }
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!group.draft.trim()}
                    onClick={() => addValues(group.id)}
                    className="mb-0.5 rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-40"
                  >
                    เพิ่มค่า
                  </button>
                </div>
              </div>
            ))}
            {combinations.length > 0 && (
              <div className="space-y-3">
                <div>
                  <h4 className="text-xs font-semibold text-slate-700">
                    ราคาและสต็อกแยก <span className="font-normal text-slate-400">(ไม่บังคับ)</span>
                  </h4>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">
                    เว้นราคาเพื่อใช้ราคาหลัก เว้นสต็อกเพื่อแบ่งจากสต็อกรวมให้อัตโนมัติ
                  </p>
                </div>
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {combinations.map((row, index) => (
                    <div
                      key={row.key}
                      className="grid min-w-0 gap-3 p-3 sm:grid-cols-[1.3fr_1fr_1fr] sm:items-center"
                    >
                      {legacyVariants.length ? (
                        <div className="flex min-w-0 items-center gap-2">
                          <label className="min-w-0 flex-1 text-xs text-slate-500">
                            ชื่อตัวเลือก
                            <input
                              name={`variant_label_${index}`}
                              required
                              maxLength={80}
                              value={row.label}
                              onChange={(event) =>
                                setLegacyVariants((current) =>
                                  current.map((item) =>
                                    item.key === row.key
                                      ? { ...item, label: event.target.value }
                                      : item,
                                  ),
                                )
                              }
                              className={field}
                            />
                          </label>
                          <button
                            type="button"
                            aria-label={`ลบตัวเลือกที่ ${index + 1}`}
                            onClick={() =>
                              setLegacyVariants((current) =>
                                current.filter((item) => item.key !== row.key),
                              )
                            }
                            className="rounded p-2 text-slate-400 hover:text-red-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <p className="break-words text-sm text-slate-700">{row.label}</p>
                      )}
                      <label className="min-w-0 text-xs text-slate-500">
                        ราคา (บาท)
                        <input
                          name={`variant_price_${index}`}
                          type="number"
                          min="0.01"
                          max="9999999"
                          step="0.01"
                          inputMode="decimal"
                          value={overrides[row.key]?.price ?? ''}
                          onChange={(event) => changeOverride(row.key, 'price', event.target.value)}
                          className={field}
                          placeholder={`ใช้ราคาหลัก ${draft.price || '0.00'}`}
                        />
                      </label>
                      <label className="min-w-0 text-xs text-slate-500">
                        สต็อก
                        <input
                          name={`variant_stock_${index}`}
                          type="number"
                          min="0"
                          max="1000000"
                          step="1"
                          inputMode="numeric"
                          value={overrides[row.key]?.stock ?? ''}
                          onChange={(event) => changeOverride(row.key, 'stock', event.target.value)}
                          className={field}
                          placeholder={`อัตโนมัติ ${preview[index]?.stock ?? '—'}`}
                        />
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </fieldset>
          {uploading && (
            <p role="status" className="text-xs text-slate-500">
              กำลังอัปโหลดรูปภาพ...
            </p>
          )}
        </div>
        <footer className="flex shrink-0 flex-wrap justify-end gap-3 border-t border-slate-100 bg-white px-5 py-4 sm:px-7">
          {error && (
            <p role="alert" className="w-full text-sm text-red-600">
              {error}
            </p>
          )}
          {needsReload && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setDetailAttempt((attempt) => attempt + 1)}
              className="text-sm font-semibold text-orange-600 underline"
            >
              โหลดข้อมูลสินค้าล่าสุด
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={onDismiss}
            className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            ยกเลิก
          </button>
          <button
            type="submit"
            disabled={formDisabled || !categoriesReady}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {saving
              ? 'กำลังบันทึก...'
              : uploading
                ? 'กำลังอัปโหลด...'
                : initialData
                  ? 'บันทึกการแก้ไข'
                  : 'บันทึกและเลือกสินค้านี้'}
          </button>
        </footer>
      </form>
    </dialog>
  )
}
