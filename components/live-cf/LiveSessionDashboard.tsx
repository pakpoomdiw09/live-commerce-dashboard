'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { BarChart3, RefreshCw, Send, Wallet } from 'lucide-react'
import {
  sessionMoney as money,
  type LiveSession,
  type SessionSnapshot,
  type SessionRound,
  type SessionTab,
} from '@/lib/features/commerce/live-session-types'
import { field, button, orange, stateText, sessionTime, read, type Post } from './session-ui'
import { SessionFinance } from './SessionFinance'
import { SessionProofModal } from './SessionProofModal'
import { SessionWinnerModal } from './SessionWinnerModal'
import { SessionFollowupModal } from './SessionFollowupModal'
import { AuctionSessionStart, type AuctionDashboardOptions } from './AuctionSessionStart'
import { AuctionSessionAutomation } from './AuctionSessionAutomation'
import {
  AuctionDashboardSection,
  AuctionSessionSlips,
  SessionRequired,
  SessionEmptyFinance,
} from './AuctionSessionSections'
import { LiveAuctionPanel } from './LiveAuctionPanel'
import { ShippingDashboard } from '@/components/shipping/ShippingDashboard'
import { AuctionSessionCustomers } from './AuctionSessionCustomers'

export function LiveSessionDashboard({
  tenantId,
  active = true,
  auction,
}: {
  tenantId: string
  active?: boolean
  auction?: AuctionDashboardOptions
}) {
  const [sessions, setSessions] = useState<LiveSession[]>([])
  const [sessionId, setSessionId] = useState('')
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [version, setVersion] = useState(0)
  const [updated, setUpdated] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [modal, setModal] = useState<
    | { kind: 'proof'; tab: SessionTab }
    | { kind: 'winner'; round: SessionRound }
    | { kind: 'followup' }
    | null
  >(null)
  const sequence = useRef(0)
  const allInOne = !!auction
  useEffect(() => {
    const id = new URL(location.href).searchParams.get('session')
    if (id && /^[a-f0-9-]{36}$/i.test(id)) setSessionId(id)
  }, [])
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let pending = false
    const run = async () => {
      if (pending || controller.signal.aborted) return
      pending = true
      const request = ++sequence.current
      try {
        if (!document.hidden) {
          const list = await read(
            `/api/live-cf/sessions?${new URLSearchParams({ tenantId })}`,
            controller.signal,
          )
          if (controller.signal.aborted || request !== sequence.current) return
          setSessions(list.sessions)
          const chosen = sessionId || list.sessions[0]?.id
          if (chosen && !sessionId) {
            setSessionId(chosen)
            return
          }
          if (chosen) {
            const result: SessionSnapshot = await read(
              `${allInOne ? '/api/live-auction/session' : '/api/live-cf/sessions'}?${new URLSearchParams({ tenantId, sessionId: chosen })}`,
              controller.signal,
            )
            if (!controller.signal.aborted && request === sequence.current) {
              setSnapshot(result)
              setUpdated(new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' }))
            }
          }
          if (!controller.signal.aborted) setError('')
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'โหลดข้อมูลไม่สำเร็จ')
      } finally {
        pending = false
        if (!controller.signal.aborted) {
          setLoading(false)
          timer = setTimeout(run, 5000)
        }
      }
    }
    const visible = () => {
      if (!document.hidden) {
        clearTimeout(timer)
        void run()
      }
    }
    void run()
    document.addEventListener('visibilitychange', visible)
    return () => {
      controller.abort()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [tenantId, active, sessionId, version, allInOne])
  const post = useCallback<Post>(
    async (input, requestId) => {
      const response = await fetch('/api/live-cf/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, sessionId, requestId, ...input }),
        signal: AbortSignal.timeout(45000),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'บันทึกไม่สำเร็จ')
      setVersion((previous) => previous + 1)
      setNotice(result.message || 'บันทึกแล้ว ยอดจะอัปเดตจากบิลล่าสุด')
      return result
    },
    [tenantId, sessionId],
  )
  function choose(id: string) {
    setSessionId(id)
    setSnapshot(null)
    setSelected([])
    setModal(null)
    setError('')
    setLoading(true)
    const url = new URL(location.href)
    url.searchParams.set('session', id)
    history.replaceState(null, '', url)
  }
  const data = snapshot?.session.id === sessionId ? snapshot : null
  const finance = data ? (
    <>
      {' '}
      <SessionFinance key={data.session.id} data={data} post={post} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {[
          ['คอมเมนต์ทั้งหมด', data.metrics.comments.toLocaleString('th-TH')],
          ['ตรงคำดัก / ตรงบิด', data.metrics.matched.toLocaleString('th-TH')],
          ['คนคอมเมนต์', `${data.metrics.commenters.toLocaleString('th-TH')} คน`],
          ['สลิปที่ผ่าน', `${data.metrics.slips.toLocaleString('th-TH')} สลิป`],
          ['ยอดโอนรวม', `฿${money(data.metrics.paid)}`],
          ['ยอดที่ยังขาด', `฿${money(data.metrics.remaining)}`],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-xl bg-slate-50 p-3">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-1 break-words text-lg font-bold tabular-nums text-slate-900">
              {value}
            </p>
          </div>
        ))}
      </div>
      <p className="rounded-xl bg-orange-50 p-3 text-sm text-orange-900">
        ขาด {data.metrics.unpaidPeople + data.metrics.partialPeople} คน • ยังไม่โอนเลย{' '}
        {data.metrics.unpaidPeople} คน • โอนขาด {data.metrics.partialPeople} คน
      </p>
    </>
  ) : (
    <SessionEmptyFinance />
  )
  const rounds = (
    <>
      {' '}
      <div className="space-y-3">
        <h3 className="font-bold text-slate-900">ผลประมูลแต่ละรอบ</h3>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[660px] text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                {['เวลาปิดรอบ', 'รายการ', 'ราคาจบ', 'ผู้ชนะ', 'จัดการ'].map((label) => (
                  <th key={label} className="p-3">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.rounds ?? []).map((round) => (
                <tr key={round.id}>
                  <td className="whitespace-nowrap p-3 text-xs">{sessionTime(round.closedAt)}</td>
                  <td className="max-w-64 break-words p-3">
                    {round.itemName}
                    {round.orderStatus === 'cancelled' && (
                      <span className="block text-xs text-red-600">ยกเลิกยอดแล้ว</span>
                    )}
                  </td>
                  <td className="p-3 font-semibold tabular-nums">฿{money(round.price)}</td>
                  <td className="p-3">
                    {round.winner ||
                      (round.status === 'cancelled' ? 'ยกเลิกรอบ' : 'ไม่มีผู้เสนอราคา')}
                  </td>
                  <td className="p-3">
                    <button
                      type="button"
                      className={button}
                      disabled={
                        !round.orderId ||
                        round.status !== 'closed' ||
                        ['shipped', 'cancelled'].includes(round.orderStatus || '')
                      }
                      onClick={() => setModal({ kind: 'winner', round })}
                    >
                      กำหนดผู้ชนะ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!(data?.rounds ?? []).length && (
            <p className="p-5 text-sm text-slate-500">ยังไม่มีรอบที่ปิดแล้ว</p>
          )}
        </div>
      </div>
    </>
  )
  const billing = (
    <>
      {' '}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 font-bold text-slate-900">
            <Wallet className="h-4 w-4" />
            ยอดลูกค้าใน Session
          </h3>
          <button
            type="button"
            className={orange}
            disabled={!(data?.tabs ?? []).some((tab) => Number(tab.remaining) > 0)}
            onClick={() => setModal({ kind: 'followup' })}
          >
            <Send className="mr-1 inline h-4 w-4" />
            ตามยอด / แจ้งยอด
          </button>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="p-3">
                  <input
                    type="checkbox"
                    aria-label="เลือกทุกคนที่ยังค้างใน Session"
                    checked={
                      (data?.tabs ?? []).some((tab) => Number(tab.remaining) > 0) &&
                      (data?.tabs ?? [])
                        .filter((tab) => Number(tab.remaining) > 0)
                        .every((tab) => selected.includes(tab.id))
                    }
                    onChange={(event) =>
                      setSelected(
                        event.target.checked
                          ? (data?.tabs ?? [])
                              .filter((tab) => Number(tab.remaining) > 0)
                              .map((tab) => tab.id)
                          : [],
                      )
                    }
                  />
                </th>
                {[
                  'ชื่อลูกค้า',
                  'รายการที่ชนะ / CF',
                  'ยอดที่ต้องจ่าย',
                  'โอนแล้ว / สลิป',
                  'คงเหลือ',
                  'แจ้งยอดล่าสุด',
                ].map((label) => (
                  <th key={label} className="p-3">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.tabs ?? []).map((tab) => (
                <tr key={tab.id}>
                  <td className="p-3">
                    <input
                      type="checkbox"
                      aria-label={`เลือกลูกค้า ${tab.name}`}
                      disabled={Number(tab.remaining) <= 0}
                      checked={selected.includes(tab.id)}
                      onChange={(event) =>
                        setSelected((previous) =>
                          event.target.checked
                            ? [...previous, tab.id]
                            : previous.filter((id) => id !== tab.id),
                        )
                      }
                    />
                  </td>
                  <td className="max-w-56 break-words p-3 font-medium">
                    {tab.name}
                    {Number(tab.credit) > 0 && (
                      <span className="block text-xs text-emerald-700">
                        เครดิต ฿{money(tab.credit)}
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    <span className="text-sm tabular-nums">{tab.items.length} รายการ</span>
                  </td>
                  <td className="p-3">
                    <button
                      type="button"
                      className="font-bold tabular-nums text-orange-600 underline underline-offset-4"
                      aria-label={`ดูที่มาของยอด ${tab.name}`}
                      onClick={() => setModal({ kind: 'proof', tab })}
                    >
                      ฿{money(tab.total)}
                    </button>
                  </td>
                  <td className="p-3 tabular-nums">
                    ฿{money(tab.paid)}
                    <span className="block text-xs text-slate-500">{tab.slips} สลิป</span>
                  </td>
                  <td className="p-3 font-semibold tabular-nums">
                    ฿{money(tab.remaining)}
                    <span
                      className={`mt-1 block text-xs ${Number(tab.remaining) <= 0 ? 'text-emerald-700' : 'text-orange-700'}`}
                    >
                      {Number(tab.remaining) <= 0
                        ? 'โอนครบแล้ว'
                        : Number(tab.paid) <= 0
                          ? 'ยังไม่โอน'
                          : `ยอดขาด ฿${money(tab.remaining)}`}
                    </span>
                  </td>
                  <td className="p-3 text-xs text-slate-500">
                    {tab.lastReminder
                      ? stateText[tab.lastReminder.status] || tab.lastReminder.status
                      : 'ยังไม่แจ้ง'}
                    {tab.lastReminder?.at && (
                      <span className="block">{sessionTime(tab.lastReminder.at)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!(data?.tabs ?? []).length && (
            <p className="p-5 text-sm text-slate-500">ยังไม่มีบิลลูกค้าใน Session นี้</p>
          )}
        </div>
      </div>
    </>
  )
  const sessionSelector = (
    <>
      {' '}
      <label className="block max-w-xl text-sm font-medium">
        Session / ไลฟ์สด
        <select
          aria-label="เลือก Session ประมูล"
          className={field}
          value={sessionId}
          onChange={(event) => choose(event.target.value)}
        >
          {!sessions.length && <option value="">ยังไม่มี Session</option>}
          {sessionId && !sessions.some((session) => session.id === sessionId) && (
            <option value={sessionId}>Session ที่เลือกไว้</option>
          )}
          {sessions.map((session) => (
            <option key={session.id} value={session.id}>
              {session.ended_at ? 'จบไลฟ์แล้ว' : 'เปิด Session'} • {session.live_post_id} •{' '}
              {sessionTime(session.created_at)}
            </option>
          ))}
        </select>
      </label>
    </>
  )
  return (
    <section
      className="mb-6 min-w-0 shrink-0 space-y-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-6"
      aria-label={auction ? 'แดชบอร์ดไลฟ์สดการประมูลครบวงจร' : 'สรุป Session ประมูล'}
      data-auction-dashboard={auction ? true : undefined}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <BarChart3 className="h-5 w-5 text-orange-500" />
            {auction ? 'ไลฟ์สดการประมูลครบวงจร' : 'สรุปยอดประมูลราย Session'}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            ยอดจากบิลและสลิปที่ตรวจสอบผ่าน • อัปเดตทุก 5 วินาที{updated ? ` • ${updated}` : ''}
          </p>
        </div>
        <button
          type="button"
          className={button}
          aria-label="โหลดสรุป Session ใหม่"
          onClick={() => setVersion((previous) => previous + 1)}
        >
          <RefreshCw className="inline h-4 w-4" /> โหลดใหม่
        </button>
      </header>
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
          {notice}
        </p>
      )}

      {loading && !data && <p role="status">Loading Session...</p>}
      {auction ? (
        <>
          <AuctionDashboardSection number={1} title="Session & Financial Summary">
            <AuctionSessionStart
              tenantId={tenantId}
              options={auction}
              onStarted={(id) => {
                choose(id)
                setVersion((v) => v + 1)
              }}
            />
            {sessionSelector}
            {finance}
          </AuctionDashboardSection>
          <AuctionDashboardSection number={2} title="Auction Round History">
            {rounds}
          </AuctionDashboardSection>
          <AuctionDashboardSection number={3} title="Live Session Automation">
            {data ? (
              <>
                <AuctionSessionAutomation
                  key={data.session.id}
                  tenantId={tenantId}
                  session={data.session}
                  options={auction}
                  onSaved={() => setVersion((v) => v + 1)}
                />
                <LiveAuctionPanel
                  key={data.session.id}
                  tenantId={tenantId}
                  pages={auction.pages}
                  bankAccounts={auction.bankAccounts}
                  session={data.session}
                  onSessionEnded={() => setVersion((v) => v + 1)}
                />
              </>
            ) : (
              <SessionRequired />
            )}
          </AuctionDashboardSection>
          <AuctionDashboardSection number={4} title="Customer Orders & Billing">
            <div
              data-customer-billing-grid
              className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-12"
            >
              <AuctionSessionCustomers
                key={`customers:${data?.session.id ?? 'empty'}`}
                tenantId={tenantId}
                data={data}
                onProof={(tab) => setModal({ kind: 'proof', tab })}
                onFollowup={(ids) => {
                  setSelected(ids)
                  setModal({ kind: 'followup' })
                }}
                onSnapshot={(result) => {
                  if (result.session.id === sessionId) setSnapshot(result)
                }}
              />
              <AuctionSessionSlips key={`slips:${data?.session.id ?? 'empty'}`} data={data} />
            </div>
          </AuctionDashboardSection>
          <AuctionDashboardSection number={5} title="Shipping & Fulfillment">
            {data ? (
              <ShippingDashboard
                key={data.session.id}
                tenantId={tenantId}
                shopName={auction.shopName}
                sessionId={data.session.id}
                embedded
              />
            ) : (
              <SessionRequired />
            )}
          </AuctionDashboardSection>
        </>
      ) : (
        <>
          {sessionSelector}
          {data ? (
            <>
              {finance}
              {rounds}
              {billing}
            </>
          ) : (
            !loading && <SessionRequired />
          )}
        </>
      )}
      {data && (
        <>
          {' '}
          {modal?.kind === 'proof' && (
            <SessionProofModal
              key={modal.tab.id}
              tenantId={tenantId}
              sessionId={sessionId}
              tab={modal.tab}
              post={post}
              onClose={() => setModal(null)}
            />
          )}
          {modal?.kind === 'winner' && (
            <SessionWinnerModal
              key={modal.round.id}
              tenantId={tenantId}
              sessionId={sessionId}
              round={modal.round}
              post={post}
              onClose={() => setModal(null)}
            />
          )}
          {modal?.kind === 'followup' && (
            <SessionFollowupModal
              tabs={data.tabs}
              selected={selected}
              post={post}
              onClose={() => setModal(null)}
            />
          )}
        </>
      )}
    </section>
  )
}
