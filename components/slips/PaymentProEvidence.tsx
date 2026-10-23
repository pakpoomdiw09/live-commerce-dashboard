'use client'
import { neutralSlipText } from '@/lib/ui-labels'
import { useEffect, useState } from 'react'
import Image from 'next/image'
import type { SlipDetail } from '@/lib/types'

/** Reuse the existing authorized slip-detail API and private signed images; never read raw evidence in browser SQL. */
export function PaymentProEvidence({ slipId }: { slipId: string }) {
  const [detail, setDetail] = useState<SlipDetail | null>(null),
    [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setDetail(null)
    setError('')
    void (async () => {
      try {
        const r = await fetch(`/api/slips/${encodeURIComponent(slipId)}`, {
            cache: 'no-store',
            signal: controller.signal,
          }),
          v = await r.json()
        if (!r.ok) throw new Error(v.error ?? 'โหลดหลักฐานไม่ได้')
        setDetail(v.slip)
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'โหลดหลักฐานไม่ได้')
      }
    })()
    return () => controller.abort()
  }, [slipId])
  if (error)
    return (
      <p role="alert" className="my-3 text-sm text-rose-700">
        {error}
      </p>
    )
  if (!detail)
    return <p className="my-3 text-sm text-slate-500">กำลังโหลดหลักฐานจากระบบตรวจสลิป…</p>
  return (
    <div className="my-4 grid gap-4 rounded-2xl bg-orange-50 p-4 md:grid-cols-2">
      {detail.imageUrl ? (
        <Image
          src={detail.imageUrl}
          alt="หลักฐานสลิปสำหรับตรวจสอบ"
          width={420}
          height={560}
          unoptimized
          className="max-h-96 w-full rounded-xl object-contain"
        />
      ) : (
        <p className="text-sm text-slate-500">รายการนี้ใช้ข้อมูล QR ไม่มีไฟล์รูปภาพ</p>
      )}
      <dl className="space-y-3 break-words text-sm">
        <div>
          <dt className="text-slate-500">ยอดจาก Provider / ยอดออเดอร์</dt>
          <dd>
            {detail.amount ?? '—'} / {detail.expected_amount ?? '—'} บาท
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">เลขอ้างอิงธุรกรรม</dt>
          <dd>{detail.trans_ref ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-500">ผู้รับ / ธนาคาร / บัญชี</dt>
          <dd>
            {detail.receiver.name ?? '—'} · {detail.receiver.bank ?? '—'} ·{' '}
            {detail.receiver.account ?? '—'}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">เวลาโอนจาก Provider</dt>
          <dd>
            {detail.transferredAt
              ? new Date(detail.transferredAt).toLocaleString('th-TH')
              : 'ไม่พบข้อมูล'}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">ผลตรวจสอบ</dt>
          <dd>{neutralSlipText(detail.note ?? detail.status)}</dd>
        </div>
      </dl>
    </div>
  )
}
