'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { BankSelector } from '@/components/banking/BankSelector'
import { BankAccountQrUpload } from '@/components/slips/BankAccountQrUpload'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/Switch'
import { ErrorMessage } from '@/components/ui/feedback'
import { bankAccountError, type BankAccount } from '@/lib/features/banking/bank-accounts'
import { bankAccountDraft, type BankAccountDraft } from '@/lib/features/banking/bank-account-draft'
import type { BankQrState } from '@/lib/features/banking/bank-qr-upload'

const blank: BankAccountDraft = {
  bank_code: 'KBANK',
  account_name: '',
  account_number: '',
  is_active: true,
}
const input =
  'mt-1 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100'

export function BankAccountForm({
  tenantId,
  account,
  onCancel,
  onSaved,
}: {
  tenantId: string
  account: BankAccount | null
  onCancel: () => void
  onSaved: () => Promise<void>
}) {
  const id = useId()
  const [draft, setDraft] = useState<BankAccountDraft>(() =>
    account ? bankAccountDraft(account) : { ...blank },
  )
  const original = useRef<BankAccountDraft | null>(account ? bankAccountDraft(account) : null)
  const [qr, setQr] = useState<BankQrState | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(!!account)
  const [ready, setReady] = useState(!account)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const locked = useRef(false)
  const pending = useRef<{ fingerprint: string; requestId: string } | null>(null)
  const accountId = account?.id
  const qrEndpoint = `/api/bank-accounts/qr?tenantId=${encodeURIComponent(tenantId)}&accountId=${encodeURIComponent(accountId ?? '')}`

  useEffect(() => {
    if (!accountId) return
    const controller = new AbortController()
    setLoading(true)
    setReady(false)
    setError('')
    void (async () => {
      try {
        const response = await fetch(qrEndpoint, { cache: 'no-store', signal: controller.signal })
        const value = await response.json()
        if (!response.ok) throw new Error(value.error || 'โหลดข้อมูลบัญชีไม่สำเร็จ')
        if (!controller.signal.aborted) {
          const current = bankAccountDraft(value.account)
          original.current = current
          setDraft(current)
          setQr(value as BankQrState)
          setReady(true)
          setFile(null)
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : 'โหลดข้อมูลไม่สำเร็จ')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [accountId, qrEndpoint, attempt])

  const normalized = bankAccountDraft(draft)
  const changedRecipient =
    !!original.current &&
    (normalized.bank_code !== original.current.bank_code ||
      normalized.account_number !== original.current.account_number)
  const imageUrl = qr?.hasQr && !changedRecipient ? `${qrEndpoint}&asset=image&v=${qr.version}` : ''

  async function save() {
    if (locked.current || loading || !ready) return
    setError('')
    const problem = bankAccountError(
      normalized.bank_code,
      normalized.account_name,
      normalized.account_number,
    )
    if (problem) {
      setError(problem)
      return
    }
    if (qr?.hasQr && changedRecipient && !file) {
      setError('กรุณาแนบ QR Code ของบัญชีใหม่')
      return
    }
    const fingerprint = JSON.stringify([
      accountId ?? null,
      normalized,
      original.current,
      qr?.version ?? 0,
      file?.name,
      file?.size,
      file?.lastModified,
    ])
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, requestId: crypto.randomUUID() }
    locked.current = true
    setBusy(true)
    try {
      const form = new FormData()
      form.set('id', accountId ?? '')
      form.set('bank_code', normalized.bank_code)
      form.set('account_name', normalized.account_name)
      form.set('account_number', normalized.account_number)
      form.set('is_active', String(normalized.is_active))
      form.set('original', JSON.stringify(original.current))
      form.set('version', String(qr?.version ?? 0))
      form.set('requestId', pending.current.requestId)
      if (file) form.set('file', file)
      const response = await fetch(
        `/api/bank-accounts/save?tenantId=${encodeURIComponent(tenantId)}`,
        { method: 'POST', body: form },
      )
      const value = await response.json()
      if (!response.ok) throw new Error(value.error || 'บันทึกข้อมูลและ QR ไม่สำเร็จ')
      try {
        await onSaved()
      } catch {
        throw new Error('บันทึกแล้ว แต่โหลดรายการไม่สำเร็จ กรุณาลองอีกครั้ง')
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ')
    } finally {
      locked.current = false
      setBusy(false)
    }
  }

  return (
    <form
      aria-labelledby={`${id}-title`}
      className="mx-auto w-full max-w-xl space-y-4 rounded-2xl border border-orange-200 bg-white p-4 sm:p-5"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <h3 id={`${id}-title`} className="font-semibold">
        {accountId ? 'แก้ไขบัญชีรับเงิน' : 'เพิ่มบัญชีรับเงิน'}
      </h3>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {loading && (
        <p role="status" className="text-sm text-slate-500">
          กำลังโหลดข้อมูล…
        </p>
      )}
      <fieldset
        disabled={busy || loading || !ready}
        className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_13rem]"
      >
        <div className="min-w-0 space-y-3">
          <BankSelector
            label="เลือกธนาคาร"
            value={draft.bank_code}
            onChange={(bank_code) => setDraft({ ...draft, bank_code })}
            disabled={busy || loading || !ready}
          />
          <label className="block text-sm" htmlFor={`${id}-name`}>
            ชื่อบัญชี
            <input
              id={`${id}-name`}
              required
              maxLength={120}
              className={input}
              value={draft.account_name}
              onChange={(event) => setDraft({ ...draft, account_name: event.target.value })}
            />
          </label>
          <label className="block text-sm" htmlFor={`${id}-number`}>
            เลขที่บัญชี
            <input
              id={`${id}-number`}
              required
              inputMode="numeric"
              autoComplete="off"
              maxLength={25}
              className={input}
              value={draft.account_number}
              onChange={(event) => setDraft({ ...draft, account_number: event.target.value })}
            />
          </label>
          <div className="flex items-center justify-between gap-3 pt-1 text-sm">
            <span>เปิดใช้งานบัญชีนี้</span>
            <Switch
              checked={draft.is_active}
              disabled={busy || loading || !ready}
              label="เปิดใช้งานบัญชีนี้"
              onChange={(is_active) => setDraft({ ...draft, is_active })}
            />
          </div>
        </div>
        <BankAccountQrUpload
          file={file}
          onChange={setFile}
          imageUrl={imageUrl}
          disabled={busy || loading || !ready}
        />
      </fieldset>
      {changedRecipient && qr?.hasQr && !file && (
        <p className="text-xs text-orange-700">เปลี่ยนบัญชีแล้ว กรุณาแนบรูป QR ใหม่</p>
      )}
      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
        {!ready && !loading && (
          <Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
            โหลดใหม่
          </Button>
        )}
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          ยกเลิก
        </Button>
        <Button
          type="submit"
          loading={busy}
          disabled={loading || !ready}
          className="bg-orange-500 hover:bg-orange-600"
        >
          บันทึกข้อมูลและ QR
        </Button>
      </div>
    </form>
  )
}
