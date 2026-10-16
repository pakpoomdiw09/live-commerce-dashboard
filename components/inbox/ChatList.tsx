'use client'

import { useEffect, useMemo, useState } from 'react'
import { BotOff, MessageCircle, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { chatBadge, type Tone } from '@/lib/status'
import { cn, customerName, listTime } from '@/lib/utils'
import { Avatar } from './Avatar'
import type { ChatSummary, Preview } from './InboxClient'
import type {InboxState} from '@/lib/inbox-types'
import {FacebookIcon} from '@/components/ui/FacebookIcon'

const SENDER = { customer: '', bot: 'บอท: ', agent: 'แอดมิน: ' } as const

const previewText = (p: Preview) => SENDER[p.sender] + (p.body ?? (p.attachments?.some((a) => a.type === 'image') ? '📷 ส่งรูปภาพ' : 'ส่งไฟล์แนบ'))

type Filter = 'all' | 'unread' | 'mine' | 'unassigned' | 'bot' | 'waiting' | 'closed'
const FILTERS: { key: Filter; label: string }[] = [
  {key:'all',label:'ทั้งหมด'},{key:'unread',label:'ยังไม่อ่าน'},{key:'mine',label:'ของฉัน'},
  {key:'unassigned',label:'ยังไม่รับ'},{key:'bot',label:'บอทดูแล'},{key:'waiting',label:'รอแอดมิน'},{key:'closed',label:'ปิดแล้ว'},
]

export function ChatList({
  chats,
  selectedId,
  onOpen,
  commentCount,
  onShowComments,
  className,
  inbox,tenantId,onDiscover,onLoadMore,listLoading,listEnd,section,
}: {
  chats: ChatSummary[]
  selectedId: string | null
  onOpen: (id: string) => void
  commentCount: number
  onShowComments: () => void
  className?: string
  inbox:InboxState|null
  tenantId:string|undefined
  onDiscover:(chats:ChatSummary[])=>void
  onLoadMore:()=>void
  listLoading:boolean
  listEnd:boolean
  section?:string
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  useEffect(()=>{setFilter(section==='mine'?'mine':section==='waiting'?'waiting':section==='ai'?'bot':'all')},[section])
  const [found,setFound]=useState<string[]>([])
  const [searchError,setSearchError]=useState(false)
  const [searching,setSearching]=useState(false)
  useEffect(()=>{
    setFound([]);setSearchError(false)
    if(!tenantId||query.trim().length<2){setSearching(false);return}
    const controller=new AbortController();setSearching(true)
    const timer=setTimeout(async()=>{try{
      const res=await fetch(`/api/inbox/search?tenantId=${tenantId}&q=${encodeURIComponent(query)}`,{signal:controller.signal,cache:'no-store'})
      if(!res.ok)throw new Error('search failed')
      const result=await res.json();if(controller.signal.aborted)return;setFound(result.customerIds);onDiscover(result.chats??[])
    }catch{if(!controller.signal.aborted)setSearchError(true)}finally{if(!controller.signal.aborted)setSearching(false)}},350)
    return()=>{clearTimeout(timer);controller.abort()}
  },[query,tenantId,onDiscover])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return chats.filter(({ customer: c, latestSlip }) => {
      const s=inbox?.conversations.find(row=>row.id===c.id)
      if(filter==='unread'&&!s?.unread_count||filter==='mine'&&(!s?.assigned_user_id||s.assigned_user_id!==inbox?.viewerId)||filter==='unassigned'&&(s?.assigned_user_id||s?.conversation_status==='closed')||filter==='bot'&&(!s?.bot_enabled||s.conversation_status==='closed')||filter==='waiting'&&(s?.bot_enabled||s?.assigned_user_id||s?.conversation_status==='closed'||s?.inbox_stage==='RESOLVED')||filter==='closed'&&s?.conversation_status!=='closed')return false
      if (!q) return true
      return found.includes(c.id)||customerName(c).toLowerCase().includes(q) || c.platform_user_id.includes(q) || (c.phone ?? '').includes(q)||(c.tags??[]).some(tag=>tag.toLowerCase().includes(q))
    })
  }, [chats, query, filter,inbox,found])

  return (
    <aside aria-label="รายชื่อแชท" className={cn('min-h-0 flex-col border-r border-slate-200 bg-white', className)}>
      <div className="space-y-3 border-b border-slate-100 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">รายชื่อลูกค้า</h2>
          <button type="button" onClick={onShowComments} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800">
            <MessageCircle className="h-3.5 w-3.5" aria-hidden />
            คอมเมนต์ ({commentCount})
          </button>
        </div>
        <p className="truncate text-xs text-slate-500">Facebook Messenger · {inbox?.pageName||'เพจที่เลือก'} · {chats.length} แชทล่าสุด</p>
        <label className="relative block">
          <span className="sr-only">ค้นหาแชท</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาชื่อ เบอร์ แท็ก หรือข้อความ"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pr-3 pl-9 text-sm placeholder:text-slate-400 focus:border-orange-500 focus:bg-white focus:ring-2 focus:ring-orange-500/20 focus:outline-none"
          />
        </label>
        {searching&&<p role="status" className="text-xs text-slate-500">กำลังค้นหาข้อความ…</p>}
        {searchError&&<p role="alert" className="text-xs text-rose-600">ค้นหาข้อความไม่สำเร็จ ยังค้นหาชื่อและเบอร์ได้</p>}
        <div role="tablist" aria-label="กรองตามสถานะ" className="flex gap-1 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition',
                filter === f.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <ul className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2">
        {visible.length === 0 && (
          <li className="px-4 py-10 text-center text-sm text-slate-500">{query || filter !== 'all' ? 'ไม่พบแชทที่ตรงเงื่อนไข' : 'ยังไม่มีแชท ข้อความแรกจากลูกค้าจะแสดงที่นี่'}</li>
        )}
        {visible.map(({ customer: c, preview, latestSlip }) => {
          const active = c.id === selectedId
          const state=inbox?.conversations.find(row=>row.id===c.id)
          const badge: { label: string; tone: Tone } = chatBadge(c.order_status, latestSlip)
          return (
            <li key={c.id}>
              <button
                onClick={() => onOpen(c.id)}
                aria-current={active || undefined}
                className={cn('flex w-full items-start gap-3 rounded-xl p-3 text-left transition-colors', active ? 'bg-orange-50 ring-1 ring-orange-200' : 'hover:bg-slate-50')}
              >
                <Avatar c={c} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium text-slate-900">{customerName(c)}</span>
                    {!!state?.unread_count&&<span className="rounded-full bg-orange-500 px-1.5 text-[10px] text-white">{state.unread_count>99?'99+':state.unread_count}</span>}
                    {c.last_message_at && (
                      <time suppressHydrationWarning className="shrink-0 text-[11px] text-slate-400">
                        {listTime(c.last_message_at)}
                      </time>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">{preview ? previewText(preview) : 'ยังไม่มีข้อความ'}</span>
                  <span className="mt-1.5 flex items-center gap-1.5">
                    <span className="inline-flex min-w-0 items-center gap-1 truncate text-[10px] text-blue-600"><FacebookIcon className="h-3 w-3 shrink-0"/>{inbox?.pageName||'Facebook'} · {state?.conversation_status==='closed'?'ปิดแล้ว':state?.assigned_user_id?inbox?.members.find(m=>m.id===state.assigned_user_id)?.name||'มีผู้ดูแล':'ยังไม่รับแชท'}</span>
                    {c.order_status !== 'new' || latestSlip === 'pending' ? <Badge tone={badge.tone}>{badge.label}</Badge> : null}
                    {!c.bot_enabled && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-500" title="แอดมินดูแลแชทนี้เอง">
                        <BotOff className="h-3 w-3" aria-hidden />
                        ปิดบอท
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
        {!query&&!listEnd&&<li><button onClick={onLoadMore} disabled={listLoading} className="w-full rounded-lg p-3 text-xs text-orange-700 hover:bg-orange-50 disabled:opacity-50">{listLoading?'กำลังโหลด…':'โหลดแชทเพิ่มเติม'}</button></li>}
      </ul>
    </aside>
  )
}
