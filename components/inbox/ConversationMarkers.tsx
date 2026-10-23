'use client'

import { Flag, RotateCw, Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { useInboxWorkspace } from '@/hooks/inbox/useInboxWorkspace'

export function ConversationMarkers({
  workspace,
}: {
  workspace: ReturnType<typeof useInboxWorkspace>
}) {
  const { data, busy, error, save, refresh } = workspace
  const button =
    'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40'
  return (
    <div className="flex flex-wrap items-center gap-1" aria-label="เครื่องหมายแชท" aria-busy={busy}>
      <button
        type="button"
        aria-label="ติดดาวแชท"
        aria-pressed={data?.starred ?? false}
        title={data?.starred ? 'นำดาวออก' : 'ติดดาว'}
        disabled={!data || busy}
        onClick={() => void save(data?.starred ? 'unstar' : 'star')}
        className={cn(
          button,
          data?.starred
            ? 'border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100 focus-visible:outline-amber-500'
            : 'border-slate-200 bg-white text-slate-500 hover:bg-amber-50 hover:text-amber-600 focus-visible:outline-amber-500',
        )}
      >
        <Star aria-hidden className="h-4 w-4" fill={data?.starred ? 'currentColor' : 'none'} />
      </button>
      <button
        type="button"
        aria-label="ติดตามผลแชท"
        aria-pressed={data?.followedUp ?? false}
        title={
          data && !data.followUpAvailable
            ? 'การติดตามผลยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบ'
            : data?.followedUp
              ? 'ยกเลิกติดตามผล'
              : 'ติดตามผล'
        }
        disabled={!data || !data.followUpAvailable || busy}
        onClick={() => void save(data?.followedUp ? 'unfollowup' : 'followup')}
        className={cn(
          button,
          data?.followedUp
            ? 'border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 focus-visible:outline-rose-500'
            : 'border-slate-200 bg-white text-slate-500 hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-rose-500',
        )}
      >
        <Flag aria-hidden className="h-4 w-4" fill={data?.followedUp ? 'currentColor' : 'none'} />
      </button>
      {error && (
        <>
          <p role="alert" className="max-w-48 text-xs text-rose-700">
            {error}
          </p>
          <button
            type="button"
            className={cn(button, 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}
            aria-label="โหลดเครื่องหมายแชทอีกครั้ง"
            title="โหลดอีกครั้ง"
            disabled={busy}
            onClick={refresh}
          >
            <RotateCw aria-hidden className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  )
}
