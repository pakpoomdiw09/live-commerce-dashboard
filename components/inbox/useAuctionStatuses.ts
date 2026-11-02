'use client'

import { useEffect, useState } from 'react'

type AuctionInboxStatus = { customer_id: string; item_name: string; remaining_amount: number }
/** Poll only loaded customers, in bounded batches, with no overlapping requests. */
export function useAuctionStatuses(tenantId: string | undefined, customerIds: string) {
  const [statuses, setStatuses] = useState<Record<string, AuctionInboxStatus>>({})
  useEffect(() => {
    setStatuses({})
    if (!tenantId || !customerIds) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let loading = false
    const load = async () => {
      if (loading || controller.signal.aborted) return
      loading = true
      try {
        if (!document.hidden) {
          const ids = customerIds.split(',')
          const next: Record<string, AuctionInboxStatus> = {}
          for (let start = 0; start < ids.length; start += 50) {
            const params = new URLSearchParams({
              tenantId,
              customers: ids.slice(start, start + 50).join(','),
            })
            const response = await fetch(`/api/inbox/auction-status?${params}`, {
              cache: 'no-store',
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
            })
            if (!response.ok) throw new Error('AUCTION_STATUS_UNAVAILABLE')
            const data = await response.json()
            for (const status of data.statuses ?? []) next[status.customer_id] = status
          }
          if (!controller.signal.aborted) setStatuses(next)
        }
      } catch {
        /* Keep the last confirmed badge while the network reconnects. */
      } finally {
        loading = false
        if (!controller.signal.aborted) timer = setTimeout(load, 5000)
      }
    }
    const visible = () => {
      if (!document.hidden) {
        clearTimeout(timer)
        void load()
      }
    }
    document.addEventListener('visibilitychange', visible)
    void load()
    return () => {
      controller.abort()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [tenantId, customerIds])
  return statuses
}
