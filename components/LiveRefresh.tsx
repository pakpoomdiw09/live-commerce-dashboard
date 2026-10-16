'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo } from 'react'
import { supabaseBrowser } from '@/lib/supabase/browser'

/**
 * Re-render a server page whenever one of `tables` changes. Realtime applies RLS, so only rows
 * this user may read trigger a refresh. Bursts (a slip goes pending → valid in a few seconds)
 * collapse into one refresh.
 */
export function LiveRefresh({ channel, tables, delayMs = 800, filter }: { channel: string; tables: string[]; delayMs?: number; filter?: string }) {
  const router = useRouter()
  const db = useMemo(() => supabaseBrowser(), [])
  const key = tables.join(',')

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      clearTimeout(timer)
      timer = setTimeout(() => router.refresh(), delayMs)
    }
    let ch = db.channel(channel)
    for (const table of key.split(',')) ch = ch.on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, refresh)
    ch.subscribe((status) => {
      if (status === 'CHANNEL_ERROR') console.error(`[live] channel ${channel} error: are ${key} in the supabase_realtime publication?`)
    })
    return () => {
      clearTimeout(timer)
      void db.removeChannel(ch)
    }
  }, [db, router, channel, key, delayMs, filter])

  return null
}
