'use client'

import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { CheckCircle2, Loader2, QrCode, Upload, X } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import type { PaidPlan, PaymentSession, PaymentSuccess } from '@/lib/payment-types'
import { PLANS, type Billing } from '@/lib/plans'
import { canResumeCheckout } from '@/lib/payment-checkout'
import { apiError, baht } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/field'

type Props = {
  tenantId: string
  plan: PaidPlan
  onClose: () => void
  onPaid: (billing: Billing) => void
}

type SessionStatus = {
  receiverChanged?: boolean
  session: PaymentSession
  status: 'pending' | 'verified' | 'paid' | 'expired'
  billing?: Billing
}

function savedSessionId(key: string): string | null {
  try { return sessionStorage.getItem(key) } catch { return null }
}

function saveSessionId(key: string, id: string | null) {
  try {
    if (id) sessionStorage.setItem(key, id)
    else sessionStorage.removeItem(key)
  } catch {
    // Storage may be disabled; session access still requires server-side owner authorization.
  }
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const expiresLabel = (value: string) => new Date(value).toLocaleTimeString('th-TH', {
  timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit',
})

export function PaymentModal({ tenantId, plan, onClose, onPaid }: Props) {
  const storageKey = `live-commerce:payment:${tenantId}:${plan}`
  const dialogRef = useRef<HTMLDialogElement>(null)
  const mountedRef = useRef(false)
  const verifyAbortRef = useRef<AbortController | null>(null)
  const headingId = useId()
  const fileId = useId()
  const [session, setSession] = useState<PaymentSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [verifying, setVerifying] = useState(false)
  const [expired, setExpired] = useState(false)
  const [proofVerified, setProofVerified] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [paidBilling, setPaidBilling] = useState<Billing | null>(null)

  useEffect(() => {
    mountedRef.current = true
    const dialog = dialogRef.current
    const previousFocus = document.activeElement
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      mountedRef.current = false
      verifyAbortRef.current?.abort()
      dialog?.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setLoading(true)
    setError(null)
    setSession(null)
    setExpired(false)
    setProofVerified(false)
    void (async () => {
      try {
        const previousId = savedSessionId(storageKey)
        if (previousId) {
          const previous = await fetch(`/api/payments/${encodeURIComponent(previousId)}`, { cache: 'no-store', signal: controller.signal })
          if (previous.ok) {
            const result = await previous.json() as SessionStatus
            if (!result.receiverChanged && canResumeCheckout(result.session, tenantId, plan, result.status)) {
              if (active) {
                setSession(result.session)
                setProofVerified(result.status === 'verified')
                if (result.status === 'paid' && result.billing) complete(result.billing)
              }
              return
            }
          } else if (![400, 404, 410].includes(previous.status)) {
            throw new Error(await apiError(previous))
          }
          saveSessionId(storageKey, null)
        }
        const res = await fetch('/api/payments', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId, plan }), signal: controller.signal,
        })
        if (!res.ok) throw new Error(await apiError(res))
        const result = await res.json() as { session: PaymentSession }
        if (active) {
          setSession(result.session)
          saveSessionId(storageKey, result.session.id)
        }
      } catch (cause) {
        if (active && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'สร้างรายการชำระเงินไม่สำเร็จ')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false; controller.abort() }
  }, [tenantId, plan, attempt])

  useEffect(() => {
    if (!session) return
    const remaining = new Date(session.expiresAt).getTime() - Date.now()
    if (remaining <= 0) { setExpired(true); return }
    const timer = setTimeout(() => setExpired(true), remaining)
    return () => clearTimeout(timer)
  }, [session])

  useEffect(() => {
    if (!file) { setPreview(null); return }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  function complete(billing: Billing) {
    saveSessionId(storageKey, null)
    setPaidBilling(billing)
    setError(null)
    onPaid(billing)
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!session || verifying || (!proofVerified && (!file || expired))) return
    const controller = new AbortController()
    verifyAbortRef.current = controller
    setVerifying(true)
    setError(null)
    try {
      const body = new FormData()
      body.append('sessionId', session.id)
      if (!proofVerified && file) body.append('file', file)
      const res = await fetch('/api/payments/verify-slip', { method: 'POST', body, signal: controller.signal })
      if (!res.ok) throw new Error(await apiError(res))
      const result = await res.json() as PaymentSuccess
      if (!result.success || result.sessionId !== session.id || !result.billing) throw new Error('ยังยืนยันการชำระเงินไม่ได้ กรุณาลองอีกครั้ง')
      if (mountedRef.current) complete(result.billing)
    } catch (cause) {
      if (!mountedRef.current || controller.signal.aborted) return
      // A payment may have committed before its response was interrupted. Resume that result.
      const status = await fetch(`/api/payments/${session.id}`, { cache: 'no-store', signal: controller.signal }).catch(() => null)
      const result = status?.ok ? await status.json().catch(() => null) as SessionStatus | null : null
      if (!mountedRef.current || controller.signal.aborted) return
      if (result?.status === 'paid' && result.billing) complete(result.billing)
      else if (result?.status === 'verified') {
        setProofVerified(true)
        setError('ตรวจสอบการชำระเงินแล้ว แต่เปิดแพ็กเกจยังไม่สำเร็จ กรุณาลองเปิดแพ็กเกจอีกครั้ง')
      }
      else setError(cause instanceof Error ? cause.message : 'ตรวจสอบสลิปไม่สำเร็จ กรุณาลองอีกครั้ง')
    } finally {
      if (mountedRef.current) setVerifying(false)
      verifyAbortRef.current = null
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      aria-busy={verifying || loading || undefined}
      onCancel={(event) => { event.preventDefault(); if (!verifying) onClose() }}
      onClick={(event) => { if (event.target === event.currentTarget && !verifying) onClose() }}
      className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-3xl border-0 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/55"
    >
      <div className="relative p-6 sm:p-8">
        <Button autoFocus size="icon" variant="ghost" className="absolute top-3 right-3" aria-label="ปิดหน้าชำระเงิน" disabled={verifying} onClick={onClose}>
          <X className="h-5 w-5" aria-hidden />
        </Button>
        {paidBilling ? (
          <div role="status" className="flex flex-col items-center py-6 text-center">
            <span className="payment-success-enter grid h-24 w-24 place-items-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="h-14 w-14" aria-hidden />
            </span>
            <h2 id={headingId} className="mt-5 text-2xl font-semibold">อนุมัติสำเร็จ! ระบบเพิ่มเครดิตให้เรียบร้อยแล้ว</h2>
            <p className="mt-2 text-sm text-slate-600">เปิดใช้แพ็กเกจ {PLANS[paidBilling.plan].name} แล้ว</p>
            <p className="mt-1 text-sm text-emerald-700">เพิ่มเครดิตบรอดแคสต์ {session?.credits.toLocaleString('th-TH')} ข้อความแล้ว</p>
            <Button className="mt-6 w-full" size="lg" onClick={onClose}>ใช้งานต่อ</Button>
          </div>
        ) : (
          <>
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-orange-50 text-orange-600"><QrCode className="h-6 w-6" aria-hidden /></span>
            <h2 id={headingId} className="mt-4 pr-5 text-xl font-semibold">ชำระเงินแพ็กเกจ {PLANS[plan].name}</h2>
            <p className="mt-1 text-sm text-slate-500">{proofVerified ? 'ชำระเงินแล้ว ลองเปิดแพ็กเกจจากรายการเดิมได้ทันที' : 'สแกน QR แล้วอัปโหลดสลิปเพื่อเปิดแพ็กเกจทันที'}</p>
            {loading ? (
              <p role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500"><Loader2 className="h-5 w-5 motion-safe:animate-spin" aria-hidden />กำลังโหลดรายการชำระเงิน</p>
            ) : session ? (
              <form onSubmit={verify} className="mt-5 space-y-5">
                <div className="rounded-2xl border border-slate-200 p-4 text-center">
                  <p className="text-3xl font-bold tabular-nums">{baht(session.amount)}</p>
                  <p className="mt-1 text-xs text-slate-500">+{session.credits.toLocaleString('th-TH')} เครดิต · แพ็กเกจใช้ได้ 30 วัน</p>
                  {!proofVerified && (
                    <div className="mx-auto my-4 w-fit rounded-xl bg-white p-3" aria-label={`QR พร้อมเพย์สำหรับชำระ ${session.amount} บาท`}>
                      <QRCodeSVG value={session.qrPayload} size={208} level="M" marginSize={4} />
                    </div>
                  )}
                  <p className="text-sm font-medium">{session.receiver.bankAccountName}</p>
                  <p className="mt-1 text-xs text-slate-500">พร้อมเพย์ {session.receiver.promptpayId}</p>
                  {session.receiver.bankAccountNo && <p className="mt-1 text-xs text-slate-500">{session.receiver.bankName} · {session.receiver.bankAccountNo}</p>}
                  {!proofVerified && <p className="mt-3 text-xs text-slate-500">QR ใช้ได้ถึง {expiresLabel(session.expiresAt)} น.</p>}
                </div>
                {proofVerified ? (
                  <div className="space-y-3">
                    <Notice tone="success">ตรวจสอบการชำระเงินแล้ว สามารถลองเปิดแพ็กเกจได้โดยไม่ต้องโอนเงินหรืออัปโหลดสลิปอีก</Notice>
                    <Button type="submit" className="w-full" size="lg" loading={verifying} disabled={verifying}>
                      {verifying ? 'กำลังเปิดแพ็กเกจ' : 'ลองเปิดแพ็กเกจอีกครั้ง'}
                    </Button>
                  </div>
                ) : expired ? (
                  <div className="space-y-3">
                    <Notice tone="error">QR นี้หมดอายุแล้ว กรุณาสร้างรายการชำระเงินใหม่</Notice>
                    <Button className="w-full" variant="secondary" disabled={verifying} onClick={() => { saveSessionId(storageKey, null); setFile(null); setAttempt((value) => value + 1) }}>สร้าง QR ใหม่</Button>
                  </div>
                ) : (
                  <>
                    <label htmlFor={fileId} className="block text-sm font-medium">อัปโหลดสลิปการโอนเงิน</label>
                    <input
                      id={fileId} type="file" accept="image/jpeg,image/png,image/webp" disabled={verifying}
                      className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-orange-50 file:px-4 file:py-2 file:font-medium file:text-orange-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-500"
                      onChange={(event) => {
                        const selected = event.currentTarget.files?.[0]
                        setError(null)
                        setFile(null)
                        if (!selected) return
                        if (!IMAGE_TYPES.has(selected.type) || selected.size > MAX_IMAGE_BYTES || selected.size === 0) {
                          setError('กรุณาเลือกภาพ JPG, PNG หรือ WEBP ขนาดไม่เกิน 5 MB')
                          event.currentTarget.value = ''
                          return
                        }
                        setFile(selected)
                      }}
                    />
                    <p className="-mt-3 text-xs text-slate-500">JPG, PNG หรือ WEBP · ไม่เกิน 5 MB</p>
                    {preview && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={preview} alt="ตัวอย่างสลิปที่เลือก" className="mx-auto max-h-52 rounded-xl border border-slate-200 object-contain" />
                    )}
                    <Button type="submit" size="lg" className="w-full" loading={verifying} disabled={!file || verifying}>
                      {!verifying && <Upload className="h-4 w-4" aria-hidden />}{verifying ? 'กำลังตรวจสอบสลิป' : 'ตรวจสอบสลิปและเปิดแพ็กเกจ'}
                    </Button>
                  </>
                )}
              </form>
            ) : null}
            {error && <div className="mt-4"><Notice tone="error">{error}</Notice></div>}
            {!loading && !session && <Button variant="secondary" className="mt-4 w-full" onClick={() => setAttempt((value) => value + 1)}>ลองสร้าง QR อีกครั้ง</Button>}
          </>
        )}
      </div>
      <style>{`
        @keyframes payment-success-enter { from { opacity: 0; transform: scale(.65); } to { opacity: 1; transform: scale(1); } }
        @media (prefers-reduced-motion: no-preference) { .payment-success-enter { animation: payment-success-enter .45s ease-out; } }
      `}</style>
    </dialog>
  )
}
