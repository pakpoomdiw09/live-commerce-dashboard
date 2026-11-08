'use client'

import { useEffect, useRef, useState } from 'react'

type TimerSnapshot = {
  id: string
  status: string
  ends_at: string | null
  serverNow: string
  resolution: string
}

/** Absolute deadlines survive suspended tabs and a browser clock in any timezone. */
export function LiveAuctionTimer({ tenantId, auctionId, onResolved }: {
  tenantId: string
  auctionId: string
  onResolved: () => void
}) {
  const [snapshot, setSnapshot] = useState<TimerSnapshot | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [startRequest, setStartRequest] = useState(0)
  const resolved = useRef(onResolved)
  resolved.current = onResolved

  useEffect(() => {
    const controller = new AbortController()
    let busy = false, done = false, notified = false, lastAttempt = -Infinity
    let deadline: number | null = null
    let serverTime = 0, observedAt = 0
    setSnapshot(null)
    setRemaining(null)
    setError('')
    async function refresh(action?: 'expire' | 'start') {
      if (busy || done || controller.signal.aborted) return
      busy = true
      lastAttempt = performance.now()
      try {
        const params = new URLSearchParams({ tenantId, auctionId })
        const response = await fetch(`/api/live-cf/auction/timer?${params}`, {
          ...(action ? { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId, auctionId, action }) } : {}),
          cache: 'no-store', signal: controller.signal,
        })
        const data: TimerSnapshot & { error?: string } = await response.json()
        if (!response.ok) throw new Error(data.error || 'ตรวจสอบเวลาประมูลไม่สำเร็จ')
        if (controller.signal.aborted) return
        serverTime = Date.parse(data.serverNow)
        observedAt = performance.now()
        deadline = data.ends_at ? Date.parse(data.ends_at) : null
        setSnapshot(data)
        setError('')
        done = data.status !== 'active'
        setRemaining(deadline === null ? null : Math.max(0, Math.ceil((deadline - serverTime) / 1000)))
        if (done && !notified) { notified = true; resolved.current() }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'ตรวจสอบเวลาประมูลไม่สำเร็จ')
      } finally { busy = false }
    }
    void refresh(startRequest ? 'start' : undefined)
    const tick = setInterval(() => {
      if (done) return
      const now = performance.now()
      const seconds = deadline === null ? null : Math.max(0, Math.ceil((deadline - serverTime - (now - observedAt)) / 1000))
      setRemaining(seconds)
      // Zero fires immediately; failed resolutions retry, never report a false close.
      if ((seconds === 0 && now - lastAttempt >= 1000) || now - lastAttempt >= 5000)
        void refresh(seconds === 0 ? 'expire' : undefined)
    }, 250)
    const visible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', visible)
    return () => {
      controller.abort()
      clearInterval(tick)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [tenantId, auctionId, startRequest])

  return <div className="rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm">
    <div role="status" className="font-semibold tabular-nums">
      {!snapshot ? 'กำลังตรวจสอบเวลาประมูล…' : snapshot.status !== 'active' ? 'ปิดรอบประมูลแล้ว'
        : remaining === null ? 'รอบเดิมยังไม่ได้กำหนดเวลาสิ้นสุด'
        : remaining === 0 ? 'หมดเวลา กำลังปิดรอบและสร้างออเดอร์…'
        : `เหลือเวลา ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`}
    </div>
    {snapshot?.status === 'active' && !snapshot.ends_at && <button type="button"
      className="mt-2 rounded-lg bg-orange-600 px-3 py-2 text-white"
      onClick={() => setStartRequest((n) => n + 1)}>เริ่มนับถอยหลัง 5 นาที</button>}
    {snapshot?.resolution === 'draining' && <p>กำลังประมวลผลบิดที่รับไว้ก่อนหมดเวลา</p>}
    {error && <p role="alert" className="mt-1 text-red-700">{error} — ระบบจะลองใหม่อัตโนมัติ</p>}
  </div>
}
