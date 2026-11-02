'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Image from 'next/image'
import { ChevronDown, Check, Video } from 'lucide-react'
import type { FacebookLiveVideo } from '@/lib/integrations/facebook/live-videos'

const timeZone = 'Asia/Bangkok'
function videoDateTime(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'ไม่ระบุวันที่และเวลา'
  const date = new Date(value)
  const time = date.toLocaleTimeString('th-TH', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const day = date.toLocaleDateString('th-TH-u-ca-buddhist', {
    timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
  const today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date())
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date) === today
    ? `วันนี้ ${time} น.`
    : `${day} ${time} น.`
}

function videoTitle(video: FacebookLiveVideo | undefined) {
  if (!video) return ''
  return video.title?.trim() || 'ไลฟ์สดไม่มีชื่อ'
}

const shortId = (id: string) => (id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id)

function VideoThumbnail({
  video,
  size,
}: {
  video: FacebookLiveVideo
  size: 'selected' | 'option'
}) {
  const [failed, setFailed] = useState(false)
  const dimensions =
    size === 'selected'
      ? 'h-8 w-8'
      : 'h-12 w-16 sm:h-14 sm:w-20'

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100 ${dimensions}`}
      aria-hidden="true"
    >
      {video.thumbnail && !failed ? (
        <Image
          src={video.thumbnail}
          alt=""
          width={size === 'selected' ? 32 : 80}
          height={size === 'selected' ? 32 : 56}
          unoptimized
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Video className={size === 'selected' ? 'h-4 w-4 text-slate-400' : 'h-6 w-6 text-slate-400'} />
      )}
    </span>
  )
}

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
        {selected && !loading && <VideoThumbnail video={selected} size="selected" />}
        <span className="min-w-0 flex-1" aria-label={value && !loading ? 'ไลฟ์สดที่เลือก' : undefined}>
          {loading ? (
            <span className="block truncate font-semibold text-slate-800">กำลังโหลดไลฟ์…</span>
          ) : selected ? (
            <>
              <span className="block truncate text-xs font-semibold text-slate-600">
                {selected.isLive ? '🔴 สด' : '⚪ สิ้นสุดแล้ว'} • {videoDateTime(selected.createdAt)}
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
              className={`flex w-full min-w-0 items-center gap-3 rounded-lg p-2 text-left transition hover:bg-orange-50 focus-visible:bg-orange-50 focus-visible:outline-none ${index === cursor ? 'bg-orange-50' : ''} ${video.id === value ? 'ring-1 ring-inset ring-orange-200' : ''}`}>
              <VideoThumbnail video={video} size="option" />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2">
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${video.isLive ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                    {video.isLive ? '🔴 สด' : '⚪ สิ้นสุดแล้ว'}
                  </span>
                  <span className="truncate text-xs font-medium text-slate-500">
                    {videoDateTime(video.createdAt)}
                  </span>
                </span>
                <span title={videoTitle(video)} className="mt-1 block line-clamp-2 break-words text-sm font-semibold text-slate-800">
                  {videoTitle(video)}
                </span>
                <span title={video.id} className="mt-0.5 block truncate text-[10px] font-normal text-slate-400">
                  รหัสวิดีโอ {shortId(video.id)}
                </span>
              </span>
              {video.id === value && <Check aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-orange-600" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
