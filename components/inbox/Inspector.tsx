'use client'

import {useEffect,useRef,useState} from 'react'
import {WorkspaceTools} from '@/components/inbox/WorkspaceTools'
import { X } from 'lucide-react'
import { SlipDetailPanel } from '@/components/slips/SlipDetailPanel'
import { Button } from '@/components/ui/button'
import { SLIP_STATUS } from '@/lib/status'
import type { CustomerRow, SlipRow } from '@/lib/types'
import { baht, cn } from '@/lib/utils'
import { CustomerPanel } from '@/components/inbox/CustomerPanel'
import {ConversationHistory} from '@/components/inbox/ConversationHistory'
import type {InboxState} from '@/lib/features/inbox/inbox-types'
import {FollowUpContactControl} from '@/components/inbox/FollowUpContactControl'

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
  focusSlipId,
}: {
  customer: CustomerRow | null
  slips: SlipRow[]
  slip: SlipRow | null
  onSelectSlip: (id: string) => void
  onClose: () => void
  onCustomerSaved: (c: CustomerRow) => void
  className?: string
  focusSlipId?:string|null
  inbox:InboxState|null
}) {
  const [tab,setTab]=useState<'profile'|'orders'|'notes'|'history'>('profile')
  const slipSection=useRef<HTMLDetailsElement>(null)
  useEffect(()=>{if(focusSlipId&&slipSection.current){slipSection.current.open=true;setTab('profile')}},[focusSlipId])
  return (
    <aside aria-label="รายละเอียดลูกค้าและสลิป" className={cn('min-h-0 min-w-0 flex-col border-l border-slate-200 bg-white', className)}>
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <h2 className="text-sm font-semibold">รายละเอียด</h2>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="ปิดรายละเอียดลูกค้า">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {!customer ? (
        <p className="p-6 text-center text-sm text-slate-500">เลือกแชทเพื่อดูรายละเอียดลูกค้า</p>
      ) : (
        <div className="scrollbar-thin min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto break-words bg-slate-50/60 p-3">
          <nav aria-label="ข้อมูลลูกค้า" className="grid grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1">{([['profile','ข้อมูล'],['orders','ออเดอร์'],['notes','โน้ต'],['history','ประวัติ']] as const).map(([key,label])=><button key={key} aria-pressed={tab===key} onClick={()=>setTab(key)} className={cn('rounded-lg py-2 text-xs',tab===key?'bg-white text-orange-700 shadow-sm':'text-slate-500')}>{label}</button>)}</nav>
          {tab==='notes'&&<WorkspaceTools key={customer.id} customerId={customer.id} members={inbox?.members??[]}/>}
          {(tab==='orders'||tab==='history')&&<ConversationHistory customer={customer} members={inbox?.members??[]} section={tab}/>}
          <section hidden={tab!=='profile'} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"><CustomerPanel customer={customer} slips={slips} onSaved={onCustomerSaved}/></section>
          {tab==='history'&&customer.tenant_id&&<FollowUpContactControl key={customer.id} customerId={customer.id} tenantId={customer.tenant_id}/>}
          {tab==='profile'&&<p className="rounded-xl border border-slate-100 bg-white p-3 text-xs text-slate-500">ผู้ดูแล: <span className="font-medium text-slate-700">{inbox?.members.find(member=>member.id===customer.assigned_user_id)?.name||'ยังไม่มอบหมาย'}</span></p>}

          <details hidden={tab!=='profile'} ref={slipSection} data-inbox-slip-details aria-label="สลิปล่าสุด" className="rounded-2xl border border-slate-200 bg-white p-3">
            <summary className="mb-3 cursor-pointer text-sm font-semibold text-slate-700">ประวัติสลิป ({slips.length})</summary>
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
          </details>
        </div>
      )}
    </aside>
  )
}
