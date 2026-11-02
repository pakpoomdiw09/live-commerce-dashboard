'use client'
import { useEffect, useRef, useState } from 'react'
import { SessionDialog } from './SessionDialog'
import {
  sessionMoney as money,
  type SessionRound,
  type SessionBid,
} from '@/lib/features/commerce/live-session-types'
import { field, button, orange, read, sessionTime, type Post } from './session-ui'

export function SessionWinnerModal({
  tenantId,
  sessionId,
  round,
  post,
  onClose,
}: {
  tenantId: string
  sessionId: string
  round: SessionRound
  post: Post
  onClose: () => void
}) {
  const [bids, setBids] = useState<SessionBid[]>([]),
    [query, setQuery] = useState(''),
    [bidId, setBidId] = useState('')
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false)
  const request = useRef(crypto.randomUUID())
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    const timer = setTimeout(() => {
      void read(
        `/api/live-cf/sessions?${new URLSearchParams({ tenantId, sessionId, roundId: round.id, q: query })}`,
        controller.signal,
      )
        .then((result) => {
          if (!controller.signal.aborted) {
            setBids(result.bids)
            setError('')
          }
        })
        .catch((cause) => {
          if (!controller.signal.aborted)
            setError(cause instanceof Error ? cause.message : 'โหลดรายชื่อไม่สำเร็จ')
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [tenantId, sessionId, round.id, query])
  const selected = bids.find((bid) => bid.id === bidId)
  return (
    <SessionDialog title={`กำหนดผู้ชนะ • ${round.itemName}`} onClose={onClose} busy={busy}>
      <p className="text-sm text-slate-600">
        ผู้ชนะเดิม: {round.winner} • ฿{money(round.price)}
      </p>
      <label className="block text-sm font-medium">
        ค้นหาคนที่เคาะในรอบนี้
        <input
          aria-label="ค้นหาผู้เสนอราคา"
          className={field}
          value={query}
          disabled={busy}
          onChange={(event) => {
            setQuery(event.target.value)
            setBidId('')
            request.current = crypto.randomUUID()
          }}
          placeholder="พิมพ์ชื่อลูกค้า"
        />
      </label>
      <label className="block text-sm font-medium">
        เลือกคอมเมนต์ราคาที่รับแล้ว
        <select
          aria-label="เลือกผู้ชนะใหม่"
          className={field}
          value={bidId}
          disabled={loading || busy}
          onChange={(event) => {
            setBidId(event.target.value)
            request.current = crypto.randomUUID()
          }}
        >
          <option value="">{loading ? 'กำลังค้นหา…' : 'เลือกลูกค้าและราคาจากหลักฐาน'}</option>
          {bids.map((bid) => (
            <option key={bid.id} value={bid.id}>
              {bid.bidder_name || bid.bidder_id} • ฿{money(bid.bid_amount)} •{' '}
              {sessionTime(bid.created_at)}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-slate-500">
        แสดงคอมเมนต์ราคาที่รับแล้วล่าสุดสูงสุด 100 รายการ พิมพ์ชื่อเพื่อค้นหาเพิ่มเติม
      </p>
      {selected && (
        <p className="rounded-xl bg-orange-50 p-4 text-sm text-orange-900">
          จะกำหนดให้ {selected.bidder_name || selected.bidder_id} ชนะที่ราคา ฿
          {money(selected.bid_amount)} และย้ายยอดเรียกเก็บเข้า Customer Tab ของคนนั้น
          เงินที่ผู้ชนะเดิมโอนไว้ยังเป็นเครดิตของคนเดิม
        </p>
      )}
      <p className="text-xs text-slate-500">
        การแก้ผู้ชนะเก็บประวัติไว้ในระบบและไม่ส่งข้อความเดิมซ้ำ
        ใช้ปุ่มตามยอดเพื่อพรีวิวและแจ้งผู้ชนะใหม่
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className={button} disabled={busy} onClick={onClose}>
          ยกเลิก
        </button>
        <button
          type="button"
          className={orange}
          disabled={!selected || busy || loading}
          onClick={async () => {
            setBusy(true)
            setError('')
            try {
              await post(
                {
                  action: 'winner',
                  roundId: round.id,
                  orderId: round.orderId,
                  bidId,
                  revision: Number(round.tabRevision),
                },
                request.current,
              )
              onClose()
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'แก้ผู้ชนะไม่สำเร็จ')
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'กำลังย้ายยอด…' : 'บันทึกผู้ชนะใหม่'}
        </button>
      </div>
    </SessionDialog>
  )
}
