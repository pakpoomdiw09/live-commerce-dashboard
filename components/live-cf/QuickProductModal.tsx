'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { LoaderCircle, PackagePlus, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { ProductImageGrid } from '@/components/shop/ProductImageGrid'
import type { LiveProductOption } from '@/lib/features/comments/comment-rules'
import { categoryOptions, isUuid, safeImage } from '@/lib/features/commerce/commerce-core'
import { quickLiveProduct, type QuickLiveProductDraft } from '@/lib/features/commerce/live-cf-setup'

const field =
  'mt-1.5 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm outline-none transition focus:border-orange-400 focus:ring-3 focus:ring-orange-100 disabled:bg-slate-50 disabled:text-slate-500'
type Draft = Required<QuickLiveProductDraft>
type Variant = Draft['variants'][number]
type Category = { id: string; name: string }

export function QuickProductModal({
  tenantId,
  salesPageUrl,
  onCreated,
  onDismiss,
}: {
  tenantId: string
  salesPageUrl: string | null
  onCreated: (product: LiveProductOption) => void
  onDismiss: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const codeInputRef = useRef<HTMLInputElement>(null)
  const savingRef = useRef(false)
  const uploadingRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [categoriesReady, setCategoriesReady] = useState(false)
  const [categoryError, setCategoryError] = useState<string | null>(null)
  const [categoryAttempt, setCategoryAttempt] = useState(0)
  const [draft, setDraft] = useState<Draft>({
    name: '',
    price: '',
    stock: '0',
    cf_code: '',
    category_id: '',
    description: '',
    images: [],
    is_active: true,
    featured: false,
    variants: [],
  })
  const busy = saving || uploading
  const options = categoryOptions(categories)
  const totalStock = draft.variants.length
    ? draft.variants.reduce((total, variant) => total + (Number(variant.stock) || 0), 0)
    : Number(draft.stock) || 0

  useEffect(() => {
    const dialog = dialogRef.current
    const previousOverflow = document.body.style.overflow
    dialog?.showModal()
    codeInputRef.current?.focus()
    document.body.style.overflow = 'hidden'
    return () => {
      dialog?.close()
      document.body.style.overflow = previousOverflow
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setCategoriesReady(false)
    setCategoryError(null)
    async function load() {
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
            (item: Category) => !item || !isUuid(item.id) || typeof item.name !== 'string',
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
    }
    void load()
    return () => controller.abort()
  }, [tenantId, categoryAttempt])

  function change<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function changeVariant(id: string, key: keyof Omit<Variant, 'id'>, value: string) {
    setDraft((current) => ({
      ...current,
      variants: current.variants.map((variant) =>
        variant.id === id ? { ...variant, [key]: value } : variant,
      ),
    }))
  }

  async function upload(file: File): Promise<string | null> {
    if (savingRef.current || uploadingRef.current) return null
    uploadingRef.current = true
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.set('file', file)
      const response = await fetch(`/api/commerce/media?tenantId=${encodeURIComponent(tenantId)}`, {
        method: 'POST',
        body: form,
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'อัปโหลดรูปภาพไม่สำเร็จ')
      const url = safeImage(result.url)
      if (!url) throw new Error('ไม่ได้รับที่อยู่รูปภาพ กรุณาลองใหม่')
      return url
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'อัปโหลดรูปภาพไม่สำเร็จ กรุณาลองใหม่')
      return null
    } finally {
      uploadingRef.current = false
      setUploading(false)
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (savingRef.current || uploadingRef.current || !categoriesReady) return
    setError(null)
    try {
      const value = quickLiveProduct(draft)
      savingRef.current = true
      setSaving(true)
      // Reuse the shop's owner/tenant checks, quotas and atomic product/variant write.
      // Stable UUIDs let the next screen use the exact persisted variant IDs immediately.
      const response = await fetch('/api/commerce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, action: 'product', value }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'เพิ่มสินค้าไม่สำเร็จ กรุณาลองใหม่')
      if (!isUuid(result.id))
        throw new Error('ไม่ได้รับรหัสสินค้าที่บันทึก กรุณาตรวจสอบรายการในหน้าร้านค้า')
      onCreated({
        id: result.id,
        name: value.name,
        code: value.code,
        price: value.price,
        stock: value.stock,
        image_url: value.images[0] ?? null,
        description: value.description || null,
        is_active: value.is_active,
        sales_page_url: salesPageUrl,
        variants: value.variants.map(
          (variant: {
            id: string
            label: string
            variant_code: string | null
            price: number
            stock: number
          }) => ({ ...variant }),
        ),
      })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'เพิ่มสินค้าไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      savingRef.current = false
      setSaving(false)
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
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-3xl border-0 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/50 backdrop:backdrop-blur-sm"
    >
      <form onSubmit={save} aria-busy={busy}>
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-100 bg-white/95 p-5 backdrop-blur-sm sm:px-6">
          <div className="flex items-start gap-3">
            <span className="inline-flex shrink-0 rounded-xl bg-orange-50 p-2.5 text-orange-600">
              <PackagePlus className="h-6 w-6" />
            </span>
            <div>
              <h2 id="quick-product-title" className="text-lg font-bold sm:text-xl">
                เพิ่มสินค้าใหม่เข้าเซลล์เพจ
              </h2>
              <p
                id="quick-product-description"
                className="mt-1 text-sm leading-relaxed text-slate-500"
              >
                เพิ่มสินค้า รูปภาพ และตัวเลือก แล้วเลือกใช้ในไลฟ์นี้ได้ทันที
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="ปิดหน้าต่างเพิ่มสินค้า"
            disabled={busy}
            onClick={onDismiss}
            className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="space-y-6 p-5 sm:p-6">
          <fieldset disabled={busy} className="grid min-w-0 gap-4 sm:grid-cols-2">
            <legend className="mb-4 text-sm font-bold text-slate-900">ข้อมูลสินค้า</legend>
            <label className="block min-w-0 text-sm font-semibold">
              รหัสสินค้า / SKU / รหัส CF
              <input
                ref={codeInputRef}
                name="cf_code"
                required
                maxLength={20}
                value={draft.cf_code}
                onChange={(event) => change('cf_code', event.target.value)}
                className={`${field} font-bold text-orange-600`}
                placeholder="เช่น A1 หรือ 159"
              />
              <span className="mt-1.5 block text-xs font-normal leading-relaxed text-slate-500">
                รหัสที่ให้ลูกค้าพิมพ์จอง ไม่เกิน 20 ตัว และไม่ซ้ำกับสินค้าในร้าน
              </span>
            </label>
            <label className="block min-w-0 text-sm font-semibold">
              ชื่อสินค้า / พระเครื่อง
              <input
                name="name"
                required
                maxLength={120}
                value={draft.name}
                onChange={(event) => change('name', event.target.value)}
                className={field}
                placeholder="เช่น เหรียญรุ่นแรก หรือเสื้อยืดคอกลม"
              />
            </label>
            <div className="min-w-0">
              <label className="block text-sm font-semibold">
                หมวดหมู่สินค้า
                <select
                  name="category_id"
                  value={draft.category_id}
                  disabled={!categoriesReady}
                  onChange={(event) => change('category_id', event.target.value)}
                  className={field}
                  aria-describedby={categoryError ? 'quick-category-error' : undefined}
                >
                  <option value="">
                    {categoriesReady
                      ? 'ไม่ระบุหมวดหมู่'
                      : categoryError
                        ? 'ยังโหลดหมวดหมู่ไม่ได้'
                        : 'กำลังโหลดหมวดหมู่...'}
                  </option>
                  {categoriesReady &&
                    options.map((option) => (
                      <option key={option.id} value={option.databaseId ?? option.id}>
                        {option.icon} {option.name}
                      </option>
                    ))}
                </select>
              </label>
              {categoryError && (
                <div
                  id="quick-category-error"
                  role="alert"
                  className="mt-2 space-y-2 text-xs text-red-700"
                >
                  <p>{categoryError}</p>
                  <button
                    type="button"
                    onClick={() => setCategoryAttempt((attempt) => attempt + 1)}
                    className="inline-flex items-center gap-1 font-semibold underline"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    ลองโหลดใหม่
                  </button>
                </div>
              )}
            </div>
            <label className="block min-w-0 text-sm font-semibold">
              ราคาขาย (บาท)
              <input
                name="price"
                type="number"
                inputMode="decimal"
                required
                min="0.01"
                max="9999999"
                step="0.01"
                value={draft.price}
                onChange={(event) => change('price', event.target.value)}
                className={field}
                placeholder="159.00"
              />
            </label>
            <label className="block text-sm font-semibold sm:col-span-2">
              รายละเอียด
              <textarea
                name="description"
                rows={3}
                maxLength={2000}
                value={draft.description}
                onChange={(event) => change('description', event.target.value)}
                className={`${field} resize-y`}
                placeholder="รายละเอียดสินค้า รุ่น ขนาด เนื้อพระ หรือจุดเด่นที่ต้องการแจ้งลูกค้า"
              />
            </label>
            <label className="block min-w-0 text-sm font-semibold">
              สต็อก (ชิ้น)
              {draft.variants.length > 0 && (
                <span className="ml-1 text-xs font-normal text-slate-500">นับรวมจากตัวเลือก</span>
              )}
              <input
                name="stock"
                type="number"
                inputMode="numeric"
                required
                min="0"
                max="1000000"
                step="1"
                disabled={draft.variants.length > 0}
                value={draft.variants.length ? totalStock : draft.stock}
                onChange={(event) => change('stock', event.target.value)}
                className={field}
              />
            </label>
            <div className="flex flex-wrap items-center gap-5 rounded-xl bg-slate-50 px-4 py-3 text-sm">
              <label className="inline-flex cursor-pointer items-center gap-2">
                <input
                  name="is_active"
                  type="checkbox"
                  checked={draft.is_active}
                  onChange={(event) => change('is_active', event.target.checked)}
                  className="h-4 w-4 accent-orange-500"
                />
                เปิดขาย
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2">
                <input
                  name="featured"
                  type="checkbox"
                  checked={draft.featured}
                  onChange={(event) => change('featured', event.target.checked)}
                  className="h-4 w-4 accent-orange-500"
                />
                สินค้าแนะนำ
              </label>
            </div>
          </fieldset>

          <div className="border-t border-slate-100 pt-5">
            <ProductImageGrid
              images={draft.images}
              disabled={busy}
              upload={upload}
              onChange={(images) => change('images', images)}
            />
          </div>

          <fieldset disabled={busy} className="min-w-0 space-y-3 border-t border-slate-100 pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold">ตัวเลือกสินค้า</h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  เช่น สี ขนาด พิมพ์พระ หรือเนื้อพระ กำหนดราคาและสต็อกแยกได้
                </p>
              </div>
              <button
                type="button"
                disabled={draft.variants.length >= 40}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    variants: [
                      ...current.variants,
                      {
                        id: crypto.randomUUID(),
                        label: '',
                        variant_code: '',
                        price: current.price,
                        stock: '0',
                      },
                    ],
                  }))
                }
                className="inline-flex items-center gap-1.5 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-semibold text-orange-700 hover:bg-orange-100 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                เพิ่มตัวเลือก
              </button>
            </div>
            {!draft.variants.length && (
              <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                ยังไม่มีตัวเลือก ระบบจะใช้ราคาขายและสต็อกของสินค้าด้านบน
              </p>
            )}
            {draft.variants.map((variant, index) => (
              <div
                key={variant.id}
                className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4"
                data-variant-id={variant.id}
              >
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">ตัวเลือกที่ {index + 1}</h4>
                  <button
                    type="button"
                    aria-label={`ลบตัวเลือกที่ ${index + 1}`}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        variants: current.variants.filter((row) => row.id !== variant.id),
                      }))
                    }
                    className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  <label className="block min-w-0 text-sm font-medium">
                    ชื่อตัวเลือก
                    <input
                      name={`variant_label_${index}`}
                      required
                      maxLength={80}
                      value={variant.label}
                      onChange={(event) => changeVariant(variant.id, 'label', event.target.value)}
                      className={field}
                      placeholder="เช่น สีดำ / พิมพ์ใหญ่ / เนื้อเงิน"
                    />
                  </label>
                  <label className="block min-w-0 text-sm font-medium">
                    รหัส CF ของตัวเลือก (ไม่บังคับ)
                    <input
                      name={`variant_code_${index}`}
                      maxLength={20}
                      value={variant.variant_code}
                      onChange={(event) =>
                        changeVariant(variant.id, 'variant_code', event.target.value)
                      }
                      className={field}
                      placeholder="เช่น A1-S หรือ 159W"
                    />
                  </label>
                  <label className="block min-w-0 text-sm font-medium">
                    ราคาขายตัวเลือก (บาท)
                    <input
                      name={`variant_price_${index}`}
                      type="number"
                      inputMode="decimal"
                      required
                      min="0.01"
                      max="9999999"
                      step="0.01"
                      value={variant.price}
                      onChange={(event) => changeVariant(variant.id, 'price', event.target.value)}
                      className={field}
                    />
                  </label>
                  <label className="block min-w-0 text-sm font-medium">
                    สต็อกตัวเลือก (ชิ้น)
                    <input
                      name={`variant_stock_${index}`}
                      type="number"
                      inputMode="numeric"
                      required
                      min="0"
                      max="1000000"
                      step="1"
                      value={variant.stock}
                      onChange={(event) => changeVariant(variant.id, 'stock', event.target.value)}
                      className={field}
                    />
                  </label>
                </div>
              </div>
            ))}
            {draft.variants.length > 0 && (
              <p className="text-xs leading-relaxed text-slate-500">
                รวมสต็อก {totalStock.toLocaleString('th-TH')} ชิ้น · หลังบันทึก
                ระบบจะเลือกตัวเลือกแรกให้ สามารถเปลี่ยนตัวเลือกในหน้าตั้งค่าไลฟ์ได้
              </p>
            )}
          </fieldset>
          <p className="rounded-xl bg-orange-50 p-3 text-xs leading-relaxed text-orange-800">
            สินค้าที่เปิดขายจะพร้อมแสดงบนเซลเพจของร้านเมื่อเปิดหน้าร้านแล้ว หากยังไม่เปิดขาย
            ระบบจะบันทึกไว้ในหน้าจัดการสินค้า
          </p>
          {error && (
            <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>

        <footer className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white/95 p-5 backdrop-blur-sm sm:px-6">
          <p role="status" className="text-xs text-slate-500">
            {uploading
              ? 'กำลังอัปโหลดรูปภาพ กรุณารอสักครู่...'
              : draft.variants.length
                ? `${draft.variants.length}/40 ตัวเลือก · สต็อกรวม ${totalStock.toLocaleString('th-TH')} ชิ้น`
                : 'บันทึกแล้วเลือกสินค้าเข้าไลฟ์ได้ทันที'}
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={onDismiss}
              className="rounded-xl bg-slate-100 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={busy || !categoriesReady}
              className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
              {saving
                ? 'กำลังเพิ่มสินค้า...'
                : uploading
                  ? 'กำลังอัปโหลดรูป...'
                  : 'บันทึกและเลือกสินค้านี้'}
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  )
}
