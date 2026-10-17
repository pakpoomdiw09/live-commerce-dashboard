'use client'

import { Fragment, useMemo, useState } from 'react'
import { ArrowLeft, PanelRightOpen, ScanLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { STALE_PENDING_MS } from '@/lib/status'
import type { CustomerRow, MessageRow, SlipRow } from '@/lib/types'
import { apiError, clock, cn, customerName, dayLabel, sameDay } from '@/lib/utils'
import { AutoPilotToggle } from './AutoPilotToggle'
import { Avatar } from './Avatar'
import type { ActiveTenant } from './InboxClient'
import {useChatScroll} from './useChatScroll'
import {WorkspaceTools} from './WorkspaceTools'
import { ReplyBox } from './ReplyBox'
import { SlipStatusCard } from './SlipStatusCard'
import {ConversationActions} from './ConversationActions'
import type {InboxState,ConversationState} from '@/lib/inbox-types'

const SENDER = { customer: 'ลูกค้า', bot: "ระบบอัตโนมัติ", agent: 'แอดมิน' } as const
const BUBBLE = {
  customer: 'rounded-bl-md bg-white text-slate-800 ring-1 ring-slate-200',
  bot: 'rounded-br-md bg-orange-100 text-orange-950 ring-1 ring-orange-200',
  agent: 'rounded-br-md bg-gradient-to-br from-orange-500 to-rose-500 text-white',
} as const

/** Messages and slips not tied to a loaded message (e.g. sent through /api/slips/verify), in time order. */
type Item = { kind: 'message'; at: string; m: MessageRow } | { kind: 'slip'; at: string; s: SlipRow }

export function Conversation({
  customer,
  tenant,
  messages,
  slips,
  state,
  focusedSlipId,
  onRetry,
  onBack,
  onOpenInspector,
  inspectorOpen=false,
  onFocusSlip,
  className,
  inbox,conversationState,onStateChange,onLoadOlder,hasOlder,olderLoading,olderError,
}: {
  customer: CustomerRow | null
  tenant: ActiveTenant | null
  messages: MessageRow[]
  slips: SlipRow[]
  state: 'idle' | 'loading' | 'error'
  focusedSlipId: string | null
  onRetry: () => void
  onBack: () => void
  inspectorOpen?:boolean
  onOpenInspector: () => void
  onFocusSlip: (id: string) => void
  className?: string
  inbox:InboxState|null
  conversationState:ConversationState|undefined
  onStateChange:()=>Promise<void>
  onLoadOlder:()=>void
  hasOlder:boolean
  olderLoading:boolean
  olderError:string
}) {
  const {viewport:scrollRef,content:messageList,onScroll,latest}=useChatScroll(customer?.id,messages)
  const { items, slipsByMessage } = useMemo(() => {
    const byMessage = new Map<string, SlipRow[]>()
    const loaded = new Set(messages.map((m) => m.id))
    const oldest = messages[0]?.created_at ?? ''
    const loose: Item[] = []
    for (const s of slips) {
      if (s.message_id && loaded.has(s.message_id)) byMessage.set(s.message_id, [...(byMessage.get(s.message_id) ?? []), s])
      else if (s.created_at >= oldest) loose.push({ kind: 'slip', at: s.created_at, s })
    }
    const all: Item[] = [...messages.map((m) => ({ kind: 'message' as const, at: m.created_at, m })), ...loose].sort((a, b) => a.at.localeCompare(b.at))
    return { items: all, slipsByMessage: byMessage }
  }, [messages, slips])


  if (!customer) {
    return (
      <section className={cn('min-h-0 flex-col items-center justify-center bg-slate-50 p-6 text-center text-sm text-slate-500', className)}>
        เลือกแชททางซ้ายเพื่อเริ่มสนทนา
      </section>
    )
  }

  const assigned=conversationState?conversationState.assigned_user_id:customer.assigned_user_id
  const botActive=(conversationState?.bot_enabled??customer.bot_enabled)&&tenant?.autoReply!==false
  const closed=(conversationState?.conversation_status??customer.conversation_status)==='closed'
  const handler=closed?'ปิดแชทแล้ว':assigned?'แอดมินรับช่วงแล้ว':botActive?"ระบบอัตโนมัติดูแลอยู่":'รอแอดมินรับช่วง'
  return (
    <section data-testid="inbox-thread" aria-label={`แชทกับ ${customerName(customer)}`} className={cn('min-h-0 min-w-0 flex-col overflow-hidden bg-slate-50/60', className)}>
      <ConversationActions key={customer.id} state={conversationState} inbox={inbox} onChange={onStateChange}>
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="กลับไปรายชื่อแชท" className="h-8 w-8 shrink-0 md:hidden"><ArrowLeft className="h-4 w-4"/></Button>
        <Avatar c={customer} className="h-8 w-8 text-xs"/>
        <div className="min-w-0 flex-1" title={inbox?.pageName||"ช่องทางแชทของเพจ"}><h2 className="truncate text-sm font-semibold">{customerName(customer)}</h2><p className="truncate text-[11px] text-slate-500">{handler}{assigned&&!closed?` · ${inbox?.members.find(m=>m.id===assigned)?.name??'ผู้ดูแล'}`:''}</p></div>
        <details className="relative shrink-0"><summary title="ตัวเลือกการตอบอัตโนมัติ" className="cursor-pointer rounded-lg p-1.5 text-[11px] text-slate-500">ตัวเลือก</summary><div className="absolute right-0 top-full z-20 mt-2 w-60 rounded-2xl border border-slate-200 bg-white p-4 shadow-lg"><AutoPilotToggle tenant={tenant}/></div></details>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onOpenInspector} aria-label="รายละเอียดลูกค้าและสลิป" aria-expanded={inspectorOpen} title={inspectorOpen?'ซ่อนข้อมูลลูกค้า':'ดูข้อมูลลูกค้า'}><PanelRightOpen className="h-4 w-4"/></Button>
      </ConversationActions>

      <div ref={scrollRef} onScroll={onScroll} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-1.5 [overflow-anchor:none]" data-message-list aria-busy={state === 'loading'}>
        {hasOlder&&<div className="mb-4 text-center"><Button size="sm" variant="secondary" loading={olderLoading} onClick={onLoadOlder}>โหลดข้อความก่อนหน้า</Button></div>}
        {olderError&&<p role="alert" className="mb-2 text-center text-xs text-rose-700">{olderError}</p>}
        {state === 'loading' && messages.length === 0 && <ThreadSkeleton />}
        {state === 'error' && (
          <div role="alert" className="mx-auto max-w-sm rounded-xl bg-rose-50 p-4 text-center text-sm text-rose-700 ring-1 ring-rose-200">
            โหลดข้อความไม่สำเร็จ
            <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
              ลองอีกครั้ง
            </Button>
          </div>
        )}
        {state === 'idle' && items.length === 0 && <p className="text-center text-sm text-slate-400">ยังไม่มีข้อความ</p>}
        <ol ref={messageList} className="space-y-2.5">
          {items.map((it, i) => (
            <Fragment key={it.kind === 'message' ? it.m.id : `slip-${it.s.id}`}>
              {(i === 0 || !sameDay(items[i - 1].at, it.at)) && (
                <li className="flex justify-center py-2">
                  <span suppressHydrationWarning className="rounded-full bg-white px-3 py-1 text-xs text-slate-500 ring-1 ring-slate-200">
                    {dayLabel(it.at)}
                  </span>
                </li>
              )}
              {it.kind === 'message' ? (
                <Bubble
                  m={it.m}
                  customer={customer}
                  slips={slipsByMessage.get(it.m.id) ?? []}
                  autoVerify={tenant?.autoVerify ?? true}
                  focusedSlipId={focusedSlipId}
                  onFocusSlip={onFocusSlip}
                />
              ) : (
                <li className="flex flex-col items-center">
                  <span className="text-[11px] text-slate-400">สลิปที่ส่งผ่าน ระบบ · {clock(it.at)}</span>
                  <SlipStatusCard slip={it.s} focused={it.s.id === focusedSlipId} onClick={() => onFocusSlip(it.s.id)} />
                </li>
              )}
            </Fragment>
          ))}
        </ol>
      </div>

      {<WorkspaceTools key={`policy:${customer.id}`} mode="header" customerId={customer.id} members={inbox?.members??[]}/>}
      <ReplyBox key={customer.id} customerId={customer.id} tenantId={customer.tenant_id!} inbox={inbox} enabled={!!conversationState&&conversationState.conversation_status==='open'&&(inbox?.autoClaimOnReply?(!conversationState.assigned_user_id||conversationState.assigned_user_id===inbox.viewerId):(conversationState.assigned_user_id===inbox?.viewerId&&!conversationState.bot_enabled))} onSent={()=>{latest();onRetry();void onStateChange()}}/>
    </section>
  )
}

