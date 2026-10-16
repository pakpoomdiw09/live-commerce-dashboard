import Link from 'next/link'
import { AlertTriangle, ArrowRight, Banknote, CheckCircle2, Coins, Hourglass, type LucideIcon } from 'lucide-react'
import { supabaseServer } from '@/lib/supabase/server'
import { getActiveTenant, getTenants, tenantFilter } from '@/lib/tenant'
import { APPROVABLE, SLIP_STATUS } from '@/lib/status'
import { LiveRefresh } from '@/components/LiveRefresh'
import type { SlipStatus } from '@/lib/types'
import { baht, cn, when } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, PageHeader } from '@/components/ui/card'
import { InlineError } from '@/components/ErrorState'
import { RevenueChart, type DayPoint } from '@/components/overview/RevenueChart'

const DAYS = 14
const TZ = 'Asia/Bangkok'
/** yyyy-mm-dd in Bangkok time, so "today" matches the shop's day, not the server's */
const dayKey = (d: Date | string) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ })
const ISSUES: SlipStatus[] = ['amount_mismatch', 'duplicate', 'fake', 'wrong_receiver', 'error']

type Row = { id: string; amount: number | null; status: SlipStatus; created_at: string; approved_at: string | null; customers: { display_name: string | null } | null }

/**
 * Money received: slips SlipOK passed, plus slips an admin approved by hand (e.g. a bank delay
 * made SlipOK answer 'fake'). Approval is refused for 'duplicate' and 'pending', so nothing is
 * counted twice. Counted on the day the slip came in.
 */
const counted = (r: Row) => r.status === 'valid' || (!!r.approved_at && APPROVABLE.includes(r.status))

