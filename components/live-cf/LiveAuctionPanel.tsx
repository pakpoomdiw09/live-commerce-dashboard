'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Gavel, Radio, Trophy } from 'lucide-react'
import type { Auction, AuctionBid } from '@/lib/features/commerce/auction-types'
import { LiveSourcePicker, type LiveSourcePage } from './LiveSourcePicker'
import { LiveSwitch, LiveTemplateEditor, ReceivingBankPicker } from './LiveReplyControls'
import {
  AUCTION_PRIVATE_TEMPLATE,
  AUCTION_BID_TEMPLATE,
  AUCTION_CLOSE_TEMPLATE,
  displayAuctionTemplate,
  auctionVariables,
  auctionPublicVariables,
} from '@/lib/features/commerce/auction-templates'

type Delivery = { channel: string; status: string; error_code: string | null }
type Snapshot = { auctions: Auction[]; bids: AuctionBid[]; deliveries: Delivery[] }
const field =
  'mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100'
const money = (value: number) => Number(value).toLocaleString('th-TH', { maximumFractionDigits: 2 })
const statusLabel: Record<string, string> = {
  accepted: 'รับราคาแล้ว',
  already_opened: 'มีผู้เปิดแล้ว',
  too_low: 'ต่ำกว่าขั้นต่ำ',
  closed: 'ปิดประมูลแล้ว',
  count: 'ผู้ขายนับเคาะ',
  stale: 'คอมเมนต์ก่อนเปิดรอบ',
}

