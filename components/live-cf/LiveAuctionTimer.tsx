'use client'

import { useEffect, useRef } from 'react'

type TimerSnapshot = {
  id: string
  status: string
  ends_at: string | null
  serverNow: string
  resolution: string
}

/** Absolute deadlines survive suspended tabs and a browser clock in any timezone. */
export function LiveAuctionTimer({
  tenantId,
  auctionId,
  onResolved,
}: {
  tenantId: string
  auctionId: string
  onResolved: () => void
}) {
  const resolved = useRef(onResolved)
  resolved.current = onResolved

  useEffect(() => {
    const controller = new AbortController()
    let busy = false,
      done = false,
      notified = false,
      lastAttempt = -Infinity
    let deadline: number | null = null
    let serverTime = 0,
      observedAt = 0
    async function refresh(action?: 'expire') {
      if (busy || done || controller.signal.aborted) return
      busy = true
      lastAttempt = performance.now()
      try {
        const params = new URLSearchParams({ tenantId, auctionId })
        const response = await fetch(`/api/live-cf/auction/timer?${params}`, {
          ...(action
            ? {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenantId, auctionId, action }),
              }
            : {}),
          cache: 'no-store',
          signal: controller.signal,
        })
        const data: TimerSnapshot & { error?: string } = await response.json()
        if ([401, 403, 404].includes(response.status)) {
          done = true
          return
        }
        if (!response.ok) return
        if (controller.signal.aborted) return
        serverTime = Date.parse(data.serverNow)
        observedAt = performance.now()
        deadline = data.ends_at ? Date.parse(data.ends_at) : null
        done = data.status !== 'active'
        if (done && !notified) {
          notified = true
          resolved.current()
        }
      } catch {
        // Transient failures retry silently; only the server can confirm a close.
      } finally {
        busy = false
      }
    }
    void refresh()
    const tick = setInterval(() => {
      if (done) return
      const now = performance.now()
      const seconds =
        deadline === null
          ? null
          : Math.max(0, Math.ceil((deadline - serverTime - (now - observedAt)) / 1000))
      // Zero fires immediately; failed resolutions retry, never report a false close.
      if ((seconds === 0 && now - lastAttempt >= 1000) || now - lastAttempt >= 5000)
        void refresh(seconds === 0 ? 'expire' : undefined)
    }, 1000)
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', visible)
    return () => {
      controller.abort()
      clearInterval(tick)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [tenantId, auctionId])

  return null
}
