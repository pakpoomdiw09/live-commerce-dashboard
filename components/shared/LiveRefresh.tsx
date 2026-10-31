'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo } from 'react'
import { supabaseBrowser } from '@/lib/supabase/browser'
import { subscribeWhileVisible } from '@/lib/realtime-visibility'

/**
 * Re-render a server page whenever one of `tables` changes. Realtime applies RLS, so only rows
 * this user may read trigger a refresh. Bursts (a slip goes pending → valid in a few seconds)
 * collapse into one refresh.
 */
export function LiveRefresh({
  channel,
  tables,
  delayMs = 800,
  filter,
}: {
  channel: string
  tables: string[]
  delayMs?: number
  filter?: string
}) {
  const router = useRouter()
  const db = useMemo(() => supabaseBrowser(), [])
  const key = tables.join(',')

  useEffect(() => {
    // Global/admin aggregates do not need an unfiltered WAL subscription.
    if (!filter) return
    let subscribed = false
    let lastRefresh = 0
    return subscribeWhileVisible(() => {
      let disposed = false
      let timer: ReturnType<typeof setTimeout> | undefined
      let dirty = false
      const refresh = () => {
        if (disposed) return
        dirty = true
        if (timer || document.visibilityState === 'hidden') return
        timer = setTimeout(
          () => {
            timer = undefined
            if (disposed || document.visibilityState === 'hidden') return
            dirty = false
            lastRefresh = Date.now()
            router.refresh()
          },
          Math.max(delayMs, 30000 - (Date.now() - lastRefresh)),
        )
      }
      const visible = () => {
        if (dirty && document.visibilityState === 'visible') refresh()
      }
      document.addEventListener('visibilitychange', visible)
      let ch = db.channel(`${channel}:${Math.random().toString(36).slice(2)}`)
      for (const table of key.split(','))
        ch = ch.on(
          'postgres_changes',
          { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
          refresh,
        )
      ch.subscribe((status) => {
        if (disposed) return
        if (status === 'SUBSCRIBED') {
          if (subscribed) refresh()
          subscribed = true
        }
        if (status === 'CHANNEL_ERROR')
          console.error(
            `[live] channel ${channel} error: are ${key} in the supabase_realtime publication?`,
          )
      })
      return () => {
        disposed = true
        clearTimeout(timer)
        document.removeEventListener('visibilitychange', visible)
        void db.removeChannel(ch)
      }
    })
  }, [db, router, channel, key, delayMs, filter])

  return null
}
