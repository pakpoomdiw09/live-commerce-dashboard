'use client'

import { useState } from 'react'
import { SendHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiError } from '@/lib/utils'

/** Admin reply. The sent message shows up in the thread through Realtime, like every other one. */
export function ReplyBox({ customerId }: { customerId: string }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId, text: body, clientId: crypto.randomUUID() }),
      })
      if (!res.ok) throw new Error(await apiError(res))
      setText('')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg.includes('2018278') ? 'ส่งไม่ได้: เกิน 24 ชั่วโมงนับจากข้อความล่าสุดของลูกค้า' : `ส่งไม่สำเร็จ: ${msg}`)
    } finally {
      setSending(false)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void send()
      }}
      className="border-t border-slate-200 bg-white p-3"
    >
      {error && (
        <p role="alert" className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}
      <div className="flex items-end gap-2 rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200 focus-within:bg-white focus-within:ring-2 focus-within:ring-emerald-500/40">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter adds a line; ignore Enter while a Thai IME is composing
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void send()
            }
          }}
          rows={2}
          maxLength={2000}
          placeholder="พิมพ์ข้อความตอบลูกค้า (Enter ส่ง, Shift+Enter ขึ้นบรรทัดใหม่)"
          aria-label="ข้อความตอบกลับ"
          className="scrollbar-thin max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm placeholder:text-slate-400 focus:outline-none"
        />
        <Button type="submit" loading={sending} disabled={!text.trim()} aria-label="ส่งข้อความ" className="h-10">
          {!sending && <SendHorizontal className="h-4 w-4" aria-hidden />}
          ส่ง
        </Button>
      </div>
    </form>
  )
}
