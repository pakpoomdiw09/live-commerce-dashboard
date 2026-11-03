'use client'

import { useId, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { field, orange } from './session-ui'

export function AuctionKeywordEditor({
  label, kind, keywords, onChange, onEdited, normalize, emojiKeys, disabled,
}: {
  label: string
  kind: 'bid' | 'close'
  keywords: string[]
  onChange: Dispatch<SetStateAction<string[]>>
  onEdited: () => void
  normalize: (text: string) => string
  emojiKeys?: string[]
  disabled: boolean
}) {
  const id = useId()
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const inputValue = useRef('')
  const closing = kind === 'close'
  const name = closing ? 'คำปิดรอบ' : 'คำดัก'
  function add(text: string) {
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
    inputValue.current = ''
    setInput('')
    setError('')
    onEdited()
  }
  function appendEmoji(emoji: string) {
    if (disabled) return
    const next = inputValue.current + emoji
    if (normalize(next).length > 40) {
      setError('แต่ละคำยาวได้ไม่เกิน 40 ตัวอักษร')
      return
    }
    inputValue.current = next
    setInput(next)
    setError('')
  }
  return (
    <div className="min-w-0 space-y-2 text-sm font-semibold" data-auction-keyword-editor={kind}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id}>{label}</label>
        <span className="shrink-0 text-xs tabular-nums text-slate-400" aria-label={`จำนวน${name}`}>
          {keywords.length} คำ
        </span>
      </div>
      <div className="flex min-h-9 flex-wrap gap-1.5" aria-label={`${name}ที่เลือก`}>
        {keywords.map((word) => (
          <span key={word} className="inline-flex max-w-full items-center gap-1 break-all rounded-full bg-orange-50 py-1 pl-3 pr-1 text-orange-800">
            {word}
            <button type="button" disabled={disabled} aria-label={`ลบ${name} ${word}`}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-orange-100 disabled:opacity-40"
              onClick={() => {
                onChange((previous) => previous.filter((value) => value !== word))
                setError('')
                onEdited()
              }}>
              <span aria-hidden="true">×</span>
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input id={id} aria-label={label} className={`${field} !mt-0`} maxLength={40}
          value={input} disabled={disabled}
          onChange={(event) => {
            inputValue.current = event.target.value
            setInput(event.target.value)
            setError('')
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              add(input)
            }
          }}
          placeholder={closing ? 'พิมพ์คำ แล้วเลือกอีโมจิหรือกด +' : 'พิมพ์คำดัก แล้วกด Enter หรือ +'}
        />
        <button type="button" aria-label={`เพิ่ม${name}`} className={`${orange} shrink-0`}
          disabled={disabled || !input.trim()} onClick={() => add(input)}>
          +
        </button>
      </div>
      {closing && emojiKeys?.length ? (
        <div className="grid w-fit max-w-full grid-cols-6 gap-1.5 sm:grid-cols-8" aria-label="แป้นพิมพ์อีโมจิปิดรอบ">
          {emojiKeys.map((emoji) => (
            <button key={emoji} type="button" aria-label={`เพิ่มอีโมจิ ${emoji}`}
              disabled={disabled}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-lg shadow-sm transition hover:border-orange-400 hover:bg-orange-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500 active:scale-95 disabled:opacity-40"
              onClick={() => appendEmoji(emoji)}>{emoji}</button>
          ))}
        </div>
      ) : null}
      {error && <p role="alert" className="text-xs font-normal text-red-700">{error}</p>}
      <p className="text-xs font-normal text-slate-500">
        {closing
          ? 'กดอีโมจิเพื่อพิมพ์ต่อท้ายช่องได้ซ้ำตามต้องการ แล้วกด Enter หรือ + เพื่อเพิ่มเป็นแท็ก'
          : 'พิมพ์คำดักเองแล้วกด Enter หรือ + เพื่อเพิ่มเป็นแท็กได้ไม่จำกัด'}
      </p>
    </div>
  )
}
