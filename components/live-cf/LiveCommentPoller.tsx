'use client'
import { useEffect, useRef, useState } from 'react'

type Comment = { id: string; name: string | null; message: string; at?: string }

/**
 * Pulls live comments through the server (which holds the Page token) every 2.5s while an
 * auction round is active, and shows the latest ones. Slows down when no round is active.
 */
export function LiveCommentPoller({ pageId, sessionId }: { pageId: string; sessionId: string }) {
  const [comments, setComments] = useState<Comment[]>([])
  const [status, setStatus] = useState('กำลังเริ่มดึงคอมเมนต์สด…')
  const stopped = useRef(false)

  useEffect(() => {
    stopped.current = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    const tick = async () => {
      let delay = 2500
      try {
        do {
          const res = await fetch('/api/live-cf/auction/poll-comments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page_id: pageId, session_id: sessionId }),
            signal: controller.signal,
            cache: 'no-store',
          })
          if ([401, 403, 404].includes(res.status)) {
            setStatus('หยุดดึงคอมเมนต์: ไม่มีสิทธิ์หรือยังไม่ได้เปิดใช้งาน')
            stopped.current = true
            return
          }
          if (res.status === 429) {
            delay = 10_000
            break
          }
          const data = await res.json().catch(() => null)
          if (data?.reason === 'VIDEO_NOT_ACCESSIBLE') {
            setStatus(
              `⚠️ อ่านวิดีโอ ${data.videoId} ไม่ได้ — ไลฟ์จบแล้วหรือไม่ใช่ไลฟ์ของเพจนี้${Array.isArray(data.liveVideos) && data.liveVideos.length > 1 ? ` (พบไลฟ์สด ${data.liveVideos.length} รายการ กรุณาเริ่มเซสชันจากไลฟ์ที่ต้องการ)` : ' — เริ่มเซสชันใหม่จากไลฟ์ที่กำลังออกอากาศ'}`,
            )
            delay = 10_000
            break
          }
          if (data?.reason === 'SESSION_NOT_FOUND') {
            setStatus('ไม่พบเซสชันหรือรหัสไลฟ์ไม่ถูกต้อง กรุณาเลือกเซสชันใหม่')
            delay = 10_000
            break
          }
          if (!res.ok || !data) {
            setStatus('ดึงคอมเมนต์ไม่สำเร็จ กำลังลองใหม่…')
            delay = 5000
            break
          }
          if (data.polled === false && data.reason === 'NO_ACTIVE_ROUND') {
            setStatus(
              data.videoId
                ? `ยังไม่มีรอบประมูลที่เปิดอยู่ในเซสชันนี้ (ไลฟ์ ${data.videoId})`
                : 'ยังไม่มีรอบประมูลที่เปิดอยู่',
            )
            delay = 10_000
            break
          }
          setStatus('กำลังดึงคอมเมนต์สด (ทุก 2.5 วินาที)')
          if (Array.isArray(data.comments) && data.comments.length)
            setComments((old) => {
              const known = new Set(old.map((c) => c.id))
              return [...old, ...data.comments.filter((c: Comment) => !known.has(c.id))].slice(-30)
            })
        } while (false)
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') return
        delay = 5000
      }
      if (!stopped.current) timer = setTimeout(tick, delay)
    }
    tick()
    return () => {
      stopped.current = true
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [pageId, sessionId])

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
      <div className="mb-2 font-medium text-slate-700">คอมเมนต์สด • {status}</div>
      <ul className="max-h-48 space-y-1 overflow-y-auto">
        {[...comments].reverse().map((c) => (
          <li key={c.id} className="truncate">
            <span className="font-medium">{c.name ?? 'ลูกค้า'}:</span> {c.message}
          </li>
        ))}
        {!comments.length && <li className="text-slate-400">ยังไม่มีคอมเมนต์ใหม่</li>}
      </ul>
    </div>
  )
}
