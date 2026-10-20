'use client'

import { PageBanner } from '@/components/ui/page-banner'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { when } from '@/lib/utils'
import type { CommentItem } from '@/components/inbox/InboxClient'

export function CommentsFeed({ comments, onBack }: { comments: CommentItem[]; onBack: () => void }) {
  return (
    <section className="mx-auto flex h-full w-full max-w-4xl min-h-0 flex-col p-4 md:p-6">
      <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
        <PageBanner compact className="flex items-center gap-3 rounded-b-none">
          <Button variant="ghost" size="icon" className="text-white hover:bg-white/20 hover:text-white" onClick={onBack} aria-label="กลับไปแชท">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="font-semibold">ความคิดเห็นจากโพสต์ ({comments.length})</h1>
        </PageBanner>
        <ul className="scrollbar-thin min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
          {comments.length === 0 && <li className="p-10 text-center text-sm text-slate-500">ยังไม่มีความคิดเห็นใหม่</li>}
          {comments.map((k) => (
            <li key={k.id} className="px-5 py-4 text-sm">
              <div className="flex items-baseline gap-2">
                <span className="font-medium">{k.author_name ?? 'ไม่ทราบชื่อ'}</span>
                <time className="text-xs text-slate-400" suppressHydrationWarning>
                  {when(k.created_at)}
                </time>
              </div>
              <p className="mt-1 break-words whitespace-pre-wrap text-slate-700">{k.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
