'use client'

import { useRef } from 'react'

const field =
  'mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 disabled:opacity-50'

export function LiveSwitch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50 ${checked ? 'bg-orange-500' : 'bg-slate-300'}`}
    >
      <span
        className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${checked ? 'left-6' : 'left-1'}`}
      />
    </button>
  )
}

export function LiveTemplateEditor({
  label,
  value,
  onChange,
  variables = [],
  rows = 4,
  disabled = false,
  maxLength = 1500,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  variables?: readonly { tag: string; label: string }[]
  rows?: number
  disabled?: boolean
  maxLength?: number
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  function insert(tag: string) {
    const start = ref.current?.selectionStart ?? value.length
    const end = ref.current?.selectionEnd ?? start
    const next = value.slice(0, start) + tag + value.slice(end)
    if (next.length > maxLength) return
    onChange(next)
    requestAnimationFrame(() => {
      ref.current?.focus()
      ref.current?.setSelectionRange(start + tag.length, start + tag.length)
    })
  }
  return (
    <div className="min-w-0 space-y-2">
      <textarea
        ref={ref}
        aria-label={label}
        className={`${field} resize-y`}
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        maxLength={maxLength}
      />
      {!!variables.length && (
        <div className="flex flex-wrap gap-1.5" aria-label={`ตัวแปร ${label}`}>
          {variables.map((chip) => (
            <button
              key={chip.tag}
              type="button"
              disabled={disabled}
              title={`ใส่${chip.label}ในข้อความ`}
              onClick={() => insert(chip.tag)}
              className="rounded-lg border border-orange-200 bg-white px-2.5 py-1 text-xs font-semibold text-orange-700 hover:bg-orange-50 disabled:opacity-50"
            >
              + {chip.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export type ReceivingBank = {
  id: string
  bank_code: string
  account_number: string
  is_primary?: boolean | null
}
export function ReceivingBankPicker({
  accounts,
  value,
  onChange,
  required = false,
  disabled = false,
}: {
  accounts: ReceivingBank[]
  value: string
  onChange: (value: string) => void
  required?: boolean
  disabled?: boolean
}) {
  return (
    <label className="block text-sm font-semibold text-slate-800">
      บัญชีรับเงิน
      <select
        aria-label="เลือกบัญชีรับเงิน"
        className={field}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        disabled={disabled}
      >
        <option value="">ยังไม่เลือกบัญชี</option>
        {accounts.map((bank) => (
          <option key={bank.id} value={bank.id}>
            {bank.bank_code} • {bank.account_number}
            {bank.is_primary ? ' • บัญชีหลัก' : ''}
          </option>
        ))}
      </select>
    </label>
  )
}
