'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabaseBrowser } from '@/lib/supabase/browser'
import {
  SLIP_COLUMNS,
  type CustomerRow,
  type MessageRow,
  type SlipRow,
  type SlipStatus,
} from '@/lib/types'
import {
  inboxChannelName,
  reconcileThread,
  type ThreadChange,
} from '@/lib/features/inbox/inbox-realtime'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ChatList } from '@/components/inbox/ChatList'
import { Conversation } from '@/components/inbox/Conversation'
import { Inspector } from '@/components/inbox/Inspector'
import { CommentsFeed } from '@/components/inbox/CommentsFeed'
import { useInboxState } from '@/hooks/inbox/useInboxState'
import { ReadMarker } from '@/components/inbox/ReadMarker'
import { LatestInboxRequest, InboxEventDeduplicator } from '@/lib/features/inbox/inbox-request'
import { InboxProCenter, type InboxView } from '@/components/inbox/InboxProCenter'
import { subscribeWhileVisible } from '@/lib/realtime-visibility'
import { isFacebookSystemDisclosure } from '@/lib/integrations/facebook/message-window'

export type Preview = Pick<MessageRow, 'sender' | 'body' | 'attachments' | 'created_at'>
export type ChatSummary = {
  customer: CustomerRow
  preview: Preview | null
  latestSlip: SlipStatus | null
}
export type CommentItem = {
  id: string
  tenant_id: string | null
  author_name: string | null
  body: string | null
  created_at: string
}
export type ActiveTenant = { id: string; name: string; autoVerify: boolean; autoReply: boolean }

const byRecent = (a: ChatSummary, b: ChatSummary) =>
  (b.customer.last_message_at ?? '').localeCompare(a.customer.last_message_at ?? '')
const newestFirst = (a: SlipRow, b: SlipRow) => b.created_at.localeCompare(a.created_at)

/**
 * The inbox screen: chat list | conversation | inspector.
 * All state and the single Realtime channel live here; the columns are presentational.
 */
