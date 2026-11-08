'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MessageCircle, X } from 'lucide-react'
import { supabaseBrowser } from '@/lib/supabase/browser'

type Notice = { customerId: string }

/** Shows a dashboard-wide, privacy-safe notice for new messages in the active tenant. */
export function InboxRealtimeNotifications({
  tenantId,
  onUnreadCountChange,
}: {
  tenantId: string | null
  onUnreadCountChange: (count: number) => void
}) {
  const pathname = usePathname()
  const [notice, setNotice] = useState<Notice | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!tenantId) {
      onUnreadCountChange(0)
      return
    }

    const db = supabaseBrowser()
    const seen = new Set<string>()
    let disposed = false
    let unreadRefresh: ReturnType<typeof setTimeout> | null = null
    const refreshUnreadCount = async () => {
      const response = await fetch(`/api/inbox/state?tenantId=${encodeURIComponent(tenantId)}`, {
        cache: 'no-store',
      }).catch(() => null)
      const state = response?.ok ? await response.json().catch(() => null) : null
      if (disposed || !Array.isArray(state?.conversations)) return
      const count = state.conversations.reduce(
        (total: number, conversation: { unread_count?: unknown }) =>
          total + Math.max(0, Number(conversation.unread_count) || 0),
        0,
      )
      onUnreadCountChange(count)
    }
    const scheduleUnreadRefresh = () => {
      if (unreadRefresh) clearTimeout(unreadRefresh)
      unreadRefresh = setTimeout(() => void refreshUnreadCount(), 200)
    }
    void refreshUnreadCount()
    const channel = db
      .channel(`dashboard-inbox:${tenantId}:${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        async ({ new: row }) => {
          const message = row as { id?: string; customer_id?: string; sender?: string }
          if (
            disposed ||
            message.sender !== 'customer' ||
            typeof message.id !== 'string' ||
            typeof message.customer_id !== 'string' ||
            seen.has(message.id)
          )
            return

          seen.add(message.id)
          if (seen.size > 1000) seen.delete(seen.values().next().value!)

          // messages has no tenant_id; verify ownership through the RLS-protected customer row.
          const { data, error } = await db
            .from('customers')
            .select('id')
            .eq('id', message.customer_id)
            .eq('tenant_id', tenantId)
            .maybeSingle()
          if (disposed || error || !data) return

          console.info('[dashboard/inbox] incoming message received')
          scheduleUnreadRefresh()
          if (pathname !== '/inbox' && !pathname.startsWith('/inbox/')) {
            setNotice({ customerId: data.id })
            if (timer.current) clearTimeout(timer.current)
            timer.current = setTimeout(() => setNotice(null), 10_000)
          }
        },
      )
      .subscribe((status, error) => {
        if (disposed) return
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          const code = error && 'code' in error && typeof error.code === 'string'
            ? error.code
            : undefined
          console.warn('[dashboard/inbox] realtime disconnected', { status, code })
        }
      })

    return () => {
      disposed = true
      if (timer.current) clearTimeout(timer.current)
      if (unreadRefresh) clearTimeout(unreadRefresh)
      void db.removeChannel(channel)
    }
  }, [onUnreadCountChange, pathname, tenantId])

  if (!notice) return null

  return (
    <aside
      aria-live="polite"
      aria-atomic="true"
      className="fixed bottom-4 right-4 z-[100] flex max-w-sm items-center gap-3 rounded-xl border border-orange-200 bg-white p-4 shadow-xl"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-orange-100 text-orange-700" aria-hidden>
        <MessageCircle className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-slate-900">มีข้อความใหม่เข้ามา</p>
        <Link
          href={`/inbox?customer=${encodeURIComponent(notice.customerId)}`}
          onClick={() => setNotice(null)}
          className="text-sm font-medium text-orange-700 underline underline-offset-2"
        >
          เปิดบทสนทนา
        </Link>
      </div>
      <button
        type="button"
        onClick={() => setNotice(null)}
        aria-label="ปิดการแจ้งเตือนข้อความใหม่"
        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </aside>
  )
}
