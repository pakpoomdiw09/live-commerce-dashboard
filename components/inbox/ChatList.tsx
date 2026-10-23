'use client'
import { matchesInboxFilter } from '@/lib/features/inbox/inbox-list'
import { INBOX_VIEWS, type InboxView } from '@/components/inbox/InboxProCenter'

import { useEffect, useMemo, useState } from 'react'
import { BulkActions } from '@/components/inbox/BulkActions'
import { BotOff, MessageCircle, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { chatBadge, type Tone } from '@/lib/status'
import { cn, customerName, listTime } from '@/lib/utils'
import { Avatar } from '@/components/inbox/Avatar'
import type { ChatSummary, Preview } from '@/components/inbox/InboxClient'
import type { InboxState } from '@/lib/features/inbox/inbox-types'
import { FacebookIcon } from '@/components/ui/FacebookIcon'

const SENDER = { customer: '', bot: 'ระบบอัตโนมัติ: ', agent: 'แอดมิน: ' } as const

const previewText = (p: Preview) =>
  SENDER[p.sender] +
  (p.body ?? (p.attachments?.some((a) => a.type === 'image') ? '📷 ส่งรูปภาพ' : 'ส่งไฟล์แนบ'))

export function ChatList({
  chats,
  selectedId,
  onOpen,
  commentCount,
  onShowComments,
  className,
  inbox,
  tenantId,
  onDiscover,
  onLoadMore,
  listLoading,
  listEnd,
  section,
  query,
  onQuery,
  assignee,
  onCounts,
}: {
  chats: ChatSummary[]
  selectedId: string | null
  onOpen: (id: string) => void
  commentCount: number
  onShowComments: () => void
  className?: string
  inbox: InboxState | null
  tenantId: string | undefined
  onDiscover: (chats: ChatSummary[]) => void
  onLoadMore: () => void
  listLoading: boolean
  listEnd: boolean
  section?: string
  query: string
  onQuery: (value: string) => void
  assignee: string
  onCounts: (counts: Partial<Record<InboxView, number>>) => void
}) {
  const [metadataReady, setMetadataReady] = useState(false)
  const [paymentIds, setPaymentIds] = useState<string[]>([])
  const [stars, setStars] = useState<string[]>([])
  const [paidIds, setPaidIds] = useState<string[]>([])
  const [followUpIds, setFollowUpIds] = useState<string[]>([])
  const [starsError, setStarsError] = useState('')
  useEffect(() => {
    setMetadataReady(false)
    setStars([])
    setPaymentIds([])
    setPaidIds([])
    setFollowUpIds([])
    setStarsError('')
    if (!tenantId) return
    const controller = new AbortController()
    let sequence = 0
    let loading = false
    let scheduled: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      if (loading || controller.signal.aborted || document.visibilityState === 'hidden') return
      loading = true
      const request = ++sequence
      try {
        const response = await fetch('/api/inbox/stars?tenantId=' + encodeURIComponent(tenantId), {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error('โหลดข้อมูลตัวกรองไม่สำเร็จ')
        const data = await response.json()
        if (controller.signal.aborted || request !== sequence) return
        setStars(data.customerIds ?? [])
        setPaymentIds(data.pendingPaymentIds ?? [])
        setPaidIds(data.paidCustomerIds ?? [])
        setFollowUpIds(data.followUpCustomerIds ?? [])
        setMetadataReady(true)
        setStarsError(
          [
            data.limited ? 'แสดงข้อมูลตัวกรองสูงสุด 1,000 รายการ' : '',
            data.followUpAvailable === false ? 'การติดตามผลยังไม่พร้อมใช้งาน' : '',
          ]
            .filter(Boolean)
            .join(' · '),
        )
      } catch (error) {
        if (!controller.signal.aborted && request === sequence)
          setStarsError(error instanceof Error ? error.message : 'โหลดข้อมูลตัวกรองไม่สำเร็จ')
      } finally {
        loading = false
      }
    }
    const refresh = () => {
      clearTimeout(scheduled)
      scheduled = setTimeout(() => void load(), 150)
    }
    const events = ['inbox:stars', 'inbox:follow-ups', 'inbox:payments', 'online']
    void load()
    for (const event of events) window.addEventListener(event, refresh)
    const timer = setInterval(refresh, 120000)
    return () => {
      controller.abort()
      clearTimeout(scheduled)
      clearInterval(timer)
      for (const event of events) window.removeEventListener(event, refresh)
    }
  }, [tenantId])
  const [chosen, setChosen] = useState<string[]>([])
  const [bulk, setBulk] = useState(false)
  const filter = section ?? 'all'
  useEffect(() => {
    const open = () => setBulk(true)
    window.addEventListener('inbox:bulk', open)
    return () => window.removeEventListener('inbox:bulk', open)
  }, [])
  const [found, setFound] = useState<string[]>([])
  const [searchError, setSearchError] = useState(false)
  const [searching, setSearching] = useState(false)
  useEffect(() => {
    setFound([])
    setSearchError(false)
    if (!tenantId || query.trim().length < 2) {
      setSearching(false)
      return
    }
    const controller = new AbortController()
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/inbox/search?tenantId=${tenantId}&q=${encodeURIComponent(query)}`,
          { signal: controller.signal, cache: 'no-store' },
        )
        if (!res.ok) throw new Error('search failed')
        const result = await res.json()
        if (controller.signal.aborted) return
        setFound(result.customerIds)
        onDiscover(result.chats ?? [])
      } catch {
        if (!controller.signal.aborted) setSearchError(true)
      } finally {
        if (!controller.signal.aborted) setSearching(false)
      }
    }, 350)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, tenantId, onDiscover])

  const conversationStates = useMemo(
    () => new Map(inbox?.conversations.map((state) => [state.id, state]) ?? []),
    [inbox?.conversations],
  )
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return chats.filter(({ customer: c }) => {
      const s = conversationStates.get(c.id)
      if (
        !matchesInboxFilter(
          filter,
          c.id,
          s,
          inbox?.viewerId,
          paymentIds,
          stars,
          paidIds,
          followUpIds,
        )
      )
        return false
      if (
        (assignee === 'unassigned' && s?.assigned_user_id) ||
        (assignee !== 'all' && assignee !== 'unassigned' && s?.assigned_user_id !== assignee)
      )
        return false
      if (!q) return true
      return (
        found.includes(c.id) ||
        customerName(c).toLowerCase().includes(q) ||
        c.platform_user_id.includes(q) ||
        (c.phone ?? '').includes(q) ||
        (c.tags ?? []).some((tag) => tag.toLowerCase().includes(q))
      )
    })
  }, [
    chats,
    query,
    filter,
    inbox,
    found,
    stars,
    paymentIds,
    paidIds,
    followUpIds,
    assignee,
    conversationStates,
  ])

  const counts = useMemo(() => {
    const result: Partial<Record<InboxView, number>> = {}
    for (const [key] of INBOX_VIEWS) {
      if (
        ((key === 'tracked' || key === 'paid') && !metadataReady) ||
        (key !== 'all' && key !== 'tracked' && key !== 'paid' && !inbox)
      )
        continue
      result[key] = chats.filter(({ customer }) =>
        matchesInboxFilter(
          key,
          customer.id,
          conversationStates.get(customer.id),
          inbox?.viewerId,
          paymentIds,
          stars,
          paidIds,
          followUpIds,
        ),
      ).length
    }
    return result
  }, [chats, inbox, paymentIds, stars, paidIds, followUpIds, metadataReady, conversationStates])
  useEffect(() => {
    onCounts(counts)
  }, [counts, onCounts])
  return (
    <aside
      aria-label="รายชื่อแชท"
      className={cn('min-h-0 min-w-0 flex-col border-r border-slate-200 bg-white', className)}
    >
      <div className="space-y-1 border-b border-slate-100 py-2 pr-2">
        <div className="flex items-center justify-between gap-1">
          <h2 className="min-w-0 truncate text-sm font-semibold text-slate-900">ข้อความล่าสุด</h2>
          <button
            type="button"
            onClick={onShowComments}
            className="flex shrink-0 items-center gap-1 rounded-lg px-1 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <MessageCircle className="h-3.5 w-3.5" aria-hidden />
            ความคิดเห็น ({commentCount})
          </button>
        </div>
        {starsError && (
          <p role="alert" className="text-xs text-rose-600">
            {starsError}
          </p>
        )}
        {searching && (
          <p role="status" className="text-xs text-slate-500">
            กำลังค้นหาข้อความ…
          </p>
        )}
        {searchError && (
          <p role="alert" className="text-xs text-rose-600">
            ค้นหาข้อความไม่สำเร็จ ยังค้นหาชื่อและเบอร์ได้
          </p>
        )}
      </div>

      <div className="border-b border-slate-100 py-1.5 pr-2">
        <label className="relative block">
          <span className="sr-only">ค้นหาแชท</span>
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            aria-label="ค้นหาแชท"
            placeholder="ค้นหาชื่อ"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            className="h-9 w-full min-w-0 rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-2.5 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 md:h-8"
          />
        </label>
      </div>
      {bulk && inbox?.proEnabled && (
        <div className="space-y-1.5 border-b border-slate-100 px-3 py-2">
          <button
            type="button"
            className="rounded-md py-1 text-xs text-orange-700 hover:text-orange-900 focus-visible:outline-2 focus-visible:outline-orange-500"
            onClick={() => {
              setBulk(false)
              setChosen([])
            }}
          >
            ยกเลิกการเลือก
          </button>
          <BulkActions
            ids={chosen}
            inbox={inbox}
            onDone={() => window.dispatchEvent(new Event('inbox:refresh'))}
          />
        </div>
      )}
      <p className="pt-1.5 pr-2 text-[11px] text-slate-400">
        {query || filter !== 'all' || assignee !== 'all'
          ? `พบ ${visible.length} แชท`
          : listEnd
            ? `แสดงทั้งหมด ${chats.length} แชท`
            : `แสดง ${chats.length} แชท · ยังมีรายการเพิ่มเติม`}
      </p>
      <ul className="scrollbar-thin min-h-0 flex-1 overflow-y-auto py-2 pr-2">
        {visible.length === 0 && (
          <li className="px-4 py-10 text-center text-sm text-slate-500">
            {query || filter !== 'all'
              ? 'ไม่พบแชทที่ตรงเงื่อนไข'
              : 'ยังไม่มีแชท ข้อความแรกจากลูกค้าจะแสดงที่นี่'}
          </li>
        )}
        {visible.map(({ customer: c, preview, latestSlip }) => {
          const active = c.id === selectedId
          const state = conversationStates.get(c.id)
          const badge: { label: string; tone: Tone } = chatBadge(c.order_status, latestSlip)
          return (
            <li key={c.id} className="relative">
              {bulk && (
                <label className="flex items-center gap-2 px-3 pt-2 text-xs text-slate-500">
                  <input
                    type="checkbox"
                    aria-label={`เลือก ${customerName(c)}`}
                    checked={chosen.includes(c.id)}
                    disabled={!chosen.includes(c.id) && chosen.length >= 20}
                    onChange={(e) =>
                      setChosen((prev) =>
                        e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id),
                      )
                    }
                  />
                  เลือกแชท
                </label>
              )}
              <button
                onClick={() => onOpen(c.id)}
                aria-current={active || undefined}
                className={cn(
                  'flex w-full min-w-0 items-start gap-2 rounded-xl p-2.5 text-left transition-colors',
                  active ? 'bg-orange-50 ring-1 ring-orange-200' : 'hover:bg-slate-50',
                )}
              >
                <Avatar c={c} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium text-slate-900">
                      {stars.includes(c.id) && (
                        <span aria-label="ติดดาว" className="mr-1 text-orange-500">
                          ★
                        </span>
                      )}
                      {customerName(c)}
                    </span>
                    {!!state?.unread_count && (
                      <span className="rounded-full bg-orange-500 px-1.5 text-[10px] text-white">
                        {state.unread_count > 99 ? '99+' : state.unread_count}
                      </span>
                    )}
                    {c.last_message_at && (
                      <time
                        suppressHydrationWarning
                        className="shrink-0 text-[11px] text-slate-400"
                      >
                        {listTime(c.last_message_at)}
                      </time>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">
                    {preview ? previewText(preview) : 'ยังไม่มีข้อความ'}
                  </span>
                  <span className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1">
                    <span className="inline-flex min-w-0 items-center gap-1 truncate text-[10px] text-blue-600">
                      <FacebookIcon className="h-3 w-3 shrink-0" />
                      {inbox?.pageName || 'เฟซบุ๊ก'} ·{' '}
                      {state?.conversation_status === 'closed'
                        ? 'ปิดแล้ว'
                        : state?.assigned_user_id
                          ? inbox?.members.find((m) => m.id === state.assigned_user_id)?.name ||
                            'มีผู้ดูแล'
                          : 'ยังไม่รับแชท'}
                    </span>
                    {c.order_status !== 'new' || latestSlip === 'pending' ? (
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    ) : null}
                    {!c.bot_enabled && (
                      <span
                        className="inline-flex items-center gap-1 text-[11px] text-slate-500"
                        title="แอดมินดูแลแชทนี้เอง"
                      >
                        <BotOff className="h-3 w-3" aria-hidden />
                        ผู้ดูแลตอบเอง
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
        {!query && !listEnd && (
          <li>
            <button
              onClick={onLoadMore}
              disabled={listLoading}
              className="w-full rounded-lg p-3 text-xs text-orange-700 hover:bg-orange-50 disabled:opacity-50"
            >
              {listLoading ? 'กำลังโหลด…' : 'โหลดแชทเพิ่มเติม'}
            </button>
          </li>
        )}
      </ul>
    </aside>
  )
}
