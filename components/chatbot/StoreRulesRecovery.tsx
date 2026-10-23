'use client'

import { useEffect, useState } from 'react'
import { parseStoreRules, type StoreRulesIssue } from '@/lib/features/store-rules/store-rule-items'

export function StoreRulesRecovery({
  tenantId,
  initial,
  issues,
  disabled,
  onSaved,
}: {
  tenantId: string
  initial: string
  issues: StoreRulesIssue[]
  disabled: boolean
  onSaved: () => Promise<void>
}) {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(initial),
    [expected, setExpected] = useState(initial)
  const [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  useEffect(() => {
    if (!editing) {
      setDraft(initial)
      setExpected(initial)
    }
  }, [initial, editing])
  const validation = parseStoreRules(draft)
  function download() {
    const url = URL.createObjectURL(new Blob([expected], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'store-rules-backup.txt'
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  async function reload() {
    setBusy(true)
    setError('')
    try {
      await onSaved()
    } catch {
      setError('โหลดกฎใหม่ไม่สำเร็จ ข้อมูลเดิมยังถูกเก็บไว้ กรุณาลองอีกครั้ง')
    } finally {
      setBusy(false)
    }
  }
  async function recover() {
    if (busy || disabled || !confirmed || !validation.ok || draft === expected) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`/api/agent-control?tenantId=${encodeURIComponent(tenantId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instructions: draft,
          expectedInstructions: expected,
          recover: true,
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'กู้คืนกฎไม่สำเร็จ กรุณาลองอีกครั้ง')
      setNotice('บันทึกข้อมูลที่แก้ไขแล้ว ประวัติกฎเดิมยังถูกเก็บไว้')
      setEditing(false)
      setConfirmed(false)
      try {
        await onSaved()
      } catch {
        setError('บันทึกสำเร็จแล้ว แต่ยังโหลดข้อมูลล่าสุดไม่ได้ กรุณากดโหลดกฎใหม่')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'กู้คืนกฎไม่สำเร็จ ข้อมูลเดิมยังถูกเก็บไว้')
    } finally {
      setBusy(false)
    }
  }
  const button =
    'rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium disabled:opacity-50'
  return (
    <section
      aria-labelledby="store-rules-recovery-title"
      className="space-y-4 rounded-3xl border border-amber-200 bg-white p-5 md:p-6"
    >
      <div role="alert" className="rounded-2xl bg-amber-50 p-4 text-amber-900">
        <h2 id="store-rules-recovery-title" className="font-semibold">
          ไม่สามารถแสดงกฎของร้านได้
        </h2>
        <p className="mt-2 text-sm">
          ข้อมูลเดิมยังถูกเก็บไว้ ระบบจะไม่ลบหรือเขียนทับอัตโนมัติ
          และจะไม่นำข้อมูลที่ไม่ผ่านการตรวจสอบไปใช้ตอบลูกค้า
        </p>
        <ul className="mt-2 list-inside list-disc text-sm">
          {issues.map((issue, index) => (
            <li key={index}>{issue.message}</li>
          ))}
        </ul>
      </div>
      <label className="block text-sm font-medium">
        ข้อมูลต้นฉบับสำหรับสำรอง
        <textarea
          aria-label="ข้อมูลกฎต้นฉบับ"
          readOnly
          value={expected}
          rows={6}
          className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} onClick={download}>
          ดาวน์โหลดข้อมูลเดิม
        </button>
        <button type="button" className={button} disabled={busy} onClick={() => void reload()}>
          {busy ? 'กำลังดำเนินการ…' : 'โหลดกฎใหม่'}
        </button>
        <button
          type="button"
          className={`${button} text-orange-700`}
          disabled={disabled || busy}
          onClick={() => {
            setEditing(true)
            setConfirmed(false)
            setError('')
          }}
        >
          แก้ไขข้อมูลเพื่อกู้คืน
        </button>
      </div>
      {notice && (
        <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </p>
      )}
      {editing && (
        <div className="space-y-3 rounded-2xl border border-orange-100 p-4">
          <label className="block text-sm font-medium">
            ข้อมูลกฎที่แก้ไข
            <textarea
              aria-label="ข้อมูลกฎที่แก้ไข"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value)
                setConfirmed(false)
              }}
              rows={10}
              disabled={busy}
              className="mt-2 w-full rounded-xl border border-slate-200 p-3 text-sm"
            />
          </label>
          {!validation.ok && (
            <p role="alert" className="text-sm text-rose-700">
              {validation.issues[0].message}
            </p>
          )}
          <label className="flex items-start gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-1"
            />
            ฉันสำรองข้อมูลเดิมแล้ว และยืนยันใช้ข้อมูลที่แก้ไขแทน
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={disabled || busy || !confirmed || !validation.ok || draft === expected}
              onClick={() => void recover()}
              className={`${button} border-orange-500 bg-orange-500 text-white`}
            >
              ยืนยันบันทึกข้อมูลที่แก้ไข
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setEditing(false)
                setConfirmed(false)
              }}
              className={button}
            >
              ยกเลิก
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
