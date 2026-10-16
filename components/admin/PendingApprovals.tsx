'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { BILLING_ITEMS, billingUnit, type BillingRequestRow } from '@/lib/plans'
import { apiError, when } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Notice } from '@/components/ui/field'

export type AdminPendingRequest = BillingRequestRow & { tenantName: string; hasProof: boolean }

export function PendingApprovals({ requests }: { requests: AdminPendingRequest[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [proof, setProof] = useState<{ id: string; url: string; tenant: string } | null>(null)
  async function view(request: AdminPendingRequest) {
    setBusy(`proof:${request.id}`)
    setMessage(null)
    try {
      const response = await fetch(`/api/billing/requests/${request.id}/proof`, { cache: 'no-store' })
      if (!response.ok) throw new Error(await apiError(response))
      const data = await response.json()
      setProof({ id: request.id, url: data.url, tenant: request.tenantName })
    } catch (error) { setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'เปิดสลิปไม่ได้' }) }
    finally { setBusy(null) }
  }
  async function decide(request: AdminPendingRequest, action: 'approve' | 'reject') {
    const note = action === 'reject' ? prompt('เหตุผลที่ไม่อนุมัติ (ไม่บังคับ)') : null
    if (action === 'reject' && note === null) return
    if (action === 'approve' && !confirm(`ยืนยันว่าได้รับเงิน ${request.price_baht.toLocaleString('th-TH')} บาท จาก ${request.tenantName} แล้ว?\nระบบจะเปิดแพ็กเกจหรือเติมยอดตามคำสั่งซื้อทันที`)) return
    setBusy(request.id)
    setMessage(null)
    try {
      const response = await fetch(`/api/billing/requests/${request.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, note }) })
      if (!response.ok) throw new Error(await apiError(response))
      setMessage({ tone: 'success', text: action === 'approve' ? 'อนุมัติและเพิ่มยอดให้ร้านค้าแล้ว' : 'ปฏิเสธคำสั่งซื้อแล้ว' })
      setProof(null)
      router.refresh()
    } catch (error) { setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'ดำเนินการไม่สำเร็จ' }) }
    finally { setBusy(null) }
  }
  return <>
    {message && <Notice tone={message.tone}>{message.text}</Notice>}
    <Card><CardHeader title="คำสั่งซื้อรออนุมัติ" description="ตรวจสอบหลักฐานและยอดเงินที่ได้รับก่อนกดอนุมัติ" />
      {requests.length === 0 ? <p className="p-5 text-sm text-slate-500">ไม่มีคำสั่งซื้อรออนุมัติ</p> : <ul className="divide-y divide-slate-100">
        {requests.map(request => <li key={request.id} className="space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="font-semibold text-slate-900">{request.tenantName} · {BILLING_ITEMS[request.item].name}</h2><p className="mt-1 text-sm text-slate-600">{request.price_baht.toLocaleString('th-TH')} บาท · +{request.credits.toLocaleString('th-TH')} {billingUnit(request.item)}</p><p className="mt-1 text-xs text-slate-500" suppressHydrationWarning>{when(request.created_at)}</p></div>
            <div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => view(request)} disabled={!!busy || !request.hasProof} loading={busy === `proof:${request.id}`}>{request.hasProof ? 'ดูสลิปโอนเงิน' : 'ยังไม่ได้แนบสลิป'}</Button><Button size="sm" loading={busy === request.id} disabled={!!busy} onClick={() => decide(request, 'approve')}>กดอนุมัติ</Button><Button size="sm" variant="ghost" disabled={!!busy} onClick={() => decide(request, 'reject')}>ไม่อนุมัติ</Button></div>
          </div>
          {!request.hasProof && <p className="text-xs text-amber-700">ยังไม่มีสลิปในระบบ หากยืนยันจากรายการเดินบัญชีแล้ว สามารถอนุมัติได้</p>}
          {request.verification_error && <p className="text-xs text-amber-700">ผลตรวจอัตโนมัติ: {request.verification_error}</p>}
          {proof?.id === request.id && <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="mb-3 flex justify-between gap-3"><p className="text-sm font-medium">หลักฐานการโอน · {proof.tenant}</p><button type="button" onClick={() => setProof(null)} className="text-sm text-slate-500">ปิดสลิป</button></div><img src={proof.url} alt={`สลิปโอนเงินจาก ${proof.tenant}`} className="mx-auto max-h-[36rem] max-w-full rounded-lg object-contain" /></div>}
        </li>)}
      </ul>}
    </Card>
  </>
}
