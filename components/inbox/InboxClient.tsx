'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabaseBrowser } from '@/lib/supabase/browser'
import { CUSTOMER_COLUMNS, SLIP_COLUMNS, type CustomerRow, type MessageRow, type SlipRow, type SlipStatus } from '@/lib/types'
import { reconcileThread, type ThreadChange } from '@/lib/inbox-realtime'
import { cn } from '@/lib/utils'
import { ChatList } from './ChatList'
import { Conversation } from './Conversation'
import { Inspector } from './Inspector'
import { CommentsFeed } from './CommentsFeed'
import {useInboxState} from './useInboxState'
import {ReadMarker} from './ReadMarker'
import {LatestInboxRequest,InboxEventDeduplicator} from '@/lib/inbox-request'
import {InboxProCenter,type InboxView} from './InboxProCenter'

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
  const [view,setView]=useState<InboxView>('all')
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
  const knownCustomers = useRef(new Set(initialChats.map(chat => chat.customer.id)))
  const changes = useRef(new Map<string, ThreadChange>())
  const revision = useRef(0)
  const threadRequest = useRef(0)
  const threadGate = useRef(new LatestInboxRequest())
  const olderGate = useRef(new LatestInboxRequest())
  const listBusy = useRef(false)
  const olderBusy = useRef(false)
  const [connection, setConnection] = useState<'connecting'|'live'|'offline'>('connecting')
  const inbox=useInboxState(tenant?.id)
  const [olderLoading,setOlderLoading]=useState(false)
  const [olderError,setOlderError]=useState('')
  const [olderEnd,setOlderEnd]=useState(false)
  const [listLoading,setListLoading]=useState(false)
  const [listEnd,setListEnd]=useState(initialChats.length<150)
  const listCursor=useRef(initialChats.at(-1)?.customer)
  const discover=useCallback((items:ChatSummary[])=>{
    for(const item of items)knownCustomers.current.add(item.customer.id)
    setChats(previous=>[...previous,...items.filter(item=>!previous.some(row=>row.customer.id===item.customer.id))].sort(byRecent))
  },[])
  async function loadMoreChats(){
    const cursor=listCursor.current;if(!tenant||!cursor||listBusy.current)return
    listBusy.current=true
    setListLoading(true)
    try{
      const res=await fetch(`/api/inbox/conversations?tenantId=${tenant.id}&before=${encodeURIComponent(cursor.last_message_at??'null')}&beforeId=${cursor.id}`,{cache:'no-store'})
      const result=await res.json();if(!res.ok)throw new Error(result.error||'โหลดรายชื่อแชทไม่สำเร็จ')
      discover(result.chats);listCursor.current=result.chats.at(-1)?.customer;setListEnd(!result.hasMore)
    }catch(e){setOlderError(e instanceof Error?e.message:'โหลดรายชื่อแชทไม่สำเร็จ')}
    finally{listBusy.current=false;setListLoading(false)}
  }

  // Shared realtime events must match the selected Page's tenant exactly.
  const mine = useCallback((tenantId: string | null) => !!tenant && tenantId === tenant.id, [tenant])

  // load the thread and the customer's slips when the selection changes
  const loadThread = useCallback(
    async (customerId: string, background = false) => {
      if (!tenant) return
      if (!background) setThreadState('loading')
      const request = ++threadRequest.current
      const ticket = threadGate.current.begin()
      const since = revision.current
      const [m, s] = await Promise.all([
        // newest 200, shown oldest first
        db.from('messages').select('id, customer_id, sender, body, attachments, created_at, inbound_seq, provider_message_id, delivery_status, customers!inner(tenant_id)').eq('customer_id', customerId).eq('customers.tenant_id',tenant.id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(200).abortSignal(ticket.signal),
        db.from('slips').select(SLIP_COLUMNS).eq('customer_id', customerId).eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(50).abortSignal(ticket.signal),
      ])
      if (!ticket.current() || selectedRef.current !== customerId || request !== threadRequest.current) return
      if (m.error || s.error) {
        console.error('[inbox] thread load failed', m.error ?? s.error)
        if (!background) setThreadState('error')
        return
      }
      setMessages(previous=>{
        const rows=(m.data??[]) as unknown as MessageRow[]
        const oldest=rows.at(-1)?.created_at
        return reconcileThread(background&&oldest?[...previous.filter(row=>row.created_at<oldest),...rows]:rows,changes.current,since,customerId)
      })
      if(!background)setOlderEnd((m.data?.length??0)<200)
      setSlips((s.data ?? []) as SlipRow[])
      setThreadState('idle')
    },
    [db, tenant],
  )

  useEffect(() => {
    const activeThreadGate=threadGate.current,activeOlderGate=olderGate.current
    selectedRef.current = selectedId
    changes.current.clear()
    threadRequest.current++
    setMessages([])
    setSlips([])
    setFocusedSlipId(null)
    setOlderEnd(false)
    setOlderError('')
    olderGate.current.cancel()
    olderBusy.current=false
    setOlderLoading(false)
    setInspectorOpen(false)
    if (selectedId) void loadThread(selectedId)
    return () => { activeThreadGate.cancel(); activeOlderGate.cancel() }
  }, [selectedId, loadThread])

  // one Realtime channel for everything on this screen
  useEffect(() => {
    if (!tenant) return
    let disposed = false
    let recovering = false
    const recentMessages = new Map<string,{revision:number;message:MessageRow}>()
    const events = new InboxEventDeduplicator()
    const scope = `tenant_id=eq.${tenant.id}`
    const chatColumns = `${CUSTOMER_COLUMNS}, messages(sender,body,attachments,created_at), slips(status,created_at)`
    type Snapshot = CustomerRow & { messages: Preview[]; slips: {status: SlipStatus}[] }
    const summary = ({messages,slips,...customer}: Snapshot): ChatSummary => ({customer,preview:messages[0]??null,latestSlip:slips[0]?.status??null})
    const replayPreview = (chat:ChatSummary,since:number) => {
      const event=recentMessages.get(chat.customer.id)
      return event && event.revision>since && event.message.created_at>=(chat.preview?.created_at??'')
        ? {...chat,preview:event.message,customer:{...chat.customer,last_message_at:event.message.created_at>(chat.customer.last_message_at??'')?event.message.created_at:chat.customer.last_message_at}}:chat
    }
    const chatsQuery = () => db.from('customers').select(chatColumns).eq('tenant_id',tenant.id).eq('slips.tenant_id',tenant.id)
      .order('created_at',{ascending:false,referencedTable:'messages'}).limit(1,{referencedTable:'messages'})
      .order('created_at',{ascending:false,referencedTable:'slips'}).limit(1,{referencedTable:'slips'})
    const refreshCustomer = async (id: string) => {
      const since=revision.current
      const {data,error} = await chatsQuery().eq('id',id).maybeSingle()
      if (disposed || error) return
      if (!data) {
        knownCustomers.current.delete(id)
        recentMessages.delete(id)
        setChats(prev=>prev.filter(chat=>chat.customer.id!==id))
        return
      }
      const chat = replayPreview(summary(data as unknown as Snapshot),since)
      knownCustomers.current.add(id)
      setChats(prev=>[chat,...prev.filter(item=>item.customer.id!==id)].sort(byRecent))
      setSelectedId(prev=>prev??id)
    }
    const recover = async () => {
      if (disposed || recovering) return
      recovering = true
      const startingIds = new Set(knownCustomers.current)
      const since=revision.current
      try {
        const [customers,comments] = await Promise.all([
          chatsQuery().order('last_message_at',{ascending:false,nullsFirst:false}).limit(150),
          db.from('comments').select('id,tenant_id,author_name,body,created_at').eq('tenant_id',tenant.id).order('created_at',{ascending:false}).limit(100),
        ])
        if (disposed || customers.error || comments.error) return
        const next = ((customers.data??[]) as unknown as Snapshot[]).map(row=>replayPreview(summary(row),since))
        const arrived = new Set([...knownCustomers.current].filter(id=>!startingIds.has(id)))
        knownCustomers.current = new Set([...next.map(chat=>chat.customer.id),...arrived])
        setChats(previous=>[
          ...next,
          ...previous.filter(chat=>!next.some(item=>item.customer.id===chat.customer.id)),
        ].sort(byRecent))
        setComments((comments.data??[]) as CommentItem[])
        setSelectedId(current=>current??next[0]?.customer.id??null)
        const selected=selectedRef.current
        if(selected){await refreshCustomer(selected);if(!disposed&&selectedRef.current===selected)await loadThread(selected,true)}
      } catch { if (!disposed) console.error('[inbox] snapshot recovery failed') }
      finally { recovering=false }
    }
    const apply = (message: MessageRow) => {
      if (disposed || !events.accept(message.id,message)) return
      const version=++revision.current
      const recent=recentMessages.get(message.customer_id)
      if (!recent || message.created_at>=recent.message.created_at) recentMessages.set(message.customer_id,{revision:version,message})
      if (recentMessages.size>300) recentMessages.delete(recentMessages.keys().next().value!)
      if (!knownCustomers.current.has(message.customer_id)) { void refreshCustomer(message.customer_id); return }
      setChats(prev=>prev.map(chat=>chat.customer.id===message.customer_id?{
        ...chat,preview:!chat.preview || message.created_at>=chat.preview.created_at?message:chat.preview,
        customer:{...chat.customer,last_message_at:message.created_at>(chat.customer.last_message_at??'')?message.created_at:chat.customer.last_message_at},
      }:chat).sort(byRecent))
      if (message.customer_id!==selectedRef.current) return
      changes.current.set(message.id,{revision:version,message})
      if (changes.current.size>1000) changes.current.delete(changes.current.keys().next().value!)
      setMessages(prev=>reconcileThread(prev,new Map([[message.id,{revision:1,message}]]),0,message.customer_id))
    }
    const channel = db
      .channel(`inbox:${tenant.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: row }) => {
        const m = row as MessageRow
        apply(m)
      })
      // bot notices are rewritten when the Send API fails ("[ส่งไม่สำเร็จ] ...")
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, ({ new: row }) => {
        const m = row as MessageRow
        apply(m)
      })
      // an admin reply the Send API rejected is deleted again (see /api/messages/send)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, ({ old }) => {
        if (!old.id || !events.accept(String(old.id),null)) return
        for (const [customer,event] of recentMessages) if (event.message.id===old.id) recentMessages.delete(customer)
        changes.current.set(String(old.id),{revision:++revision.current,message:null})
        if (changes.current.size>1000) changes.current.delete(changes.current.keys().next().value!)
        setMessages(prev=>prev.filter(message=>message.id!==old.id))
        void recover()
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments', filter:scope }, ({ new: row }) => {
        const k = row as CommentItem
        if (mine(k.tenant_id)) setComments((prev) => [k, ...prev.filter(item=>item.id!==k.id)].slice(0,100))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, (p) => {
        if (p.eventType === 'DELETE') {
          const id = String(p.old.id??'')
          knownCustomers.current.delete(id)
          setChats(previous=>previous.filter(chat=>chat.customer.id!==id))
          setSelectedId(previous=>previous===id?null:previous)
          return
        }
        const c = p.new as CustomerRow
        if (mine(c.tenant_id)) { knownCustomers.current.add(c.id); void refreshCustomer(c.id) }
        else knownCustomers.current.delete(c.id)
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'slips', filter:scope }, (p) => {
        if (p.eventType === 'DELETE') return
        const s = p.new as SlipRow
        if (!s.customer_id || !mine(s.tenant_id)) return
        setChats((prev) => prev.map((c) => (c.customer.id === s.customer_id ? { ...c, latestSlip: s.status } : c)))
        if (s.customer_id !== selectedRef.current) return
        setSlips((prev) => [s, ...prev.filter((x) => x.id !== s.id)].sort(newestFirst).slice(0, 50))
      })
      .subscribe((status) => {
        if (disposed) return
        if (status==='SUBSCRIBED') { setConnection('live'); void recover() }
        else if (['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)) setConnection('offline')
        if (status === 'CHANNEL_ERROR') console.error('[inbox] Realtime channel error: is the table in the supabase_realtime publication?')
      })
    const timer = setInterval(()=>void recover(),30000)
    const onVisible=()=>{if(document.visibilityState==='visible')void recover()}
    window.addEventListener('online',recover)
    document.addEventListener('visibilitychange',onVisible)
    return () => {
      disposed=true
      clearInterval(timer)
      window.removeEventListener('online',recover)
      document.removeEventListener('visibilitychange',onVisible)
      void db.removeChannel(channel)
    }
  }, [db, mine, tenant, loadThread])

  const selectedCustomer = chats.find((c) => c.customer.id === selectedId)?.customer ?? null
  const currentState=inbox.data?.conversations.find(c=>c.id===selectedId)??(selectedCustomer&&selectedCustomer.conversation_version!==undefined?{id:selectedCustomer.id,assigned_user_id:selectedCustomer.assigned_user_id??null,conversation_status:selectedCustomer.conversation_status??'open',conversation_version:selectedCustomer.conversation_version,inbound_seq:selectedCustomer.inbound_seq??0,bot_enabled:selectedCustomer.bot_enabled,unread_count:0}:undefined)
  const selected=selectedCustomer?{...selectedCustomer,...(currentState??{})}:null
  async function loadOlder(){
    const oldest=messages[0];if(!oldest||olderBusy.current||!selectedId)return
    olderBusy.current=true
    const ticket=olderGate.current.begin()
    const id=selectedId;setOlderLoading(true);setOlderError('')
    try{
      const res=await fetch(`/api/inbox/conversations/${id}/messages?before=${encodeURIComponent(oldest.created_at)}&beforeId=${oldest.id}`,{cache:'no-store',signal:ticket.signal})
      const result=await res.json();if(!res.ok)throw new Error(result.error||'โหลดข้อความเก่าไม่สำเร็จ')
      if(!ticket.current()||selectedRef.current!==id)return
      setMessages(previous=>reconcileThread([...result.messages,...previous],new Map(),0,id));setOlderEnd(!result.hasMore)
    }catch(e){if(ticket.current()&&selectedRef.current===id)setOlderError(e instanceof Error?e.message:'โหลดข้อความเก่าไม่สำเร็จ')}
    finally{if(ticket.current()){olderBusy.current=false;setOlderLoading(false)}}
  }
  // the inspector follows the slip the admin clicked, else the newest one
  const inspectedSlipId = focusedSlipId ?? slips[0]?.id ?? null
  const inspectedSlip = slips.find((s) => s.id === inspectedSlipId) ?? null

  function openChat(id: string) {
    if(selectedRef.current===id){setMobileChat(true);return}
    selectedRef.current=id
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
    <div className="flex h-full min-h-0 flex-col">
    {tenant&&inbox.data?.proEnabled&&<InboxProCenter tenantId={tenant.id} inbox={inbox.data} view={view} onView={next=>{setView(next);if(next==='customers')setInspectorOpen(true);if(['all','mine','waiting','team'].includes(next))setMobileChat(false)}}/>}
    <div className="relative grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] md:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)_21rem] 2xl:grid-cols-[20rem_minmax(0,1fr)_24rem]">
      <ReadMarker customerId={selectedId} messages={messages} onRead={inbox.refresh} mobileOpen={mobileChat}/>
      {inbox.error&&<p role="alert" className="absolute top-1 left-2 z-20 rounded-lg bg-rose-50 p-2 text-xs text-rose-700">{inbox.error}</p>}
      {connection!=='live'&&<p role="status" className="absolute bottom-2 left-2 z-20 max-w-xs rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 shadow ring-1 ring-amber-200">{connection==='connecting'?'กำลังเชื่อมต่อแชทสด…':'การเชื่อมต่อแชทสดขัดข้อง ระบบจะตรวจข้อความใหม่ทุก 30 วินาที'}</p>}
      <ChatList
        section={view}
        className={cn(mobileChat ? 'hidden' : 'flex', 'md:flex')}
        chats={chats}
        inbox={inbox.data}
        tenantId={tenant?.id}
        onDiscover={discover}
        onLoadMore={()=>void loadMoreChats()}
        listLoading={listLoading}
        listEnd={listEnd}
        selectedId={selectedId}
        onOpen={openChat}
        commentCount={comments.length}
        onShowComments={() => setTab('comments')}
      />

      <Conversation
        key={`thread:${selectedId??'empty'}`}
        className={cn(mobileChat ? 'flex' : 'hidden', 'md:flex')}
        customer={selected}
        inbox={inbox.data}
        conversationState={currentState}
        onStateChange={inbox.refresh}
        onLoadOlder={()=>void loadOlder()}
        hasOlder={!olderEnd&&messages.length>0}
        olderLoading={olderLoading}
        olderError={olderError}
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
        key={`inspector:${selectedId??'empty'}`}
        inbox={inbox.data}
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
    </div>
  )
}
