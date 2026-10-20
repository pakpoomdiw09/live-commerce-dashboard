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
    let lastRefresh=0,dirty=false
    const refresh = () => {
      dirty=true
      if(timer||document.visibilityState==='hidden')return
      timer = setTimeout(() => {
        timer=undefined
        if(document.visibilityState==='hidden')return
        dirty=false;lastRefresh=Date.now();router.refresh()
      }, Math.max(delayMs,5000-(Date.now()-lastRefresh)))
    }
    const visible=()=>{if(dirty&&document.visibilityState==='visible')refresh()}
    document.addEventListener('visibilitychange',visible)
    let ch = db.channel(channel)
    for (const table of key.split(',')) ch = ch.on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, refresh)
    ch.subscribe((status) => {
      if (status === 'CHANNEL_ERROR') console.error(`[live] channel ${channel} error: are ${key} in the supabase_realtime publication?`)
    })
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange',visible)
      void db.removeChannel(ch)
    }
  }, [db, router, channel, key, delayMs, filter])

  return null
}
