'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import type { FacebookLiveVideo } from '@/lib/integrations/facebook/live-videos'

const timeZone = 'Asia/Bangkok'
function videoTime(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'ไม่ระบุเวลาเริ่มไลฟ์'
  const date = new Date(value)
  const day = new Intl.DateTimeFormat('en-CA', { timeZone })
  if (day.format(date) === day.format(new Date()))
    return `วันนี้ ${date.toLocaleTimeString('th-TH', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false })} น.`
  return date.toLocaleString('th-TH-u-ca-gregory', {
    timeZone, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}
const shortId = (id: string) => id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id

/** Shared by CF and auction; selection is a video ID, never the displayed caption. */
export function LiveVideoSelect({
  videos, value, onChange, disabled = false, loading = false,
}: {
  videos: FacebookLiveVideo[]
  value: string
  onChange: (id: string) => void
  disabled?: boolean
  loading?: boolean
}) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const selected = videos.find((video) => video.id === value)
  const expanded = open && !disabled
  useEffect(() => {
    if (!expanded) return
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [expanded])
  useEffect(() => {
    if (expanded) document.getElementById(`${id}-option-${cursor}`)?.scrollIntoView({ block: 'nearest' })
  }, [expanded, cursor, id])
  function show() {
    setCursor(Math.max(0, videos.findIndex((video) => video.id === value)))
    setOpen(true)
  }
  function choose(video: FacebookLiveVideo) {
    onChange(video.id)
    setOpen(false)
    trigger.current?.focus()
  }
  return (
    <div ref={root} data-live-video-select className="relative mt-1.5 min-w-0"
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
      <button ref={trigger} type="button" role="combobox" aria-label="ไลฟ์สด Facebook"
        aria-expanded={expanded} aria-controls={`${id}-list`} aria-haspopup="listbox"
        aria-activedescendant={expanded && videos[cursor] ? `${id}-option-${cursor}` : undefined}
        data-selected-video-id={value} disabled={disabled}
        onClick={() => { trigger.current?.focus(); expanded ? setOpen(false) : show() }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
          else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault()
            if (!expanded) show()
            else setCursor((previous) => event.key === 'Home' ? 0 : event.key === 'End' ? Math.max(0, videos.length - 1)
              : Math.max(0, Math.min(videos.length - 1, previous + (event.key === 'ArrowDown' ? 1 : -1))))
          } else if (expanded && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            if (videos[cursor]) choose(videos[cursor])
          }
        }}
        className="flex min-h-16 w-full min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-left text-sm transition hover:border-orange-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60">
        <span className="min-w-0 flex-1" aria-label={value && !loading ? 'ไลฟ์สดที่เลือก' : undefined}>
          <span className="block truncate font-semibold text-slate-800">
            {loading ? 'กำลังโหลดไลฟ์…' : selected?.title || (value ? 'รายการที่เลือกไว้' : 'เลือกไลฟ์สดหรือวิดีโอล่าสุด')}
          </span>
          {value && !loading && (
            <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-normal">
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">กำลังเชื่อมต่อ</span>
              <span title={value} className="text-slate-400">รหัสวิดีโอ {shortId(value)}</span>
            </span>
          )}
        </span>
        <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-slate-400 transition ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div id={`${id}-list`} role="listbox" aria-label="รายการไลฟ์สด Facebook"
          className="absolute left-0 right-0 top-full z-50 mt-2 max-h-80 overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-900/15">
          {!videos.length && <p className="p-4 text-sm font-normal text-slate-500">ยังไม่พบรายการไลฟ์ กดโหลดรายการใหม่เพื่อตรวจอีกครั้ง</p>}
          {videos.map((video, index) => (
            <button key={video.id} id={`${id}-option-${index}`} type="button" role="option"
              aria-selected={video.id === value} tabIndex={-1}
              onPointerMove={() => setCursor(index)} onClick={() => choose(video)}
              className={`flex w-full min-w-0 items-start gap-2 rounded-lg p-3 text-left transition ${index === cursor ? 'bg-orange-50' : 'hover:bg-slate-50'} ${video.id === value ? 'ring-1 ring-inset ring-orange-200' : ''}`}>
              <span className="min-w-0 flex-1 space-y-1.5">
                <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-bold ${video.isLive ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-600'}`}>
                  {video.isLive ? '🔴 สด' : '⚪ สิ้นสุดแล้ว'}
                </span>
                <span className="line-clamp-2 break-words text-sm font-semibold text-slate-800">{video.title}</span>
                <span className="block text-xs font-normal text-slate-500">{videoTime(video.createdAt)}</span>
                <span title={video.id} className="block text-[10px] font-normal text-slate-400">รหัสวิดีโอ {shortId(video.id)}</span>
              </span>
              {video.id === value && <Check aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-orange-600" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
