'use client'

import { neutralSlipText } from '@/lib/ui-labels'
import { ChevronRight, Loader2, ReceiptText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { SLIP_STATUS } from '@/lib/status'
import type { SlipRow } from '@/lib/types'
import { baht, cn } from '@/lib/utils'

/** Verdict card shown inside the chat, under the slip image it belongs to. Click: open in the inspector. */
export function SlipStatusCard({ slip, focused, onClick }: { slip: SlipRow; focused: boolean; onClick: () => void }) {
  const st = SLIP_STATUS[slip.status] ?? SLIP_STATUS.error
  const pending = slip.status === 'pending'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={focused}
      className={cn(
        'mt-2 flex w-64 max-w-full items-center gap-3 rounded-xl bg-white p-3 text-left text-slate-800 ring-1 transition hover:shadow-md',
        focused ? 'shadow-md ring-2 ring-emerald-500' : 'ring-slate-200',
      )}
    >
      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', pending ? 'bg-sky-50 text-sky-600' : 'bg-slate-100 text-slate-600')}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ReceiptText className="h-4 w-4" aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold tabular-nums">{pending ? 'กำลังตรวจสลิป...' : baht(slip.amount ?? slip.expected_amount)}</span>
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1">
          <Badge tone={st.tone}>{st.label}</Badge>
          {slip.approved_at && <Badge tone="success">อนุมัติแล้ว</Badge>}
        </span>
        {slip.note && !pending && <span className="mt-1 line-clamp-2 block text-[11px] text-slate-500">{neutralSlipText(slip.note)}</span>}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden />
    </button>
  )
}
