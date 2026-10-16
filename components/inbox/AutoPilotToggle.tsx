'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { Bot } from 'lucide-react'
import { apiError, cn } from '@/lib/utils'
import type { ActiveTenant } from './InboxClient'

/** SlipOK Auto-Pilot for the whole tenant / Page: verify slip images from chat automatically. */
export function AutoPilotToggle({ tenant }: { tenant: ActiveTenant | null }) {
  const router = useRouter()
  const [on, setOn] = useState(tenant?.autoVerify ?? false)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setOn(tenant?.autoVerify ?? false), [tenant?.autoVerify])

  function toggle() {
    if (!tenant) return
    const next = !on
    setOn(next) // optimistic
    setError(null)
    start(async () => {
      const res = await fetch(`/api/tenants/${tenant.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_verify_enabled: next }),
      })
      if (!res.ok) {
        setOn(!next)
        setError(await apiError(res))
        return
      }
      router.refresh()
    })
  }

  const label = tenant ? `ระบบตรวจสลิปอัตโนมัติของ ${tenant.name}` : 'ตั้งค่าร้านค้าก่อนเปิดระบบตรวจสลิปอัตโนมัติ'
  return (
    <div className="flex flex-col items-end">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        title={error ?? label}
        disabled={!tenant || pending}
        onClick={toggle}
        className={cn(
          'flex items-center gap-2 rounded-full py-1 pr-1 pl-3 text-xs font-medium ring-1 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-60',
          on ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-slate-50 text-slate-600 ring-slate-200',
        )}
      >
        <Bot className="h-3.5 w-3.5" aria-hidden />
        <span className="hidden sm:inline">ตรวจสลิปอัตโนมัติ</span>
        <span className="sm:hidden">ตรวจสลิป</span>
        <span className={cn('flex h-5 w-9 items-center rounded-full p-0.5 transition-colors', on ? 'bg-emerald-500' : 'bg-slate-300')}>
          <span className={cn('h-4 w-4 rounded-full bg-white shadow transition-transform', on && 'translate-x-4')} />
        </span>
      </button>
      {error && <span className="mt-1 text-[11px] text-rose-600">{error}</span>}
    </div>
  )
}
