'use client'

import { useId, useState, type Dispatch, type SetStateAction } from 'react'
import { field, orange } from './session-ui'

export function AuctionKeywordEditor({
  label, kind, keywords, onChange, onEdited, normalize, presets, limit, disabled,
}: {
  label: string
  kind: 'bid' | 'close'
  keywords: string[]
  onChange: Dispatch<SetStateAction<string[]>>
  onEdited: () => void
  normalize: (text: string) => string
  presets: string[]
  limit: number
  disabled: boolean
}) {
  const id = useId()
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const closing = kind === 'close'
  const name = closing ? 'คำปิดรอบ' : 'คำดัก'
  const full = keywords.length >= limit
  function add(text: string) {
    if (disabled) return
    const word = normalize(text)
    if (!word) return
    if (word.length > 40 || /[\r\n{}]/u.test(word)) {
      setError('แต่ละคำยาวได้ไม่เกิน 40 ตัวอักษร และไม่มีวงเล็บปีกกาหรือการขึ้นบรรทัดใหม่')
      return
    }
    if (full && !keywords.some((value) => normalize(value) === word)) {
      setError(`ครบ ${limit} คำแล้ว กรุณาลบบางคำก่อนเพิ่มคำใหม่`)
      return
    }
    // Check inside the update as well: rapid clicks can share the same render.
    onChange((previous) => previous.some((value) => normalize(value) === word) || previous.length >= limit
      ? previous : [...previous, word])
    setInput('')
    setError('')
    onEdited()
  }
  return (
    <div className="min-w-0 space-y-2 text-sm font-semibold" data-auction-keyword-editor={kind}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id}>{label}</label>
        <span className={`shrink-0 text-xs tabular-nums ${full ? 'text-orange-700' : 'text-slate-400'}`} aria-label={`จำนวน${name}`}>
          {keywords.length}/{limit}
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
          value={input} disabled={disabled || full}
          onChange={(event) => { setInput(event.target.value); setError('') }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              add(input)
            }
          }}
          placeholder={full ? `ครบ ${limit} คำแล้ว` : closing ? 'พิมพ์คำหรือวางอีโมจิ แล้วกด +' : 'พิมพ์คำ เช่น 1, เคาะ แล้วกดเพิ่ม'}
        />
        <button type="button" aria-label={`เพิ่ม${name}`} className={`${orange} shrink-0`}
          disabled={disabled || full || !input.trim()} onClick={() => add(input)}>
          {closing ? '+' : '+ เพิ่มคำดัก'}
        </button>
      </div>
      <div className={closing ? 'grid w-fit max-w-full grid-cols-6 gap-1.5 sm:grid-cols-8' : 'flex flex-wrap gap-1.5'}
        aria-label={closing ? 'เพิ่มอีโมจิปิดรอบด่วน' : 'คำดักแนะนำ'}>
        {presets.map((word) => (
          <button key={word} type="button" aria-label={closing ? `เพิ่มอีโมจิ ${word}` : `ใช้คำดัก ${word}`}
            aria-pressed={keywords.some((value) => normalize(value) === normalize(word))}
            disabled={disabled}
            className={`${closing ? 'h-9 w-9 text-lg' : 'min-h-9 min-w-9 px-2 text-xs'} inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white shadow-sm transition hover:border-orange-400 hover:bg-orange-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500 active:scale-95 aria-pressed:border-orange-300 aria-pressed:bg-orange-50 disabled:opacity-40`}
            onClick={() => add(word)}>{word}</button>
        ))}
      </div>
      {full && <p role="status" className="text-xs font-normal text-orange-700">ครบ {limit} คำแล้ว ลบบางคำเพื่อเพิ่มคำใหม่</p>}
      {error && <p role="alert" className="text-xs font-normal text-red-700">{error}</p>}
      <p className="text-xs font-normal text-slate-500">
        {closing
          ? 'กดอีโมจิต่อเนื่องได้ ตัวเดิมจะไม่เพิ่มซ้ำ กด × เพื่อลบ หรือพิมพ์คำแล้วกด +'
          : 'พิมพ์แล้วกด Enter หรือ + เพิ่มคำดัก เลือกคำแนะนำได้สูงสุด 10 คำ โดย F และ f นับเป็นคำเดียวกัน'}
      </p>
    </div>
  )
}
