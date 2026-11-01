'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { LoaderCircle, PackagePlus, X } from 'lucide-react'
import type { LiveProductOption } from '@/lib/features/comments/comment-rules'
import { isUuid } from '@/lib/features/commerce/commerce-core'
import { quickLiveProduct, type QuickLiveProductDraft } from '@/lib/features/commerce/live-cf-setup'

const field =
  'mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm outline-none transition focus:border-orange-400 focus:ring-3 focus:ring-orange-100 disabled:bg-slate-50'

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
  const nameInputRef = useRef<HTMLInputElement>(null)
  const savingRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<QuickLiveProductDraft>({
    name: '',
    price: '',
    stock: '',
    cf_code: '',
  })

  useEffect(() => {
    const dialog = dialogRef.current
    const previousOverflow = document.body.style.overflow
    dialog?.showModal()
    nameInputRef.current?.focus()
    document.body.style.overflow = 'hidden'
    return () => {
      dialog?.close()
      document.body.style.overflow = previousOverflow
    }
  }, [])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (savingRef.current) return
    setError(null)
    try {
      const value = quickLiveProduct(draft)
      savingRef.current = true
      setSaving(true)
      // The existing server API checks owner access, product quotas and duplicate codes,
      // then inserts into products through commerce_save_product in one transaction.
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
        image_url: null,
        description: null,
        sales_page_url: salesPageUrl,
        variants: [],
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
        if (!savingRef.current) onDismiss()
      }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-3xl border-0 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/50 backdrop:backdrop-blur-sm"
    >
      <form onSubmit={save} aria-busy={saving}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5 sm:p-6">
          <div>
            <span className="mb-3 inline-flex rounded-xl bg-orange-50 p-2.5 text-orange-600">
              <PackagePlus className="h-6 w-6" />
            </span>
            <h2 id="quick-product-title" className="text-xl font-bold">
              เพิ่มสินค้าใหม่เข้าเซลล์เพจ
            </h2>
            <p
              id="quick-product-description"
              className="mt-1 text-sm leading-relaxed text-slate-500"
            >
              กรอกข้อมูลสินค้า บันทึกแล้วเลือกใช้ในไลฟ์นี้ได้ทันที
            </p>
          </div>
          <button
            type="button"
            aria-label="ปิดหน้าต่างเพิ่มสินค้า"
            disabled={saving}
            onClick={onDismiss}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <fieldset disabled={saving} className="space-y-4 p-5 sm:p-6">
          <label className="block text-sm font-semibold">
            ชื่อสินค้า
            <input
              ref={nameInputRef}
              name="name"
              required
              maxLength={120}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              className={field}
              placeholder="เช่น เสื้อยืดคอกลม"
            />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className="block text-sm font-semibold">
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
                onChange={(event) => setDraft({ ...draft, price: event.target.value })}
                className={field}
                placeholder="159.00"
              />
            </label>
            <label className="block text-sm font-semibold">
              จำนวนสต็อก (ชิ้น)
              <input
                name="stock"
                type="number"
                inputMode="numeric"
                required
                min="0"
                max="1000000"
                step="1"
                value={draft.stock}
                onChange={(event) => setDraft({ ...draft, stock: event.target.value })}
                className={field}
                placeholder="10"
              />
            </label>
          </div>
          <label className="block text-sm font-semibold">
            รหัส CF
            <input
              name="cf_code"
              required
              maxLength={20}
              value={draft.cf_code}
              onChange={(event) => setDraft({ ...draft, cf_code: event.target.value })}
              className={`${field} font-bold text-orange-600`}
              placeholder="เช่น A1 หรือ 159"
            />
            <span className="mt-1.5 block text-xs font-normal leading-relaxed text-slate-500">
              ใช้ตัวอักษร ตัวเลข ขีดกลาง หรือขีดล่าง ไม่เกิน 20 ตัว และไม่ซ้ำกับสินค้าในร้าน
            </span>
          </label>
          <p className="rounded-xl bg-orange-50 p-3 text-xs leading-relaxed text-orange-800">
            สินค้าจะพร้อมแสดงบนเซลเพจของร้านเมื่อเปิดหน้าร้านแล้ว
            สามารถเพิ่มรูปภาพและรายละเอียดภายหลังที่หน้าร้านค้าได้
          </p>
        </fieldset>
        {error && (
          <p
            role="alert"
            className="mx-5 mb-5 rounded-xl bg-red-50 p-3 text-sm text-red-700 sm:mx-6"
          >
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 p-5 sm:p-6">
          <button
            type="button"
            disabled={saving}
            onClick={onDismiss}
            className="rounded-xl bg-slate-100 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50"
          >
            ยกเลิก
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-600 disabled:cursor-wait disabled:opacity-60"
          >
            {saving && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {saving ? 'กำลังเพิ่มสินค้า...' : 'บันทึกและเลือกสินค้านี้'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