function Bubble({
  m,
  customer,
  slips,
  autoVerify,
  focusedSlipId,
  onFocusSlip,
}: {
  m: MessageRow
  customer: CustomerRow
  slips: SlipRow[]
  autoVerify: boolean
  focusedSlipId: string | null
  onFocusSlip: (id: string) => void
}) {
  const mine = m.sender !== 'customer'
  const images = (m.attachments ?? []).filter((a) => a.type === 'image' && a.payload?.url && !a.payload.sticker_id)
  // offer a manual check when Auto-Pilot didn't run, when every check of this image failed, or when a
  // check has been stuck 'pending' for over 3 minutes (cut off; /api/messages/[id]/verify allows a retry)
  const running = slips.some((s) => s.status === 'pending' && Date.now() - Date.parse(s.created_at) <= STALE_PENDING_MS)
  const canVerify = !mine && images.length > 0 && !running && !slips.some((s) => s.status === 'valid') && (!autoVerify || slips.length > 0)

  return (
    <li data-message-id={m.id} className={cn('flex items-end gap-2', mine && 'flex-row-reverse')}>
      {!mine && <Avatar c={customer} className="h-7 w-7 text-xs" />}
      <div className={cn('flex max-w-[78%] flex-col', mine ? 'items-end' : 'items-start')}>
        <div className={cn('rounded-2xl px-4 py-2 text-sm shadow-sm', BUBBLE[m.sender])}>
          {m.body && <p className="break-words whitespace-pre-wrap">{m.body}</p>}
          {m.attachments?.map((a, i) =>
            a.type === 'image' && a.payload?.url ? (
              // Meta CDN links expire after a while; slips are also kept in the private 'slips' bucket
              <a key={i} href={a.payload.url} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.payload.url} alt="รูปที่ลูกค้าส่ง" loading="lazy" className="my-1 max-h-64 rounded-lg" />
              </a>
            ) : (
              <p key={i} className="opacity-80">
                {a.payload?.url ? (
                  <a href={a.payload.url} target="_blank" rel="noreferrer" className="underline">
                    [ไฟล์แนบ: {a.type}]
                  </a>
                ) : (
                  `[ไฟล์แนบ: ${a.type}]`
                )}
              </p>
            ),
          )}
          {!m.body && !m.attachments?.length && <p className="opacity-80">[ไฟล์แนบ]</p>}
        </div>
        {slips.map((s) => (
          <SlipStatusCard key={s.id} slip={s} focused={s.id === focusedSlipId} onClick={() => onFocusSlip(s.id)} />
        ))}
        {canVerify && <VerifyButton messageId={m.id} retry={slips.length > 0} />}
        <span className="mt-1 px-1 text-[11px] text-slate-400">
          {mine && `${SENDER[m.sender]} · `}
          <time suppressHydrationWarning>{clock(m.created_at)}</time>
          {mine&&m.delivery_status&&<span> · {m.delivery_status==='pending'&&Date.now()-Date.parse(m.created_at)>120000?'ยังยืนยันผลไม่ได้':{pending:'กำลังส่ง',sent:'ส่งแล้ว',delivered:'ส่งถึงแล้ว',read:'อ่านแล้ว',failed:'ส่งไม่สำเร็จ',unknown:'ยังยืนยันผลไม่ได้'}[m.delivery_status]}</span>}
        </span>
      </div>
    </li>
  )
}

/** Manual SlipOK check of an image in chat. The verdict arrives through Realtime as a slip card. */
function VerifyButton({ messageId, retry }: { messageId: string; retry: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function run() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/messages/${messageId}/verify`, { method: 'POST' })
      if (!res.ok) setError(await apiError(res))
    } catch {
      setError("เชื่อมต่อระบบไม่ได้")
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-2">
      <Button variant="secondary" size="sm" loading={busy} onClick={run}>
        {!busy && <ScanLine className="h-3.5 w-3.5" aria-hidden />}
        {retry ? 'ตรวจสลิปอีกครั้ง' : 'ตรวจสอบสลิปนี้'}
      </Button>
      {error && <p className="mt-1 text-[11px] text-rose-600">{error}</p>}
    </div>
  )
}

function ThreadSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      {['w-3/5', 'w-2/5', 'w-3/4', 'w-1/2', 'w-1/3'].map((w, i) => (
        <div key={i} className={cn('flex', i % 2 ? 'justify-end' : 'justify-start')}>
          <Skeleton className={cn('h-10 rounded-2xl', w)} />
        </div>
      ))}
    </div>
  )
}
