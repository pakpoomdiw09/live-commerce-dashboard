'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, FileText, Image as ImageIcon, RefreshCw, Search, X } from 'lucide-react'
import type { FacebookCommentPost } from '@/lib/integrations/facebook/live-videos'

const postNumber = (value: string) => value.trim().split('_').at(-1) ?? value.trim()

function formatDate(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'ไม่ระบุวันที่'
  return new Date(value).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function postType(post: FacebookCommentPost) {
  if (post.isLive || post.postType === 'live') {
    return { label: 'Live', className: 'bg-red-50 text-red-700' }
  }
  if (post.postType === 'video') {
    return { label: 'Video', className: 'bg-violet-50 text-violet-700' }
  }
  if (post.postType === 'photo') {
    return { label: 'Photo', className: 'bg-sky-50 text-sky-700' }
  }
  return { label: 'Post', className: 'bg-slate-100 text-slate-600' }
}

export function CommentPostPicker({
  pageId,
  pageName,
  openOnMount = false,
  value,
  title,
  onChange,
}: {
  pageId: string
  pageName: string
  openOnMount?: boolean
  value: string | null
  title: string | null
  onChange: (postId: string | null, postTitle: string | null) => void
}) {
  const id = useId()
  const dialogId = `${id}-dialog`
  const dialogTitleId = `${id}-dialog-title`
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const [posts, setPosts] = useState<FacebookCommentPost[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
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
    if (openOnMount) setOpen(true)
  }, [openOnMount])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus())

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
      )
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
      triggerRef.current?.focus()
    }
  }, [open])

  const filteredPosts = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('th-TH')
    if (!term) return posts
    return posts.filter((post) => `${post.title} ${post.preview}`.toLocaleLowerCase('th-TH').includes(term))
  }, [posts, search])

  function close() {
    setOpen(false)
    setSearch('')
  }

  const selectedTitle = selected?.title || selected?.preview || title
  const modal = open && typeof document !== 'undefined' ? createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <section
        ref={dialogRef}
        id={dialogId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogTitleId}
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <header className="flex items-start gap-3 border-b border-slate-200 px-5 py-4 sm:px-6">
          <div className="min-w-0 flex-1">
            <h2 id={dialogTitleId} className="truncate text-lg font-bold text-slate-900 sm:text-xl">
              เลือกโพสต์ของเพจ {pageName}
            </h2>
            <p className="mt-1 text-sm text-slate-500">เลือกโพสต์ที่ต้องการให้กฎนี้ตอบกลับความคิดเห็น</p>
          </div>
          <button
            type="button"
            onClick={() => setRetry((n) => n + 1)}
            disabled={loading}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:border-orange-300 hover:bg-orange-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">โหลดรายการโพสต์ใหม่</span>
            <span className="sm:hidden">โหลดใหม่</span>
          </button>
          <button
            type="button"
            aria-label="ปิดหน้าต่างเลือกโพสต์"
            onClick={close}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
          <label className="relative block">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="ค้นหาจากข้อความในโพสต์"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm text-slate-800 outline-none transition focus:border-orange-400 focus:bg-white focus:ring-2 focus:ring-orange-100"
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {loading && (
            <div role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
              <RefreshCw className="h-4 w-4 animate-spin" /> กำลังโหลดโพสต์จากเพจ…
            </div>
          )}
          {!loading && error && (
            <div className="mx-auto max-w-lg rounded-xl border border-red-200 bg-red-50 p-4 text-center">
              <p role="alert" className="text-sm text-red-800">{error}</p>
              <button
                type="button"
                onClick={() => setRetry((n) => n + 1)}
                className="mt-3 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-red-700 ring-1 ring-red-200 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
              >
                ลองโหลดอีกครั้ง
              </button>
            </div>
          )}
          {!loading && !error && !filteredPosts.length && (
            <div className="mx-auto max-w-lg rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-12 text-center">
              <FileText aria-hidden="true" className="mx-auto h-8 w-8 text-slate-400" />
              <p className="mt-3 text-sm font-semibold text-slate-700">
                {search ? 'ไม่พบโพสต์ที่ตรงกับคำค้น' : 'ไม่พบโพสต์ล่าสุดของเพจ'}
              </p>
              <p className="mt-1 text-xs text-slate-500">ลองเปลี่ยนคำค้นหรือโหลดรายการโพสต์ใหม่</p>
            </div>
          )}
          {!loading && !error && !!filteredPosts.length && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {filteredPosts.map((post) => {
                const selectedPost = postNumber(post.id) === postNumber(value ?? '')
                const type = postType(post)
                return (
                  <button
                    key={post.id}
                    type="button"
                    aria-pressed={selectedPost}
                    onClick={() => {
                      onChange(post.id, post.title || post.preview || null)
                      close()
                    }}
                    className={`flex min-h-32 items-start gap-3 rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 ${selectedPost ? 'border-orange-400 bg-orange-50/70 ring-1 ring-orange-200' : 'border-slate-200 bg-white hover:border-orange-300 hover:bg-orange-50/40'}`}
                  >
                    {post.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={post.thumbnail} alt="" className="h-20 w-20 shrink-0 rounded-lg bg-slate-100 object-cover sm:h-24 sm:w-24" />
                    ) : (
                      <span className="grid h-20 w-20 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-400 sm:h-24 sm:w-24">
                        <ImageIcon aria-hidden="true" className="h-7 w-7" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${type.className}`}>{type.label}</span>
                        {post.createdAt && <span className="text-[11px] text-slate-500">{formatDate(post.createdAt)}</span>}
                      </span>
                      <span className="mt-2 block line-clamp-4 whitespace-normal break-words text-sm leading-5 text-slate-800">
                        {post.preview || post.title || 'โพสต์ Facebook'}
                      </span>
                      {selectedPost && <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-orange-700"><Check className="h-3.5 w-3.5" /> เลือกอยู่</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </div>,
    document.body,
  ) : null

  return (
    <div className="space-y-3">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        disabled={!pageId}
        onClick={() => setOpen(true)}
        className="flex min-h-20 w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-orange-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 disabled:bg-slate-50 disabled:opacity-60"
      >
        {selected?.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={selected.thumbnail} alt="" className="h-14 w-20 shrink-0 rounded-lg object-cover" />
        ) : (
          <span className="grid h-14 w-20 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-400">
            <FileText aria-hidden="true" className="h-6 w-6" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-slate-500">โพสต์เป้าหมาย</span>
          <span className="mt-1 block line-clamp-2 break-words text-sm font-semibold text-slate-800">
            {selectedTitle || (value ? `โพสต์ที่เลือก (${formatDate(selected?.createdAt ?? null)})` : 'คลิกเพื่อเลือกโพสต์จากเพจ')}
          </span>
          {selected?.createdAt && <span className="mt-1 block text-xs text-slate-500">{formatDate(selected.createdAt)}</span>}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-700">
          {value ? 'เปลี่ยนโพสต์' : 'เลือกโพสต์'}
          <ChevronDown aria-hidden="true" className="h-4 w-4" />
        </span>
      </button>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      {modal}
    </div>
  )
}
