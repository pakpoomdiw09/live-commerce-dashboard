import { loadBasicOverview } from '@/lib/features/overview/basic-overview-server'
import { hasFeature } from '@/lib/feature-access'
import { FeatureLocked } from '@/components/shared/FeatureLocked'
import { SetupNotice } from '@/components/shared/SetupNotice'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CheckCircle2,
  Coins,
  Hourglass,
  type LucideIcon,
} from 'lucide-react'
import { supabaseAdmin } from '@/lib/supabase/server'
import { getActiveTenant, getTenants } from '@/lib/tenant'
import { SLIP_STATUS } from '@/lib/status'
import { LiveRefresh } from '@/components/shared/LiveRefresh'
import type { SlipStatus } from '@/lib/types'
import { baht, cn, when } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, PageHeader } from '@/components/ui/card'
import { InlineError } from '@/components/shared/ErrorState'
import { RevenueChart } from '@/components/overview/RevenueChart'

const DAYS = 14
const TZ = 'Asia/Bangkok'
/** yyyy-mm-dd in Bangkok time, so "today" matches the shop's day, not the server's */
const dayKey = (d: Date | string) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ })
export async function BasicOverviewPage() {
  const { error: tenantError } = await getTenants()
  if (tenantError)
    return (
      <div className="p-6">
        <InlineError title="โหลดข้อมูลร้านค้าไม่ได้" message={tenantError} />
      </div>
    )
  const tenant = await getActiveTenant()
  if (!tenant) return <SetupNotice kind="no-tenant" />
  const db = supabaseAdmin({ timeoutMs: 15000 })
  if (!(await hasFeature(db, tenant.id, 'slip_auto_pilot'))) return <FeatureLocked />
  const now = new Date()
  let stats
  try {
    stats = await loadBasicOverview(db, tenant.id, now)
  } catch (error) {
    return (
      <div className="p-6">
        <InlineError
          title="โหลดข้อมูลสรุปยอดไม่ได้"
          message={error instanceof Error ? error.message : 'กรุณาลองใหม่'}
        />
      </div>
    )
  }
  const points = stats.points.map((point) => ({
    ...point,
    label: new Date(point.day + 'T12:00:00+07:00').toLocaleDateString('th-TH', {
      day: 'numeric',
      month: 'short',
      timeZone: TZ,
    }),
  }))
  const todayPoint = points.find((point) => point.day === dayKey(now))!
  const yesterdayAmount =
    points.find((point) => point.day === dayKey(new Date(now.getTime() - 86400000)))?.amount ?? 0
  const delta =
    yesterdayAmount > 0 ? ((todayPoint.amount - yesterdayAmount) / yesterdayAmount) * 100 : null
  const { periodTotal, attention, attentionCount, totalSlips } = stats
  const byStatus = new Map(Object.entries(stats.byStatus))
  const creditsLeft = Math.max(tenant.slip_quota + tenant.slip_quota_credits - tenant.slip_used, 0)

  return (
    <div className="mx-0 w-full min-w-0 max-w-none min-h-full space-y-6 bg-[#fffaf8] p-4 md:space-y-7 md:p-8">
      {/* new slips, verdicts and approvals update the tiles and the chart without a reload */}
      <LiveRefresh
        channel={`overview:${tenant.id}`}
        tables={['slips', 'orders']}
        filter={`tenant_id=eq.${tenant.id}`}
      />
      <PageHeader
        title="ภาพรวมธุรกิจ"
        description={`${tenant ? tenant.name : 'ทุกร้านค้า'} · ข้อมูล ${DAYS} วันล่าสุด`}
        className="rounded-3xl border border-orange-100 bg-gradient-to-r from-white via-white to-orange-50/70 p-5 shadow-sm [&_h1]:text-2xl [&_h1]:font-bold md:p-6 md:[&_h1]:text-3xl [&_p]:text-sm"
        action={
          <Link
            href="/inbox"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:underline"
          >
            ไปยังกล่องข้อความ <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={Banknote}
          label="ยอดรับเงินวันนี้"
          value={baht(todayPoint.amount)}
          foot={
            delta == null
              ? 'ยังไม่มียอดเมื่อวานให้เทียบ'
              : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(0)}% จากเมื่อวาน`
          }
        />
        <StatTile
          icon={CheckCircle2}
          label="สลิปผ่าน / อนุมัติวันนี้"
          value={todayPoint.count.toLocaleString('th-TH')}
          foot={`${DAYS} วัน: ${baht(periodTotal)}`}
        />
        <StatTile
          icon={attentionCount ? AlertTriangle : Hourglass}
          label="รอแอดมินตรวจสอบ"
          value={attentionCount.toLocaleString('th-TH')}
          foot="กำลังตรวจ + มีปัญหาที่ยังไม่อนุมัติ"
          href="/slips"
        />
        <StatTile
          icon={Coins}
          label="เครดิตตรวจสลิปคงเหลือ"
          value={creditsLeft == null ? '-' : creditsLeft.toLocaleString('th-TH')}
          foot={
            tenant
              ? `ใช้ไป ${tenant.slip_used.toLocaleString('th-TH')} / ${tenant.slip_quota.toLocaleString('th-TH')}`
              : 'ยังไม่ได้ตั้งค่าร้านค้า'
          }
          href="/settings#credits"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2 border-slate-200/80 shadow-[0_10px_35px_-25px_#33415555]">
          <CardHeader
            title="ยอดรับเงินรายวัน (สลิปผ่านและอนุมัติแล้ว)"
            description={`รวม ${baht(periodTotal)} ใน ${DAYS} วัน`}
            className="[&_h2]:text-base [&_h2]:font-bold [&_p]:mt-1 [&_p]:text-sm"
          />
          <div className="p-5">
            <RevenueChart data={points} />
          </div>
        </Card>

        <Card className="border-slate-200/80 shadow-[0_10px_35px_-25px_#33415555]">
          <CardHeader
            title="ผลตรวจสลิป"
            description={`${totalSlips.toLocaleString('th-TH')} สลิปใน ${DAYS} วัน`}
            className="[&_h2]:text-base [&_h2]:font-bold [&_p]:mt-1 [&_p]:text-sm"
          />
          <ul className="space-y-3 p-5">
            {(Object.keys(SLIP_STATUS) as SlipStatus[]).map((s) => {
              const n = byStatus.get(s) ?? 0
              const pct = totalSlips ? (n / totalSlips) * 100 : 0
              return (
                <li key={s}>
                  <div className="flex items-center justify-between text-xs">
                    <Badge tone={SLIP_STATUS[s].tone}>{SLIP_STATUS[s].label}</Badge>
                    <span className="font-medium text-slate-700 tabular-nums">
                      {n.toLocaleString('th-TH')}{' '}
                      <span className="text-slate-400">({pct.toFixed(0)}%)</span>
                    </span>
                  </div>
                  <div
                    className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"
                    aria-hidden
                  >
                    <div
                      className="h-full rounded-full bg-slate-400"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      </div>

      <Card className="border-slate-200/80 shadow-[0_10px_35px_-25px_#33415555]">
        <CardHeader
          title="สลิปที่ต้องตรวจสอบ"
          description="สลิปที่ระบบยังตัดสินไม่ได้ หรือไม่ผ่าน และยังไม่ได้อนุมัติด้วยตนเอง"
          className="[&_h2]:text-base [&_h2]:font-bold [&_p]:mt-1 [&_p]:text-sm"
          action={
            <Link href="/slips" className="text-xs font-medium text-emerald-700 hover:underline">
              ดูทั้งหมด
            </Link>
          }
        />
        {attentionCount === 0 ? (
          <p className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
            ไม่มีสลิปค้างตรวจ
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {attention.map((r) => (
              <li key={r.id} className="flex items-center gap-4 px-5 py-3 text-sm">
                <Badge tone={SLIP_STATUS[r.status].tone}>{SLIP_STATUS[r.status].label}</Badge>
                <span className="min-w-0 flex-1 truncate text-slate-700">
                  {r.customers?.display_name ?? 'ไม่ทราบลูกค้า'}
                </span>
                <span className="font-medium tabular-nums">{baht(r.amount)}</span>
                <time
                  className="hidden w-28 text-right text-xs text-slate-400 sm:block"
                  suppressHydrationWarning
                >
                  {when(r.created_at)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function StatTile({
  icon: Icon,
  label,
  value,
  foot,
  href,
}: {
  icon: LucideIcon
  label: string
  value: string
  foot: string
  href?: string
}) {
  const body = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-500">{label}</span>
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-500">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
        {value}
      </p>
      <p className="mt-1 text-xs text-slate-500">{foot}</p>
    </>
  )
  const cls =
    'block rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-md'
  return href ? (
    <Link href={href} className={cn(cls)}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}
