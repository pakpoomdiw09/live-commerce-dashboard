'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, MessagesSquare, Send } from 'lucide-react'
import {
  sessionCustomerRows,
  type SessionCustomerRow,
} from '@/lib/features/commerce/session-customer-rows'
import {
  sessionMoney as money,
  type SessionSnapshot,
  type SessionTab,
} from '@/lib/features/commerce/live-session-types'
import { SessionCustomerStatus } from './AuctionSessionSections'
import { button, field, orange, sessionTime } from './session-ui'

function CustomerNote({
  row,
  tenantId,
  sessionId,
}: {
  row: SessionCustomerRow
  tenantId: string
  sessionId: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [saved, setSaved] = useState<{ note: string; revision: number } | null>(null)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const base = useRef(row.noteRevision),
    pending = useRef({ key: '', id: '' })
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const current =
    saved && saved.revision >= row.noteRevision
      ? saved
      : { note: row.note, revision: row.noteRevision }
  async function save() {
    if (draft === null || !row.fbId || busy) return
    if (draft.trim() === current.note) {
      setDraft(null)
      return
    }
    setBusy(true)
    setError('')
    const key = `${base.current}:${draft}`
    if (pending.current.key !== key) pending.current = { key, id: crypto.randomUUID() }
    try {
      const response = await fetch('/api/live-auction/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          sessionId,
          action: 'note',
          fbId: row.fbId,
          note: draft,
          revision: base.current,
          requestId: pending.current.id,
        }),
        signal: AbortSignal.timeout(20000),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'บันทึกหมายเหตุไม่สำเร็จ')
      if (mounted.current) {
        setSaved(result)
        setDraft(null)
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'บันทึกไม่สำเร็จ')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  return (
    <div className="space-y-1">
      <input
        aria-label={`หมายเหตุ ${row.name}`}
        className={`${field} !mt-0 min-w-24 !px-2 !py-2 !text-xs`}
        maxLength={500}
        placeholder="หมายเหตุ"
        disabled={busy || !row.fbId}
        value={draft ?? current.note}
        onChange={(e) => {
          if (draft === null) base.current = current.revision
          setDraft(e.target.value)
          setError('')
        }}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          }
        }}
      />
      <p className="text-[10px] text-slate-400">
        {busy
          ? 'กำลังบันทึก…'
          : draft !== null
            ? 'ออกจากช่องเพื่อบันทึก'
            : current.revision > 0
              ? 'บันทึกแล้ว'
              : 'บันทึกเมื่อออกจากช่อง'}
      </p>
      {error && (
        <div role="alert" className="text-xs text-red-700">
          {error}
          <button
            type="button"
            className="block underline"
            onClick={() => {
              setDraft(null)
              setError('')
            }}
          >
            ยกเลิกการแก้ไข
          </button>
        </div>
      )}
    </div>
  )
}

