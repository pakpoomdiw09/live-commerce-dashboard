'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { ArrowLeftRight, Plus } from 'lucide-react'
import { FacebookIcon } from '@/components/ui/FacebookIcon'
import { FallbackImg } from '@/components/ui/FallbackImg'
import { apiError, cn } from '@/lib/utils'

export type ActivePage = {
  tenantId: string
  name: string
  picture: string | null
  pageLinked: boolean
  autoReply: boolean
  creditsLeft: number
}

/**
 * Top of the sidebar: the active Page (picture, name, credits tag), the bot on/off switch
 * (tenants.auto_reply_enabled, which the webhook checks before auto-replying) and the way
 * back to the Page picker.
 */
export function PageStatus({ page }: { page: ActivePage | null }) {
  const router = useRouter()
  const [on, setOn] = useState(page?.autoReply ?? false)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setOn(page?.autoReply ?? false), [page?.autoReply])

  if (!page) {
    return (
      <Link
        href="/select-page"
        className="flex items-center gap-3 rounded-2xl border border-dashed border-white/50 p-3 text-sm text-white/90 transition hover:bg-white/10"
      >
        <Plus className="h-4 w-4" aria-hidden />
        เลือกหรือเพิ่มเพจ
      </Link>
    )
  }

  function toggle() {
    if (!page) return
    const next = !on
    setOn(next) // optimistic
    setError(null)
    start(async () => {
      const res = await fetch(`/api/tenants/${page.tenantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_reply_enabled: next }),
      })
      if (!res.ok) {
        setOn(!next)
        setError(await apiError(res))
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="rounded-2xl bg-white/15 p-3 ring-1 ring-white/20 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        {/* no Page linked yet, Graph unreachable or an expired CDN URL: the Facebook mark instead */}
        <FallbackImg
          src={page.picture}
          size={40}
          className="h-10 w-10 max-w-10 shrink-0 rounded-full bg-white object-cover ring-2 ring-white"
          fallback={
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-[#1877f2] ring-2 ring-white">
              <FacebookIcon className="h-5 w-5" />
            </span>
          }
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-white" title={page.name}>
            {page.name}
          </span>
          <span className="mt-0.5 inline-block rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-orange-600">
            เครดิต {page.creditsLeft.toLocaleString('th-TH')}
          </span>
        </span>
        <Link href="/select-page" aria-label="สลับเพจ" title="สลับเพจ" className="rounded-lg p-1.5 text-white/80 hover:bg-white/15 hover:text-white">
          <ArrowLeftRight className="h-4 w-4" />
        </Link>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`บอทตอบอัตโนมัติของ ${page.name}`}
        title={error ?? undefined}
        disabled={pending}
        onClick={toggle}
        className="mt-3 flex w-full items-center justify-between rounded-xl bg-white/10 px-3 py-2 text-xs font-medium text-white transition hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-60"
      >
        <span className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full', on ? 'bg-lime-300' : 'bg-white/40')} aria-hidden />
          {on ? 'กำลังทำงาน' : 'ปิดบอทอยู่'}
        </span>
        <span className={cn('flex h-5 w-9 items-center rounded-full p-0.5 transition-colors', on ? 'bg-lime-400' : 'bg-white/30')}>
          <span className={cn('h-4 w-4 rounded-full bg-white shadow transition-transform', on && 'translate-x-4')} />
        </span>
      </button>
      {!page.pageLinked && <p className="mt-2 text-[11px] text-white/80">ยังไม่ผูกเพจ: ตั้งค่า Page ID และ token ในหน้าตั้งค่า</p>}
      {error && <p className="mt-2 text-[11px] font-medium text-white">{error}</p>}
    </div>
  )
}
