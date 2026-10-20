import { Check, Image as ImageIcon, Info, MessageCircle, Phone, Smile, Video } from 'lucide-react'

/** Visual preview only; the composer and header icons do not send messages. */
export function BroadcastPreview({ message, pageName = 'เพจร้านค้า' }: { message: string; pageName?: string }) {
  const hasMessage = !!message.trim()
  return (
    <section aria-label="ตัวอย่างข้อความในแชท" className="min-w-0 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-lg shadow-slate-200/50">
      <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-4">
        <span className="relative shrink-0">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-blue-500 to-violet-500 text-white shadow-sm">
            <MessageCircle className="h-6 w-6" aria-hidden />
          </span>
          <span className="absolute right-0 bottom-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900" title={pageName}>{pageName}</p>
          <p className="mt-0.5 text-[11px] text-slate-400">ตัวอย่างแชทกับลูกค้า</p>
        </div>
        <span className="flex shrink-0 items-center gap-3 text-blue-500" aria-hidden>
          <Phone className="hidden h-4 w-4 sm:block" /><Video className="hidden h-5 w-5 sm:block" /><Info className="h-5 w-5" />
        </span>
      </div>

      <div className="min-h-64 min-w-0 bg-gradient-to-b from-slate-50/80 to-white px-4 py-6">
        <p className="mb-6 text-center text-[10px] font-medium text-slate-400">ข้อความที่คุณส่งถึงลูกค้า</p>
        <div className="flex min-w-0 justify-end">
          <p className={`max-w-[88%] min-w-0 whitespace-pre-wrap rounded-[22px] rounded-br-md bg-gradient-to-br from-blue-500 to-blue-600 px-4 py-3 text-sm leading-relaxed text-white shadow-sm shadow-blue-200/70 [overflow-wrap:anywhere] ${hasMessage ? '' : 'italic'}`}>
            {hasMessage ? message : 'ข้อความของคุณจะแสดงที่นี่'}
          </p>
        </div>
        <div className="mt-2 flex justify-end" aria-hidden>
          <span className="grid h-3.5 w-3.5 place-items-center rounded-full bg-blue-100 text-blue-500"><Check className="h-2.5 w-2.5" /></span>
        </div>
      </div>

      <div aria-hidden className="flex items-center gap-3 border-t border-slate-100 px-4 py-3 text-blue-500">
        <ImageIcon className="h-5 w-5 shrink-0" />
        <span className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-full bg-slate-100 px-4 py-2 text-xs text-slate-400">
          <span className="truncate">พิมพ์ข้อความ…</span><Smile className="h-4 w-4 shrink-0 text-blue-500" />
        </span>
        <MessageCircle className="h-5 w-5 shrink-0" />
      </div>
    </section>
  )
}
