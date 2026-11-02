'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import type { FacebookLiveVideo } from '@/lib/integrations/facebook/live-videos'

const timeZone = 'Asia/Bangkok'
function videoStatus(video: FacebookLiveVideo) {
  if (!video.createdAt || !Number.isFinite(Date.parse(video.createdAt)))
    return video.isLive ? '🔴 สด • ไม่ระบุเวลา' : '⚪ สิ้นสุดแล้ว • ไม่ระบุวันที่'

  const date = new Date(video.createdAt)
  const time = date.toLocaleTimeString('th-TH', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  if (video.isLive) return `🔴 สด • วันนี้ ${time} น.`

  const day = date.toLocaleDateString('th-TH-u-ca-buddhist', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  })
  return `⚪ สิ้นสุดแล้ว • ${day} (${time} น.)`
}

function videoTitle(video: FacebookLiveVideo | undefined) {
  if (!video) return ''
  return video.title?.trim() || 'ไลฟ์สดไม่มีชื่อ'
}

const shortId = (id: string) => (id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id)

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
          {loading ? (
            <span className="block truncate font-semibold text-slate-800">กำลังโหลดไลฟ์…</span>
          ) : selected ? (
            <>
              <span className="block truncate text-xs font-semibold text-slate-600">
                {videoStatus(selected)}
              </span>
              <span title={videoTitle(selected)} className="mt-1 block truncate font-semibold text-slate-800">
                {videoTitle(selected)}
              </span>
            </>
          ) : (
            <span className="block truncate font-semibold text-slate-800">
              {value ? 'รายการที่เลือกไว้' : 'เลือกไลฟ์สดหรือวิดีโอล่าสุด'}
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
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-slate-600">
                  {videoStatus(video)}
                </span>
                <span title={videoTitle(video)} className="mt-1 block truncate text-sm font-semibold text-slate-800">
                  {videoTitle(video)}
                </span>
                <span className="sr-only">รหัสวิดีโอ {shortId(video.id)}</span>
              </span>
              {video.id === value && <Check aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-orange-600" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