export async function BasicOverviewPage() {
  const { error: tenantError } = await getTenants()
  if (tenantError) return <div className="p-6"><InlineError title="โหลดข้อมูลร้านค้าไม่ได้" message={tenantError}/></div>
  const [db, tenant] = await Promise.all([supabaseServer(), getActiveTenant()])
  const since = new Date(Date.now() - (DAYS + 1) * 86_400_000).toISOString()
  let query = db
    .from('slips')
    .select('id, amount, status, created_at, approved_at, customers(display_name)')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(5000)
  if (tenant) query = query.or(tenantFilter(tenant.id))
  const { data, error } = await query

  if (error) {
    return (
      <div className="p-6">
        <InlineError title="โหลดข้อมูลสรุปยอดไม่ได้" message={error.message} />
      </div>
    )
  }
  const rows = (data ?? []) as unknown as Row[]

  // ── aggregate ──
  const today = dayKey(new Date())
  const yesterday = dayKey(new Date(Date.now() - 86_400_000))
  const series = new Map<string, DayPoint>()
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000)
    const key = dayKey(d)
    series.set(key, { day: key, label: d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: TZ }), amount: 0, count: 0 })
  }
  const byStatus = new Map<SlipStatus, number>()
  for (const r of rows) {
    byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1)
    if (!counted(r)) continue
    const p = series.get(dayKey(r.created_at))
    if (p) {
      p.amount += Number(r.amount ?? 0)
      p.count += 1
    }
  }
  const points = [...series.values()]
  const todayPoint = series.get(today)!
  const yesterdayAmount = series.get(yesterday)?.amount ?? 0
  const delta = yesterdayAmount > 0 ? ((todayPoint.amount - yesterdayAmount) / yesterdayAmount) * 100 : null
  const periodTotal = points.reduce((s, p) => s + p.amount, 0)
  const attention = rows.filter((r) => r.status === 'pending' || (ISSUES.includes(r.status) && !r.approved_at))
  const creditsLeft = tenant ? Math.max(tenant.slip_quota + tenant.slip_quota_credits - tenant.slip_used, 0) : null
  const totalSlips = rows.length

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-8">
      {/* new slips, verdicts and approvals update the tiles and the chart without a reload */}
      <LiveRefresh channel="overview" tables={['slips', 'orders']} />
      <PageHeader
        title="แดชบอร์ดสรุปยอด"
        description={`${tenant ? tenant.name : 'ทุกร้านค้า'} · ข้อมูล ${DAYS} วันล่าสุด`}
        action={
          <Link href="/inbox" className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:underline">
            ไปกล่องข้อความ <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={Banknote}
          label="ยอดรับเงินวันนี้"
          value={baht(todayPoint.amount)}
          foot={delta == null ? 'ยังไม่มียอดเมื่อวานให้เทียบ' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(0)}% จากเมื่อวาน`}
        />
        <StatTile icon={CheckCircle2} label="สลิปผ่าน / อนุมัติวันนี้" value={todayPoint.count.toLocaleString('th-TH')} foot={`${DAYS} วัน: ${baht(periodTotal)}`} />
        <StatTile
          icon={attention.length ? AlertTriangle : Hourglass}
          label="รอแอดมินตรวจสอบ"
          value={attention.length.toLocaleString('th-TH')}
          foot="กำลังตรวจ + มีปัญหาที่ยังไม่อนุมัติ"
          href="/slips"
        />
        <StatTile
          icon={Coins}
          label="เครดิตตรวจสลิปคงเหลือ"
          value={creditsLeft == null ? '-' : creditsLeft.toLocaleString('th-TH')}
          foot={tenant ? `ใช้ไป ${tenant.slip_used.toLocaleString('th-TH')} / ${tenant.slip_quota.toLocaleString('th-TH')}` : 'ยังไม่ได้ตั้งค่าร้านค้า'}
          href="/settings#credits"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="ยอดรับเงินรายวัน (สลิปถูกต้อง + อนุมัติเอง)" description={`รวม ${baht(periodTotal)} ใน ${DAYS} วัน`} />
          <div className="p-5">
            <RevenueChart data={points} />
          </div>
        </Card>

        <Card>
          <CardHeader title="ผลตรวจสลิป" description={`${totalSlips.toLocaleString('th-TH')} สลิปใน ${DAYS} วัน`} />
          <ul className="space-y-3 p-5">
            {(Object.keys(SLIP_STATUS) as SlipStatus[]).map((s) => {
              const n = byStatus.get(s) ?? 0
              const pct = totalSlips ? (n / totalSlips) * 100 : 0
              return (
                <li key={s}>
                  <div className="flex items-center justify-between text-xs">
                    <Badge tone={SLIP_STATUS[s].tone}>{SLIP_STATUS[s].label}</Badge>
                    <span className="font-medium text-slate-700 tabular-nums">
                      {n.toLocaleString('th-TH')} <span className="text-slate-400">({pct.toFixed(0)}%)</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                    <div className="h-full rounded-full bg-slate-400" style={{ width: `${pct}%` }} />
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="สลิปที่ต้องตรวจสอบ"
          description="สลิปที่ระบบยังตัดสินไม่ได้ หรือไม่ผ่าน และยังไม่ได้อนุมัติด้วยตนเอง"
          action={
            <Link href="/slips" className="text-xs font-medium text-emerald-700 hover:underline">
              ดูทั้งหมด
            </Link>
          }
        />
        {attention.length === 0 ? (
          <p className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
            ไม่มีสลิปค้างตรวจ
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {attention.slice(0, 8).map((r) => (
              <li key={r.id} className="flex items-center gap-4 px-5 py-3 text-sm">
                <Badge tone={SLIP_STATUS[r.status].tone}>{SLIP_STATUS[r.status].label}</Badge>
                <span className="min-w-0 flex-1 truncate text-slate-700">{r.customers?.display_name ?? 'ไม่ทราบลูกค้า'}</span>
                <span className="font-medium tabular-nums">{baht(r.amount)}</span>
                <time className="hidden w-28 text-right text-xs text-slate-400 sm:block" suppressHydrationWarning>
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

function StatTile({ icon: Icon, label, value, foot, href }: { icon: LucideIcon; label: string; value: string; foot: string; href?: string }) {
  const body = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-500">{label}</span>
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-500">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{foot}</p>
    </>
  )
  const cls = 'block rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'
  return href ? (
    <Link href={href} className={cn(cls, 'transition hover:border-slate-300 hover:shadow-md')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}
