'use client'

import { useEffect, useId, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { field, orange } from './session-ui'

const EMOJI_CATEGORIES = [
  {
    label: 'ปิดรอบ / ห้าม',
    emojis: ['❌', '🚫', '🛑', '⛔', '🔒', '⏹️', '✖️'],
  },
  {
    label: 'ตัวเลข / ยืนยัน',
    emojis: ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '0️⃣', '➕', '1'],
  },
  {
    label: 'รูปมือ / สัญลักษณ์',
    emojis: ['👍', '👌', '🔥', '💯', '📦', '💰', '🏷️', '👑'],
  },
  {
    label: 'หัวใจ',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍'],
  },
] as const

export function AuctionKeywordEditor({
  label,
  kind,
  keywords,
  onChange,
  onEdited,
  normalize,
  disabled,
}: {
  label: string
  kind: 'bid' | 'close'
  keywords: string[]
  onChange: Dispatch<SetStateAction<string[]>>
  onEdited: () => void
  normalize: (text: string) => string
  disabled: boolean
}) {
  const id = useId()
  const pickerId = useId()
  const editorRef = useRef<HTMLDivElement>(null)
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const closing = kind === 'close'
  const name = closing ? 'คำปิดรอบ' : 'คำดัก'

  useEffect(() => {
    if (!pickerOpen) return
    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !editorRef.current?.contains(event.target)) {
        setPickerOpen(false)
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setPickerOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [pickerOpen])

  function add(text: string, clearInput = true) {
    if (disabled) return
    const word = normalize(text)
    if (!word) return
    if (word.length > 40 || /[\r\n{}]/u.test(word)) {
      setError('แต่ละคำยาวได้ไม่เกิน 40 ตัวอักษร และไม่มีวงเล็บปีกกาหรือการขึ้นบรรทัดใหม่')
      return
    }
    // Check inside the update as well: rapid clicks can share the same render.
    onChange((previous) =>
      previous.some((value) => normalize(value) === word) ? previous : [...previous, word],
    )
    if (clearInput) setInput('')
    setError('')
    onEdited()
  }
  return (
    <div
      ref={editorRef}
      className="relative min-w-0 space-y-2 text-sm font-semibold"
      data-auction-keyword-editor={kind}
    >
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id}>{label}</label>
        <span className="shrink-0 text-xs tabular-nums text-slate-400" aria-label={`จำนวน${name}`}>
          {keywords.length} คำ
        </span>
      </div>
      <div className="flex min-h-9 flex-wrap gap-1.5" aria-label={`${name}ที่เลือก`}>
        {keywords.map((word) => (
          <span
            key={word}
            className="inline-flex max-w-full items-center gap-1 break-all rounded-full bg-orange-50 py-1 pl-3 pr-1 text-orange-800"
          >
            {word}
            <button
              type="button"
              disabled={disabled}
              aria-label={`ลบ${name} ${word}`}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-orange-100 disabled:opacity-40"
              onClick={() => {
                onChange((previous) => previous.filter((value) => value !== word))
                setError('')
                onEdited()
              }}
            >
              <span aria-hidden="true">×</span>
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          id={id}
          aria-label={label}
          className={`${field} !mt-0`}
          maxLength={40}
          value={input}
          disabled={disabled}
          onChange={(event) => {
            setInput(event.target.value)
            setError('')
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              add(input)
            }
          }}
          placeholder={`พิมพ์${name} แล้วกด Enter หรือ +`}
        />
        <button
          type="button"
          aria-label={`เพิ่ม${name}`}
          className={`${orange} shrink-0`}
          disabled={disabled || !input.trim()}
          onClick={() => add(input)}
        >
          +
        </button>
        <button
          type="button"
          aria-label={`เปิดแป้นพิมพ์อีโมจิ${name}`}
          aria-expanded={pickerOpen}
          aria-controls={pickerId}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-lg shadow-sm transition hover:border-orange-400 hover:bg-orange-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500 disabled:opacity-40"
          disabled={disabled}
          onClick={() => setPickerOpen((open) => !open)}
        >
          ☺
        </button>
      </div>
      {pickerOpen && (
        <div
          id={pickerId}
          role="dialog"
          aria-label={`แป้นพิมพ์อีโมจิ${name}`}
          className="absolute left-0 top-full z-30 mt-2 max-h-80 w-full min-w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-slate-700">
              เลือกอีโมจิเพื่อเพิ่มเป็นแท็ก
            </span>
            <button
              type="button"
              aria-label="ปิดแป้นพิมพ์อีโมจิ"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              onClick={() => setPickerOpen(false)}
            >
              ×
            </button>
          </div>
          <div className="space-y-3">
            {EMOJI_CATEGORIES.map(({ label: category, emojis }) => (
              <section key={category} aria-label={category}>
                <h4 className="mb-1.5 text-xs font-medium text-slate-500">{category}</h4>
                <div className="flex flex-wrap gap-1.5">
                  {emojis.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      aria-label={`เพิ่มอีโมจิ ${emoji}`}
                      disabled={disabled}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-lg shadow-sm transition hover:border-orange-400 hover:bg-orange-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500 active:scale-95 disabled:opacity-40"
                      onClick={() => add(emoji, false)}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs font-normal text-red-700">
          {error}
        </p>
      )}
      <p className="text-xs font-normal text-slate-500">
        พิมพ์คำเองแล้วกด Enter หรือ + หรือเลือกอีโมจิเพื่อเพิ่มเป็นแท็กได้ไม่จำกัด
      </p>
    </div>
  )
}
