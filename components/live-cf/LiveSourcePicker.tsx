'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type { FacebookLiveVideo } from '@/lib/integrations/facebook/live-videos'
import { extractFacebookLiveId } from '@/lib/features/commerce/live-cf-setup'
import { parseLiveVideoList } from '@/lib/features/commerce/live-source'
import { LiveVideoPickerModal, liveVideoTime } from './LiveVideoPickerModal'

export type LiveSourcePage = { id: string; name: string; picture?: string | null }
const field =
  'mt-1.5 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100 disabled:opacity-50'

export function LiveSourcePicker({
  pages,
  pageId,
  livePostId,
  onPageChange,
  onLiveChange,
  disabled = false,
  active = true,
  allowManual = false,
  thai = false,
}: {
  pages: LiveSourcePage[]
  pageId: string
  livePostId: string
  onPageChange: (id: string) => void
  onLiveChange: (id: string) => void
  disabled?: boolean
  active?: boolean
  allowManual?: boolean
  thai?: boolean
}) {
  const id = useId()
  const [videos, setVideos] = useState<FacebookLiveVideo[]>([])
  const [loadedPage, setLoadedPage] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [automatic, setAutomatic] = useState(true)
  const [manual, setManual] = useState(false)
  const [modal, setModal] = useState(false)
  // A ref keeps asynchronous Page responses from overwriting an explicit selection.
  const current = useRef({ pageId, livePostId, automatic, onLiveChange })
  current.current = { pageId, livePostId, automatic, onLiveChange }
  useEffect(() => {
    if (!active || !pageId) return
    const controller = new AbortController()
    setLoading(true)
    setError('')
    void (async () => {
      try {
        const response = await fetch(
          `/api/facebook/live-videos?page_id=${encodeURIComponent(pageId)}`,
          {
            cache: 'no-store',
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
          },
        )
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'โหลดรายการไลฟ์ไม่สำเร็จ')
        const parsed = parseLiveVideoList(data, pageId)
        if (controller.signal.aborted || current.current.pageId !== pageId) return
        setVideos(parsed.videos)
        setLoadedPage(pageId)
        const live = parsed.videos.filter((video) => video.isLive)
        if (current.current.automatic && !current.current.livePostId && live.length === 1)
          current.current.onLiveChange(live[0].id)
      } catch (cause) {
        if (!controller.signal.aborted) {
          setVideos([])
          setLoadedPage(pageId)
          setError(cause instanceof Error ? cause.message : 'โหลดรายการไลฟ์ไม่สำเร็จ')
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [pageId, attempt, active])
  const options = loadedPage === pageId ? videos : []
  const selected = options.find((video) => video.id === livePostId)
  function choose(value: string) {
    setAutomatic(false)
    setManual(false)
    onLiveChange(value)
  }
  return (
    <div className="grid min-w-0 gap-4 md:grid-cols-2">
      <label className="min-w-0 text-sm font-semibold text-slate-800">
        เลือกเพจ Facebook
        <select
          aria-label="เลือกเพจ Facebook"
          className={field}
          value={pageId}
          disabled={disabled}
          onChange={(event) => {
            setModal(false)
            setManual(false)
            setAutomatic(true)
            onPageChange(event.target.value)
          }}
          required={!allowManual}
        >
          <option value="">เลือกเพจที่ใช้ไลฟ์สด</option>
          {pages.map((page) => (
            <option key={page.id} value={page.id}>
              {page.name}
            </option>
          ))}
        </select>
        {thai && (
          <span className="mt-1 block text-xs font-normal text-slate-500">
            เลือกเพจที่ร้านกำลังใช้ขายสินค้า
          </span>
        )}
      </label>
      <div className="min-w-0 space-y-2 text-sm">
        <label className="block font-semibold text-slate-800">
          {thai ? 'เลือกลิงก์ไลฟ์สดที่กำลังออกอากาศ' : 'ไลฟ์สด Facebook'}
          <select
            aria-label="ไลฟ์สด Facebook"
            className={field}
            value={manual ? '' : livePostId}
            required={!allowManual}
            disabled={disabled || !pageId || loading}
            onChange={(event) => choose(event.target.value)}
          >
            <option value="">{loading ? 'กำลังโหลดไลฟ์…' : 'เลือกไลฟ์สดหรือวิดีโอล่าสุด'}</option>
            {!manual && livePostId && !selected && (
              <option value={livePostId}>รายการที่เลือกไว้ • {livePostId}</option>
            )}
            {options.map((video) => (
              <option key={video.id} value={video.id}>
                {video.isLive ? (thai ? 'กำลังออกอากาศ' : '🔴 LIVE') : 'วิดีโอล่าสุด'} •{' '}
                {video.title} • {liveVideoTime(video.createdAt)}
              </option>
            ))}
          </select>
          {thai && (
            <span className="mt-1 block text-xs font-normal text-slate-500">
              เลือกรายการที่กำลังขาย ระบบจะรับคอมเมนต์จากไลฟ์นี้เท่านั้น
            </span>
          )}
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={automatic}
            disabled={disabled || !pageId || loading}
            onClick={() => {
              setAutomatic(!automatic)
              if (!automatic) {
                const live = options.filter((video) => video.isLive)
                if (live.length === 1) onLiveChange(live[0].id)
                setAttempt((value) => value + 1)
                setManual(false)
              }
            }}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${automatic ? 'bg-red-50 text-red-700 ring-1 ring-red-200' : 'bg-slate-100 text-slate-600'}`}
          >
            ● เลือกจากไลฟ์สดปัจจุบัน {automatic ? 'อัตโนมัติ' : ''}
          </button>
          <button
            type="button"
            disabled={disabled || !pageId || loading}
            onClick={() => setAttempt((value) => value + 1)}
            className="text-xs text-orange-700 underline disabled:opacity-50"
          >
            โหลดรายการใหม่
          </button>
          <button
            type="button"
            disabled={disabled || !pageId}
            onClick={() => setModal(true)}
            className="text-xs text-slate-600 underline disabled:opacity-50"
          >
            ดูภาพตัวอย่างไลฟ์
          </button>
        </div>
        {error && (
          <p role="alert" className="text-xs text-red-700">
            {error}
          </p>
        )}
        {!loading && !error && loadedPage === pageId && !options.some((video) => video.isLive) && (
          <p className="text-xs text-slate-500">
            ยังไม่พบไลฟ์ที่กำลังออกอากาศ เลือกวิดีโอล่าสุดได้จากรายการ
          </p>
        )}
        {options.filter((video) => video.isLive).length > 1 && (
          <p className="text-xs text-slate-500">มีหลายไลฟ์กำลังออกอากาศ กรุณาเลือกไลฟ์ที่ต้องการ</p>
        )}
        {selected && (
          <p
            aria-label="ไลฟ์สดที่เลือก"
            className="break-words rounded-lg bg-slate-100 p-2 text-xs text-slate-700"
          >
            {selected.isLive
              ? thai
                ? 'กำลังออกอากาศ • เลือกไลฟ์แล้ว'
                : '🔴 LIVE • เลือกไลฟ์แล้ว'
              : 'เลือกวิดีโอสำรองแล้ว'}{' '}
            • {selected.title} • รหัส {selected.id}
          </p>
        )}
        {allowManual && (
          <>
            <button
              type="button"
              aria-pressed={manual}
              disabled={disabled}
              onClick={() => {
                setManual(!manual)
                setAutomatic(false)
              }}
              className="text-xs text-slate-500 underline"
            >
              กรอกรหัสด้วยตนเอง
            </button>
            <input
              id={id}
              aria-label="ลิงก์หรือรหัสไลฟ์สด Facebook"
              className={`${field} read-only:bg-slate-50 read-only:text-slate-500`}
              value={livePostId}
              disabled={disabled}
              readOnly={!manual}
              placeholder="วางลิงก์ Facebook หรือกรอกรหัสไลฟ์"
              onChange={(event) => onLiveChange(event.target.value)}
              onPaste={(event) => {
                if (!manual) return
                const parsed = extractFacebookLiveId(event.clipboardData.getData('text'))
                if (parsed) {
                  event.preventDefault()
                  onLiveChange(parsed)
                }
              }}
              aria-invalid={manual && extractFacebookLiveId(livePostId) === null}
              onBlur={() => {
                const parsed = extractFacebookLiveId(livePostId)
                if (parsed !== null) onLiveChange(parsed)
              }}
            />
            {manual && extractFacebookLiveId(livePostId) === null && (
              <p role="alert" className="text-xs text-red-600">
                อ่านรหัสจากลิงก์นี้ไม่ได้ กรุณาคัดลอกลิงก์วิดีโอแบบเต็มจาก Facebook
              </p>
            )}
            <p className="text-xs text-slate-500">เว้นว่างเพื่อรับทุกไลฟ์ของเพจ</p>
          </>
        )}
      </div>
      {modal && pageId && (
        <LiveVideoPickerModal
          key={pageId}
          pageId={pageId}
          thai={thai}
          pageName={pages.find((page) => page.id === pageId)?.name ?? 'เพจ Facebook'}
          onSelect={(video) => {
            setVideos((previous) => [video, ...previous.filter((row) => row.id !== video.id)])
            setLoadedPage(pageId)
            choose(video.id)
            setModal(false)
          }}
          onDismiss={() => setModal(false)}
        />
      )}
    </div>
  )
}
