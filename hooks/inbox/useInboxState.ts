'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createBackgroundRefresh } from '@/lib/background-refresh'
import type { InboxState, ConversationUpdate } from '@/lib/features/inbox/inbox-types'
import { apiError } from '@/lib/utils'
import { LatestInboxRequest } from '@/lib/features/inbox/inbox-request'

export function useInboxState(tenantId: string | undefined, customerIds: readonly string[] = []) {
  const [data, setData] = useState<InboxState | null>(null),
    [error, setError] = useState<string | null>(null)
  const idsKey = [...new Set(customerIds)].sort().join(',')
  const generation = useRef(0)
  const tenantScope = useRef(tenantId)
  tenantScope.current = tenantId
  const gate = useRef(new LatestInboxRequest())
  const refresh = useCallback(
    async (background = false) => {
      if (!tenantId) return
      const request = ++generation.current
      const ticket = gate.current.begin()
      try {
        const ids = idsKey ? idsKey.split(',') : []
        let next: InboxState | null = null
        for (let offset = 0; offset < Math.max(1, ids.length); offset += 500) {
          const query = ids.length
            ? '&customerIds=' + encodeURIComponent(ids.slice(offset, offset + 500).join(','))
            : ''
          const res = await fetch('/api/inbox/state?tenantId=' + tenantId + query, {
            cache: 'no-store',
            signal: ticket.signal,
          })
          if (!res.ok) throw new Error(await apiError(res))
          const page = (await res.json()) as InboxState
          next = next
            ? { ...page, conversations: [...next.conversations, ...page.conversations] }
            : page
          if (!ticket.current()) return
        }
        if (ticket.current() && request === generation.current) {
          setData(next)
          setError(null)
        }
      } catch (e) {
        if (ticket.current() && request === generation.current)
          setError(e instanceof Error ? e.message : 'โหลดสถานะแชทไม่สำเร็จ')
        if (background && ticket.current() && request === generation.current) throw e
      }
    },
    [tenantId, idsKey],
  )
  const latestRefresh = useRef(refresh)
  const scheduleRefresh = useRef<() => void>(() => {})
  const previousIds = useRef(idsKey)
  useEffect(() => {
    latestRefresh.current = refresh
  }, [refresh])
  useEffect(() => {
    const activeGate = gate.current
    const invalidate = () => {
      ++generation.current
    }
    setData(null)
    setError(null)
    if (!tenantId) {
      return
    }
    const scheduler = createBackgroundRefresh(
      () => latestRefresh.current(true),
      () => {},
      { intervalMs: 120000, minGapMs: 10000 },
    )
    scheduleRefresh.current = scheduler.request
    scheduler.request()
    const focus = () => {
      if (document.visibilityState === 'visible') scheduler.request()
    }
    document.addEventListener('visibilitychange', focus)
    window.addEventListener('online', focus)
    return () => {
      scheduleRefresh.current = () => {}
      invalidate()
      activeGate.cancel()
      scheduler.stop()
      document.removeEventListener('visibilitychange', focus)
      window.removeEventListener('online', focus)
    }
  }, [tenantId])
  useEffect(() => {
    if (previousIds.current !== idsKey) {
      previousIds.current = idsKey
      scheduleRefresh.current()
    }
  }, [idsKey])
  const applyConversation = useCallback((saved: ConversationUpdate) => {
    if (saved.tenant_id !== tenantScope.current) return
    ++generation.current
    gate.current.cancel()
    setData((current) => {
      if (!current || saved.tenant_id !== tenantScope.current) return current
      const previous = current.conversations.find((row) => row.id === saved.id)
      if (previous && previous.conversation_version > saved.conversation_version) return current
      return {
        ...current,
        conversations: previous
          ? current.conversations.map((row) => (row.id === saved.id ? { ...row, ...saved } : row))
          : [...current.conversations, { ...saved, unread_count: 0 }],
      }
    })
  }, [])
  const refreshSoon = useCallback(async () => scheduleRefresh.current(), [])
  return { data, error, refresh, refreshSoon, applyConversation }
}
