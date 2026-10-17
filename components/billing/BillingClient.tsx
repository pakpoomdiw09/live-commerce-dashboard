'use client'

import { neutralSlipText } from '@/lib/ui-labels'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Bot, Check, Coins, Megaphone, Receipt } from 'lucide-react'
import {
  BILLING_ITEMS,
  PLANS,
  TOPUPS,
  SLIP_TOPUPS,
  billingUnit,
  creditsLeft,
  type Billing,
  type BillingItem,
  type BillingRequestRow,
  type PlanId,
  type TopupId,
  type SlipTopupId,
} from '@/lib/plans'
import type { Tone } from '@/lib/status'
import type { PaidPlan } from '@/lib/payment-types'
import { apiError, cn, when } from '@/lib/utils'
import { PaymentModal } from '@/components/payments/PaymentModal'
import { BillingProof } from '@/components/billing/BillingProof'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, PageHeader } from '@/components/ui/card'
import { Notice } from '@/components/ui/field'

type Props = {
  tenantId: string
  billing: Billing
  canBuy: boolean
  /** how to pay (bank account, PromptPay...), from BILLING_PAYMENT_INFO */
  paymentInfo: string | null
  requests: BillingRequestRow[]
}

const STATUS: Record<BillingRequestRow['status'], { label: string; tone: Tone }> = {
  pending: { label: 'รออนุมัติ', tone: 'warning' },
  approved: { label: 'อนุมัติแล้ว', tone: 'success' },
  rejected: { label: 'ไม่อนุมัติ', tone: 'danger' },
  cancelled: { label: 'ยกเลิก', tone: 'neutral' },
}

const n = (v: number) => v.toLocaleString('th-TH')

const planFeatures = (id: PlanId) => [
  id === 'free' ? `บรอดแคสต์ ${n(PLANS[id].credits)} ข้อความ/เดือน` : `เพิ่มเครดิตบรอดแคสต์ ${n(PLANS[id].credits)} ข้อความ`,
  PLANS[id].messageTags ? 'ส่งหาลูกค้าที่เกิน 24 ชั่วโมง ด้วยแท็กข้อความพิเศษ' : 'ส่งได้เฉพาะลูกค้าภายใน 24 ชั่วโมง',
  'ซื้อเครดิตเพิ่มได้ทุกแพ็กเกจ',
  'ระบบ AI ตอบแชทอัตโนมัติ 24 ชั่วโมง',
]

