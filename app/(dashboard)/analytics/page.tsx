import Link from 'next/link'
import { Bot, Hand, MessagesSquare, Receipt, ShoppingCart, Target, TrendingUp, Wallet } from 'lucide-react'
import { supabaseServer } from '@/lib/supabase/server'
import { getActiveTenant } from '@/lib/tenant'
import { CF_ORDER_STATUS } from '@/lib/status'
import type { CfOrderStatus } from '@/lib/types'
import { baht, cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, PageHeader } from '@/components/ui/card'
import { StatTile } from '@/components/ui/StatTile'
import { LiveRefresh } from '@/components/LiveRefresh'
import { SetupNotice } from '@/components/SetupNotice'
import { RevenueChart, type DayPoint } from '@/components/overview/RevenueChart'

export const metadata = { title: 'วิเคราะห์' }

const PERIODS = [7, 30, 90]
const TZ = 'Asia/Bangkok'
const dayKey = (d: Date | string) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ })
/** Money that came in: paid, and paid-then-shipped. */
const isSale = (s: CfOrderStatus) => s === 'paid' || s === 'shipped'
const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '-')
const num = (n: number) => n.toLocaleString('th-TH')

type Order = { id: string; customer_id: string; product_id: string | null; product_name: string; amount: number; status: CfOrderStatus; created_at: string; paid_at: string | null }

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const [db, tenant, sp] = await Promise.all([supabaseServer(), getActiveTenant(), searchParams])
  if (!tenant) return <SetupNotice kind="no-tenant" />
  const days = PERIODS.includes(Number(sp.days)) ? Number(sp.days) : 30
  const now = Date.now()
  const since = new Date(now - days * 86_400_000).toISOString()
  const prevSince = new Date(now - 2 * days * 86_400_000).toISOString()

  const msgCount = (sender: string) =>
    db
      .from('messages')
      .select('id, customers!inner(tenant_id)', { count: 'exact', head: true })
      .eq('customers.tenant_id', tenant.id)
      .eq('sender', sender)
      .gte('created_at', since)

  const [orders, prev, activeChats, botMsgs, agentMsgs, customerMsgs, handovers, followUps] = await Promise.all([
    db.from('orders').select('id, customer_id, product_id, product_name, amount, status, created_at, paid_at').eq('tenant_id', tenant.id).gte('created_at', since).limit(10000),
    db.from('orders').select('amount, status').eq('tenant_id', tenant.id).gte('created_at', prevSince).lt('created_at', since).limit(10000),
    db.from('customers').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).gte('last_message_at', since),
    msgCount('bot'),
    msgCount('agent'),
    msgCount('customer'),
    db.from('customers').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).gte('handover_at', since),
    db.from('follow_up_jobs').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('status', 'sent').gte('sent_at', since),
  ])
  if (orders.error) return <SetupNotice kind="migration" message={orders.error.message} />

  const rows = ((orders.data ?? []) as Order[]).map((o) => ({ ...o, amount: Number(o.amount) }))
  const sales = rows.filter((o) => isSale(o.status))
  // sum in satang so 0.1 + 0.2 stays 0.30
  const sum = (list: { amount: number | string }[]) => list.reduce((s, o) => s + Math.round(Number(o.amount) * 100), 0) / 100
  const gmv = sum(sales)
  const prevGmv = sum((prev.data ?? []).filter((o) => isSale(o.status as CfOrderStatus)))
  const delta = prevGmv > 0 ? ((gmv - prevGmv) / prevGmv) * 100 : null
  const aov = sales.length ? gmv / sales.length : 0

  // ── bot close rate: paid orders where no admin wrote to the customer between the order and the payment ──
  const paidCustomers = [...new Set(sales.map((o) => o.customer_id))]
  const agentTimes = new Map<string, number[]>()
  for (let i = 0; i < paidCustomers.length; i += 200) {
    const { data } = await db
      .from('messages')
      .select('customer_id, created_at')
      .eq('sender', 'agent')
      .in('customer_id', paidCustomers.slice(i, i + 200))
      .gte('created_at', since)
      .limit(10000)
    for (const m of data ?? []) agentTimes.set(m.customer_id, [...(agentTimes.get(m.customer_id) ?? []), new Date(m.created_at).getTime()])
  }
  const botClosed = sales.filter((o) => {
    const from = new Date(o.created_at).getTime()
    const to = o.paid_at ? new Date(o.paid_at).getTime() : now
    return !(agentTimes.get(o.customer_id) ?? []).some((t) => t >= from && t <= to)
  }).length

  // ── daily GMV ──
  const series = new Map<string, DayPoint>()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * 86_400_000)
    series.set(dayKey(d), { day: dayKey(d), label: d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: TZ }), amount: 0, count: 0 })
  }
  for (const o of sales) {
    const p = series.get(dayKey(o.created_at))
    if (p) {
      p.amount += o.amount
      p.count += 1
    }
  }

  // ── orders by status, top products ──
  const byStatus = new Map<CfOrderStatus, number>()
  for (const o of rows) byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1)
  const products = new Map<string, { name: string; qty: number; amount: number }>()
  for (const o of sales) {
    const key = o.product_id ?? o.product_name
    const p = products.get(key) ?? { name: o.product_name, qty: 0, amount: 0 }
    p.qty += 1
    p.amount += o.amount
    products.set(key, p)
  }
  const top = [...products.values()].sort((a, b) => b.amount - a.amount).slice(0, 6)
  const topMax = top[0]?.amount ?? 0

  const buyers = new Set(rows.map((o) => o.customer_id)).size
  const bot = botMsgs.count ?? 0
  const agent = agentMsgs.count ?? 0
  const chats = activeChats.count ?? 0

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-8">
      <LiveRefresh channel="analytics" tables={['orders']} />
      <PageHeader
        title="วิเคราะห์"
        description={`${tenant.name} · ${days} วันล่าสุด`}
        action={
          <nav aria-label="ช่วงเวลา" className="flex rounded-lg bg-slate-100 p-1 text-sm">
            {PERIODS.map((p) => (
              <Link
                key={p}
                href={`/analytics?days=${p}`}
                aria-current={p === days ? 'page' : undefined}
                className={cn('rounded-md px-3 py-1 font-medium', p === days ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}
              >
                {p} วัน
              </Link>
            ))}
          </nav>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={Wallet}
          label="ยอดขาย (GMV)"
          value={baht(gmv)}
          foot={delta == null ? 'ยังไม่มีข้อมูลช่วงก่อนหน้าให้เทียบ' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(0)}% จาก ${days} วันก่อนหน้า`}
        />
        <StatTile icon={Receipt} label="ออเดอร์ชำระแล้ว" value={num(sales.length)} foot={`เฉลี่ย ${baht(aov)} / ออเดอร์`} href="/shop" />
        <StatTile icon={Bot} label="บอทปิดการขายเอง" value={pct(botClosed, sales.length)} foot={`${num(botClosed)} จาก ${num(sales.length)} ออเดอร์ ไม่มีแอดมินแทรก`} />
        <StatTile icon={Target} label="อัตราชำระเงิน" value={pct(sales.length, rows.length)} foot={`ชำระ ${num(sales.length)} จากสั่ง ${num(rows.length)} ออเดอร์`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="ยอดขายรายวัน" description={`ออเดอร์ที่ชำระแล้ว / จัดส่งแล้ว ตามวันที่สั่ง · รวม ${baht(gmv)}`} />
          <div className="p-5">
            <RevenueChart data={[...series.values()]} unit="ออเดอร์" caption="ยอดขายรายวัน" />
          </div>
        </Card>

        <Card>
          <CardHeader title="สถานะออเดอร์" description={`${num(rows.length)} ออเดอร์ใน ${days} วัน`} />
          <ul className="space-y-3 p-5">
            {(Object.keys(CF_ORDER_STATUS) as CfOrderStatus[]).map((s) => {
              const n = byStatus.get(s) ?? 0
              const share = rows.length ? (n / rows.length) * 100 : 0
              return (
                <li key={s}>
                  <div className="flex items-center justify-between text-xs">
                    <Badge tone={CF_ORDER_STATUS[s].tone}>{CF_ORDER_STATUS[s].label}</Badge>
                    <span className="font-medium text-slate-700 tabular-nums">
                      {num(n)} <span className="text-slate-400">({share.toFixed(0)}%)</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                    <div className="h-full rounded-full bg-slate-400" style={{ width: `${share}%` }} />
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="สินค้าขายดี" description="จัดอันดับตามยอดขายที่ชำระแล้ว" />
          {top.length === 0 ? (
            <p className="p-10 text-center text-sm text-slate-500">ยังไม่มียอดขายในช่วงนี้</p>
          ) : (
            <ul className="space-y-4 p-5">
              {top.map((p, i) => (
                <li key={p.name + i}>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="w-5 text-right text-xs font-semibold text-slate-400 tabular-nums">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{p.name}</span>
                    <span className="text-xs text-slate-500 tabular-nums">{num(p.qty)} ชิ้น</span>
                    <span className="w-28 text-right font-medium tabular-nums">{baht(p.amount)}</span>
                  </div>
                  <div className="mt-1.5 ml-8 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                    <div className="h-full rounded-full bg-emerald-600" style={{ width: `${topMax ? (p.amount / topMax) * 100 : 0}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="แชทและบอท" description={`${days} วันล่าสุด`} />
          <dl className="divide-y divide-slate-100 text-sm">
            {[
              [MessagesSquare, 'ลูกค้าที่ทักแชท', num(chats), `${num(customerMsgs.count ?? 0)} ข้อความ`],
              [ShoppingCart, 'ทักแล้วสั่งซื้อ', pct(buyers, chats), `${num(buyers)} คนสั่งซื้อ`],
              [Bot, 'ข้อความที่บอทตอบ', pct(bot, bot + agent), `บอท ${num(bot)} · แอดมิน ${num(agent)}`],
              [Hand, 'ส่งต่อให้แอดมิน', num(handovers.count ?? 0), 'ลูกค้าขอคุยกับคน'],
              [TrendingUp, 'ข้อความทวงสลิปที่ส่ง', num(followUps.count ?? 0), 'จากผู้ช่วยติดตามลูกค้า'],
            ].map(([Icon, label, value, foot]) => {
              const I = Icon as typeof Bot
              return (
                <div key={label as string} className="flex items-center gap-3 px-5 py-3">
                  <I className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                  <dt className="min-w-0 flex-1">
                    <span className="block text-slate-700">{label as string}</span>
                    <span className="block text-xs text-slate-400">{foot as string}</span>
                  </dt>
                  <dd className="font-semibold text-slate-900 tabular-nums">{value as string}</dd>
                </div>
              )
            })}
          </dl>
        </Card>
      </div>
    </div>
  )
}
