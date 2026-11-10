'use client'

import { useRef, useState } from 'react'
import { Building2, Clock3, LoaderCircle, LockKeyhole, PackageCheck } from 'lucide-react'
import type { CfOrderStatus } from '@/lib/types'

export type LiveCfPaymentVariant = { id: string; label: string; price: number; stock: number }
type Selection = {
  variant_id: string | null
  variant_label: string | null
  amount: number
  confirmed_at: string | null
  payment_total: number
  remaining_selections: number
}
const baht = (value: number) =>
  Number(value).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function LiveCfVariantPayment({
  token,
  productName,
  status,
  initialSelection,
  variants,
  bank,
  qrUrl,
}: {
  token: string
  productName: string
  status: CfOrderStatus
  initialSelection: Selection
  variants: LiveCfPaymentVariant[]
  bank: { name: string; account_name: string; account_number: string } | null
  qrUrl: string | null
}) {
  const [selection, setSelection] = useState(initialSelection)
  const [variantId, setVariantId] = useState(initialSelection.variant_id ?? '')
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null)
  const lock = useRef(false)
  const candidate = variants.find((variant) => variant.id === variantId)
  const confirmed = !!selection.confirmed_at
  async function confirm() {
    if (lock.current || !candidate) return
    lock.current = true
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/live-cf/payment-variant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, variantId }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'ยืนยันตัวเลือกไม่สำเร็จ')
      if (
        typeof result.amount !== 'number' ||
        !Number.isFinite(result.amount) ||
        result.amount <= 0 ||
        result.variant_id !== variantId ||
        !result.confirmed_at ||
        typeof result.payment_total !== 'number' ||
        !Number.isFinite(result.payment_total) ||
        result.payment_total <= 0 ||
        !Number.isSafeInteger(result.remaining_selections) ||
        result.remaining_selections < 0
      )
        throw new Error('ข้อมูลการยืนยันไม่ครบ กรุณาเปิดหน้าชำระเงินใหม่')
      setSelection(result)
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-8 text-slate-900">
      <section className="mx-auto max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <header className="border-b border-slate-100 px-6 py-5">
          <p className="flex items-center gap-2 text-xs text-slate-500">
            <LockKeyhole className="h-4 w-4" />
            ลิงก์สั่งซื้อที่ปลอดภัย
          </p>
          <h1 className="mt-2 text-xl font-semibold">สรุปคำสั่งซื้อและชำระเงิน</h1>
        </header>
        <div className="space-y-5 p-6">
          <div className="flex gap-3">
            <PackageCheck className="mt-1 h-6 w-6 shrink-0 text-orange-500" />
            <div>
              <h2 className="font-semibold">{productName}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {confirmed ? selection.variant_label : 'เลือกรูปแบบสินค้าก่อนชำระเงิน'}
              </p>
              <p className="mt-2 text-2xl font-semibold text-orange-600">
                {baht(confirmed ? selection.amount : (candidate?.price ?? selection.amount))} บาท
              </p>
              {!confirmed && (
                <p className="mt-1 text-xs text-slate-400">ยอดสุดท้ายจะแสดงหลังยืนยันตัวเลือก</p>
              )}
            </div>
          </div>
          {status === 'cancelled' ? (
            <p role="status" className="rounded-lg bg-rose-50 p-4 text-sm text-rose-800">
              คำสั่งซื้อนี้ถูกยกเลิกแล้ว จึงไม่สามารถชำระเงินหรือส่งสลิปผ่านลิงก์นี้ได้
              หากชำระเงินไปแล้ว กรุณาติดต่อร้านค้า
            </p>
          ) : status !== 'pending_payment' ? (
            <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
              รายการนี้ได้รับการชำระหรือดำเนินการแล้ว
            </p>
          ) : !confirmed ? (
            <div className="space-y-3 border-t border-slate-100 pt-5">
              <label className="block text-sm font-medium">
                เลือกสีหรือขนาด
                <select
                  aria-label="เลือกรูปแบบสินค้าเพื่อชำระเงิน"
                  disabled={busy}
                  value={variantId}
                  onChange={(event) => {
                    setVariantId(event.target.value)
                    setError(null)
                  }}
                  className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 outline-none focus:border-slate-400"
                >
                  <option value="">กรุณาเลือกตัวเลือกสินค้า</option>
                  {variants.map((variant) => (
                    <option key={variant.id} value={variant.id} disabled={variant.stock < 1}>
                      {variant.label} · {baht(variant.price)} บาท{variant.stock < 1 ? ' · หมด' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs leading-relaxed text-slate-500">
                ตรวจสอบตัวเลือกให้ถูกต้องก่อนยืนยัน ยืนยันแล้วจะจองสต็อกและไม่สามารถเปลี่ยนเองได้
              </p>
              {error && (
                <p role="alert" className="text-sm text-red-600">
                  {error}
                </p>
              )}
              <button
                type="button"
                disabled={busy || !candidate || candidate.stock < 1}
                onClick={confirm}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
              >
                {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
                {busy ? 'กำลังยืนยัน...' : 'ยืนยันตัวเลือกและดูข้อมูลชำระเงิน'}
              </button>
            </div>
          ) : selection.remaining_selections > 0 ? (
            <div className="space-y-3 border-t border-slate-100 pt-4 text-sm text-slate-600">
              <p>
                ยังมีรายการอื่นที่ต้องเลือกรูปแบบสินค้า
                กรุณาเปิดลิงก์รายการที่เหลือจากแชทและยืนยันให้ครบก่อนโอนเงิน
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-lg border border-slate-200 px-4 py-2 font-medium hover:bg-slate-50"
              >
                อัปเดตยอดชำระเงิน
              </button>
            </div>
          ) : bank ? (
            <div className="rounded-xl border border-slate-200 p-5 text-center">
              <Building2 className="mx-auto h-6 w-6 text-slate-400" />
              <p className="mt-2 text-xs text-slate-500">
                โอนยอดรวม {baht(selection.payment_total)} บาท เข้าบัญชี
              </p>
              {selection.payment_total !== selection.amount && (
                <p className="mt-1 text-xs text-slate-400">
                  รวมทุกรายการที่ยังไม่ชำระของคุณในร้านนี้
                </p>
              )}
              <p className="mt-1 font-medium">{bank.name}</p>
              <p className="mt-1 text-xl font-semibold tracking-wide">{bank.account_number}</p>
              <p className="text-sm text-slate-500">{bank.account_name}</p>
              {qrUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed bank QR URL
                <img
                  src={qrUrl}
                  alt="รหัสสำหรับชำระเงิน"
                  className="mx-auto mt-4 h-48 w-48 object-contain"
                />
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              ร้านค้ายังไม่ได้ตั้งค่าบัญชีรับเงิน กรุณาติดต่อร้านค้า
            </p>
          )}
          <p className="flex items-center justify-center gap-1.5 text-xs text-slate-400">
            <Clock3 className="h-3.5 w-3.5" />
            ลิงก์หมดอายุภายใน 24 ชั่วโมง
          </p>
        </div>
      </section>
    </main>
  )
}
