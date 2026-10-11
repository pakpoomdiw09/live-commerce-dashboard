'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search, Upload, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/card'
import { supabaseBrowser } from '@/lib/supabase/browser'
import { SLIP_STATUS } from '@/lib/status'
import type { SlipRow, SlipStatus } from '@/lib/types'
import { baht, cn, when } from '@/lib/utils'
import { SlipDetailPanel } from './SlipDetailPanel'
import { VerifySlipForm } from './VerifySlipForm'

export type SlipListRow = SlipRow & { customers: { display_name: string | null } | null }
type Filter = 'all' | 'valid' | 'issue' | 'pending'

const ISSUES: SlipStatus[] = ['amount_mismatch', 'duplicate', 'fake', 'wrong_receiver', 'error']
const FILTERS: { key: Filter; label: string; match: (s: SlipStatus) => boolean }[] = [
  { key: 'all', label: 'ทั้งหมด', match: () => true },
  { key: 'valid', label: 'ถูกต้อง', match: (s) => s === 'valid' },
  { key: 'issue', label: 'มีปัญหา', match: (s) => ISSUES.includes(s) },
  { key: 'pending', label: 'กำลังตรวจ', match: (s) => s === 'pending' },
]

export function SlipsWorkspace({ initial, tenant }: { initial: SlipListRow[]; tenant: { id: string; name: string; expectedAmount: number | null } | null }) {
  const db = useMemo(() => supabaseBrowser(), [])
  const [rows, setRows] = useState(initial)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)

  useEffect(() => {
    const channel = db
      .channel('slips')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'slips' }, (p) => {
        if (p.eventType === 'DELETE') return
        const row = p.new as SlipRow
        if (tenant && row.tenant_id && row.tenant_id !== tenant.id) return
        setRows((prev) => {
          const old = prev.find((r) => r.id === row.id)
          // Realtime rows carry no joins: keep the customer name we already have
          const next: SlipListRow = { ...row, customers: old?.customers ?? null }
          return old ? prev.map((r) => (r.id === row.id ? next : r)) : [next, ...prev]
        })
      })
      .subscribe()
    return () => {
      void db.removeChannel(channel)
    }
  }, [db, tenant])

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, rows.filter((r) => f.match(r.status)).length])) as Record<Filter, number>, [rows])
  const visible = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!
    const q = query.trim().toLowerCase()
    return rows.filter(
      (r) => f.match(r.status) && (!q || (r.trans_ref ?? '').toLowerCase().includes(q) || (r.customers?.display_name ?? '').toLowerCase().includes(q) || String(r.amount ?? '').includes(q)),
    )
  }, [rows, filter, query])
  const open = rows.find((r) => r.id === openId) ?? null

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-8">
      <PageHeader
        title="ตรวจสอบสลิป"
        description={tenant ? `ประวัติการตรวจสลิปของ ${tenant.name} อัปเดตแบบเรียลไทม์` : 'ประวัติการตรวจสลิปทั้งหมด อัปเดตแบบเรียลไทม์'}
        action={
          <Button onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4" aria-hidden />
            ตรวจสลิปด้วยตนเอง
          </Button>
        }
      />

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <div role="tablist" aria-label="กรองตามสถานะ" className="flex gap-1 rounded-lg bg-slate-100 p-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                role="tab"
                aria-selected={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={cn('rounded-md px-3 py-1.5 text-xs font-medium transition', filter === f.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}
              >
                {f.label} <span className="text-slate-400 tabular-nums">{counts[f.key]}</span>
              </button>
            ))}
          </div>
          <label className="relative ml-auto w-full sm:w-72">
            <span className="sr-only">ค้นหาสลิป</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ค้นหา TransRef / ชื่อลูกค้า / ยอด"
              className="w-full rounded-lg border border-slate-200 py-2 pr-3 pl-9 text-sm placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none"
            />
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="bg-slate-50/80 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">เวลา</th>
                <th className="px-4 py-3 font-medium">ลูกค้า</th>
                <th className="px-4 py-3 text-right font-medium">ยอดในสลิป</th>
                <th className="px-4 py-3 text-right font-medium">ยอดที่คาดหวัง</th>
                <th className="px-4 py-3 font-medium">TransRef</th>
                <th className="px-4 py-3 font-medium">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                    {rows.length === 0 ? 'ยังไม่มีสลิป สลิปที่ลูกค้าส่งในแชทหรือผ่าน API จะแสดงที่นี่' : 'ไม่พบสลิปที่ตรงเงื่อนไข'}
                  </td>
                </tr>
              )}
              {visible.map((r) => {
                const st = SLIP_STATUS[r.status] ?? SLIP_STATUS.error
                return (
                  <tr
                    key={r.id}
                    onClick={() => setOpenId(r.id)}
                    className={cn('cursor-pointer transition-colors hover:bg-slate-50', r.id === openId && 'bg-emerald-50/50')}
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600" suppressHydrationWarning>
                      {when(r.created_at)}
                    </td>
                    <td className="max-w-[12rem] truncate px-4 py-3">
                      <button type="button" className="text-left font-medium text-slate-800 hover:text-emerald-700" onClick={() => setOpenId(r.id)}>
                        {r.customers?.display_name ?? (r.customer_id ? 'ลูกค้าในแชท' : 'ส่งผ่าน API')}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">{baht(r.amount)}</td>
                    <td className="px-4 py-3 text-right text-slate-500 tabular-nums">{baht(r.expected_amount)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{r.trans_ref ?? '-'}</td>
                    <td className="px-4 py-3">
                      <span className="flex flex-wrap items-center gap-1">
                        <Badge tone={st.tone}>{st.label}</Badge>
                        {r.approved_at && <Badge tone="success">อนุมัติแล้ว</Badge>}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Drawer open={!!open} title="รายละเอียดสลิป" onClose={() => setOpenId(null)}>
        {open && <SlipDetailPanel slip={open} />}
      </Drawer>
      <Drawer open={uploadOpen} title="ตรวจสลิปด้วยตนเอง" onClose={() => setUploadOpen(false)}>
        <VerifySlipForm
          tenant={tenant}
          onVerified={(id) => {
            setUploadOpen(false)
            setOpenId(id)
          }}
        />
      </Drawer>
    </div>
  )
}

function Drawer({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50">
      <div aria-hidden className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={onClose} />
      <aside role="dialog" aria-modal aria-label={title} className="absolute inset-y-0 right-0 flex w-[min(26rem,100vw)] flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="ปิด">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>
  )
}
