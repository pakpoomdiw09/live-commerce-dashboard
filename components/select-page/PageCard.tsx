'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { FacebookIcon } from '@/components/ui/FacebookIcon'
import { FallbackImg } from '@/components/ui/FallbackImg'
import { apiError, cn } from '@/lib/utils'
import type { PageConnectionStatus } from '@/lib/types'

export type PageCardData = {
  tenantId: string
  name: string
  shopName: string
  picture: string | null
  connectionStatus: PageConnectionStatus
  autoReply: boolean
  creditsLeft: number
  active: boolean
}

/** One Page in the picker: choosing it makes it the active tenant and opens the dashboard. */
export function PageCard({ page }: { page: PageCardData }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const status = {
    'missing-page': {
      label: 'ยังไม่ได้ผูกเพจ',
      detail: 'เลือกร้านแล้วตั้งค่าเพจ หรือเชื่อมต่อ Facebook',
      className: 'bg-amber-50 text-amber-800 ring-amber-200',
    },
    'missing-token': {
      label: 'ยังไม่มี Token ของเพจ',
      detail: 'เชื่อมต่อ Facebook เพื่อบันทึก Token',
      className: 'bg-amber-50 text-amber-800 ring-amber-200',
    },
    verified: {
      label: 'เชื่อมต่อเพจแล้ว',
      detail: 'ตรวจสอบ Token และสิทธิ์ตอบแชทแล้ว',
      className: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    },
    limited: {
      label: 'เชื่อมต่อแล้ว สิทธิ์ยังไม่ครบ',
      detail: 'Token ไม่มีสิทธิ์ตอบแชท กรุณาอนุญาตสิทธิ์ใน Facebook',
      className: 'bg-amber-50 text-amber-800 ring-amber-200',
    },
    invalid: {
      label: 'ต้องเชื่อมต่อเพจใหม่',
      detail: 'Token ใช้ไม่ได้หรือไม่ตรงกับเพจนี้',
      className: 'bg-rose-50 text-rose-700 ring-rose-200',
    },
    unverified: {
      label: 'ยังตรวจสอบการเชื่อมต่อไม่ได้',
      detail: 'ผูกเพจแล้ว แต่ยังตรวจสอบ Token กับ Facebook ไม่สำเร็จ',
      className: 'bg-slate-100 text-slate-600 ring-slate-200',
    },
  }[page.connectionStatus]

  function choose() {
    setError(null)
    start(async () => {
      const res = await fetch('/api/tenants/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: page.tenantId }),
      })
      if (!res.ok) return setError(await apiError(res))
      router.push('/overview')
      router.refresh()
    })
  }

  return (
    <button
      type="button"
      onClick={choose}
      disabled={pending}
      className={cn(
        'relative flex h-full min-h-48 w-full flex-col items-center gap-2 rounded-2xl bg-white p-5 text-center shadow-lg shadow-orange-900/10 transition hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-70',
        page.active && 'ring-4 ring-white/70',
      )}
    >
      {page.active && (
        <CheckCircle2
          className="absolute top-3 right-3 h-5 w-5 text-orange-500"
          aria-label="เพจที่ใช้อยู่"
        />
      )}
      <FallbackImg
        src={page.picture}
        size={64}
        className="h-16 w-16 rounded-full object-cover ring-2 ring-orange-100"
        fallback={
          <span className="grid h-16 w-16 place-items-center rounded-full bg-[#1877f2]/10 text-[#1877f2]">
            <FacebookIcon className="h-7 w-7" />
          </span>
        }
      />
      <span className="mt-1 line-clamp-2 font-semibold text-slate-900">{page.name}</span>
      {page.name !== page.shopName && (
        <span className="-mt-1 text-xs text-slate-500">{page.shopName}</span>
      )}
      <span
        className={cn(
          'rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1',
          status.className,
        )}
      >
        {status.label}
      </span>
      <span className="text-xs text-slate-500">{status.detail}</span>
      <span className="text-xs text-slate-500">
        {page.autoReply ? 'เปิดตอบอัตโนมัติ' : 'ปิดตอบอัตโนมัติ'}
      </span>
      <span className="mt-auto text-xs text-slate-500">
        เครดิตตรวจสลิป {page.creditsLeft.toLocaleString('th-TH')}
      </span>
      {pending && (
        <Loader2
          className="absolute top-3 left-3 h-4 w-4 animate-spin text-slate-400"
          aria-label="กำลังเปิดเพจ"
        />
      )}
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </button>
  )
}