export function InboxClient({
  initialChats,
  initialComments,
  initialSelectedId,
  tenant,
}: {
  initialChats: ChatSummary[]
  initialComments: CommentItem[]
  initialSelectedId: string | null
  tenant: ActiveTenant | null
}) {
  const tenantId = tenant?.id
  const db = useMemo(() => supabaseBrowser(), [])
  const [tab, setTab] = useState<'chat' | 'comments'>('chat')
  const [view, setView] = useState<InboxView>('all')
  const [chats, setChats] = useState(initialChats)
  const [comments, setComments] = useState(initialComments)
  const [selectedId, setSelectedId] = useState(initialSelectedId)
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [syncingCustomerId, setSyncingCustomerId] = useState<string | 'all' | null>(null)
  const [syncError, setSyncError] = useState('')
  const [slips, setSlips] = useState<SlipRow[]>([])
  const [threadState, setThreadState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [focusedSlipId, setFocusedSlipId] = useState<string | null>(null)
  // below md only one column fits (list or chat); below xl the inspector is a slide-over
  const [mobileChat, setMobileChat] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  useEffect(() => {
    if (!inspectorOpen) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setInspectorOpen(false)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [inspectorOpen])
  const selectedRef = useRef(selectedId)
  const knownCustomers = useRef(new Set(initialChats.map((chat) => chat.customer.id)))
  const customerMessageAt = useRef(
    new Map(initialChats.map((chat) => [chat.customer.id, chat.customer.last_message_at])),
  )
  const changes = useRef(new Map<string, ThreadChange>())
  const revision = useRef(0)
  const threadRequest = useRef(0)
  const syncBusy = useRef(false)
  const syncAttempted = useRef(new Set<string>())
  const threadLoadedFor = useRef<string | null>(null)
  const threadGate = useRef(new LatestInboxRequest())
  const olderGate = useRef(new LatestInboxRequest())
  const listBusy = useRef(false)
  const olderBusy = useRef(false)
  const [connection, setConnection] = useState<
    'connecting' | 'realtime' | 'polling' | 'offline'
  >('connecting')
  const inbox = useInboxState(
    tenant?.id,
    chats.map((chat) => chat.customer.id),
  )
  const refreshInbox = inbox.refresh
  const refreshMetadata = useRef(inbox.refreshSoon)
  refreshMetadata.current = inbox.refreshSoon
  useEffect(() => {
    const refresh = () => {
      void refreshInbox()
    }
    window.addEventListener('inbox:refresh', refresh)
    return () => window.removeEventListener('inbox:refresh', refresh)
  }, [refreshInbox])
  const [olderLoading, setOlderLoading] = useState(false)
  const [olderError, setOlderError] = useState('')
  const [olderEnd, setOlderEnd] = useState(false)
  const [listLoading, setListLoading] = useState(false)
  const [listEnd, setListEnd] = useState(initialChats.length < 150)
  const [searchQuery, setSearchQuery] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [filterCounts, setFilterCounts] = useState<Partial<Record<InboxView, number>>>({})
  const [syncNotice, setSyncNotice] = useState('')
  const listCursor = useRef(initialChats.at(-1)?.customer)
  const discover = useCallback((items: ChatSummary[]) => {
    for (const item of items) knownCustomers.current.add(item.customer.id)
    setChats((previous) =>
      [
        ...previous,
        ...items.filter((item) => !previous.some((row) => row.customer.id === item.customer.id)),
      ].sort(byRecent),
    )
  }, [])
  async function loadMoreChats() {
    const cursor = listCursor.current
    if (!tenant || !cursor || listBusy.current) return
    listBusy.current = true
    setListLoading(true)
    try {
      const res = await fetch(
        `/api/inbox/conversations?tenantId=${tenant.id}&before=${encodeURIComponent(cursor.last_message_at ?? 'null')}&beforeId=${cursor.id}`,
        { cache: 'no-store' },
      )
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'โหลดรายชื่อแชทไม่สำเร็จ')
      discover(result.chats)
      listCursor.current = result.chats.at(-1)?.customer
      setListEnd(!result.hasMore)
    } catch (e) {
      setOlderError(e instanceof Error ? e.message : 'โหลดรายชื่อแชทไม่สำเร็จ')
    } finally {
      listBusy.current = false
      setListLoading(false)
    }
  }

  // load the thread and the customer's slips when the selection changes
  const loadThread = useCallback(
    async (customerId: string, background = false) => {
      if (!tenantId) return
      if (!background) setThreadState('loading')
      const request = ++threadRequest.current
      const ticket = threadGate.current.begin()
      const since = revision.current
      const [m, s] = await Promise.all([
        // Server endpoint: it authorizes the tenant member and reads with the service role, so the
        // browser's RLS (which has no counterpart of the app-level feature override) can't blank
        // the thread. Returns the newest 100 oldest-first; flip to the newest-first shape below.
        fetch(`/api/inbox/conversations/${customerId}/messages`, {
          signal: ticket.signal,
          cache: 'no-store',
        })
          .then(async (res) => {
            if (!res.ok)
              return { data: null, hasMore: false, error: { code: `HTTP_${res.status}` } }
            const body = (await res.json()) as { messages?: unknown[]; hasMore?: boolean }
            return {
              data: [...(body.messages ?? [])].reverse(),
              hasMore: body.hasMore === true,
              error: null,
            }
          })
          .catch((error: unknown) => ({
            data: null,
            hasMore: false,
            error: { code: (error as Error)?.name ?? 'FETCH_FAILED' },
          })),
        db
          .from('slips')
          .select(SLIP_COLUMNS)
          .eq('customer_id', customerId)
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false })
          .limit(50)
          .abortSignal(ticket.signal),
      ])
      if (
        !ticket.current() ||
        selectedRef.current !== customerId ||
        request !== threadRequest.current
      )
        return
      if (s.error) console.error('[inbox] slips load failed', { code: s.error.code })
      if (m.error) {
        console.error('[inbox] thread load failed', { code: m.error.code })
        if (!background) setThreadState('error')
        return
      }
      setMessages((previous) => {
        const rows = (m.data ?? []) as unknown as MessageRow[]
        const oldest = rows.at(-1)?.created_at
        return reconcileThread(
          background && oldest
            ? [...previous.filter((row) => row.created_at < oldest), ...rows]
            : rows,
          changes.current,
          since,
          customerId,
        )
      })
      if (!background) setOlderEnd(!m.hasMore)
      if (!s.error) setSlips((s.data ?? []) as SlipRow[])
      threadLoadedFor.current = customerId
      setThreadState('idle')
    },
    [db, tenantId],
  )
  const syncMessages = useCallback(
    async (customerId?: string) => {
      if (!tenantId || syncBusy.current) return
      if (customerId) syncAttempted.current.add(customerId)
      syncBusy.current = true
      setSyncingCustomerId(customerId ?? 'all')
      setSyncError('')
      setSyncNotice('')
      try {
        const response = await fetch('/api/inbox/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId, ...(customerId ? { customerId } : {}) }),
        })
        const result = (await response.json().catch(() => null)) as {
          error?: string
          syncedMessages?: number
          partial?: boolean
          message?: string
        } | null
        if (!response.ok) throw new Error(result?.error || 'ซิงค์ข้อความจาก Facebook ไม่สำเร็จ')

        const listResponse = await fetch(
          `/api/inbox/conversations?tenantId=${encodeURIComponent(tenantId)}${
            customerId ? `&customerId=${encodeURIComponent(customerId)}` : ''
          }`,
          { cache: 'no-store' },
        )
        const listResult = (await listResponse.json().catch(() => null)) as {
          chats?: ChatSummary[]
          hasMore?: boolean
          error?: string
        } | null
        if (!listResponse.ok || !Array.isArray(listResult?.chats))
          throw new Error(listResult?.error || 'โหลดรายชื่อแชทหลังซิงค์ไม่สำเร็จ')

        if (customerId) {
          const refreshed = listResult.chats[0]
          if (refreshed) {
            setChats((previous) =>
              [refreshed, ...previous.filter((chat) => chat.customer.id !== customerId)].sort(
                byRecent,
              ),
            )
          }
          if (selectedRef.current === customerId) await loadThread(customerId)
        } else {
          setChats(listResult.chats.sort(byRecent))
          listCursor.current = listResult.chats.at(-1)?.customer
          setListEnd(!listResult.hasMore)
          if (selectedRef.current) await loadThread(selectedRef.current)
          else if (listResult.chats[0]) setSelectedId(listResult.chats[0].customer.id)
        }
        window.dispatchEvent(new Event('inbox:refresh'))
        if (result?.partial)
          setSyncNotice(
            result.message || 'บันทึกข้อความที่ดึงได้แล้ว แต่ยังซิงค์ไม่ครบ กรุณาซิงค์อีกครั้ง',
          )
      } catch (error) {
        setSyncError(error instanceof Error ? error.message : 'ซิงค์ข้อความจาก Facebook ไม่สำเร็จ')
      } finally {
        syncBusy.current = false
        setSyncingCustomerId(null)
      }
    },
    [loadThread, tenantId],
  )

  useEffect(() => {
    if (
      !selectedId ||
      threadLoadedFor.current !== selectedId ||
      threadState !== 'idle' ||
      messages.length > 0
    )
      return
    if (syncAttempted.current.has(selectedId)) return
    syncAttempted.current.add(selectedId)
    void syncMessages(selectedId)
  }, [messages.length, selectedId, syncMessages, threadState])

  useEffect(() => {
    if (!tenantId || chats.length > 0 || syncAttempted.current.has(`tenant:${tenantId}`)) return
    syncAttempted.current.add(`tenant:${tenantId}`)
    void syncMessages()
  }, [chats.length, syncMessages, tenantId])
  // Keep callbacks current without making subscription lifetime depend on them.
  const latestThreadLoader = useRef(loadThread)
  useEffect(() => {
    latestThreadLoader.current = loadThread
  }, [loadThread])

  useEffect(() => {
    const activeThreadGate = threadGate.current,
      activeOlderGate = olderGate.current
    selectedRef.current = selectedId
    changes.current.clear()
    threadLoadedFor.current = null
    threadRequest.current++
    setMessages([])
    setSlips([])
    setFocusedSlipId(null)
    setOlderEnd(false)
    setOlderError('')
    olderGate.current.cancel()
    olderBusy.current = false
    setOlderLoading(false)
    setInspectorOpen(false)
    if (selectedId) void loadThread(selectedId)
    return () => {
      activeThreadGate.cancel()
      activeOlderGate.cancel()
    }
  }, [selectedId, loadThread, tenantId])

  // one Realtime channel for everything on this screen
  useEffect(() => {
    if (!tenantId) {
      console.warn('[inbox/realtime] subscription skipped: tenant unavailable')
      return
    }
    return subscribeWhileVisible(() => {
      const db = supabaseBrowser()
      const snapshotController = new AbortController()
      const mine = (rowTenantId: string | null) => rowTenantId === tenantId
      const loadThread = (customerId: string, background = false) =>
        latestThreadLoader.current(customerId, background)
      setConnection('connecting')
      let disposed = false
      let recovering = false
      let live = false
      let lastRecovery = 0
      const customerRequests = new Map<string, Promise<void>>()
      const recentMessages = new Map<string, { revision: number; message: MessageRow }>()
      const events = new InboxEventDeduplicator()
      const scope = `tenant_id=eq.${tenantId}`
      const replayPreview = (chat: ChatSummary, since: number) => {
        const event = recentMessages.get(chat.customer.id)
        return event &&
          event.revision > since &&
          event.message.created_at >= (chat.preview?.created_at ?? '')
          ? {
              ...chat,
              preview: event.message,
              customer: {
                ...chat.customer,
                last_message_at:
                  event.message.created_at > (chat.customer.last_message_at ?? '')
                    ? event.message.created_at
                    : chat.customer.last_message_at,
              },
            }
          : chat
      }
      const chatSnapshot = async (params = '') => {
        const requestController = new AbortController()
        const abortRequest = () => requestController.abort()
        snapshotController.signal.addEventListener('abort', abortRequest, { once: true })
        if (snapshotController.signal.aborted) abortRequest()
        const timeout = setTimeout(abortRequest, 10000)
        const snapshotStarted = Date.now()
        try {
          const response = await fetch(
            `/api/inbox/conversations?tenantId=${encodeURIComponent(tenantId)}${params}`,
            { cache: 'no-store', signal: requestController.signal },
          )
          console.info('[inbox/snapshot]', { status: response.status, durationMs: Date.now() - snapshotStarted })
          const data = (await response.json().catch(() => null)) as {
            chats?: ChatSummary[]
            comments?: CommentItem[]
            hasMore?: boolean
            error?: string
          } | null
          if (!response.ok || !data || !Array.isArray(data.chats))
            throw new Error(data?.error || 'โหลดรายชื่อแชทไม่สำเร็จ')
          return data
        } finally {
          clearTimeout(timeout)
          snapshotController.signal.removeEventListener('abort', abortRequest)
        }
      }
      const fetchCustomer = async (id: string) => {
        const since = revision.current
        let data: { chats?: ChatSummary[] }
        try {
          data = await chatSnapshot(`&customerId=${encodeURIComponent(id)}`)
        } catch {
          if (!disposed) console.error('[inbox] customer refresh failed')
          return
        }
        if (disposed) return
        const refreshed = data.chats?.[0]
        if (!refreshed) {
          knownCustomers.current.delete(id)
          customerMessageAt.current.delete(id)
          recentMessages.delete(id)
          setChats((prev) => prev.filter((chat) => chat.customer.id !== id))
          setSelectedId((previous) => (previous === id ? null : previous))
          return
        }
        const chat = replayPreview(refreshed, since)
        knownCustomers.current.add(id)
        customerMessageAt.current.set(id, chat.customer.last_message_at)
        setChats((prev) => [chat, ...prev.filter((item) => item.customer.id !== id)].sort(byRecent))
        setSelectedId((prev) => prev ?? id)
      }
      // Customer INSERT, message INSERT and profile UPDATE can arrive together.
      const refreshCustomer = (id: string) => {
        const pending = customerRequests.get(id)
        if (pending) return pending
        const request = fetchCustomer(id).finally(() => customerRequests.delete(id))
        customerRequests.set(id, request)
        return request
      }
      const recover = async () => {
        if (disposed || recovering || document.visibilityState === 'hidden') return
        recovering = true
        lastRecovery = Date.now()
        const startingIds = new Set(knownCustomers.current)
        const since = revision.current
        try {
          const snapshot = await chatSnapshot('&includeComments=true')
          if (disposed) return
          if (!live) setConnection('polling')
          if (Array.isArray(snapshot.comments)) setComments(snapshot.comments)
          const next = (snapshot.chats ?? []).map((chat) => replayPreview(chat, since))
          const arrived = new Set([...knownCustomers.current].filter((id) => !startingIds.has(id)))
          const oldest = next.at(-1)?.customer
          knownCustomers.current = new Set([...next.map((chat) => chat.customer.id), ...arrived])
          customerMessageAt.current = new Map(
            next.map((chat) => [chat.customer.id, chat.customer.last_message_at]),
          )
          setChats((previous) =>
            [
              ...next,
              ...previous.filter(
                (chat) =>
                  !next.some((item) => item.customer.id === chat.customer.id) &&
                  (arrived.has(chat.customer.id) ||
                    (snapshot.hasMore === true &&
                      oldest &&
                      ((chat.customer.last_message_at ?? '') < (oldest.last_message_at ?? '') ||
                        (chat.customer.last_message_at === oldest.last_message_at &&
                          chat.customer.id < oldest.id)))),
              ),
            ].sort(byRecent),
          )
          setSelectedId((current) => current ?? next[0]?.customer.id ?? null)
          const selected = selectedRef.current
          if (selected) {
            if (!next.some((chat) => chat.customer.id === selected)) await refreshCustomer(selected)
            if (!disposed && selectedRef.current === selected) void loadThread(selected, true)
          }
        } catch (error) {
          if (!disposed) {
            if (!live) setConnection('offline')
            const code = error && typeof error === 'object' && 'code' in error &&
              typeof error.code === 'string' && /^[A-Z0-9_-]{1,40}$/.test(error.code)
              ? error.code
              : undefined
            console.warn('[inbox] snapshot recovery failed', {
              errorType: error instanceof Error ? error.name : 'unknown',
              code,
            })
          }
        } finally {
          recovering = false
        }
      }
      const apply = (message: MessageRow) => {
        if (isFacebookSystemDisclosure(message.body)) return
        if (disposed || !events.accept(message.id, message)) return
        void refreshMetadata.current?.()
        const version = ++revision.current
        const recent = recentMessages.get(message.customer_id)
        if (!recent || message.created_at >= recent.message.created_at)
          recentMessages.set(message.customer_id, { revision: version, message })
        if (recentMessages.size > 300) recentMessages.delete(recentMessages.keys().next().value!)
        // The selected thread may be outside the latest 150-customer snapshot.
        // Apply its event before asynchronous customer hydration completes.
        if (message.customer_id === selectedRef.current) {
          changes.current.set(message.id, { revision: version, message })
          if (changes.current.size > 1000)
            changes.current.delete(changes.current.keys().next().value!)
          setMessages((prev) =>
            reconcileThread(
              prev,
              new Map([[message.id, { revision: 1, message }]]),
              0,
              message.customer_id,
            ),
          )
        }
        if (!knownCustomers.current.has(message.customer_id)) {
          void refreshCustomer(message.customer_id)
          return
        }
        setChats((prev) =>
          prev
            .map((chat) =>
              chat.customer.id === message.customer_id
                ? {
                    ...chat,
                    preview:
                      !chat.preview || message.created_at >= chat.preview.created_at
                        ? message
                        : chat.preview,
                    customer: {
                      ...chat.customer,
                      last_message_at:
                        message.created_at > (chat.customer.last_message_at ?? '')
                          ? message.created_at
                          : chat.customer.last_message_at,
                    },
                  }
                : chat,
            )
            .sort(byRecent),
        )
      }
      const channelName = inboxChannelName('inbox', tenantId)
      // Remove/recreate this channel when the active customer changes so the
      // thread's INSERT stream is scoped at the Realtime subscription itself.
      const channel = db.channel(channelName)
      if (selectedId) {
        channel.on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `customer_id=eq.${selectedId}`,
          },
          ({ new: row }) => {
            const m = row as MessageRow
            console.info('[inbox/realtime] message INSERT received', {
              matchesActiveConversation: m.customer_id === selectedRef.current,
              sender: m.sender,
            })
            apply(m)
          },
        )
      }
      channel
        // bot notices are rewritten when the Send API fails ("[ส่งไม่สำเร็จ] ...")
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'messages' },
          ({ new: row }) => {
            const m = row as MessageRow
            apply(m)
          },
        )
        // an admin reply the Send API rejected is deleted again (see /api/messages/send)
        .on(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'messages' },
          ({ old }) => {
            if (disposed || !old.id || !events.accept(String(old.id), null)) return
            for (const [customer, event] of recentMessages)
              if (event.message.id === old.id) recentMessages.delete(customer)
            changes.current.set(String(old.id), { revision: ++revision.current, message: null })
            if (changes.current.size > 1000)
              changes.current.delete(changes.current.keys().next().value!)
            setMessages((prev) => prev.filter((message) => message.id !== old.id))
            void recover()
          },
        )
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'comments', filter: scope },
          ({ new: row }) => {
            if (disposed) return
            const k = row as CommentItem
            if (mine(k.tenant_id))
              setComments((prev) => [k, ...prev.filter((item) => item.id !== k.id)].slice(0, 100))
          },
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'customers', filter: scope },
          (p) => {
            if (disposed) return
            void refreshMetadata.current?.()
            if (p.eventType === 'DELETE') {
              const id = String(p.old.id ?? '')
              knownCustomers.current.delete(id)
              customerMessageAt.current.delete(id)
              setChats((previous) => previous.filter((chat) => chat.customer.id !== id))
              setSelectedId((previous) => (previous === id ? null : previous))
              return
            }
            const c = p.new as CustomerRow
            if (mine(c.tenant_id)) {
              // Customer rows are the conversation list. Refresh their preview
              // after last_message_at changes; metadata refresh updates unread counts.
              if (
                !knownCustomers.current.has(c.id) ||
                customerMessageAt.current.get(c.id) !== c.last_message_at
              )
                void refreshCustomer(c.id)
              knownCustomers.current.add(c.id)
              customerMessageAt.current.set(c.id, c.last_message_at)
            } else knownCustomers.current.delete(c.id)
            setChats((prev) => {
              const existing = prev.find((x) => x.customer.id === c.id)
              const rest = prev.filter((x) => x.customer.id !== c.id)
              // a customer moved to another tenant leaves this list
              if (!mine(c.tenant_id)) return rest
              return [
                {
                  customer: c,
                  preview: existing?.preview ?? null,
                  latestSlip: existing?.latestSlip ?? null,
                },
                ...rest,
              ].sort(byRecent)
            })
            // the very first chat: open it so its messages show without a click
            if (mine(c.tenant_id)) setSelectedId((prev) => prev ?? c.id)
          },
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'slips', filter: scope },
          (p) => {
            if (disposed) return
            window.dispatchEvent(new Event('inbox:payments'))
            if (p.eventType === 'DELETE') return
            const s = p.new as SlipRow
            if (!s.customer_id || !mine(s.tenant_id)) return
            setChats((prev) =>
              prev.map((c) =>
                c.customer.id === s.customer_id ? { ...c, latestSlip: s.status } : c,
              ),
            )
            if (s.customer_id !== selectedRef.current) return
            setSlips((prev) =>
              [s, ...prev.filter((x) => x.id !== s.id)].sort(newestFirst).slice(0, 50),
            )
          },
        )
        .subscribe((status, err) => {
          if (disposed) return
          const errorCode = err && typeof err === 'object' && 'code' in err &&
            typeof err.code === 'string' && /^[A-Z0-9_-]{1,40}$/.test(err.code)
            ? err.code
            : undefined
          if (status === 'SUBSCRIBED') console.info('[inbox/realtime]', { status })
          else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status))
            console.warn('[inbox/realtime] channel disconnected', {
              status,
              errorCode,
            })
          if (status === 'SUBSCRIBED') {
            live = true
            setConnection('realtime')
            void recover()
          } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
            setConnection('offline')
            live = false
          }
        })
      const connectionWatchdog = setTimeout(() => {
        if (!disposed && !live)
          console.warn('[inbox/realtime] channel has not subscribed after 15 seconds')
      }, 15000)
      void recover()
      // Keep a safety snapshot for silent replication failures, but prefer events.
      const timer = setInterval(() => {
        if (document.visibilityState === 'hidden') return
        if (live && Date.now() - lastRecovery < 15000) return
        void recover()
      }, 5000)
      const onVisible = () => {
        if (document.visibilityState === 'visible') void recover()
      }
      window.addEventListener('online', recover)
      document.addEventListener('visibilitychange', onVisible)
      return () => {
        disposed = true
        snapshotController.abort()
        clearTimeout(connectionWatchdog)
        clearInterval(timer)
        window.removeEventListener('online', recover)
        document.removeEventListener('visibilitychange', onVisible)
        void db.removeChannel(channel)
      }
    })
  }, [tenantId, selectedId])

  const selectedCustomer = chats.find((c) => c.customer.id === selectedId)?.customer ?? null
  const currentState =
    inbox.data?.conversations.find((c) => c.id === selectedId) ??
    (selectedCustomer && selectedCustomer.conversation_version !== undefined
      ? {
          id: selectedCustomer.id,
          assigned_user_id: selectedCustomer.assigned_user_id ?? null,
          conversation_status: selectedCustomer.conversation_status ?? 'open',
          conversation_version: selectedCustomer.conversation_version,
          inbound_seq: selectedCustomer.inbound_seq ?? 0,
          bot_enabled: selectedCustomer.bot_enabled,
          unread_count: 0,
        }
      : undefined)
  const selected = selectedCustomer ? { ...selectedCustomer, ...(currentState ?? {}) } : null
  async function loadOlder() {
    const oldest = messages[0]
    if (!oldest || olderBusy.current || !selectedId) return
    olderBusy.current = true
    const ticket = olderGate.current.begin()
    const id = selectedId
    setOlderLoading(true)
    setOlderError('')
    try {
      const res = await fetch(
        `/api/inbox/conversations/${id}/messages?before=${encodeURIComponent(oldest.created_at)}&beforeId=${oldest.id}`,
        { cache: 'no-store', signal: ticket.signal },
      )
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'โหลดข้อความเก่าไม่สำเร็จ')
      if (!ticket.current() || selectedRef.current !== id) return
      setMessages((previous) =>
        reconcileThread([...result.messages, ...previous], new Map(), 0, id),
      )
      setOlderEnd(!result.hasMore)
    } catch (e) {
      if (ticket.current() && selectedRef.current === id)
        setOlderError(e instanceof Error ? e.message : 'โหลดข้อความเก่าไม่สำเร็จ')
    } finally {
      if (ticket.current()) {
        olderBusy.current = false
        setOlderLoading(false)
      }
    }
  }
  // the inspector follows the slip the admin clicked, else the newest one
  const inspectedSlipId = focusedSlipId ?? slips[0]?.id ?? null
  const inspectedSlip = slips.find((s) => s.id === inspectedSlipId) ?? null

  function openChat(id: string) {
    if (selectedRef.current === id) {
      setMobileChat(true)
      return
    }
    selectedRef.current = id
    threadGate.current.cancel()
    olderGate.current.cancel()
    setMessages([])
    setSlips([])
    setFocusedSlipId(null)
    setSelectedId(id)
    setMobileChat(true)
    setInspectorOpen(false)
  }

  function focusSlip(id: string) {
    setFocusedSlipId(id)
    setInspectorOpen(true)
  }

  // CRM edits come back from the API before Realtime does: apply right away
  function patchCustomer(c: CustomerRow) {
    setChats((prev) => prev.map((x) => (x.customer.id === c.id ? { ...x, customer: c } : x)))
  }

  if (tab === 'comments') {
    return <CommentsFeed comments={comments} onBack={() => setTab('chat')} />
  }

  return (
    <div data-inbox-version="v2" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {tenant && (
        <InboxProCenter
          compact={mobileChat}
          assignee={assigneeFilter}
          onAssignee={(value) => {
            setAssigneeFilter(value)
            setMobileChat(false)
          }}
          counts={filterCounts}
          autoReply={tenant.autoReply}
          onBulk={() => {
            setMobileChat(false)
            window.dispatchEvent(new Event('inbox:bulk'))
          }}
          tenantId={tenant.id}
          inbox={inbox.data}
          view={view}
          onView={(next) => {
            setView(next)
            setMobileChat(false)
          }}
        />
      )}
      {tenant && (
        <div className="flex flex-wrap items-center gap-2 px-3 pt-2">
          <Button
            variant="secondary"
            size="sm"
            loading={syncingCustomerId === 'all'}
            onClick={() => void syncMessages()}
          >
            Sync Messages
          </Button>
          {syncError && (
            <p role="alert" className="text-xs text-rose-700">
              {syncError}
            </p>
          )}
          {syncNotice && (
            <p role="status" className="text-xs text-amber-700">
              {syncNotice}
            </p>
          )}
        </div>
      )}
      {!inbox.data && (
        <div
          role={inbox.error ? 'alert' : 'status'}
          className="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-600"
        >
          {inbox.error || 'กำลังโหลดสถานะและผู้ดูแลแชท…'}
          {inbox.error && (
            <button
              type="button"
              onClick={() => void inbox.refresh()}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-orange-700"
            >
              ลองโหลดสถานะอีกครั้ง
            </button>
          )}
        </div>
      )}
      <div
        className={`relative mx-3 grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] md:grid-cols-[clamp(18rem,25vw,22rem)_minmax(0,1fr)] ${inspectorOpen ? 'xl:grid-cols-[clamp(18rem,25vw,22rem)_minmax(0,1fr)_clamp(17rem,22vw,19rem)]' : ''}`}
      >
        <ReadMarker
          customerId={selectedId}
          messages={messages}
          onRead={inbox.refreshSoon}
          mobileOpen={mobileChat}
        />
        {inbox.error && (
          <p
            role="alert"
            className="absolute top-1 left-2 z-20 rounded-lg bg-rose-50 p-2 text-xs text-rose-700"
          >
            {inbox.error}
          </p>
        )}
        {(connection === 'connecting' || connection === 'offline') && (
          <p
            role="status"
            className="absolute bottom-2 left-2 z-20 max-w-xs rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 shadow ring-1 ring-amber-200"
          >
            {connection === 'connecting'
              ? 'กำลังเชื่อมต่อแชทสดและตรวจข้อความใหม่อัตโนมัติ…'
              : 'แชทสดขัดข้อง ระบบกำลังตรวจข้อความใหม่อัตโนมัติ'}
          </p>
        )}
        <ChatList
          query={searchQuery}
          onQuery={(value) => {
            setSearchQuery(value)
            setMobileChat(false)
          }}
          assignee={assigneeFilter}
          onCounts={setFilterCounts}
          section={view}
          className={cn(mobileChat ? 'hidden' : 'flex', 'md:flex')}
          chats={chats}
          inbox={inbox.data}
          tenantId={tenant?.id}
          onDiscover={discover}
          onLoadMore={() => void loadMoreChats()}
          listLoading={listLoading}
          listEnd={listEnd}
          selectedId={selectedId}
          onOpen={openChat}
          commentCount={comments.length}
          onShowComments={() => setTab('comments')}
        />

        <Conversation
          key={`thread:${selectedId ?? 'empty'}`}
          className={cn(mobileChat ? 'flex' : 'hidden', 'md:flex')}
          customer={selected}
          inbox={inbox.data}
          conversationState={currentState}
          onStateChange={inbox.refresh}
          onConversationSaved={inbox.applyConversation}
          onLoadOlder={() => void loadOlder()}
          hasOlder={!olderEnd && messages.length > 0}
          olderLoading={olderLoading}
          olderError={olderError}
          tenant={tenant}
          messages={messages}
          slips={slips}
          state={threadState}
          focusedSlipId={inspectedSlipId}
          onRetry={() => selectedId && void loadThread(selectedId)}
          onSync={() => selectedId && void syncMessages(selectedId)}
          syncing={syncingCustomerId === selectedId}
          onBack={() => setMobileChat(false)}
          inspectorOpen={inspectorOpen}
          onOpenInspector={() => setInspectorOpen((open) => !open)}
          onFocusSlip={focusSlip}
        />

        {inspectorOpen && (
          <div
            aria-hidden
            className="fixed inset-0 z-30 bg-slate-900/20 backdrop-blur-sm xl:hidden"
            onClick={() => setInspectorOpen(false)}
          />
        )}
        <Inspector
          focusSlipId={focusedSlipId}
          key={`inspector:${selectedId ?? 'empty'}`}
          inbox={inbox.data}
          className={cn(
            inspectorOpen
              ? 'fixed inset-y-0 right-0 z-40 flex w-[min(22rem,100vw)] shadow-2xl'
              : 'hidden',
            inspectorOpen ? 'xl:static xl:z-auto xl:flex xl:w-auto xl:shadow-none' : 'xl:hidden',
          )}
          customer={selected}
          slips={slips}
          slip={inspectedSlip}
          onSelectSlip={setFocusedSlipId}
          onClose={() => setInspectorOpen(false)}
          onCustomerSaved={patchCustomer}
        />
      </div>
    </div>
  )
}