export function BillingClient({ tenantId, billing: initialBilling, canBuy, paymentInfo, requests }: Props) {
  const router = useRouter()
  const [billing, setBilling] = useState(initialBilling)
  const [paymentPlan, setPaymentPlan] = useState<PaidPlan | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)
  const paid = billing.featureBypass || billing.plan !== 'free'

  useEffect(() => { setBilling(initialBilling) }, [initialBilling])
  useEffect(() => { setPaymentPlan(null) }, [tenantId])

  async function call(key: string, url: string, init: RequestInit, done: string) {
    setBusy(key)
    setNotice(null)
    try {
      const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init })
      if (!res.ok) throw new Error(await apiError(res))
      setNotice({ tone: 'success', text: done })
      router.refresh()
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  function buy(item: BillingItem) {
    if (item === 'starter' || item === 'pro') {
      setNotice(null)
      setPaymentPlan(item)
      return
    }
    const it = BILLING_ITEMS[item]
    if (!confirm(`สั่งซื้อ ${it.name} ราคา ${n(it.price)} บาท?\nแนบสลิปโอนเงินเพื่อให้ระบบตรวจสอบและเพิ่มเครดิตอัตโนมัติ`)) return
    void call(item, '/api/billing/requests', { method: 'POST', body: JSON.stringify({ tenantId, item }) }, `สร้างคำสั่งซื้อ ${it.name} แล้ว กรุณาแนบสลิปในประวัติการสั่งซื้อเพื่อเพิ่มเครดิตอัตโนมัติ`)
  }

  function decide(id: string, action: 'approve' | 'reject' | 'cancel') {
    const note = action === 'reject' ? prompt('เหตุผลที่ไม่อนุมัติ (ไม่บังคับ)') : null
    if (action === 'reject' && note === null) return
    const done = { approve: 'อนุมัติแล้ว', reject: 'ปฏิเสธแล้ว', cancel: 'ยกเลิกคำสั่งซื้อแล้ว' }[action]
    void call(`${action}:${id}`, `/api/billing/requests/${id}`, { method: 'PATCH', body: JSON.stringify({ action, note }) }, done)
  }

  const left = creditsLeft(billing)

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-8">
      {paymentPlan && (
        <PaymentModal
          key={`${tenantId}:${paymentPlan}`} tenantId={tenantId} plan={paymentPlan}
          onClose={() => setPaymentPlan(null)}
          onPaid={(updatedBilling) => {
            setBilling({ ...billing, ...updatedBilling, featureBypass: billing.featureBypass })
            setNotice({ tone: 'success', text: 'อนุมัติสำเร็จ! ระบบเพิ่มเครดิตให้เรียบร้อยแล้ว' })
            router.refresh()
          }}
        />
      )}
      <PageHeader title="แพ็กเกจและการเติมเงิน" description="เครดิตส่งข้อความและโควตาตรวจสลิปแยกกัน เลือกเติมให้ตรงกับการใช้งาน" />

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-orange-200 p-5">
          <p className="flex items-center gap-2 text-sm font-medium text-slate-700"><Megaphone className="h-5 w-5 text-orange-500" aria-hidden />เครดิตส่งข้อความ (บรอดแคสต์)</p>
          <p className="mt-3 text-3xl font-semibold text-slate-900 tabular-nums">{n(left)} <span className="text-sm font-normal text-slate-500">ข้อความคงเหลือ</span></p>
          <p className="mt-2 text-xs text-slate-500">จากแพ็กเกจ {n(billing.monthly)} ข้อความ + ที่เติมไว้ {n(billing.topup)} ข้อความ</p>
          <p className="mt-1 text-xs text-slate-500">ส่งสำเร็จ 1 ข้อความ ใช้ 1 เครดิต · ใช้ตรวจสลิปไม่ได้</p>
        </Card>
        <Card className="border-emerald-200 p-5">
          <p className="flex items-center gap-2 text-sm font-medium text-slate-700"><Receipt className="h-5 w-5 text-emerald-600" aria-hidden />โควตาตรวจสลิปอัตโนมัติ</p>
          <p className="mt-3 text-3xl font-semibold text-slate-900 tabular-nums">{n(billing.slipRemaining)} <span className="text-sm font-normal text-slate-500">รายการคงเหลือ</span></p>
          <p className="mt-2 text-xs text-slate-500">ตรวจสลิป 1 ครั้ง ใช้ 1 รายการ · ใช้ส่งบรอดแคสต์ไม่ได้</p>
          <p className="mt-1 text-xs text-slate-500">โควตาที่เติมสะสม {n(billing.slipQuotaCredits)} รายการ · รวมอยู่ในยอดคงเหลือแล้ว</p>
        </Card>
      </div>
      <p className="text-sm text-slate-600" suppressHydrationWarning>แพ็กเกจปัจจุบัน: {PLANS[billing.plan].name} · {billing.planExpiresAt ? when(billing.planExpiresAt) : paid ? 'ไม่มีวันหมดอายุ' : 'ฟรีตลอด'}</p>

      {paymentInfo && (
        <div className="flex gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
          <Receipt className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" aria-hidden />
          <div>
            <p className="font-semibold">วิธีชำระเงิน</p>
            <p className="mt-0.5 whitespace-pre-line text-sky-800">{paymentInfo}</p>
          </div>
        </div>
      )}

      <section aria-labelledby="plans-title">
        <h2 id="plans-title" className="mb-3 text-base font-semibold text-slate-900">
          แพ็กเกจ
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {(Object.keys(PLANS) as PlanId[]).map((id) => {
            const p = PLANS[id]
            const current = billing.plan === id
            const item = id === 'free' ? null : (id as BillingItem)
            return (
              <Card key={id} className={cn('flex flex-col p-5', current && 'ring-2 ring-orange-400', id === 'pro' && !current && 'ring-1 ring-orange-200')}>
                <div className="flex items-center justify-between">
                  <span className="text-lg font-semibold text-slate-900">{p.name}</span>
                  {current ? <Badge tone="success">แพ็กเกจของคุณ</Badge> : id === 'pro' && <Badge tone="info" icon={false}>คุ้มที่สุด</Badge>}
                </div>
                <p className="mt-2 text-3xl font-bold text-slate-900 tabular-nums">
                  {n(p.price)}
                  <span className="ml-1 text-sm font-normal text-slate-500">{id === 'free' ? 'บาท/เดือน' : 'บาท/30 วัน'}</span>
                </p>
                <ul className="mt-4 flex-1 space-y-2 text-sm text-slate-700">
                  {planFeatures(id).map((f, i) => (
                    <li key={f} className="flex items-start gap-2">
                      {i === 1 && !p.messageTags ? (
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                      ) : i === 3 ? (
                        <Bot className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                      ) : i === 0 ? (
                        <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" aria-hidden />
                      ) : (
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                      )}
                      {f}
                    </li>
                  ))}
                </ul>
                {item && canBuy && (
                  <Button className="mt-5" variant={current ? 'secondary' : 'primary'} onClick={() => buy(item)} disabled={!!busy || !!paymentPlan}>
                    {current ? 'ต่ออายุ 30 วัน' : `อัปเกรดเป็น ${p.name}`}
                  </Button>
                )}
              </Card>
            )
          })}
        </div>
        {!canBuy && <p className="mt-2 text-xs text-slate-500">เฉพาะเจ้าของร้านเท่านั้นที่สั่งซื้อแพ็กเกจและเครดิตได้</p>}
      </section>

      <Card>
        <CardHeader
          title="เติมข้อความบรอดแคสต์"
          description={'เครดิตที่เติมไม่มีวันหมดอายุ ใช้ต่อจากเครดิตรายเดือน'}
        />
        <div className="grid gap-3 p-5 sm:grid-cols-3">
          {(Object.keys(TOPUPS) as TopupId[]).map((id) => {
            const t = TOPUPS[id]
            return (
              <div key={id} className={'flex flex-col rounded-xl border border-slate-200 p-4'}>
                <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                  <Coins className="h-4 w-4 text-orange-500" aria-hidden />
                  {t.name}
                </span>
                <span className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">+{n(t.credits)} ข้อความ</span>
                <span className="text-xs text-slate-500">
                  {n(t.price)} บาท · {(t.price / t.credits).toFixed(2)} บาท/ข้อความ
                </span>
                {canBuy && (
                  <Button size="sm" variant="secondary" className="mt-3" onClick={() => buy(id)} loading={busy === id} disabled={!!busy}>
                    {'เติมข้อความ'}
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="เติมสิทธิ์ตรวจสลิป"
          description={'โควตาที่เติมสะสมไม่มีวันหมดอายุ ใช้ตรวจสลิปอัตโนมัติเท่านั้น'}
        />
        <div className="grid gap-3 p-5 sm:grid-cols-3">
          {(Object.keys(SLIP_TOPUPS) as SlipTopupId[]).map((id) => {
            const t = SLIP_TOPUPS[id]
            return (
              <div key={id} className={'flex flex-col rounded-xl border border-slate-200 p-4'}>
                <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                  <Coins className="h-4 w-4 text-emerald-600" aria-hidden />
                  {t.name}
                </span>
                <span className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">+{n(t.credits)} รายการ</span>
                <span className="text-xs text-slate-500">
                  {n(t.price)} บาท · {(t.price / t.credits).toFixed(2)} บาท/รายการ
                </span>
                {canBuy && (
                  <Button size="sm" variant="secondary" className="mt-3" onClick={() => buy(id)} loading={busy === id} disabled={!!busy}>
                    {'เติมสิทธิ์ตรวจสลิป'}
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      <Card>
        <CardHeader title="ประวัติการสั่งซื้อ" description="20 รายการล่าสุดของร้านนี้" />
        {requests.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-slate-500">ยังไม่มีการสั่งซื้อ</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
                    {BILLING_ITEMS[r.item].name}
                    <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                  </p>
                  <p className="text-xs text-slate-500" suppressHydrationWarning>
                    {n(r.price_baht)} บาท · {n(r.credits)} {billingUnit(r.item)} · {when(r.created_at)}
                    {r.note && ` · ${neutralSlipText(r.note)}`}
                  </p>
                  {r.verification_error && r.status === 'pending' && <p className="mt-2 text-xs text-amber-700">{r.verification_error} · รอผู้ดูแลตรวจสอบ</p>}
                  {canBuy && <BillingProof id={r.id} pending={r.status === 'pending'} hasProof={!!r.proof_path} onApproved={(updated) => {
                    if (updated) setBilling({ ...updated, featureBypass: billing.featureBypass })
                    setNotice({ tone: 'success', text: 'อนุมัติสำเร็จ! ระบบเพิ่มเครดิตให้เรียบร้อยแล้ว' })
                  }} />}
                </div>
                {r.status === 'pending' && canBuy && (
                  <Button size="sm" variant="ghost" onClick={() => decide(r.id, 'cancel')} loading={busy === `cancel:${r.id}`} disabled={!!busy}>
                    ยกเลิก
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
