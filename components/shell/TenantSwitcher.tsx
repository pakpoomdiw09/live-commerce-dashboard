'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { Check, ChevronsUpDown, Loader2, Plus } from 'lucide-react'
import { BankLogo } from '@/components/BankLogo'
import { FacebookIcon } from '@/components/ui/FacebookIcon'
import type { TenantRow } from '@/lib/types'
import { cn } from '@/lib/utils'

type Option = Pick<TenantRow, 'id' | 'name' | 'bank_code' | 'page_id'>

/**
 * Quick Switcher: pick the tenant (shop / Facebook Page) every dashboard screen works on.
 * canCreate: only platform admins add tenants (POST /api/tenants refuses everyone else).
 */
export function TenantSwitcher({ tenants, activeId, canCreate }: { tenants: Option[]; activeId: string | null; canCreate: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const active = tenants.find((t) => t.id === activeId)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => rootRef.current?.contains(e.target as Node) || setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function pick(id: string) {
    setOpen(false)
    if (id === activeId) return
    setError(null)
    start(async () => {
      const res = await fetch('/api/tenants/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: id }),
      })
      if (!res.ok) return setError('สลับร้านไม่สำเร็จ')
      router.refresh()
    })
  }

  if (tenants.length === 0) {
    if (!canCreate) return <p className="rounded-xl border border-dashed border-slate-300 p-3 text-xs text-slate-500">ยังไม่มีร้านค้าที่คุณเข้าถึงได้</p>
    return (
      <Link
        href="/settings"
        className="flex items-center gap-3 rounded-xl border border-dashed border-slate-300 p-3 text-sm text-slate-600 transition hover:border-emerald-400 hover:text-emerald-700"
      >
        <Plus className="h-4 w-4" aria-hidden />
        เพิ่มร้านค้าแรก
      </Link>
    )
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-xl bg-white p-2.5 text-left ring-1 ring-slate-200 transition hover:ring-slate-300 focus-visible:outline-2 focus-visible:outline-emerald-600"
      >
        <BankLogo code={active?.bank_code} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-slate-900">{active?.name ?? 'เลือกร้านค้า'}</span>
          <span className="flex items-center gap-1 truncate text-[11px] text-slate-500">
            <FacebookIcon className="h-3 w-3" />
            {active?.page_id ? `Page ${active.page_id}` : 'ยังไม่ผูกเพจ'}
          </span>
        </span>
        {pending ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-label="กำลังสลับร้าน" /> : <ChevronsUpDown className="h-4 w-4 text-slate-400" aria-hidden />}
      </button>

      {open && (
        <div className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-xl bg-white p-1 shadow-xl ring-1 ring-slate-200">
          <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-slate-400 uppercase">ร้านค้า / เพจ</p>
          <ul role="listbox" aria-label="เลือกร้านค้า" className="scrollbar-thin max-h-72 overflow-y-auto">
            {tenants.map((t) => (
              <li key={t.id} role="option" aria-selected={t.id === activeId}>
                <button
                  type="button"
                  onClick={() => pick(t.id)}
                  className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-slate-50', t.id === activeId && 'bg-emerald-50/60')}
                >
                  <BankLogo code={t.bank_code} size="sm" />
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  {t.id === activeId && <Check className="h-4 w-4 text-emerald-600" aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
          {canCreate && (
            <Link
              href="/settings?new=1"
              onClick={() => setOpen(false)}
              className="mt-1 flex items-center gap-2 border-t border-slate-100 px-2.5 py-2 text-sm text-slate-600 hover:text-emerald-700"
            >
              <Plus className="h-4 w-4" aria-hidden />
              เพิ่มร้านค้า
            </Link>
          )}
        </div>
      )}
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  )
}
