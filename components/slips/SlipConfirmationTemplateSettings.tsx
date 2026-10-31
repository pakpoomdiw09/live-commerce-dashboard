'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ErrorMessage, SuccessToast } from '@/components/ui/feedback'
import {
  DEFAULT_SLIP_CONFIRMATION_TEMPLATE,
  MAX_SLIP_CONFIRMATION_LENGTH,
} from '@/lib/features/slips/slip-confirmation-template'

export function SlipConfirmationTemplateSettings({ tenantId }: { tenantId: string }) {
  const id = useId()
  const [template, setTemplate] = useState(DEFAULT_SLIP_CONFIRMATION_TEMPLATE)
  const [loading, setLoading] = useState(true)
  const [canManage, setCanManage] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [attempt, setAttempt] = useState(0)
  const locked = useRef(false)
  const endpoint = `/api/slips/settings?tenantId=${encodeURIComponent(tenantId)}`

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setCanManage(false)
    setError('')
    setNotice('')
    async function load() {
      try {
        const response = await fetch(endpoint, { signal: controller.signal, cache: 'no-store' })
        const value = await response.json()
        if (!response.ok) throw new Error(value.error || 'โหลดข้อความยืนยันยอดเงินไม่สำเร็จ')
        if (!controller.signal.aborted) {
          setTemplate(value.slip_confirmation_template ?? DEFAULT_SLIP_CONFIRMATION_TEMPLATE)
          setCanManage(value.canManage === true)
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : 'โหลดข้อความไม่สำเร็จ')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [endpoint, attempt])

  async function save() {
    if (locked.current || loading || !canManage) return
    locked.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slip_confirmation_template: template }),
      })
      const value = await response.json()
      if (!response.ok) throw new Error(value.error || 'บันทึกข้อความไม่สำเร็จ')
      setTemplate(value.slip_confirmation_template)
      setNotice('บันทึกข้อความแล้ว จะใช้กับการยืนยันสลิปครั้งถัดไป')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'บันทึกข้อความไม่สำเร็จ')
    } finally {
      locked.current = false
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 border-t border-orange-100 pt-5">
      <label htmlFor={id} className="block font-medium">
        ข้อความยืนยันยอดเงิน (Slip Confirmation Template)
      </label>
      <textarea
        id={id}
        rows={7}
        className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm leading-relaxed disabled:bg-slate-50 disabled:text-slate-500"
        value={template}
        maxLength={MAX_SLIP_CONFIRMATION_LENGTH}
        disabled={loading || busy || !canManage}
        onChange={(event) => {
          setTemplate(event.target.value)
          setNotice('')
        }}
        aria-describedby={`${id}-help`}
      />
      <div id={`${id}-help`} className="space-y-1 text-xs text-slate-500">
        <p>
          <code>{'{amount}'}</code> = ยอดเงินที่โอน เช่น 1.00
        </p>
        <p>
          <code>{'{pageName}'}</code> = ชื่อเพจ
        </p>
        <p>เว้นว่างเพื่อใช้ข้อความเริ่มต้น ข้อความนี้จะตรงกันใน Messenger และแดชบอร์ด</p>
      </div>
      {loading && (
        <p className="text-sm text-slate-500" role="status">
          กำลังโหลดข้อความ…
        </p>
      )}
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {notice && <SuccessToast>{notice}</SuccessToast>}
      {!loading && !canManage && !error && (
        <p className="text-xs text-slate-500">เฉพาะเจ้าของร้านที่แก้ไขข้อความได้</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save()} disabled={loading || !canManage} loading={busy}>
          บันทึกข้อความ
        </Button>
        <Button
          variant="secondary"
          disabled={loading || busy || !canManage}
          onClick={() => {
            setTemplate(DEFAULT_SLIP_CONFIRMATION_TEMPLATE)
            setNotice('')
          }}
        >
          ใช้ข้อความเริ่มต้น
        </Button>
        {!loading && !canManage && error && (
          <Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
            โหลดใหม่
          </Button>
        )}
      </div>
    </div>
  )
}