export function AuctionSessionCustomers({
  tenantId,
  data,
  onProof,
  onFollowup,
  onSnapshot,
}: {
  tenantId: string
  data: SessionSnapshot | null
  onProof: (tab: SessionTab) => void
  onFollowup: (tabIds: string[]) => void
  onSnapshot: (snapshot: SessionSnapshot) => void
}) {
  const rows = useMemo(() => sessionCustomerRows(data), [data])
  const [onlyMatched, setOnlyMatched] = useState(false),
    [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const controller = useRef<AbortController | null>(null),
    all = useRef<HTMLInputElement>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const visible = onlyMatched ? rows.filter((row) => row.matched) : rows
  const checkedRows = rows.filter((row) => selected.includes(row.id))
  const eligible = (checkedRows.length ? checkedRows : visible).flatMap((row) =>
    row.tab && Number(row.tab.remaining) > 0 ? [row.tab.id] : [],
  )
  const checked = visible.length > 0 && visible.every((row) => selected.includes(row.id))
  useEffect(() => {
    if (all.current)
      all.current.indeterminate = !checked && visible.some((row) => selected.includes(row.id))
  }, [checked, visible, selected])
  function toggle(id: string, checked: boolean) {
    setSelected((previous) =>
      checked ? [...new Set([...previous, id])] : previous.filter((value) => value !== id),
    )
  }
  async function loadSelected() {
    if (!data || !checkedRows.length || checkedRows.some((row) => !row.fbId)) return
    setBusy(true)
    setError('')
    setNotice('')
    const abort = new AbortController()
    controller.current?.abort()
    controller.current = abort
    try {
      const response = await fetch('/api/live-auction/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          sessionId: data.session.id,
          action: 'load_customers',
          fbIds: checkedRows.map((row) => row.fbId),
          requestId: crypto.randomUUID(),
        }),
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30000)]),
      })
      const result: SessionSnapshot & { error?: string } = await response.json()
      if (!response.ok) throw new Error(result.error || 'ดึงข้อมูลไม่สำเร็จ')
      if (result.session?.id !== data.session.id) throw new Error('ข้อมูลไม่ตรงกับไลฟ์ที่เลือก')
      if (!abort.signal.aborted) {
        onSnapshot(result)
        setNotice(`ดึงข้อมูล ${checkedRows.length} คนแล้ว`)
      }
    } catch (cause) {
      if (!abort.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'ดึงข้อมูลไม่สำเร็จ')
    } finally {
      if (!abort.signal.aborted) setBusy(false)
    }
  }
  return (
    <section
      data-session-customers
      className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-3 xl:col-span-7"
    >
      <header className="space-y-3">
        <h3 className="font-bold text-slate-900">รายชื่อลูกค้าและบิลสะสมในไลฟ์นี้</h3>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-h-10 items-center gap-2 text-xs">
            <input
              ref={all}
              type="checkbox"
              aria-label="เลือกลูกค้าทั้งหมดที่แสดง"
              checked={checked}
              disabled={!visible.length || busy}
              onChange={(e) => setSelected(e.target.checked ? visible.map((row) => row.id) : [])}
            />
            เลือกทั้งหมด
          </label>
          <button
            type="button"
            className={`${orange} inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap`}
            disabled={!eligible.length || busy}
            onClick={() => onFollowup(eligible)}
          >
            <Send className="h-4 w-4" /> ตามยอดค้างชำระ
          </button>
          <button
            type="button"
            className={`${button} inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap`}
            disabled={
              busy ||
              !checkedRows.length ||
              checkedRows.length > 500 ||
              checkedRows.some((row) => !row.fbId)
            }
            onClick={() => void loadSelected()}
          >
            <Download className="h-4 w-4" />
            {busy ? 'กำลังดึงข้อมูล…' : 'ดึงข้อมูลคนที่เลือก'}
          </button>
          <label className="flex min-h-10 items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={onlyMatched}
              onChange={(e) => {
                setOnlyMatched(e.target.checked)
                setSelected([])
              }}
              aria-label="เฉพาะคนตรงคำดัก"
            />
            เฉพาะคนตรงคำดัก
          </label>
          <p className="text-[10px] text-slate-500">
            เลือกเพื่อแสดงเฉพาะลูกค้าที่พิมพ์ตรงคำดักของไลฟ์นี้
          </p>
        </div>
        <SessionCustomerStatus data={data} />
        <p className="text-[10px] text-slate-500">
          ส่งตามยอดไม่เกิน 12 ข้อความต่อนาทีต่อเพจ โดยตรวจยอดค้างล่าสุดก่อนส่ง
        </p>
        <p className="text-xs text-slate-500">
          แสดง {visible.length} คน · เลือก {checkedRows.length} คน · คลิกยอดเงินเพื่อตรวจและปรับยอด
        </p>
      </header>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-emerald-700">
          {notice}
        </p>
      )}
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table
          className="w-full min-w-[520px] text-left text-xs"
          aria-label="รายชื่อลูกค้าและบิลสะสม"
        >
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="w-8 p-2">
                <span className="sr-only">เลือก</span>
              </th>
              {['ชื่อ Facebook', 'ยอดซื้อ / รายการ', 'สถานะการเงิน', 'ยอด / หมายเหตุ'].map(
                (label) => (
                  <th key={label} className="p-2">
                    {label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map((row) => (
              <tr
                key={row.id}
                data-customer-row={row.id}
                className={selected.includes(row.id) ? 'bg-orange-50/40' : ''}
              >
                <td className="p-2 align-top">
                  <input
                    type="checkbox"
                    aria-label={`เลือกลูกค้า ${row.name}`}
                    checked={selected.includes(row.id)}
                    disabled={busy}
                    onChange={(e) => toggle(row.id, e.target.checked)}
                  />
                </td>
                <td className="max-w-36 break-words p-2 align-top">
                  <div className="flex items-start gap-2">
                    <b className="min-w-0">{row.name}</b>
                    {row.customerId ? (
                      <a
                        href={`/inbox?customer=${encodeURIComponent(row.customerId)}`}
                        aria-label={`เปิดแช็ต Messenger ${row.name}`}
                        title="เปิดข้อความของลูกค้า"
                        className="shrink-0 text-blue-600"
                      >
                        <MessagesSquare className="h-4 w-4" />
                      </a>
                    ) : (
                      <span
                        title="เลือกแล้วกดดึงข้อมูล เพื่อเปิดข้อความของลูกค้า"
                        className="shrink-0 text-slate-300"
                      >
                        <MessagesSquare className="h-4 w-4" />
                      </span>
                    )}
                  </div>
                  <span className="mt-1 block text-[10px] text-slate-400">
                    {row.comments} คอมเมนต์{row.at ? ` · ${sessionTime(row.at)}` : ''}
                  </span>
                  {row.matched && (
                    <span className="mt-1 inline-block rounded bg-orange-50 px-1.5 py-0.5 text-[10px] text-orange-700">
                      ตรงคำดัก
                    </span>
                  )}
                </td>
                <td className="max-w-48 p-2 align-top">
                  {row.tab ? (
                    <>
                      <button
                        type="button"
                        className="font-bold tabular-nums text-orange-600 underline underline-offset-4"
                        aria-label={`ดูที่มาของยอด ${row.name}`}
                        onClick={() => onProof(row.tab!)}
                      >
                        ฿{money(row.tab.total)}
                      </button>
                      <ul className="mt-1 max-h-28 space-y-1 overflow-auto break-words text-[10px] text-slate-500">
                        {row.tab.items.map((item) => (
                          <li key={item.orderId}>
                            {(() => {
                              const tag = item.name.match(/^\[(ประมูล|CF(?:-[^\]]+)?)\]\s*/u)
                              return tag ? (
                                <>
                                  <span
                                    className={`mr-1 rounded px-1 py-0.5 ${tag[1] === 'ประมูล' ? 'bg-orange-50 text-orange-700' : 'bg-blue-50 text-blue-700'}`}
                                  >
                                    [{tag[1]}]
                                  </span>
                                  {item.name.slice(tag[0].length)}
                                </>
                              ) : (
                                item.name
                              )
                            })()}{' '}
                            · {money(item.amount)} บาท
                          </li>
                        ))}
                      </ul>
                      <span className="mt-1 block text-[10px] text-slate-400">
                        {row.tab.items.length} รายการ · ค่าส่ง {money(row.tab.shipping)} ฿
                      </span>
                    </>
                  ) : (
                    <span className="text-slate-400">ยังไม่มีบิล</span>
                  )}
                </td>
                <td className="p-2 align-top">
                  <div className="space-y-1">
                    {row.tab ? (
                      <>
                        {Number(row.tab.paid) > 0 && (
                          <span className="block rounded-lg bg-emerald-50 px-2 py-1.5 font-semibold tabular-nums text-emerald-700">
                            {Number(row.tab.remaining) <= 0
                              ? `โอนครบแล้ว ${money(row.tab.paid)} บาท`
                              : `โอนแล้ว ${money(row.tab.paid)} บาท`}
                          </span>
                        )}
                        {Number(row.tab.remaining) > 0 && Number(row.tab.paid) > 0 && (
                          <span className="block rounded-lg bg-red-50 px-2 py-1.5 font-semibold tabular-nums text-red-700">
                            โอนขาด {money(row.tab.remaining)} ฿
                          </span>
                        )}
                        {Number(row.tab.paid) <= 0 && Number(row.tab.remaining) > 0 && (
                          <span className="block rounded-lg bg-orange-50 px-2 py-1.5 font-semibold text-orange-700">
                            ยังไม่โอน
                            <span className="block text-[10px]">
                              ขาด {money(row.tab.remaining)} ฿
                            </span>
                          </span>
                        )}
                        {Number(row.tab.remaining) <= 0 && (
                          <span className="block text-[10px] text-emerald-700">
                            {Number(row.tab.credit) > 0
                              ? `เกิน ${money(row.tab.credit)} ฿`
                              : 'โอนครบแล้ว'}
                          </span>
                        )}
                        <span className="block text-[10px] text-slate-400">
                          {row.tab.slips} สลิป
                        </span>
                      </>
                    ) : (
                      <span className="inline-block rounded-lg bg-slate-100 px-2 py-1.5 text-slate-500">
                        ยังไม่มีบิล
                      </span>
                    )}
                  </div>
                </td>
                <td className="w-28 p-2 align-top">
                  {data && (
                    <CustomerNote row={row} tenantId={tenantId} sessionId={data.session.id} />
                  )}
                  {row.tab && (
                    <button
                      type="button"
                      className="mt-2 text-[10px] font-semibold text-orange-600 underline"
                      onClick={() => onProof(row.tab!)}
                    >
                      ปรับยอด
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && (
          <p className="p-6 text-center text-sm text-slate-500">
            {onlyMatched ? 'ยังไม่มีคนตรงคำดักในไลฟ์นี้' : 'ยังไม่มีลูกค้าในไลฟ์นี้'}
          </p>
        )}
      </div>
    </section>
  )
}
