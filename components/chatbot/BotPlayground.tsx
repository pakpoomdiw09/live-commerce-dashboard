'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Loader2, RotateCcw, Send } from 'lucide-react'
import type { BotSettings } from '@/lib/chatbot'
import { apiError, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { inputClass } from '@/components/ui/field'
import { MessengerPreview } from './MessengerPreview'

type Turn = { role: 'user' | 'model'; text: string; imageUrl?: string | null; quickReplies?: string[] }
type Reply = { text: string | null; handover: boolean; imageUrl: string | null; quickReplies: string[] }

export function BotPlayground({ tenantId, settings }: { tenantId: string; settings: BotSettings }) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [handedOver, setHandedOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [silent, setSilent] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const sending = useRef(false)
  const log = useRef<HTMLDivElement>(null)
  useEffect(() => () => { controller.current?.abort() }, [])
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight }, [turns, busy, handedOver])

  function reset() {
    controller.current?.abort()
    controller.current = null
    sending.current = false
    setBusy(false); setTurns([]); setInput(''); setError(null); setHandedOver(false); setSilent(false)
  }
  async function send(event: FormEvent) {
    event.preventDefault()
    const text = input.trim()
    if (!text || sending.current || handedOver) return
    const pending: Turn[] = [...turns, { role: 'user', text }]
    const abort = new AbortController()
    controller.current = abort
    sending.current = true
    setTurns(pending); setInput(''); setBusy(true); setError(null); setSilent(false)
    try {
      const res = await fetch('/api/chatbot/test-reply', { method: 'POST', signal: abort.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId,
          settings: { reply_mode: settings.reply_mode, ai_instructions: settings.ai_instructions,
            fallback_text: settings.fallback_text, fallback_messages: settings.fallback_messages, handover_keywords: settings.handover_keywords, handover_text: settings.handover_text, handover_messages: settings.handover_messages },
          messages: pending.filter(turn => turn.text.trim()).slice(-12).map(({ role, text }) => ({ role, text })),
        }) })
      if (!res.ok) throw new Error(await apiError(res))
      const reply = await res.json() as Reply
      if (abort.signal.aborted) return
      setHandedOver(reply.handover)
      if (reply.text || reply.imageUrl) setTurns([...pending, { role: 'model', text: reply.text ?? '', imageUrl: reply.imageUrl, quickReplies: reply.quickReplies }])
      else setSilent(!reply.handover)
    } catch (cause) {
      if (!abort.signal.aborted) {
        setTurns(turns); setInput(text)
        setError(cause instanceof Error ? cause.message : 'ทดสอบไม่สำเร็จ')
      }
    } finally {
      if (controller.current === abort) { sending.current = false; setBusy(false); controller.current = null }
    }
  }
  return <Card>
    <CardHeader title="ทดสอบบอท" description="คุยจากการตั้งค่าที่กำลังแก้ไขได้ทันที โดยไม่ต้องบันทึก" />
    <div className="space-y-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500">{settings.reply_mode === 'ai' ? 'AI Agent' : 'Keyword Matching'} · ลูกค้าทดสอบ</span>
        <Button size="sm" variant="secondary" onClick={reset} aria-label="ล้างประวัติการทดสอบ"><RotateCcw className="h-3.5 w-3.5" aria-hidden />Reset Chat</Button>
      </div>
      <div ref={log} role="log" aria-label="ประวัติการทดสอบบอท" aria-live="polite" className="h-80 space-y-4 overflow-y-auto rounded-2xl bg-slate-50 p-4">
        {!turns.length && <p className="py-12 text-center text-sm text-slate-400">พิมพ์ข้อความเพื่อเริ่มทดสอบคุยกับบอท</p>}
        {turns.map((turn, index) => <div key={index} className={cn('flex flex-col', turn.role === 'user' ? 'items-end' : 'items-start')}>
          <span className="mb-1 text-[11px] text-slate-400">{turn.role === 'user' ? 'ลูกค้าทดสอบ' : 'บอท'}</span>
          {turn.role === 'user' ? <p className="max-w-[90%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-sm bg-orange-500 px-4 py-2 text-sm text-white">{turn.text}</p>
            : <MessengerPreview text={turn.text} imageUrl={turn.imageUrl} quickReplies={turn.quickReplies} />}
        </div>)}
        {busy && <p className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />บอทกำลังตอบ…</p>}
      </div>
      {handedOver && <p role="status" className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">ส่งต่อแอดมินแล้ว บอทหยุดตอบในแชทจำลองนี้ กด Reset Chat เพื่อเริ่มใหม่</p>}
      {silent && <p role="status" className="text-xs text-slate-500">ไม่ตรงคีย์เวิร์ดและไม่มีข้อความสำรอง บอทจึงไม่ตอบ</p>}
      {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
      <form onSubmit={send} className="flex gap-2">
        <input aria-label="ข้อความทดสอบ" value={input} onChange={e => setInput(e.target.value)} maxLength={2000} disabled={busy || handedOver}
          placeholder="พิมพ์ข้อความแล้วกด Enter" className={cn(inputClass, 'min-w-0 flex-1')} />
        <Button type="submit" disabled={busy || handedOver || !input.trim()} aria-label="ส่งข้อความทดสอบ"><Send className="h-4 w-4" aria-hidden /></Button>
      </form>
    </div>
  </Card>
}
