'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PLANS, type PlanId } from '@/lib/features/billing/plans'
import { apiError, when } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Notice } from '@/components/ui/field'

export type ManagedTenant = { id: string; name: string; page_name: string | null; plan: PlanId; plan_expires_at: string | null; is_active: boolean; broadcast_credits: number; broadcast_topup_credits: number; slip_quota: number; slip_quota_credits: number; slip_used: number }

export function ManageTenants({ tenants }: { tenants: ManagedTenant[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [plans, setPlans] = useState<Record<string, PlanId>>({})
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  async function save(tenant: ManagedTenant, change: { plan?: PlanId; isActive?: boolean }) {
    const detail = change.plan ? `เปลี่ยน ${tenant.name} เป็น ${PLANS[change.plan].name}?\nเครดิตแพ็กเกจจะเปลี่ยนเป็น ${PLANS[change.plan].credits.toLocaleString('th-TH')} ข้อความ เครดิตเติมสะสมทั้งสองประเภทคงเดิม${change.plan !== 'free' ? '\nแพ็กเกจมีอายุ 30 วันนับจากวันนี้' : ''}` : `${change.isActive ? 'เปิด' : 'ปิด'}การใช้งานร้าน ${tenant.name}?`
    if (!confirm(detail)) return
    setBusy(tenant.id)
    setMessage(null)
    try {
      const response = await fetch(`/api/admin/tenants/${tenant.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change) })
      if (!response.ok) throw new Error(await apiError(response))
      setPlans(previous => { const next = { ...previous }; delete next[tenant.id]; return next })
      setMessage({ tone: 'success', text: `บันทึกการเปลี่ยนแปลงของ ${tenant.name} แล้ว` })
      router.refresh()
    } catch (error) { setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'บันทึกไม่ได้' }) }
    finally { setBusy(null) }
  }
  return <>
    {message && <Notice tone={message.tone}>{message.text}</Notice>}
    <Card className="overflow-hidden">
      {tenants.length === 0 ? <p className="p-5 text-sm text-slate-500">ไม่พบร้านค้า</p> : <ul className="divide-y divide-slate-100">{tenants.map(tenant => <li key={tenant.id} className="flex flex-wrap items-center justify-between gap-5 p-5">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold text-slate-900">{tenant.name}</h2><Badge tone={tenant.is_active ? 'success' : 'danger'}>{tenant.is_active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</Badge></div><p className="mt-1 text-xs text-slate-500">{tenant.page_name || 'ยังไม่ได้เชื่อมต่อเพจ'} · {PLANS[tenant.plan].name}</p><p className="mt-1 text-xs text-slate-500" suppressHydrationWarning>{tenant.plan_expires_at ? `หมดอายุ ${when(tenant.plan_expires_at)}` : 'ไม่มีวันหมดอายุ'}</p><p className="mt-2 text-sm text-slate-600">บรอดแคสต์ {(tenant.broadcast_credits + tenant.broadcast_topup_credits).toLocaleString('th-TH')} ข้อความ · ตรวจสลิป {Math.max(tenant.slip_quota + tenant.slip_quota_credits - tenant.slip_used, 0).toLocaleString('th-TH')} รายการ</p></div>
        <div className="flex flex-wrap items-center gap-2"><label className="sr-only" htmlFor={`plan-${tenant.id}`}>แพ็กเกจของ {tenant.name}</label><select id={`plan-${tenant.id}`} className="rounded-lg border border-slate-200 bg-white p-2 text-sm" value={plans[tenant.id] ?? tenant.plan} onChange={event => setPlans({ ...plans, [tenant.id]: event.target.value as PlanId })} disabled={!!busy}>{(Object.keys(PLANS) as PlanId[]).map(plan => <option key={plan} value={plan}>{PLANS[plan].name}</option>)}</select><Button size="sm" variant="secondary" disabled={!!busy || !plans[tenant.id] || plans[tenant.id] === tenant.plan} onClick={() => save(tenant, { plan: plans[tenant.id] })}>ปรับแพ็กเกจ</Button><Button size="sm" variant={tenant.is_active ? 'ghost' : 'primary'} loading={busy === tenant.id} disabled={!!busy} onClick={() => save(tenant, { isActive: !tenant.is_active })}>{tenant.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</Button></div>
      </li>)}</ul>}
    </Card>
  </>
}
