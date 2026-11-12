'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, FileText, RefreshCw } from 'lucide-react'
import type { FacebookCommentPost } from '@/lib/integrations/facebook/live-videos'

const input = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100 disabled:opacity-50'
const postNumber = (value: string) => value.trim().split('_').at(-1) ?? value.trim()

function formatDate(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'ไม่ระบุวันที่'
  return new Date(value).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

export function CommentPostPicker({
  pageId,
  value,
  title,
  onChange,
}: {
  pageId: string
  value: string | null
  title: string | null
  onChange: (postId: string | null, postTitle: string | null) => void
}) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const [posts, setPosts] = useState<FacebookCommentPost[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [open, setOpen] = useState(false)
  const selected = posts.find((post) => postNumber(post.id) === postNumber(value ?? ''))

  useEffect(() => {
    if (!pageId) return
    const controller = new AbortController()
    setLoading(true)
    setError('')
    void fetch(`/api/facebook/comment-posts?page_id=${encodeURIComponent(pageId)}`, {
      cache: 'no-store',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
    }).then(async (response) => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'โหลดโพสต์ไม่สำเร็จ')
      if (!Array.isArray(data.posts)) throw new Error('รูปแบบข้อมูลโพสต์ไม่ถูกต้อง')
      if (!controller.signal.aborted) setPosts(data.posts as FacebookCommentPost[])
    }).catch((cause) => {
      if (controller.signal.aborted) return
      setPosts([])
      setError(cause instanceof Error ? cause.message : 'โหลดโพสต์ไม่สำเร็จ')
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [pageId, retry])

  useEffect(() => {
    if (!open) return
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  const expanded = open && !loading
  return (
    <div className="space-y-3">
      <div ref={root} className="relative">
        <button
          type="button"
          role="combobox"
          aria-label="เลือกโพสต์ Facebook"
          aria-expanded={expanded}
          aria-controls={`${id}-posts`}
          disabled={!pageId || loading}
          onClick={() => setOpen((current) => !current)}
          className="flex min-h-16 w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left text-sm hover:border-orange-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 disabled:bg-slate-50 disabled:opacity-60"
        >
          {selected?.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={selected.thumbnail} alt="" className="h-12 w-16 shrink-0 rounded-md object-cover" />
          ) : (
            <span className="grid h-12 w-16 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-400">
              <FileText className="h-6 w-6" />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-medium text-slate-500">
              {loading ? 'กำลังโหลดโพสต์…' : selected ? formatDate(selected.createdAt) : 'เลือกโพสต์ล่าสุดของเพจ'}
            </span>
            <span className="mt-1 block truncate font-semibold text-slate-800">
              {selected?.title || (value ? title || `Post ID: ${value}` : 'เลือกโพสต์ที่ต้องการ')}
            </span>
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${expanded ? 'rotate-180' : ''}`} />
        </button>
        {expanded && (
          <div id={`${id}-posts`} role="listbox" aria-label="รายการโพสต์ Facebook" className="absolute left-0 right-0 top-full z-50 mt-2 max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
            {!posts.length ? <p className="p-4 text-sm text-slate-500">ไม่พบโพสต์ล่าสุดของเพจ</p> : posts.map((post) => (
              <button
                key={post.id}
                type="button"
                role="option"
                aria-selected={postNumber(post.id) === postNumber(value ?? '')}
                onClick={() => { onChange(post.id, post.title); setOpen(false) }}
                className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-orange-50 focus-visible:bg-orange-50 focus-visible:outline-none"
              >
                {post.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={post.thumbnail} alt="" className="h-12 w-16 shrink-0 rounded-md object-cover" />
                ) : <span className="grid h-12 w-16 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-400"><FileText className="h-6 w-6" /></span>}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-xs text-slate-500">
                    {post.isLive && <span className="rounded-full bg-red-50 px-2 py-0.5 font-bold text-red-700">LIVE</span>}
                    <span className="truncate">{formatDate(post.createdAt)}</span>
                  </span>
                  <span className="mt-1 block line-clamp-2 break-words text-sm font-semibold text-slate-800">{post.preview || post.title}</span>
                  <span className="mt-0.5 block truncate font-mono text-[10px] text-slate-400">{post.id}</span>
                </span>
                {postNumber(post.id) === postNumber(value ?? '') && <Check className="h-4 w-4 shrink-0 text-orange-600" />}
              </button>
            ))}
          </div>
        )}
      </div>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      <button type="button" disabled={!pageId || loading} onClick={() => setRetry((n) => n + 1)} className="inline-flex items-center gap-1.5 text-xs text-orange-700 underline disabled:opacity-50">
        <RefreshCw className="h-3 w-3" /> โหลดรายการโพสต์ใหม่
      </button>
      <label className="block text-sm font-medium text-slate-700">
        หรือวาง Post ID โดยตรง
        <input
          aria-label="Facebook Post ID"
          inputMode="numeric"
          autoComplete="off"
          maxLength={82}
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value.trim(), null)}
          placeholder="เช่น 123456789 หรือ PAGEID_POSTID"
          className={`${input} mt-1.5 font-mono`}
        />
      </label>
      <p className="text-xs text-slate-500">เลือกโพสต์จากรายการหรือวางรหัสโพสต์ เพื่อจำกัดกฎให้ทำงานกับโพสต์นั้นเท่านั้น</p>
    </div>
  )
}
