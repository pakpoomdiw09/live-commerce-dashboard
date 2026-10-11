'use client'

import { useMemo, useState } from 'react'
import { BotOff, MessageCircle, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { chatBadge, type Tone } from '@/lib/status'
import type { OrderStatus } from '@/lib/types'
import { cn, customerName, listTime } from '@/lib/utils'
import { Avatar } from './Avatar'
import type { ChatSummary, Preview } from './InboxClient'

const SENDER = { customer: '', bot: 'บอท: ', agent: 'แอดมิน: ' } as const

const previewText = (p: Preview) => SENDER[p.sender] + (p.body ?? (p.attachments?.some((a) => a.type === 'image') ? '📷 ส่งรูปภาพ' : 'ส่งไฟล์แนบ'))

type Filter = 'all' | 'review' | 'paid' | 'shipped'
const FILTERS: { key: Filter; label: string; match: (s: OrderStatus, pending: boolean) => boolean }[] = [
  { key: 'all', label: 'ทั้งหมด', match: () => true },
  { key: 'review', label: 'รอตรวจ', match: (s, pending) => pending || s === 'pending_review' },
  { key: 'paid', label: 'ชำระแล้ว', match: (s) => s === 'paid' || s === 'approved' },
  { key: 'shipped', label: 'ส่งแล้ว', match: (s) => s === 'shipped' },
]

export function ChatList({
  chats,
  selectedId,
  onOpen,
  commentCount,
  onShowComments,
  className,
}: {
  chats: ChatSummary[]
  selectedId: string | null
  onOpen: (id: string) => void
  commentCount: number
  onShowComments: () => void
  className?: string
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const f = FILTERS.find((x) => x.key === filter)!
    return chats.filter(({ customer: c, latestSlip }) => {
      if (!f.match(c.order_status, latestSlip === 'pending')) return false
      if (!q) return true
      return customerName(c).toLowerCase().includes(q) || c.platform_user_id.includes(q) || (c.phone ?? '').includes(q)
    })
  }, [chats, query, filter])

  return (
    <aside aria-label="รายชื่อแชท" className={cn('min-h-0 flex-col border-r border-slate-200 bg-white', className)}>
      <div className="space-y-3 border-b border-slate-100 p-4">
        <div className="flex items-center justify-between">
          <h1 className="font-semibold text-slate-900">กล่องข้อความ</h1>
          <button type="button" onClick={onShowComments} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800">
            <MessageCircle className="h-3.5 w-3.5" aria-hidden />
            คอมเมนต์ ({commentCount})
          </button>
        </div>
        <label className="relative block">
          <span className="sr-only">ค้นหาแชท</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาชื่อ / เบอร์โทร"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pr-3 pl-9 text-sm placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:outline-none"
          />
        </label>
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
          const badge: { label: string; tone: Tone } = chatBadge(c.order_status, latestSlip)
          return (
            <li key={c.id}>
              <button
                onClick={() => onOpen(c.id)}
                aria-current={active || undefined}
                className={cn('flex w-full items-start gap-3 rounded-xl p-3 text-left transition-colors', active ? 'bg-emerald-50 ring-1 ring-emerald-200' : 'hover:bg-slate-50')}
              >
                <Avatar c={c} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium text-slate-900">{customerName(c)}</span>
                    {c.last_message_at && (
                      <time suppressHydrationWarning className="shrink-0 text-[11px] text-slate-400">
                        {listTime(c.last_message_at)}
                      </time>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">{preview ? previewText(preview) : 'ยังไม่มีข้อความ'}</span>
                  <span className="mt-1.5 flex items-center gap-1.5">
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
      </ul>
    </aside>
  )
}
