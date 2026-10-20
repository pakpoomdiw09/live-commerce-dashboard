'use client'
import {createBackgroundRefresh} from '@/lib/background-refresh'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Banknote, CheckCircle2, Coins, Search, Upload, X } from 'lucide-react'
import { StatTile } from '@/components/ui/StatTile'
import { summarizeSlips } from '@/lib/features/slips/slip-summary'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/card'
import { supabaseBrowser } from '@/lib/supabase/browser'
import { SLIP_STATUS } from '@/lib/status'
import type { SlipRow, SlipStatus } from '@/lib/types'
import { baht, cn, when } from '@/lib/utils'
import { SlipDetailPanel } from '@/components/slips/SlipDetailPanel'
import { VerifySlipForm } from '@/components/slips/VerifySlipForm'
import {EmptyState} from '@/components/ui/feedback'

export type SlipListRow = SlipRow & { customers: { display_name: string | null } | null }
type Filter = 'all' | 'valid' | 'issue' | 'pending'

const ISSUES: SlipStatus[] = ['amount_mismatch', 'duplicate', 'fake', 'wrong_receiver', 'error']
const FILTERS: { key: Filter; label: string; match: (s: SlipStatus) => boolean }[] = [
  { key: 'all', label: 'ทั้งหมด', match: () => true },
  { key: 'valid', label: 'ถูกต้อง', match: (s) => s === 'valid' },
  { key: 'issue', label: 'มีปัญหา', match: (s) => ISSUES.includes(s) },
  { key: 'pending', label: 'กำลังตรวจ', match: (s) => s === 'pending' },
]

