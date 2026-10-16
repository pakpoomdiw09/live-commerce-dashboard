'use client'

import { X } from 'lucide-react'
import { SlipDetailPanel } from '@/components/slips/SlipDetailPanel'
import { Button } from '@/components/ui/button'
import { SLIP_STATUS } from '@/lib/status'
import type { CustomerRow, SlipRow } from '@/lib/types'
import { baht, cn } from '@/lib/utils'
import { CustomerPanel } from './CustomerPanel'
import {ConversationHistory} from './ConversationHistory'
import type {InboxState} from '@/lib/inbox-types'
import {FollowUpContactControl} from './FollowUpContactControl'

/** Right column: CRM details of the open chat, then the slip being inspected with its actions. */
export function Inspector({
  customer,
  slips,
  slip,
  onSelectSlip,
  onClose,
  onCustomerSaved,
  className,
  inbox,
}: {
  customer: CustomerRow | null
  slips: SlipRow[]
  slip: SlipRow | null
  onSelectSlip: (id: string) => void
  onClose: () => void
  onCustomerSaved: (c: CustomerRow) => void
  className?: string
  inbox:InboxState|null
}) {
  return (
    <aside aria-label="รายละเอียดลูกค้าและสลิป" className={cn('min-h-0 flex-col border-l border-slate-200 bg-white', className)}>
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <h2 className="text-sm font-semibold">รายละเอียด</h2>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="ปิด" className="xl:hidden">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {!customer ? (
        <p className="p-6 text-center text-sm text-slate-500">เลือกแชทเพื่อดูรายละเอียดลูกค้า</p>
      ) : (
        <div className="scrollbar-thin min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
          <CustomerPanel customer={customer} slips={slips} onSaved={onCustomerSaved} />
          {customer.tenant_id&&<FollowUpContactControl key={customer.id} customerId={customer.id} tenantId={customer.tenant_id}/>}
          <p className="rounded-lg bg-orange-50 p-2 text-xs text-orange-900">ผู้ดูแล: {inbox?.members.find(member=>member.id===customer.assigned_user_id)?.name||'ยังไม่มอบหมาย'}</p>
          <ConversationHistory customer={customer} members={inbox?.members??[]}/>

          <section aria-label="สลิปล่าสุด" className="border-t border-slate-100 pt-5">
            <h3 className="mb-3 text-xs font-semibold tracking-wide text-slate-500 uppercase">สรุปสลิป</h3>
            {slips.length === 0 || !slip ? (
              <p className="rounded-xl border border-dashed border-slate-300 p-5 text-center text-xs text-slate-500">ยังไม่มีสลิปจากลูกค้ารายนี้</p>
            ) : (
              <>
                {slips.length > 1 && (
                  <div role="tablist" aria-label="เลือกสลิป" className="scrollbar-thin -mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
                    {slips.slice(0, 10).map((s) => (
                      <button
                        key={s.id}
                        role="tab"
                        aria-selected={s.id === slip.id}
                        onClick={() => onSelectSlip(s.id)}
                        title={SLIP_STATUS[s.status]?.label}
                        className={cn(
                          'shrink-0 rounded-lg px-2.5 py-1.5 text-left text-[11px] ring-1 transition',
                          s.id === slip.id ? 'bg-orange-50 text-orange-800 ring-orange-300' : 'bg-white text-slate-600 ring-slate-200 hover:ring-slate-300',
                        )}
                      >
                        <span className="block font-semibold tabular-nums">{baht(s.amount ?? s.expected_amount)}</span>
                        <span className="block">{SLIP_STATUS[s.status]?.label}</span>
                      </button>
                    ))}
                  </div>
                )}
                <SlipDetailPanel slip={slip} />
              </>
            )}
          </section>
        </div>
      )}
    </aside>
  )
}
