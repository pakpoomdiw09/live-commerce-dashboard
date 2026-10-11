'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { FacebookIcon } from '@/components/ui/FacebookIcon'
import { apiError, cn } from '@/lib/utils'

export type PageCardData = {
  tenantId: string
  name: string
  shopName: string
  picture: string | null
  /** Meta recognises the Page token */
  connected: boolean
  autoReply: boolean
  creditsLeft: number
  active: boolean
}

/** One Page in the picker: choosing it makes it the active tenant and opens the dashboard. */
export function PageCard({ page }: { page: PageCardData }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const status = !page.connected
    ? { label: 'ยังเชื่อมเพจไม่ครบ', className: 'bg-amber-50 text-amber-800 ring-amber-200' }
    : page.autoReply
      ? { label: 'บอทกำลังทำงาน', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' }
      : { label: 'ปิดบอทอยู่', className: 'bg-slate-100 text-slate-600 ring-slate-200' }

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
      {page.active && <CheckCircle2 className="absolute top-3 right-3 h-5 w-5 text-orange-500" aria-label="เพจที่ใช้อยู่" />}
      {page.picture ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={page.picture} alt="" className="h-16 w-16 rounded-full object-cover ring-2 ring-orange-100" />
      ) : (
        <span className="grid h-16 w-16 place-items-center rounded-full bg-[#1877f2]/10 text-[#1877f2]">
          <FacebookIcon className="h-7 w-7" />
        </span>
      )}
      <span className="mt-1 line-clamp-2 font-semibold text-slate-900">{page.name}</span>
      {page.name !== page.shopName && <span className="-mt-1 text-xs text-slate-500">{page.shopName}</span>}
      <span className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1', status.className)}>{status.label}</span>
      <span className="mt-auto text-xs text-slate-500">เครดิตตรวจสลิป {page.creditsLeft.toLocaleString('th-TH')}</span>
      {pending && <Loader2 className="absolute top-3 left-3 h-4 w-4 animate-spin text-slate-400" aria-label="กำลังเปิดเพจ" />}
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </button>
  )
}
