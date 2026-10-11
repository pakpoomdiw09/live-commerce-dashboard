'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabaseBrowser } from '@/lib/supabase/browser'
import { SLIP_COLUMNS, type CustomerRow, type MessageRow, type SlipRow, type SlipStatus } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ChatList } from './ChatList'
import { Conversation } from './Conversation'
import { Inspector } from './Inspector'
import { CommentsFeed } from './CommentsFeed'

export type Preview = Pick<MessageRow, 'sender' | 'body' | 'attachments' | 'created_at'>
export type ChatSummary = { customer: CustomerRow; preview: Preview | null; latestSlip: SlipStatus | null }
export type CommentItem = { id: string; tenant_id: string | null; author_name: string | null; body: string | null; created_at: string }
export type ActiveTenant = { id: string; name: string; autoVerify: boolean; autoReply: boolean }

const byRecent = (a: ChatSummary, b: ChatSummary) => (b.customer.last_message_at ?? '').localeCompare(a.customer.last_message_at ?? '')
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
  const db = useMemo(() => supabaseBrowser(), [])
  const [tab, setTab] = useState<'chat' | 'comments'>('chat')
  const [chats, setChats] = useState(initialChats)
  const [comments, setComments] = useState(initialComments)
  const [selectedId, setSelectedId] = useState(initialSelectedId)
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [slips, setSlips] = useState<SlipRow[]>([])
  const [threadState, setThreadState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [focusedSlipId, setFocusedSlipId] = useState<string | null>(null)
  // below md only one column fits (list or chat); below xl the inspector is a slide-over
  const [mobileChat, setMobileChat] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const selectedRef = useRef(selectedId)

  // rows of other tenants arrive on the shared Realtime channel too; unassigned rows stay visible
  const mine = useCallback((tenantId: string | null) => !tenant || tenantId === null || tenantId === tenant.id, [tenant])

  // load the thread and the customer's slips when the selection changes
  const loadThread = useCallback(
    async (customerId: string) => {
      setThreadState('loading')
      const [m, s] = await Promise.all([
        // newest 200, shown oldest first
        db.from('messages').select('id, customer_id, sender, body, attachments, created_at').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(200),
        db.from('slips').select(SLIP_COLUMNS).eq('customer_id', customerId).order('created_at', { ascending: false }).limit(50),
      ])
      if (selectedRef.current !== customerId) return
      if (m.error || s.error) {
        console.error('[inbox] thread load failed', m.error ?? s.error)
        setThreadState('error')
        return
      }
      setMessages(((m.data ?? []) as MessageRow[]).reverse())
      setSlips((s.data ?? []) as SlipRow[])
      setThreadState('idle')
    },
    [db],
  )

  useEffect(() => {
    selectedRef.current = selectedId
    setMessages([])
    setSlips([])
    setFocusedSlipId(null)
    if (selectedId) void loadThread(selectedId)
  }, [selectedId, loadThread])

  // one Realtime channel for everything on this screen
  useEffect(() => {
    const channel = db
      .channel('inbox')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: row }) => {
        const m = row as MessageRow
        setChats((prev) => prev.map((c) => (c.customer.id === m.customer_id ? { ...c, preview: m } : c)))
        if (m.customer_id !== selectedRef.current) return
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
      })
      // bot notices are rewritten when the Send API fails ("[ส่งไม่สำเร็จ] ...")
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, ({ new: row }) => {
        const m = row as MessageRow
        setMessages((prev) => prev.map((x) => (x.id === m.id ? m : x)))
      })
      // an admin reply the Send API rejected is deleted again (see /api/messages/send)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, ({ old }) =>
        setMessages((prev) => prev.filter((x) => x.id !== (old as { id?: string }).id)),
      )
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments' }, ({ new: row }) => {
        const k = row as CommentItem
        if (mine(k.tenant_id)) setComments((prev) => [k, ...prev])
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, (p) => {
        if (p.eventType === 'DELETE') return
        const c = p.new as CustomerRow
        setChats((prev) => {
          const existing = prev.find((x) => x.customer.id === c.id)
          const rest = prev.filter((x) => x.customer.id !== c.id)
          // a customer moved to another tenant leaves this list
          if (!mine(c.tenant_id)) return rest
          return [{ customer: c, preview: existing?.preview ?? null, latestSlip: existing?.latestSlip ?? null }, ...rest].sort(byRecent)
        })
        // the very first chat: open it so its messages show without a click
        if (mine(c.tenant_id)) setSelectedId((prev) => prev ?? c.id)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'slips' }, (p) => {
        if (p.eventType === 'DELETE') return
        const s = p.new as SlipRow
        if (!s.customer_id || !mine(s.tenant_id)) return
        setChats((prev) => prev.map((c) => (c.customer.id === s.customer_id ? { ...c, latestSlip: s.status } : c)))
        if (s.customer_id !== selectedRef.current) return
        setSlips((prev) => [s, ...prev.filter((x) => x.id !== s.id)].sort(newestFirst).slice(0, 50))
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') console.error('[inbox] Realtime channel error: is the table in the supabase_realtime publication?')
      })
    return () => {
      void db.removeChannel(channel)
    }
  }, [db, mine])

  const selected = chats.find((c) => c.customer.id === selectedId)?.customer ?? null
  // the inspector follows the slip the admin clicked, else the newest one
  const inspectedSlipId = focusedSlipId ?? slips[0]?.id ?? null
  const inspectedSlip = slips.find((s) => s.id === inspectedSlipId) ?? null

  function openChat(id: string) {
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
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)] md:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)_21rem] 2xl:grid-cols-[20rem_minmax(0,1fr)_24rem]">
      <ChatList
        className={cn(mobileChat ? 'hidden' : 'flex', 'md:flex')}
        chats={chats}
        selectedId={selectedId}
        onOpen={openChat}
        commentCount={comments.length}
        onShowComments={() => setTab('comments')}
      />

      <Conversation
        className={cn(mobileChat ? 'flex' : 'hidden', 'md:flex')}
        customer={selected}
        tenant={tenant}
        messages={messages}
        slips={slips}
        state={threadState}
        focusedSlipId={inspectedSlipId}
        onRetry={() => selectedId && void loadThread(selectedId)}
        onBack={() => setMobileChat(false)}
        onOpenInspector={() => setInspectorOpen(true)}
        onFocusSlip={focusSlip}
      />

      {inspectorOpen && <div aria-hidden className="fixed inset-0 z-30 bg-slate-900/20 backdrop-blur-sm xl:hidden" onClick={() => setInspectorOpen(false)} />}
      <Inspector
        className={cn(
          inspectorOpen ? 'fixed inset-y-0 right-0 z-40 flex w-[min(24rem,100vw)] shadow-2xl' : 'hidden',
          'xl:static xl:z-auto xl:flex xl:w-auto xl:shadow-none',
        )}
        customer={selected}
        slips={slips}
        slip={inspectedSlip}
        onSelectSlip={setFocusedSlipId}
        onClose={() => setInspectorOpen(false)}
        onCustomerSaved={patchCustomer}
      />
    </div>
  )
}
