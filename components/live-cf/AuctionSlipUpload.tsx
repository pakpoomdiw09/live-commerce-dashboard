'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function AuctionSlipUpload({
  token,
  initiallySubmitted,
  automatic = false,
}: {
  token: string
  initiallySubmitted: boolean
  automatic?: boolean
}) {
  const router = useRouter()
  const [submitted, setSubmitted] = useState(initiallySubmitted)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [verification, setVerification] = useState('')
  return (
    <div className="rounded-2xl border border-orange-100 p-4">
      {submitted ? (
        <p role="status" className="text-sm text-emerald-700">
          {verification || 'ส่งสลิปแล้ว รอร้านค้าตรวจสอบและยืนยันการชำระเงิน'}
        </p>
      ) : (
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault()
            const body = new FormData(event.currentTarget)
            setBusy(true)
            setError('')
            try {
              const response = await fetch(`/pay/live/${encodeURIComponent(token)}/slip`, {
                method: 'POST',
                body,
              })
              const result = await response.json()
              if (!response.ok) throw new Error(result.error || 'อัปโหลดไม่สำเร็จ')
              if (automatic && result.balance)
                setVerification(
                  `ตรวจสลิปผ่านแล้ว ยอดค้างสุทธิ ${Number(result.balance.remainingAmount).toLocaleString('th-TH')} บาท${result.balance.remainingAmount === 0 ? ' • ชำระครบแล้วครับ' : ' • เปิดหน้าใหม่เพื่อแนบสลิปส่วนที่เหลือได้ครับ'}`,
                )
              setSubmitted(true)
              if (automatic) router.refresh()
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'อัปโหลดไม่สำเร็จ')
            } finally {
              setBusy(false)
            }
          }}
        >
          <label className="block text-sm font-semibold">
            แนบสลิปชำระเงิน
            <input
              required
              name="file"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="mt-2 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-orange-50 file:p-2 file:text-orange-700"
            />
          </label>
          <p className="text-xs text-slate-500">
            JPG, PNG หรือ WebP ไม่เกิน 5 MB{' '}
            {automatic
              ? 'ตรวจสลิปอัตโนมัติด้วยระบบ AI และหักยอดที่โอนจริง รวมถึงยอดโอนบางส่วน'
              : 'ร้านค้าจะตรวจสอบหลักฐานก่อนยืนยันยอด'}
          </p>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <button
            disabled={busy}
            className="w-full rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'กำลังส่ง…' : 'ส่งหลักฐานชำระเงิน'}
          </button>
        </form>
      )}
    </div>
  )
}
