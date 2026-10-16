'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiError } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/field'
import type { Billing } from '@/lib/plans'

export function BillingProof({ id, pending, hasProof, onApproved }: { id: string; pending: boolean; hasProof: boolean; onApproved?: (billing?: Billing) => void }) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [image, setImage] = useState<string | null>(null)
  const [result, setResult] = useState<{ approved: boolean; message: string } | null>(null)
  async function upload(file?: File) {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const form = new FormData()
      if (file) form.append('file', file)
      const response = await fetch(`/api/billing/requests/${id}/proof`, { method: 'POST', body: form })
      if (!response.ok) throw new Error(await apiError(response))
      const data = await response.json()
      const approved = data.status === 'approved'
      setResult({ approved, message: data.message || 'บันทึกสลิปแล้ว รอผู้ดูแลตรวจสอบ' })
      if (approved) onApproved?.(data.billing ?? undefined)
      router.refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'แนบสลิปไม่ได้') }
    finally { setBusy(false); if (input.current) input.current.value = '' }
  }
  async function view() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/billing/requests/${id}/proof`, { cache: 'no-store' })
      if (!response.ok) throw new Error(await apiError(response))
      setImage((await response.json()).url)
    } catch (e) { setError(e instanceof Error ? e.message : 'เปิดสลิปไม่ได้') }
    finally { setBusy(false) }
  }
  return <div className="mt-2 space-y-2">
    {hasProof ? <div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" disabled={busy} onClick={view}>ดูสลิปที่แนบแล้ว</Button>{pending && !result?.approved && <Button size="sm" variant="secondary" loading={busy} onClick={() => void upload()}>ตรวจสอบและอนุมัติอีกครั้ง</Button>}</div> : pending && !result?.approved && <><input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label="เลือกสลิปโอนเงิน" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file) }} /><Button size="sm" variant="secondary" loading={busy} onClick={() => input.current?.click()}>แนบสลิปและอนุมัติอัตโนมัติ</Button><p className="text-xs text-slate-500">JPG, PNG หรือ WebP ไม่เกิน 5 MB · ระบบตรวจสลิปก่อนเพิ่มเครดิต</p></>}
    {busy && <p role="status" className="text-xs text-slate-500">กำลังตรวจสอบสลิปและรายการชำระเงิน…</p>}
    {result && (result.approved ? <Notice tone="success">{result.message}</Notice> : <p role="status" className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">{result.message}</p>)}
    {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
    {image && <div><button type="button" onClick={() => setImage(null)} className="mb-2 text-xs text-slate-500">ปิดสลิป</button><img src={image} alt="สลิปที่แนบกับคำสั่งซื้อ" className="max-h-96 max-w-full rounded-lg object-contain" /></div>}
  </div>
}