export function LiveAuctionPanel({
  tenantId,
  bankAccounts,
  pages = [],
  active = true,
}: {
  tenantId: string
  bankAccounts: { id: string; bank_code: string; account_number: string }[]
  pages?: LiveSourcePage[]
  active?: boolean
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>({ auctions: [], bids: [], deliveries: [] })
  const [selectedId, setSelectedId] = useState('')
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState('')
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const requestVersion = useRef(0)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(true)
  const [draft, setDraft] = useState({
    itemName: '',
    pageId: pages[0]?.id ?? '',
    livePostId: '',
    startPrice: '200',
    minStep: '20',
    shippingFee: '50',
    bankAccountId: bankAccounts[0]?.id ?? '',
    hostIds: '',
    privateReply: true,
    publicReply: true,
    privateText: displayAuctionTemplate(AUCTION_PRIVATE_TEMPLATE),
    bidText: displayAuctionTemplate(AUCTION_BID_TEMPLATE),
    closeText: displayAuctionTemplate(AUCTION_CLOSE_TEMPLATE),
  })
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const version = ++requestVersion.current
      try {
        const params = new URLSearchParams({ tenantId })
        if (selectedId) params.set('id', selectedId)
        const response = await fetch(`/api/live-cf/auction?${params}`, {
          cache: 'no-store',
          signal,
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'โหลดข้อมูลประมูลไม่สำเร็จ')
        if (!signal?.aborted && version === requestVersion.current) {
          setSnapshot(data)
          setLoadError('')
          setLastUpdated(new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' }))
        }
      } catch (cause) {
        if (!signal?.aborted && version === requestVersion.current)
          setLoadError(cause instanceof Error ? cause.message : 'โหลดข้อมูลไม่สำเร็จ')
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [tenantId, selectedId],
  )

  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let polling = false
    const poll = async () => {
      if (polling) return
      polling = true
      if (!document.hidden) await refresh(controller.signal)
      polling = false
      if (!controller.signal.aborted) timer = setTimeout(poll, 3000)
    }
    void poll()
    const onVisible = () => {
      if (!document.hidden) {
        clearTimeout(timer)
        void poll()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      controller.abort()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh, active])

  const auction = snapshot.auctions.find((a) => a.id === selectedId) ?? snapshot.auctions[0]
  async function mutate(path: string, input: Record<string, unknown>) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, ...input }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'ดำเนินการไม่สำเร็จ')
      if (typeof data.message === 'string') setNotice(data.message)
      if (data.id) {
        setSelectedId(data.id)
        setShowForm(false)
      } else await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ดำเนินการไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="mb-8 shrink-0 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200"
      aria-label="ระบบประมูลสด"
    >
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 bg-orange-50/60 p-5">
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-orange-500 p-2.5 text-white">
            <Gavel className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-lg font-bold text-slate-900">ประมูลสด</h1>
            <p className="text-sm text-slate-500">
              ผู้ขายคุมจังหวะผ่านคอมเมนต์ • ไม่มีเวลานับถอยหลัง
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
        >
          {showForm ? 'ซ่อนแบบฟอร์ม' : 'เปิดรายการใหม่'}
        </button>
      </header>
      <div className="space-y-5 p-5">
        <p className="text-xs text-slate-500" aria-live="polite">
          อัปเดตอัตโนมัติทุก 3 วินาที{lastUpdated ? ` • ล่าสุด ${lastUpdated}` : ''}
        </p>
        {(error || loadError) && (
          <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
            {error || loadError}
          </p>
        )}
        {notice && (
          <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
            {notice}
          </p>
        )}
        {showForm && (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void mutate('/api/live-cf/auction', {
                ...draft,
                startPrice: Number(draft.startPrice),
                minStep: Number(draft.minStep),
                shippingFee: Number(draft.shippingFee),
                hostIds: draft.hostIds.split(/[\s,]+/).filter(Boolean),
              })
            }}
            className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            <label className="text-sm font-medium">
              ชื่อรายการ
              <input
                required
                maxLength={200}
                className={field}
                value={draft.itemName}
                onChange={(e) => setDraft({ ...draft, itemName: e.target.value })}
                placeholder="เหรียญรุ่น 1"
              />
            </label>
            <div className="sm:col-span-2 lg:col-span-3">
              <LiveSourcePicker
                pages={pages}
                pageId={draft.pageId}
                livePostId={draft.livePostId}
                active={active}
                disabled={busy}
                onPageChange={(pageId) =>
                  setDraft((previous) => ({ ...previous, pageId, livePostId: '' }))
                }
                onLiveChange={(livePostId) => setDraft((previous) => ({ ...previous, livePostId }))}
              />
            </div>
            {(
              [
                { key: 'startPrice', label: 'ราคาเปิด (บาท)', min: '0.01' },
                { key: 'minStep', label: 'สเต็ปขั้นต่ำ (บาท)', min: '0.01' },
                { key: 'shippingFee', label: 'ค่าจัดส่ง (บาท)', min: '0' },
              ] as const
            ).map(({ key, label, min }) => (
              <label key={key} className="text-sm font-medium">
                {label}
                <input
                  type="number"
                  required
                  min={min}
                  max={key === 'shippingFee' ? 999999 : 999999999}
                  step="0.01"
                  className={field}
                  value={draft[key]}
                  onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                />
              </label>
            ))}
            <label className="text-sm font-medium sm:col-span-2">
              Facebook ID ผู้ช่วยคุมประมูล (ถ้ามี)
              <input
                className={field}
                value={draft.hostIds}
                onChange={(e) => setDraft({ ...draft, hostIds: e.target.value })}
                placeholder="คั่นด้วยจุลภาค • เพจที่เชื่อมต่อมีสิทธิ์อยู่แล้ว"
              />
              <span className="mt-1 block text-xs text-slate-500">
                ID ที่เพิ่มมีสิทธิ์สั่งปิดผ่านคอมเมนต์ได้
              </span>
            </label>
            <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-4 sm:col-span-2 lg:col-span-3">
              <h2 className="font-bold text-slate-900">ข้อความตอบกลับอัตโนมัติ</h2>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <LiveSwitch
                    checked={draft.privateReply}
                    disabled={busy}
                    label="ส่งสรุปยอดเข้า Messenger"
                    onChange={(privateReply) =>
                      setDraft((previous) => ({ ...previous, privateReply }))
                    }
                  />
                  <span className="text-sm font-semibold">
                    ส่งสรุปยอดและลิงก์ชำระเงินเข้ากล่องข้อความ Facebook (Messenger)
                  </span>
                </div>
                {draft.privateReply && (
                  <LiveTemplateEditor
                    label="ข้อความสรุปยอดผู้ชนะประมูล"
                    value={draft.privateText}
                    disabled={busy}
                    variables={auctionVariables}
                    onChange={(privateText) =>
                      setDraft((previous) => ({ ...previous, privateText }))
                    }
                  />
                )}
                <p className="text-xs text-slate-500">
                  ยอดชำระ คือยอดค้างสุทธิของบิลสะสมหลังหักยอดโอนที่ตรวจสอบแล้ว
                  ระบบแนบสรุปยอดและลิงก์แนบสลิปให้เสมอ ข้อความยาวจะย่อให้เหมาะกับปุ่ม Messenger
                  โดยคงยอดเงินและลิงก์บิลครบถ้วน
                </p>
              </div>
              <div className="space-y-3 border-t border-slate-100 pt-4">
                <div className="flex items-center gap-3">
                  <LiveSwitch
                    checked={draft.publicReply}
                    disabled={busy}
                    label="ตอบกลับใต้คอมเมนต์ประมูล"
                    onChange={(publicReply) =>
                      setDraft((previous) => ({ ...previous, publicReply }))
                    }
                  />
                  <span className="text-sm font-semibold">ตอบกลับใต้คอมเมนต์</span>
                </div>
                {draft.publicReply && (
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div>
                      <p className="text-sm font-medium">ยืนยันผู้เปิดราคา / ผู้นำล่าสุด</p>
                      <LiveTemplateEditor
                        label="ข้อความยืนยันผู้นำประมูล"
                        value={draft.bidText}
                        variables={auctionPublicVariables}
                        rows={3}
                        maxLength={600}
                        disabled={busy}
                        onChange={(bidText) => setDraft((previous) => ({ ...previous, bidText }))}
                      />
                    </div>
                    <div>
                      <p className="text-sm font-medium">ประกาศผู้ชนะเมื่อปิดประมูล (❌)</p>
                      <LiveTemplateEditor
                        label="ข้อความประกาศผู้ชนะประมูล"
                        value={draft.closeText}
                        variables={auctionPublicVariables}
                        rows={3}
                        maxLength={600}
                        disabled={busy}
                        onChange={(closeText) =>
                          setDraft((previous) => ({ ...previous, closeText }))
                        }
                      />
                    </div>
                  </div>
                )}
              </div>
              <div className="max-w-lg">
                <ReceivingBankPicker
                  accounts={bankAccounts}
                  value={draft.bankAccountId}
                  required
                  disabled={busy}
                  onChange={(bankAccountId) =>
                    setDraft((previous) => ({ ...previous, bankAccountId }))
                  }
                />
              </div>
              <p className="text-xs text-slate-500">
                ใช้บัญชีนี้ในบิลสะสมและหน้าชำระเงิน คิดค่าจัดส่งครั้งเดียวต่อรอบไลฟ์
              </p>
            </div>
            <p className="text-sm text-slate-500 sm:col-span-2">
              ลูกค้าพิมพ์ “เปิดให้ 10 ลุ้น” เพื่อเปิดตามราคาตั้งต้น หรือ “1” / “+1”
              เพื่อเพิ่มหนึ่งสเต็ป ระหว่างรอบนี้คอมเมนต์ของไลฟ์จะเข้าระบบประมูล
            </p>
            <button
              disabled={busy}
              className="rounded-xl bg-orange-500 px-4 py-3 font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'กำลังบันทึก…' : 'เริ่มเปิดประมูลรายการนี้'}
            </button>
          </form>
        )}
        {loading ? (
          <p className="text-sm text-slate-500">กำลังโหลดรายการ…</p>
        ) : !auction ? (
          <p className="py-4 text-sm text-slate-500">
            ยังไม่มีรายการประมูล กดเปิดรายการใหม่เพื่อเริ่มต้น
          </p>
        ) : (
          <>
            <label className="block max-w-lg text-sm font-medium">
              รายการประมูล
              <select
                className={field}
                value={auction.id}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                {snapshot.auctions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.item_name} •{' '}
                    {a.status === 'active'
                      ? 'กำลังประมูล'
                      : a.status === 'closed'
                        ? 'ปิดแล้ว'
                        : 'ยกเลิก'}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="flex items-center gap-2 text-sm text-slate-500">
                  <Radio className="h-4 w-4" />
                  {auction.status === 'active'
                    ? 'กำลังประมูล'
                    : auction.status === 'closed'
                      ? 'ปิดประมูลแล้ว'
                      : 'ยกเลิกแล้ว'}
                </p>
                <h3 className="mt-2 font-bold">{auction.item_name}</h3>
                <p className="mt-1 text-sm text-slate-500">
                  เปิด {money(auction.start_price)} • ขั้นต่ำ +{money(auction.min_step)} บาท
                </p>
                <p className="mt-1 text-xs text-slate-400">ไลฟ์ {auction.live_post_id}</p>
              </div>
              <div className="rounded-xl bg-orange-50 p-4">
                <p className="flex items-center gap-2 text-sm text-orange-700">
                  <Trophy className="h-4 w-4" />
                  {auction.status === 'closed' ? 'ผู้ชนะ' : 'ผู้นำปัจจุบัน'}
                </p>
                <p className="mt-2 text-xl font-bold" data-auction-leader>
                  {auction.leading_bidder_name ||
                    (auction.leading_bidder_id ? 'ลูกค้า Facebook' : 'รอผู้เปิดประมูล')}
                </p>
                <p
                  className="mt-2 text-4xl font-bold tabular-nums text-orange-600 md:text-5xl"
                  data-auction-price
                >
                  {money(auction.current_price)} <span className="text-sm">บาท</span>
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-sm text-slate-500">ผู้ขายนับเคาะ</p>
                <p className="mt-2 text-3xl font-bold" data-auction-count>
                  {auction.host_count || '—'}
                </p>
                <div className="mt-3 flex gap-2" aria-label="สถานะนับเคาะ 3 2 1">
                  {['3', '2', '1'].map((count) => (
                    <span
                      key={count}
                      className={`grid h-9 w-9 place-items-center rounded-lg text-sm font-bold ${auction.host_count === count ? 'bg-orange-500 text-white' : 'bg-white text-slate-400 ring-1 ring-slate-200'}`}
                    >
                      {count}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  พิมพ์ 3, 2, 1 หรือ เคาะ 1–3 เพื่อนับ
                  <br />
                  พิมพ์ ปิด / x / ❌ เพื่อจบรายการ
                </p>
              </div>
            </div>
            {auction.status === 'active' && (
              <div className="space-y-3 rounded-xl border border-slate-200 p-4">
                <p className="text-sm font-semibold">คำสั่งผู้ขาย • ส่งคอมเมนต์เข้าไลฟ์โดยตรง</p>
                <div className="flex flex-wrap gap-3">
                  {(['3', '2', '1'] as const).map((action) => (
                    <button
                      key={action}
                      data-auction-action={action}
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void mutate('/api/live-cf/auction/host-action', {
                          auctionId: auction.id,
                          action,
                        })
                      }
                      className="rounded-xl border border-orange-200 bg-orange-50 px-5 py-2.5 text-sm font-semibold text-orange-700 disabled:opacity-50"
                    >
                      นับ {action}
                    </button>
                  ))}
                  <button
                    type="button"
                    data-auction-action="close"
                    disabled={busy}
                    onClick={() =>
                      void mutate('/api/live-cf/auction/host-action', {
                        auctionId: auction.id,
                        action: 'close',
                      })
                    }
                    className="rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    ปิดประมูล (❌)
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void mutate('/api/live-cf/auction/close', {
                        auctionId: auction.id,
                        cancel: true,
                      })
                    }
                    className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-600 disabled:opacity-50"
                  >
                    ยกเลิกรายการนี้
                  </button>
                </div>
                <p className="text-xs text-slate-500">
                  สถานะการนับและผลปิดจะอัปเดตเมื่อระบบประมวลผลคอมเมนต์ตามลำดับในคิว
                </p>
              </div>
            )}
            {snapshot.deliveries.length > 0 && (
              <div className="space-y-1 rounded-xl bg-slate-50 p-3 text-sm">
                {snapshot.deliveries.map((d) => (
                  <p
                    key={d.channel}
                    className={d.status === 'requires_review' ? 'text-red-700' : 'text-slate-600'}
                  >
                    {d.channel === 'private' ? 'บิล Messenger' : 'สรุปใต้คอมเมนต์'}:{' '}
                    {d.status === 'sent'
                      ? 'ส่งแล้ว'
                      : d.status === 'requires_review'
                        ? 'ต้องตรวจสอบการส่งใน Inbox ก่อนส่งซ้ำ'
                        : 'รอส่ง'}
                    {d.error_code && <span className="ml-2 text-xs">({d.error_code})</span>}
                  </p>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-3 rounded-xl bg-slate-50 p-3">
              <button
                type="button"
                disabled={busy || auction.status === 'active'}
                onClick={() =>
                  void mutate('/api/customer-tabs', {
                    action: 'end_live',
                    livePostId: auction.live_post_id,
                    requestId: crypto.randomUUID(),
                    reminders: true,
                  })
                }
                className="rounded-lg border border-orange-200 bg-white px-3 py-2 text-xs font-semibold text-orange-700 disabled:opacity-50"
              >
                จบไลฟ์และตั้งทวงยอด
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void mutate('/api/customer-tabs', {
                    action: 'remind_all',
                    requestId: crypto.randomUUID(),
                  })
                }
                className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                ให้ AI แจ้งยอดค้างทั้งหมด
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <caption className="mb-3 text-left font-semibold">ประวัติการเคาะล่าสุด</caption>
                <thead>
                  <tr className="border-b text-xs text-slate-400">
                    <th className="p-2">เวลา</th>
                    <th className="p-2">ผู้เสนอราคา</th>
                    <th className="p-2">คอมเมนต์</th>
                    <th className="p-2">ราคา</th>
                    <th className="p-2">ผล</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.bids.map((bid) => (
                    <tr key={bid.id} className="border-b border-slate-100">
                      <td className="whitespace-nowrap p-2 text-xs text-slate-500">
                        {new Date(bid.created_at).toLocaleTimeString('th-TH', {
                          timeZone: 'Asia/Bangkok',
                        })}
                      </td>
                      <td className="p-2">{bid.bidder_name || 'ลูกค้า'}</td>
                      <td className="max-w-xs break-words p-2">{bid.comment_text}</td>
                      <td className="whitespace-nowrap p-2">
                        {bid.bid_amount == null ? '—' : money(bid.bid_amount)}
                      </td>
                      <td
                        className={`p-2 ${bid.status === 'accepted' ? 'text-emerald-600' : 'text-slate-500'}`}
                      >
                        {statusLabel[bid.status] || bid.status}
                        {bid.is_opening && bid.status === 'accepted' ? ' (คนเปิด)' : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!snapshot.bids.length && (
                <p className="p-4 text-center text-sm text-slate-400">ยังไม่มีคอมเมนต์ประมูล</p>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
