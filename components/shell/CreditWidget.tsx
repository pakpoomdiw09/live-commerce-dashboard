'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Coins } from 'lucide-react'
import { supabaseBrowser } from '@/lib/supabase/browser'
import { cn } from '@/lib/utils'

/**
 * Remaining SlipOK credits for the active tenant: one credit per slip check.
 * Live: every slip change of this tenant (a check starts or ends, which is when credits move)
 * re-reads the balance. The tenants table itself isn't in the Realtime publication, because
 * it holds the Page token.
 */
export function CreditWidget({ tenantId, used: initialUsed, quota: initialQuota }: { tenantId: string; used: number; quota: number }) {
  const db = useMemo(() => supabaseBrowser(), [])
  const [{ used, quota }, setCredit] = useState({ used: initialUsed, quota: initialQuota })

  // a server refresh (e.g. after saving Settings) brings newer numbers
  useEffect(() => setCredit({ used: initialUsed, quota: initialQuota }), [initialUsed, initialQuota])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const reload = () => {
      // several slips in a burst: one read
      clearTimeout(timer)
      timer = setTimeout(async () => {
        const { data, error } = await db.from('tenants').select('slip_used, slip_quota').eq('id', tenantId).maybeSingle()
        if (error) return console.error('[credits] reload failed', error)
        if (data) setCredit({ used: data.slip_used, quota: data.slip_quota })
      }, 500)
    }
    const channel = db
      .channel(`credits:${tenantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'slips', filter: `tenant_id=eq.${tenantId}` }, reload)
      .subscribe()
    return () => {
      clearTimeout(timer)
      void db.removeChannel(channel)
    }
  }, [db, tenantId])

  const left = Math.max(quota - used, 0)
  const pct = quota > 0 ? Math.min((used / quota) * 100, 100) : 100
  const low = quota === 0 || left / quota < 0.1
  return (
    <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
          <Coins className="h-3.5 w-3.5" aria-hidden />
          เครดิตตรวจสลิป
        </span>
        {low && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 ring-1 ring-amber-200">ใกล้หมด</span>}
      </div>
      <p className="mt-2 text-lg font-semibold text-slate-900 tabular-nums" aria-live="polite">
        {left.toLocaleString('th-TH')}
        <span className="ml-1 text-xs font-normal text-slate-500">/ {quota.toLocaleString('th-TH')} คงเหลือ</span>
      </p>
      <div
        role="meter"
        aria-label="เครดิตที่ใช้ไป"
        aria-valuemin={0}
        aria-valuemax={quota}
        aria-valuenow={used}
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"
      >
        <div className={cn('h-full rounded-full transition-[width]', low ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${pct}%` }} />
      </div>
      <Link href="/settings#credits" className="mt-2 inline-block text-[11px] font-medium text-emerald-700 hover:underline">
        จัดการเครดิต
      </Link>
    </div>
  )
}