export function SlipsWorkspace({ initial, tenant, initialCredits, creditBypass = false, embedded = false }: { initial: SlipListRow[]; tenant: { id: string; name: string; expectedAmount: number | null } | null; initialCredits: { quota: number; used: number }; creditBypass?: boolean; embedded?: boolean }) {
  const db = useMemo(() => supabaseBrowser(), [])
  const [rows, setRows] = useState(initial)
  const [credits, setCredits] = useState(initialCredits)
  const remaining = Math.max(credits.quota - credits.used, 0)
  const remainingPercent = credits.quota > 0 ? Math.min(100, Math.max(0, remaining / credits.quota * 100)) : 0
  const summary = useMemo(() => summarizeSlips(rows), [rows])
  useEffect(() => { setRows(initial) }, [initial])
  useEffect(() => { setCredits(initialCredits) }, [initialCredits])
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)

  useEffect(() => {
    let active = true
    const reloadCredits = async (signal:AbortSignal) => {
      if (!tenant) return
      const { data, error } = await db.from('tenants').select('slip_quota, slip_used, slip_quota_credits').eq('id', tenant.id).abortSignal(signal).single()
      if(error)throw error
      if (active && data && !error) setCredits({ quota: data.slip_quota + data.slip_quota_credits, used: data.slip_used })
    }
    const refresh=createBackgroundRefresh(reloadCredits,()=>{}, {intervalMs:120000})
    refresh.request()
    const channel = db
      .channel(`slips:${tenant?.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'slips' }, (p) => {
        if (p.eventType === 'DELETE') {
          setRows((prev) => prev.filter((row) => row.id !== (p.old as { id?: string }).id))
          return
        }
        const row = p.new as SlipRow
        if (!tenant || row.tenant_id !== tenant.id) return
        refresh.request()
        setRows((prev) => {
          const old = prev.find((r) => r.id === row.id)
          // Realtime rows carry no joins: keep the customer name we already have
          const next: SlipListRow = { ...row, customers: old?.customers ?? null }
          return (old ? prev.map((r) => (r.id === row.id ? next : r)) : [next, ...prev])
            .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 200)
        })
      })
      .subscribe()
    return () => {
      active = false
      refresh.stop()
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
    <div className={cn('mx-0 w-full min-w-0 max-w-none space-y-6', !embedded && 'p-4 md:p-8')}>
      <PageHeader variant={embedded ? 'section' : 'page'}
        title="ระบบตรวจสลิป"
        description={tenant ? `ประวัติการตรวจสลิปของ ${tenant.name} อัปเดตแบบเรียลไทม์` : 'ประวัติการตรวจสลิปทั้งหมด อัปเดตแบบเรียลไทม์'}
        action={
          <div className="flex flex-wrap items-center gap-3">
          <Link href="/slips?tab=settings" className="text-sm font-medium text-emerald-700 underline">ตั้งค่าบัญชีรับเงิน & ตรวจสลิป</Link>
          <Button onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4" aria-hidden />
            ตรวจสลิปด้วยตนเอง
          </Button>
          </div>
        }
      />

      <p className="text-xs text-slate-500">สรุปจากรายการล่าสุดสูงสุด 200 สลิปของเพจที่เลือก</p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile icon={Banknote} label="ยอดเงินที่ตรวจผ่าน" value={baht(summary.amount)} foot="รวมเฉพาะสลิปสถานะตรวจผ่าน" />
        <StatTile icon={CheckCircle2} label="ตรวจผ่าน" value={summary.passed.toLocaleString('th-TH')} foot={`จาก ${rows.length.toLocaleString('th-TH')} รายการล่าสุด`} />
        <StatTile icon={AlertTriangle} label="ตรวจไม่ผ่าน" value={summary.failed.toLocaleString('th-TH')} foot={`รอตรวจ ${summary.pending} · ระบบขัดข้อง ${summary.errors}`} />
        <StatTile icon={Coins} label="เครดิตตรวจสลิปคงเหลือ" value={creditBypass ? 'ไม่จำกัด (Admin)' : remaining.toLocaleString('th-TH')} foot={`ใช้ไป ${credits.used.toLocaleString('th-TH')} / ${credits.quota.toLocaleString('th-TH')}`} href="/slips?tab=settings#credits" />
      </div>
      <div className="rounded-2xl border border-orange-100 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="inline-flex items-center gap-2 font-medium text-slate-700"><Coins className="h-4 w-4 text-orange-500" aria-hidden />เครดิตตรวจสลิป</span>
          <span className="font-semibold tabular-nums text-slate-900">{creditBypass ? 'ไม่จำกัด · Admin Bypass' : `${remaining.toLocaleString('th-TH')} / ${credits.quota.toLocaleString('th-TH')} เครดิต`}</span>
        </div>
        {creditBypass ? (
          <p className="text-xs text-emerald-700">บัญชีผู้ดูแลใช้งานได้โดยไม่หักเครดิต</p>
        ) : (
          <>
            <div role="progressbar" aria-label="เครดิตตรวจสลิปคงเหลือ" aria-valuemin={0} aria-valuemax={Math.max(credits.quota, 1)} aria-valuenow={remaining} aria-valuetext={`${remaining} จาก ${credits.quota} เครดิต`} className="h-3 overflow-hidden rounded-full bg-slate-100">
              <div className={cn('h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none', remainingPercent <= 10 ? 'bg-rose-500' : 'bg-gradient-to-r from-orange-400 to-pink-500')} style={{ width: `${remainingPercent}%` }} />
            </div>
            <p className="mt-2 text-xs text-slate-500">ตรวจสลิป 1 ครั้งใช้ 1 เครดิต · คืนเครดิตเมื่อผู้ให้บริการขัดข้อง</p>
          </>
        )}
      </div>
      {!creditBypass && remaining === 0 && (
        <div role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
          เครดิตตรวจสลิปหมดแล้ว ระบบจะหยุดตรวจสลิป กรุณาติดต่อผู้ดูแลเพื่อเติมเครดิตตรวจสลิป
          <Link href="/billing" className="ml-2 font-semibold underline">ดูแพ็กเกจ / เติมเครดิต</Link>
        </div>
      )}

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

        <div className="space-y-3 p-3 md:hidden">
          {!visible.length&&<EmptyState>{rows.length===0?'ยังไม่มีสลิป':'ไม่พบสลิปที่ตรงเงื่อนไข'}</EmptyState>}
          {visible.map(r=><button type="button" key={r.id} onClick={()=>setOpenId(r.id)} aria-label={`ดูสลิปของ ${r.customers?.display_name??'ลูกค้า'} ${when(r.created_at)}`} className="block w-full rounded-xl border border-slate-200 p-4 text-left">
            <span className="flex flex-wrap justify-between gap-2"><strong>{r.customers?.display_name??'ลูกค้า'}</strong><Badge tone={(SLIP_STATUS[r.status]??SLIP_STATUS.error).tone}>{(SLIP_STATUS[r.status]??SLIP_STATUS.error).label}</Badge></span>
            <span className="mt-2 block text-xs text-slate-500" suppressHydrationWarning>{when(r.created_at)}</span>
            <span className="mt-2 block text-sm">ยอดในสลิป {baht(r.amount)} · ยอดที่คาดหวัง {baht(r.expected_amount)}</span>
            <span className="mt-2 block break-all text-xs text-slate-500">เลขอ้างอิง: {r.trans_ref??'ยังไม่มีข้อมูล'}</span>
            {r.approved_at&&<span className="mt-2 block text-xs text-green-700">แอดมินอนุมัติแล้ว</span>}
          </button>)}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="bg-slate-50/80 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">เวลา</th>
                <th className="px-4 py-3 font-medium">ลูกค้า</th>
                <th className="px-4 py-3 text-right font-medium">ยอดในสลิป</th>
                <th className="px-4 py-3 text-right font-medium">ยอดที่คาดหวัง</th>
                <th className="px-4 py-3 font-medium">เลขอ้างอิงธุรกรรม</th>
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
