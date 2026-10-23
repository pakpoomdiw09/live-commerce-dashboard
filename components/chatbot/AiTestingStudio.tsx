'use client'

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { PlaygroundProductImage } from '@/components/chatbot/PlaygroundProductImage'
import {
  AlertCircle,
  Bot,
  LoaderCircle,
  RotateCcw,
  Send,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import type { BotSettings } from '@/lib/features/agents/chatbot'

type Turn = {
  id: number
  role: 'user' | 'model' | 'system'
  text: string
  time?: string
  providerCalled?: boolean
  handover?: boolean
  imageUrl?: string | null
}

type Reply = {
  text: string | null
  image_url?: string | null
  imageUrl: string | null
  handover: boolean
  route: 'keyword' | 'ai' | 'handover' | 'none'
  providerCalled?: boolean
  elapsedMs: number
}

const SAMPLE_MESSAGES = [
  'สวัสดีครับ มีสินค้าอะไรบ้าง?',
  'สินค้านี้ราคาเท่าไหร่?',
  'มีโปรโมชั่นวันนี้ไหม?',
  'ขอทราบค่าจัดส่ง',
]

const timeLabel = (time: string) =>
  new Date(time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })

export function AiTestingStudio({
  tenantId,
  settings,
  activeRuleCount,
  aiAllowed,
}: {
  tenantId: string
  settings: BotSettings
  activeRuleCount: number
  aiAllowed: boolean
  embedded?: boolean
}) {
  const welcomeMessage = aiAllowed
    ? 'พื้นที่ทดสอบระบบ: หากข้อความตรงกับคำที่ตั้งค่าไว้ ระบบจะตอบตามกฎของร้าน หากไม่ตรง ระบบจะส่งให้ AI จริงประมวลผลโดยใช้ข้อมูลสอนที่ตั้งไว้'
    : 'ฟีเจอร์นี้สำหรับผู้ใช้งานแพ็กเกจเท่านั้น'
  const [turns, setTurns] = useState<Turn[]>([{ id: 0, role: 'system', text: welcomeMessage }])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [retryText, setRetryText] = useState('')
  const log = useRef<HTMLDivElement>(null)
  const lock = useRef(false)
  const sequence = useRef(0)

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight
  }, [turns, busy])

  async function runTrial(text: string, retry = false) {
    const trimmed = text.trim()
    if (!trimmed || lock.current || !aiAllowed) return

    const pending = retry
      ? turns
      : [
          ...turns,
          {
            id: ++sequence.current,
            role: 'user' as const,
            text: trimmed,
            time: new Date().toISOString(),
          },
        ]
    const messages = pending
      .filter((turn) => turn.role !== 'system')
      .slice(-12)
      .map((turn) => ({ role: turn.role, text: turn.text }))
    if (messages.at(-1)?.role !== 'user') messages.push({ role: 'user', text: trimmed })

    lock.current = true
    setBusy(true)
    setError('')
    setRetryText('')
    setInput('')
    if (!retry) setTurns(pending)

    try {
      const response = await fetch('/api/chatbot/test-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          tenantId,
          settings: {
            reply_mode: settings.reply_mode,
            ai_instructions: settings.ai_instructions,
            handover_keywords: settings.handover_keywords,
            handover_text: settings.handover_text,
            handover_messages: settings.handover_messages,
          },
          messages,
          mode: 'chat',
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'ทดสอบไม่สำเร็จ กรุณาลองใหม่')

      const reply = result as Reply
      const now = new Date().toISOString()
      if (reply.text || reply.image_url || reply.imageUrl) {
        setTurns((current) => [
          ...current,
          {
            id: ++sequence.current,
            role: 'model',
            text: reply.text ?? '',
            time: now,
            providerCalled: reply.providerCalled,
            handover: reply.handover,
            imageUrl: reply.image_url ?? reply.imageUrl,
          },
        ])
      } else {
        const message = reply.route === 'none' ? 'ไม่มีคำตอบจากระบบในรอบนี้' : 'ไม่มีข้อความตอบกลับ'
        setTurns((current) => [
          ...current,
          {
            id: ++sequence.current,
            role: 'system',
            text: message,
            time: now,
          },
        ])
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ทดสอบไม่สำเร็จ กรุณาลองใหม่')
      setRetryText(trimmed)
      if (!retry) setInput(trimmed)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void runTrial(input)
  }

  function composerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void runTrial(input)
    }
  }

  function clearChat() {
    if (
      !turns.length ||
      window.confirm('ล้างบทสนทนาทดลองนี้หรือไม่? ข้อความจริงของลูกค้าไม่ได้รับผลกระทบ')
    ) {
      setTurns([{ id: 0, role: 'system', text: welcomeMessage }])
      setError('')
      setRetryText('')
    }
  }

  const surface = 'border-blue-100 bg-white text-slate-900'

  return (
    <section className={`overflow-hidden rounded-3xl border shadow-sm ${surface}`}>
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-blue-100 bg-white p-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-blue-100 bg-blue-50 text-blue-700">
            <Bot className="h-6 w-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold">ทดลองตอบด้วย AI</h2>
            <p className={`mt-1 max-w-lg text-xs leading-6 ${'text-slate-500'}`}>
              พิมพ์คำถามจำลองเพื่อทดลองผู้ช่วย AI ที่ใช้ข้อมูลร้านค้า สินค้า
              และข้อความที่บันทึกไว้เป็นคลังความรู้ โดยไม่ส่งข้อความหาลูกค้าจริง
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={clearChat}
          className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-500"
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
          เริ่มบทสนทนาใหม่
        </button>
      </header>

      <p className="mx-4 mt-4 flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-900 sm:mx-6">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          ข้อความจะถูกประมวลผลตามสิทธิ์และโควตาของร้าน
          แต่จะไม่ส่งหาลูกค้าจริงหรือบันทึกลงกล่องข้อความเพจ
        </span>
      </p>
      {!aiAllowed && (
        <p
          role="status"
          className="mx-4 mt-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900 sm:mx-6"
        >
          ฟีเจอร์นี้สำหรับผู้ใช้งานแพ็กเกจเท่านั้น
        </p>
      )}

      <div
        ref={log}
        role="log"
        aria-label="บทสนทนาทดลอง"
        aria-live="polite"
        className={`h-[min(58vh,560px)] min-h-[320px] space-y-5 overflow-y-auto p-4 sm:p-6 ${'bg-white'}`}
      >
        {!turns.length ? (
          <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-blue-50 text-blue-600">
              <Bot className="h-7 w-7" aria-hidden />
            </span>
            <h3 className="mt-4 font-semibold">เริ่มพิมพ์ข้อความเพื่อทดลองคุย</h3>
            <p className={`mt-2 max-w-md text-sm leading-6 ${'text-slate-500'}`}>
              ระบบจะตรวจคำที่ตั้งค่าไว้ก่อน หากไม่พบ AI จะประมวลผลจากข้อมูลสอนและเนื้อหาการสนทนานี้
            </p>
          </div>
        ) : (
          turns.map((turn) => (
            <article
              key={turn.id}
              className={`flex gap-2.5 ${turn.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              <span
                className={`mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-xl ${
                  turn.role === 'user'
                    ? 'border border-blue-100 bg-blue-50 text-blue-700'
                    : turn.role === 'system'
                      ? 'border border-blue-100 bg-blue-50 text-blue-700'
                      : 'border border-blue-100 bg-white text-blue-600'
                }`}
              >
                {turn.role === 'user' ? (
                  <UserRound className="h-4 w-4" aria-hidden />
                ) : turn.role === 'system' ? (
                  <AlertCircle className="h-4 w-4" aria-hidden />
                ) : (
                  <Bot className="h-4 w-4" aria-hidden />
                )}
              </span>
              <div className={`min-w-0 max-w-[88%] ${turn.role === 'user' ? 'text-right' : ''}`}>
                <div className={`mb-1 flex items-center gap-2 text-[11px] ${'text-slate-500'}`}>
                  <span className="font-semibold">
                    {turn.role === 'user'
                      ? 'คุณ'
                      : turn.role === 'system'
                        ? 'ข้อความแจ้ง'
                        : turn.handover
                          ? 'ส่งต่อผู้ดูแลร้าน'
                          : turn.providerCalled
                            ? 'AI'
                            : 'กฎของร้าน'}
                  </span>
                  {turn.time && <time>{timeLabel(turn.time)}</time>}
                </div>
                <div
                  className={`whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-left text-sm leading-6 ${
                    turn.role === 'user'
                      ? 'rounded-tr-sm bg-blue-600 text-white'
                      : turn.role === 'system'
                        ? 'rounded-tl-sm border border-blue-100 bg-blue-50 text-blue-900'
                        : 'rounded-tl-sm border border-blue-100 bg-blue-50/60 text-slate-800'
                  }`}
                >
                  {turn.text}
                  {turn.imageUrl && (
                    <PlaygroundProductImage key={turn.imageUrl} src={turn.imageUrl} />
                  )}
                </div>
              </div>
            </article>
          ))
        )}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <LoaderCircle className="h-4 w-4 animate-spin text-blue-600" aria-hidden />
            กำลังประมวลผลข้อความทดลอง...
          </div>
        )}
      </div>

      <footer className="border-t border-blue-100 bg-white p-4 sm:p-5">
        <div className="mb-3">
          <p className={`mb-2 text-xs font-medium ${'text-slate-600'}`}>ลองถามตัวอย่าง</p>
          <div className="flex flex-wrap gap-2">
            {SAMPLE_MESSAGES.map((message) => (
              <button
                key={message}
                type="button"
                disabled={!aiAllowed || busy}
                onClick={() => setInput(message)}
                className="rounded-full border border-blue-100 bg-white px-3 py-1.5 text-xs text-blue-800 transition hover:border-blue-300 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {message}
              </button>
            ))}
          </div>
        </div>
        {aiAllowed && (
          <p className={`mb-3 text-xs ${'text-slate-500'}`}>
            ผู้ช่วย AI ใช้ข้อมูลร้าน สินค้า และข้อความที่บันทึกไว้ การทดลองใช้โควตา AI ของร้าน
            และจะส่งต่อแอดมินเมื่อไม่สามารถตอบได้
          </p>
        )}
        {error && (
          <div
            role="alert"
            className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5 text-sm text-blue-900"
          >
            <span className="inline-flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
              {error}
            </span>
            {retryText && (
              <button
                type="button"
                onClick={() => void runTrial(retryText, true)}
                disabled={busy}
                className="shrink-0 font-semibold underline"
              >
                ลองอีกครั้ง
              </button>
            )}
          </div>
        )}
        <form
          onSubmit={submit}
          className="flex items-end gap-2 rounded-2xl border border-blue-200 bg-white p-1.5 shadow-sm focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100"
        >
          <textarea
            aria-label="ข้อความทดลอง"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={composerKeyDown}
            maxLength={2000}
            rows={1}
            disabled={busy || !aiAllowed}
            placeholder={
              aiAllowed
                ? 'พิมพ์ข้อความที่ต้องการทดลอง...'
                : 'ฟีเจอร์นี้สำหรับผู้ใช้งานแพ็กเกจเท่านั้น'
            }
            className="max-h-32 min-h-10 min-w-0 flex-1 resize-y border-0 bg-transparent px-2 py-2 text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400 focus:ring-0"
          />
          <button
            type="submit"
            disabled={busy || !input.trim() || !aiAllowed}
            aria-label="ส่งข้อความทดลอง"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-600 text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            {busy ? (
              <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden />
            ) : (
              <Send className="h-5 w-5" aria-hidden />
            )}
          </button>
        </form>
        <p className="mt-2 flex flex-wrap justify-between gap-2 text-[11px] text-slate-400">
          <span>ใช้ปุ่มส่งเพื่อส่งข้อความ · กดปุ่มขึ้นบรรทัดใหม่เพื่อเว้นบรรทัด</span>
          <span>{input.length}/2,000</span>
        </p>
      </footer>
    </section>
  )
}
