'use client'

import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, Radio, RefreshCw, Video, X } from 'lucide-react'
import type { FacebookLiveVideo } from '@/lib/integrations/facebook/live-videos'
import { parseLiveVideoList } from '@/lib/features/commerce/live-source'

export function liveVideoTime(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'ไม่ระบุเวลา'
  return new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok',
  }).format(new Date(value))
}

export function LiveVideoPickerModal({
  pageId,
  pageName,
  onSelect,
  onDismiss,
  thai = false,
}: {
  pageId: string
  pageName: string
  onSelect: (video: FacebookLiveVideo) => void
  onDismiss: () => void
  thai?: boolean
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [videos, setVideos] = useState<FacebookLiveVideo[]>([])
  const [fallback, setFallback] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const dialog = dialogRef.current
    const previousOverflow = document.body.style.overflow
    const previousFocus = document.activeElement as HTMLElement | null
    dialog?.showModal()
    closeRef.current?.focus()
    document.body.style.overflow = 'hidden'
    return () => {
      dialog?.close()
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setVideos([])
    setFallback(false)
    setError(null)
    void (async () => {
      try {
        const response = await fetch(
          `/api/facebook/live-videos?page_id=${encodeURIComponent(pageId)}`,
          {
            cache: 'no-store',
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
          },
        )
        const result = await response.json()
        if (!response.ok) throw new Error(result.error ?? 'โหลดรายการไลฟ์สดไม่สำเร็จ')
        const parsed = parseLiveVideoList(result, pageId)
        if (!controller.signal.aborted) {
          setVideos(parsed.videos)
          setFallback(parsed.fallback)
        }
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(
            failure instanceof TypeError || failure instanceof SyntaxError
              ? 'เชื่อมต่อหรืออ่านข้อมูลไม่สำเร็จ กรุณาลองใหม่'
              : failure instanceof Error && failure.name !== 'TimeoutError'
                ? failure.message
                : 'โหลดรายการนานเกินไป กรุณาลองใหม่',
          )
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [pageId, attempt])

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="live-video-picker-title"
      aria-busy={loading}
      onCancel={(event) => {
        event.preventDefault()
        onDismiss()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onDismiss()
      }}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/40"
    >
      <div className="flex max-h-[90dvh] flex-col">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 id="live-video-picker-title" className="text-lg font-bold">
                เลือกไลฟ์สดปัจจุบัน
              </h2>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${fallback ? 'bg-slate-100 text-slate-600' : 'bg-red-50 text-red-600'}`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${fallback ? 'bg-slate-400' : 'animate-pulse bg-red-500 motion-reduce:animate-none'}`}
                />{' '}
                {fallback ? 'ตัวเลือกสำรอง' : thai ? 'กำลังออกอากาศ' : 'LIVE'}
              </span>
            </div>
            <p className="mt-1 break-words text-sm text-slate-500">{pageName}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="ปิดหน้าต่างเลือกไลฟ์"
            onClick={onDismiss}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-orange-500"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="overflow-y-auto overscroll-contain p-4 sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <p role="status" className="text-sm text-slate-500">
              {loading
                ? 'กำลังค้นหาไลฟ์สด…'
                : error
                  ? 'โหลดรายการไม่สำเร็จ'
                  : fallback
                    ? `วิดีโอล่าสุด ${videos.length} รายการ`
                    : `กำลังถ่ายทอดสด ${videos.length} รายการ`}
            </p>
            <button
              type="button"
              disabled={loading}
              onClick={() => setAttempt((value) => value + 1)}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> รีเฟรชรายการ
            </button>
          </div>
          {fallback && !loading && !error && (
            <p
              role="note"
              className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed text-slate-600"
            >
              ไม่พบไลฟ์ที่กำลังถ่ายทอดสด แสดงวิดีโอล่าสุดไม่เกิน 3 รายการเป็นตัวเลือกสำรอง
            </p>
          )}
          {loading ? (
            <div className="grid min-h-52 place-content-center justify-items-center gap-3 text-sm text-slate-500">
              <LoaderCircle className="h-7 w-7 animate-spin text-orange-500" /> กำลังโหลดรายการจาก
              Facebook
            </div>
          ) : error ? (
            <div
              role="alert"
              className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center"
            >
              <p className="text-sm text-amber-900">{error}</p>
              <button
                type="button"
                onClick={() => setAttempt((value) => value + 1)}
                className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-amber-800 ring-1 ring-amber-200"
              >
                ลองใหม่อีกครั้ง
              </button>
            </div>
          ) : !videos.length ? (
            <div className="flex min-h-60 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-5 py-8 text-center">
              <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-white text-slate-400 shadow-sm">
                <Radio className="h-7 w-7" />
              </span>
              <h3 className="font-semibold text-slate-800">เพจนี้ยังไม่ได้เปิดไลฟ์สด</h3>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-500">
                เริ่มถ่ายทอดสดบนเพจ Facebook แล้วกดค้นหาอีกครั้ง
                หรือปิดหน้าต่างเพื่อกรอกรหัสด้วยตนเอง
              </p>
              <button
                type="button"
                onClick={() => setAttempt((value) => value + 1)}
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600"
              >
                <RefreshCw className="h-4 w-4" /> ลองค้นหาอีกครั้ง
              </button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="hidden bg-slate-50 text-xs text-slate-500 sm:table-header-group">
                  <tr>
                    <th className="px-4 py-3 font-medium">
                      {fallback ? 'วิดีโอล่าสุด' : 'ไลฟ์สด'}
                    </th>
                    <th className="px-4 py-3 font-medium">
                      {fallback ? 'เวลาโพสต์' : 'เวลาเริ่มไลฟ์'}
                    </th>
                    <th className="px-4 py-3">
                      <span className="sr-only">เลือก</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="block divide-y divide-slate-100 sm:table-row-group">
                  {videos.map((video) => (
                    <tr key={video.id} className="block p-4 sm:table-row sm:p-0">
                      <td className="block pb-3 sm:table-cell sm:p-4">
                        <div className="flex items-center gap-3">
                          <div className="grid h-14 w-24 shrink-0 place-items-center overflow-hidden rounded-lg bg-slate-100 text-slate-400">
                            {video.thumbnail ? (
                              // eslint-disable-next-line @next/next/no-img-element -- Meta returns temporary video thumbnails.
                              <img
                                src={video.thumbnail}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <Video className="h-6 w-6" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="line-clamp-2 break-words font-semibold text-slate-800">
                              {video.title}
                            </p>
                            <p className="mt-1 text-xs text-slate-400">รหัส {video.id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="block pb-3 text-xs text-slate-500 sm:table-cell sm:whitespace-nowrap sm:p-4">
                        <time dateTime={video.createdAt ?? undefined}>
                          {liveVideoTime(video.createdAt)}
                        </time>
                      </td>
                      <td className="block sm:table-cell sm:p-4 sm:text-right">
                        <button
                          type="button"
                          onClick={() => onSelect(video)}
                          className="w-full whitespace-nowrap rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 sm:w-auto"
                        >
                          {video.isLive ? 'เลือกไลฟ์นี้' : 'เลือกวิดีโอนี้'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <footer className="flex justify-end border-t border-slate-100 px-5 py-4 sm:px-6">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            ยกเลิก
          </button>
        </footer>
      </div>
    </dialog>
  )
}
