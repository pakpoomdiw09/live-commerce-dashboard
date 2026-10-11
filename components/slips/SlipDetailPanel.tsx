'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowDown, BadgeCheck, Check, Copy, ExternalLink, FileText, ImageOff, MessageSquareShare } from 'lucide-react'
import { BankLogo, bankName } from '@/components/BankLogo'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { APPROVABLE, SLIP_STATUS } from '@/lib/status'
import type { SlipDetail, SlipRow } from '@/lib/types'
import { apiError, baht, cn, when } from '@/lib/utils'

/**
 * Everything about one slip: image, SlipOK data (amount, time, banks, TransRef) and the admin actions.
 * `slip` is the live row (Realtime); the detail is re-fetched whenever its state changes.
 */
export function SlipDetailPanel({ slip, canMessage = true }: { slip: SlipRow; canMessage?: boolean }) {
  const [detail, setDetail] = useState<SlipDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const version = `${slip.id}:${slip.status}:${slip.approved_at}:${slip.confirmed_at}`

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await fetch(`/api/slips/${slip.id}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(await apiError(res))
      setDetail(((await res.json()) as { slip: SlipDetail }).slip)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'โหลดรายละเอียดสลิปไม่สำเร็จ')
    }
  }, [slip.id])

  // reload on every state change of the row; keep the old detail on screen meanwhile,
  // but not when switching to another slip
  useEffect(() => {
    setDetail((d) => (d?.id === slip.id ? d : null))
    void load()
  }, [load, slip.id, version])

  const st = SLIP_STATUS[slip.status] ?? SLIP_STATUS.error
  const d = detail?.id === slip.id ? detail : null

  return (
    <div className="space-y-4">
      {/* image */}
      <div className="overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200">
        {!d ? (
          <Skeleton className="aspect-[3/4] w-full rounded-none" />
        ) : d.imageUrl ? (
          <a href={d.imageUrl} target="_blank" rel="noreferrer" className="group relative block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={d.imageUrl} alt="รูปสลิป" className="max-h-80 w-full object-contain" />
            <span className="absolute top-2 right-2 rounded-md bg-white/90 p-1 text-slate-600 opacity-0 shadow transition group-hover:opacity-100">
              <ExternalLink className="h-3.5 w-3.5" aria-label="เปิดรูปเต็ม" />
            </span>
          </a>
        ) : (
          <div className="grid h-28 place-items-center text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <ImageOff className="h-4 w-4" aria-hidden /> ไม่มีรูป (ตรวจจาก QR)
            </span>
          </div>
        )}
      </div>

      {/* verdict */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={st.tone}>{st.label}</Badge>
        {slip.approved_at && <Badge tone="success">อนุมัติแล้ว</Badge>}
        {slip.confirmed_at && (
          <Badge tone="neutral" icon={false}>
            แจ้งลูกค้าแล้ว
          </Badge>
        )}
      </div>
      {slip.note && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">{slip.note}</p>}

      {loadError && (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {loadError}{' '}
          <button type="button" onClick={() => void load()} className="font-medium underline">
            ลองใหม่
          </button>
        </p>
      )}

      {/* amounts */}
      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
          <dt className="text-[11px] text-slate-500">ยอดในสลิป</dt>
          <dd className="mt-0.5 text-lg font-semibold text-slate-900 tabular-nums">{baht(slip.amount)}</dd>
        </div>
        <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
          <dt className="text-[11px] text-slate-500">ยอดที่คาดหวัง</dt>
          <dd className="mt-0.5 text-lg font-semibold text-slate-500 tabular-nums">{baht(slip.expected_amount)}</dd>
        </div>
      </dl>

      {/* transfer */}
      <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
        {d ? (
          <>
            <Party label="ผู้โอน" p={d.sender} />
            <ArrowDown className="my-1 ml-2.5 h-3.5 w-3.5 text-slate-300" aria-hidden />
            <Party label="ผู้รับ" p={d.receiver} />
          </>
        ) : (
          <div className="space-y-3">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        )}
      </div>

      <dl className="space-y-2 text-xs">
        <Row label="เวลาโอน">{d ? (d.transferredAt ? <span suppressHydrationWarning>{when(d.transferredAt)}</span> : '-') : <Skeleton className="h-4 w-28" />}</Row>
        <Row label="ส่งสลิปเมื่อ">
          <span suppressHydrationWarning>{when(slip.created_at)}</span>
        </Row>
        <Row label="TransRef">{slip.trans_ref ? <CopyText text={slip.trans_ref} /> : '-'}</Row>
        {d?.tenantName && <Row label="ร้านค้า">{d.tenantName}</Row>}
      </dl>

      <SlipActions slip={slip} canMessage={canMessage && !!slip.customer_id} onDone={() => void load()} />
    </div>
  )
}

function Party({ label, p }: { label: string; p: SlipDetail['sender'] }) {
  return (
    <div className="flex items-center gap-2.5">
      <BankLogo code={p.bank} />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-slate-500">
          {label} · {p.bank ? bankName(p.bank) : 'ไม่ทราบธนาคาร'}
        </p>
        <p className="truncate text-sm font-medium text-slate-800">{p.name ?? '-'}</p>
        {p.account && <p className="font-mono text-[11px] text-slate-500">{p.account}</p>}
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 text-right font-medium text-slate-800">{children}</dd>
    </div>
  )
}

function CopyText({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
      className="inline-flex max-w-full items-center gap-1 rounded font-mono text-[11px] hover:text-emerald-700"
      title="คัดลอก"
    >
      <span className="truncate">{text}</span>
      {copied ? <Check className="h-3 w-3 shrink-0 text-emerald-600" aria-label="คัดลอกแล้ว" /> : <Copy className="h-3 w-3 shrink-0" aria-hidden />}
    </button>
  )
}

type Action = 'approve' | 'confirm'

/** อนุมัติออเดอร์ / ส่งข้อความยืนยันการโอนเข้าแชท / ออกใบเสร็จรับเงิน */
function SlipActions({ slip, canMessage, onDone }: { slip: SlipRow; canMessage: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState<Action | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => setMsg(null), [slip.id])

  const approvable = APPROVABLE.includes(slip.status)
  const confirmable = slip.status === 'valid' || !!slip.approved_at

  async function run(action: Action) {
    if (action === 'approve' && slip.status !== 'valid' && !confirm(`สลิปนี้มีสถานะ "${SLIP_STATUS[slip.status].label}" ยืนยันอนุมัติออเดอร์ด้วยตนเอง?`)) return
    setBusy(action)
    setMsg(null)
    try {
      const res = await fetch(`/api/slips/${slip.id}/${action}`, { method: 'POST' })
      if (!res.ok) throw new Error(await apiError(res))
      const body = (await res.json()) as { alreadySent?: boolean }
      setMsg({
        ok: true,
        text: action === 'approve' ? 'อนุมัติออเดอร์แล้ว' : body.alreadySent ? 'เคยส่งข้อความยืนยันสลิปนี้แล้ว' : 'ส่งข้อความยืนยันเข้าแชทแล้ว',
      })
      onDone()
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'ทำรายการไม่สำเร็จ' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-2 border-t border-slate-100 pt-4">
      <Button className="w-full" loading={busy === 'approve'} disabled={!approvable || !!slip.approved_at || busy !== null} onClick={() => run('approve')}>
        {busy !== 'approve' && <BadgeCheck className="h-4 w-4" aria-hidden />}
        {slip.approved_at ? 'อนุมัติออเดอร์แล้ว' : 'อนุมัติออเดอร์'}
      </Button>
      <Button
        variant="secondary"
        className="w-full"
        loading={busy === 'confirm'}
        disabled={!canMessage || !confirmable || busy !== null}
        title={!canMessage ? 'สลิปนี้ไม่ได้มาจากแชท' : !confirmable ? 'ยืนยันได้เมื่อสลิปถูกต้องหรืออนุมัติแล้ว' : undefined}
        onClick={() => run('confirm')}
      >
        {busy !== 'confirm' && <MessageSquareShare className="h-4 w-4" aria-hidden />}
        ส่งข้อความยืนยันการโอนเข้าแชท
      </Button>
      <a
        href={confirmable ? `/receipts/${slip.id}` : undefined}
        target="_blank"
        rel="noreferrer"
        aria-disabled={!confirmable}
        className={cn(
          'flex h-9 w-full items-center justify-center gap-2 rounded-lg text-sm font-medium ring-1 ring-slate-200 transition',
          confirmable ? 'bg-white text-slate-700 hover:bg-slate-50' : 'pointer-events-none bg-slate-50 text-slate-400',
        )}
      >
        <FileText className="h-4 w-4" aria-hidden />
        ออกใบเสร็จรับเงิน
      </a>
      {msg && (
        <p role="status" className={cn('rounded-lg px-3 py-2 text-xs', msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700')}>
          {msg.text}
        </p>
      )}
    </div>
  )
}
