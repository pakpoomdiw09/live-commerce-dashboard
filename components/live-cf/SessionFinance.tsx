'use client'
import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import {
  inputMoney,
  sessionProfit,
  sessionMoney as money,
  type SessionSnapshot,
} from '@/lib/features/commerce/live-session-types'
import { field, button, type Post } from './session-ui'

export function SessionFinance({ data, post }: { data: SessionSnapshot; post: Post }) {
  const [draft, setDraft] = useState({
    cost: String(data.session.cost_amount),
    ads: String(data.session.ad_spent),
    shipping: String(data.session.shipping_cost),
  })
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const request = useRef(crypto.randomUUID())
  const baseRevision = useRef(data.session.financial_revision)
  useEffect(() => {
    if (!dirty) {
      setDraft({
        cost: String(data.session.cost_amount),
        ads: String(data.session.ad_spent),
        shipping: String(data.session.shipping_cost),
      })
      baseRevision.current = data.session.financial_revision
    }
  }, [
    data.session.cost_amount,
    data.session.ad_spent,
    data.session.shipping_cost,
    data.session.financial_revision,
    dirty,
  ])
  const valid = Object.values(draft).every((value) => inputMoney(value) !== null)
  const profit = valid
    ? sessionProfit(
        data.metrics.paid,
        Number(draft.cost),
        Number(draft.ads),
        Number(draft.shipping),
      )
    : null
  return (
    <form
      className="space-y-3 rounded-xl border border-slate-200 p-4"
      onSubmit={async (event) => {
        event.preventDefault()
        if (!valid) return
        setBusy(true)
        setError('')
        try {
          await post({ action: 'costs', revision: baseRevision.current, ...draft }, request.current)
          setDirty(false)
          request.current = crypto.randomUUID()
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'บันทึกไม่สำเร็จ')
        } finally {
          setBusy(false)
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(
          [
            { key: 'cost', label: 'ต้นทุน (บาท)' },
            { key: 'ads', label: 'ค่าแอด (บาท)' },
            { key: 'shipping', label: 'ค่าส่ง (บาท)' },
          ] as const
        ).map(({ key, label }) => (
          <label key={key} className="text-sm font-medium">
            {label}
            <input
              type="number"
              min="0"
              max="999999999999.99"
              step="0.01"
              required
              aria-label={label}
              className={field}
              disabled={busy}
              value={draft[key]}
              onChange={(event) => {
                setDraft((previous) => ({ ...previous, [key]: event.target.value }))
                setDirty(true)
                request.current = crypto.randomUUID()
              }}
            />
          </label>
        ))}
        <div
          className={`rounded-xl p-3 ${profit !== null && profit < 0 ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}
        >
          <p className="text-xs">กำไรสุทธิ (บาท){dirty && ' • ยังไม่บันทึก'}</p>
          <output aria-label="กำไร Session" className="mt-1 block text-2xl font-bold tabular-nums">
            {profit === null ? '—' : money(profit)}
          </output>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          กำไร = ยอดโอนที่ตรวจผ่าน − (ต้นทุน + ค่าแอด + ค่าส่งที่ร้านจ่าย)
          ค่าส่งส่วนนี้เป็นค่าใช้จ่ายร้าน แยกจากค่าส่งที่เรียกเก็บในบิลลูกค้า
        </p>
        <button type="submit" className={button} disabled={!dirty || !valid || busy}>
          <Check className="mr-1 inline h-4 w-4" />
          {busy ? 'กำลังบันทึก…' : 'บันทึกค่าใช้จ่าย'}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}{' '}
          <button
            type="button"
            className="underline"
            onClick={() => {
              setDirty(false)
              setError('')
              request.current = crypto.randomUUID()
            }}
          >
            ใช้ค่าใช้จ่ายล่าสุด
          </button>
        </p>
      )}
    </form>
  )
}
