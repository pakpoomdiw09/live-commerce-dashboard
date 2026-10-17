'use client'

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { SUPPORTED_BANKS, findBank, isSupportedBank, UNSUPPORTED_BANK_MESSAGE } from '@/lib/banks'
import { BankLogo } from '@/components/BankLogo'
import { cn } from '@/lib/utils'

type BankSelectorProps = {
  value: string
  onChange: (code: string) => void
  label?: string
  disabled?: boolean
  className?: string
}

/** Search and selection stay in the browser; the stored bank code is unchanged. */
export function BankSelector({ value, onChange, label = 'ธนาคาร', disabled = false, className }: BankSelectorProps) {
  const id = useId()
  const listId = `${id}-banks`
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeCode, setActiveCode] = useState(value)
  const selected = findBank(value)
  const options = useMemo(() => {
    const search = query.trim().normalize('NFKC').toLocaleLowerCase('th-TH')
    return SUPPORTED_BANKS.filter(bank => !search || [bank.name, bank.englishName, bank.code, bank.slipCode, bank.short, ...bank.aliases]
      .some(part => part?.normalize('NFKC').toLocaleLowerCase('th-TH').includes(search)))
  }, [query])
  const activeIndex = Math.max(0, options.findIndex(bank => bank.code === activeCode))
  const active = options[activeIndex]

  const close = () => { setOpen(false); setQuery('') }
  const show = () => {
    if (disabled) return
    setQuery('')
    setActiveCode(SUPPORTED_BANKS.find(bank => bank.code === selected?.code)?.code ?? SUPPORTED_BANKS[0]?.code ?? '')
    setOpen(true)
  }
  const choose = (code: string) => {
    onChange(code)
    close()
    input.current?.focus({ preventScroll: true })
  }

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close()
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open])

  useEffect(() => {
    if (disabled) { setOpen(false); setQuery('') }
  }, [disabled])

  useEffect(() => {
    if (open && active) document.getElementById(`${id}-${active.code}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [open, active, id])

  function navigate(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) { event.stopPropagation(); return }
    if (event.key === 'Tab') { close(); return }
    if (event.key === 'Escape') {
      if (open) { event.preventDefault(); event.stopPropagation(); close() }
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      if (!open) show()
      else if (active) choose(active.code)
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    if (!open) { show(); return }
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
      : event.key === 'ArrowDown' ? (activeIndex + 1) % options.length
        : (activeIndex - 1 + options.length) % options.length
    if (options[next]) setActiveCode(options[next].code)
  }

  return <div ref={root} className={cn('relative min-w-0 w-full', className)}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close() }}>
    <label htmlFor={id} className="mb-2 block text-sm font-medium text-slate-600">{label}</label>
    <div className={cn('flex min-h-[60px] min-w-0 items-center gap-3 rounded-xl border bg-white px-3 transition focus-within:border-orange-400 focus-within:ring-2 focus-within:ring-orange-100', disabled ? 'border-slate-200 bg-slate-50 opacity-60' : 'border-slate-200')}>
      <BankLogo code={selected?.code ?? value} className="h-10! w-10!" />
      <input ref={input} id={id} type="text" role="combobox" autoComplete="off" spellCheck={false}
        aria-label={label} aria-expanded={open} aria-haspopup="listbox" aria-controls={listId}
        aria-autocomplete="list" aria-activedescendant={open && active ? `${id}-${active.code}` : undefined}
        aria-describedby={`${id}-hint${value && !isSupportedBank(value) ? ` ${id}-support` : ''}`} disabled={disabled}
        value={open ? query : selected?.name ?? value}
        placeholder="ค้นหาชื่อธนาคาร หรือรหัสธนาคาร"
        onFocus={show} onClick={() => { if (!open) show() }} onKeyDown={navigate}
        onChange={event => { setQuery(event.target.value); setOpen(true); setActiveCode('') }}
        className="min-w-0 flex-1 truncate bg-transparent py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed" />
      <button type="button" aria-label={open ? 'ปิดรายชื่อธนาคาร' : 'เปิดรายชื่อธนาคาร'}
        disabled={disabled} tabIndex={-1} className="shrink-0 rounded-lg p-1 text-slate-500 hover:bg-orange-50 disabled:cursor-not-allowed"
        onMouseDown={event => event.preventDefault()}
        onClick={() => { if (open) close(); else { input.current?.focus(); show() } }}>
        <ChevronDown aria-hidden className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
      </button>
    </div>
    <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">ค้นหาได้ด้วยชื่อภาษาไทย ภาษาอังกฤษ หรือรหัสธนาคาร</p>
    {value && !isSupportedBank(value) && <p id={`${id}-support`} className="mt-1 text-xs text-amber-700" role="status">{UNSUPPORTED_BANK_MESSAGE}</p>}
    {open && <div className="absolute inset-x-0 top-full z-40 mt-2 max-h-[420px] overflow-y-auto overscroll-contain rounded-xl border border-orange-100 bg-white shadow-xl">
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-xs text-slate-500" aria-live="polite">
        <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />พบ {options.length} รายการ
      </div>
      <div id={listId} role="listbox" aria-label={`รายชื่อ${label}`}>
        {options.map(bank => <div key={bank.code} id={`${id}-${bank.code}`} role="option" aria-selected={selected?.code === bank.code}
          onMouseDown={event => event.preventDefault()} onPointerMove={() => setActiveCode(bank.code)} onClick={() => choose(bank.code)}
          className={cn('flex min-h-[60px] cursor-pointer items-center gap-3 px-3 py-2', active?.code === bank.code ? 'bg-orange-50' : 'hover:bg-slate-50')}>
          <BankLogo code={bank.code} className="h-10! w-10!" />
          <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium leading-snug text-slate-900">{bank.name}</span>
            <span className="block truncate text-xs text-slate-500">{bank.englishName} · {bank.code}</span>
            {bank.support === 'manual' && <span className="block text-[11px] text-amber-700">ตรวจสลิปอัตโนมัติ: ยังไม่รองรับ</span>}</span>
          {selected?.code === bank.code && <Check className="h-4 w-4 shrink-0 text-orange-600" aria-hidden />}
        </div>)}
      </div>
      {!options.length && <p className="p-4 text-sm text-slate-500" role="status">ไม่พบธนาคารที่ค้นหา ลองค้นหาด้วยชื่อหรือรหัสอื่น</p>}
    </div>}
  </div>
}
