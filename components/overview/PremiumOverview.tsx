'use client'
import { PageBanner } from '@/components/ui/page-banner'
import { neutralSlipText } from '@/lib/ui-labels'
import Image from 'next/image'
import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowDownLeft,
  ArrowRight,
  Bell,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  Layers,
  LockKeyhole,
  MessageCircle,
  Package,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Store,
  TrendingUp,
} from 'lucide-react'
import type { PremiumOverviewData } from '@/lib/features/overview/premium-overview-core'
import type { ActivityPoint } from '@/lib/features/overview/overview-activity-core'
import { CustomerGenderCard } from '@/components/overview/CustomerGenderCard'
import { Avatar } from '@/components/inbox/Avatar'
import {
  MessageActivityChart,
  HourlyActivityChart,
} from '@/components/overview/MessageActivityCharts'

const count = (n: number | null) => (n === null ? '—' : n.toLocaleString('th-TH'))
const money = (n: number | null) =>
  n === null
    ? '—'
    : new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(n)
const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleString('th-TH', {
        timeZone: 'Asia/Bangkok',
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '—'
const resultInfo = {
  passed: { label: 'ผ่าน / อนุมัติ', color: '#22c55e', style: 'bg-green-50 text-green-700' },
  pending: { label: 'รอตรวจสอบ', color: '#fb923c', style: 'bg-orange-50 text-orange-700' },
  rejected: { label: 'ไม่ผ่าน', color: '#f43f5e', style: 'bg-rose-50 text-rose-700' },
  error: { label: 'ตรวจไม่สำเร็จ', color: '#94a3b8', style: 'bg-slate-100 text-slate-600' },
}
function Panel({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`min-w-0 rounded-3xl border border-orange-100/80 bg-white p-5 shadow-[0_8px_30px_-18px_#9a341233] md:p-6 ${className}`}
    >
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-slate-900">{title}</h2>
          {subtitle && <p className="mt-1.5 text-sm leading-6 text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}
function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-2xl bg-slate-50 px-4 py-8 text-center text-sm leading-6 text-slate-500">
      {children}
    </p>
  )
}
function Locked() {
  return (
    <Empty>
      <LockKeyhole className="mx-auto mb-2 h-5 w-5" />
      แพ็กเกจปัจจุบันไม่รองรับข้อมูลส่วนนี้
      <br />
      <Link href="/billing" className="font-medium text-orange-700 underline">
        อัปเกรดแพ็กเกจ
      </Link>
    </Empty>
  )
}
function Donut({ data }: { data: PremiumOverviewData['results'] }) {
  if (!data) return <Locked />
  const total = Object.values(data).reduce((a, b) => a + b, 0)
  let angle = 0
  const slices = Object.entries(resultInfo).map(([key, value]) => {
    const start = angle
    angle += (data[key as keyof typeof data] / (total || 1)) * 360
    return `${value.color} ${start}deg ${angle}deg`
  })
  return (
    <>
      <div
        role="img"
        aria-label={`ผลตรวจรวม ${total} สลิป: ${Object.entries(data)
          .map(([k, v]) => `${resultInfo[k as keyof typeof resultInfo].label} ${v}`)
          .join(', ')}`}
        className="relative mx-auto mb-6 grid h-44 w-44 place-items-center rounded-full"
        style={{ background: total ? `conic-gradient(${slices.join(',')})` : '#f1f5f9' }}
      >
        <div className="grid h-32 w-32 content-center rounded-full bg-white text-center">
          <strong className="text-3xl font-bold text-slate-900">{count(total)}</strong>
          <span className="mt-1 text-xs text-slate-500">สลิปทั้งหมด</span>
        </div>
      </div>
      <ul className="space-y-3">
        {Object.entries(resultInfo).map(([key, value]) => (
          <li key={key} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: value.color }} />
            <span className="text-slate-600">{value.label}</span>
            <strong className="ml-auto tabular-nums">
              {count(data[key as keyof typeof data])}
            </strong>
          </li>
        ))}
      </ul>
      {!total && (
        <p className="mt-4 text-center text-xs text-slate-500">ยังไม่มีสลิปในช่วงเวลานี้</p>
      )}
    </>
  )
}
function Pagination({
  page,
  total,
  href,
}: {
  page: number
  total: number
  href: (page: number) => string
}) {
  return (
    <nav
      aria-label="หน้ารายการล่าสุด"
      className="mt-4 flex items-center justify-between text-xs text-slate-500"
    >
      <span>
        {count(total)} รายการ · หน้า {page}
      </span>
      <span className="flex gap-2">
        {page > 1 && (
          <Link href={href(page - 1)} className="rounded-lg border p-2" aria-label="หน้าก่อนหน้า">
            <ChevronLeft className="h-4 w-4" />
          </Link>
        )}
        {page * 10 < total && page < 1000 && (
          <Link href={href(page + 1)} className="rounded-lg border p-2" aria-label="หน้าถัดไป">
            <ChevronRight className="h-4 w-4" />
          </Link>
        )}
      </span>
    </nav>
  )
}

export function PremiumOverview({
  data,
  shopCount,
  userName,
  profileImageUrl,
}: {
  data: PremiumOverviewData
  shopCount: number
  userName: string
  profileImageUrl: string | null
}) {
  const router = useRouter(),
    [profileImageFailed, setProfileImageFailed] = useState(false)
  const filters = data.filters,
    m = data.metrics
  const href = (page: number) =>
    `/overview?${new URLSearchParams({ range: filters.range, q: filters.q, page: String(page) })}`
  const failedSlips = data.results ? data.results.rejected + data.results.error : null
  const kpis = [
    {
      label: 'ลูกค้าที่ทักมา',
      value: count(m.uniqueCustomers),
      foot: 'นับลูกค้าแต่ละคนเพียงครั้งเดียว',
      icon: Store,
      tone: 'bg-rose-50 text-rose-600',
    },
    {
      label: 'ข้อความที่ได้รับ',
      value: count(m.incomingMessages),
      foot: 'จำนวนข้อความจากลูกค้าในช่วงเวลาที่เลือก',
      icon: MessageCircle,
      tone: 'bg-blue-50 text-blue-600',
    },
    {
      label: 'สลิปผ่าน',
      value: count(data.results?.passed ?? null),
      foot: 'ผลตรวจผ่านหรืออนุมัติแล้ว',
      icon: CheckCircle2,
      tone: 'bg-emerald-50 text-emerald-600',
    },
    {
      label: 'สลิปไม่ผ่าน',
      value: count(failedSlips),
      foot: 'ตรวจไม่ผ่านหรือพบข้อผิดพลาด',
      icon: ShieldCheck,
      tone: 'bg-violet-50 text-violet-600',
    },
  ]
  const peakActivity =
    data.activity?.reduce<ActivityPoint | null>(
      (best, point) => (point.messages > (best?.messages ?? 0) ? point : best),
      null,
    ) ?? null
  const peakSummary =
    peakActivity && peakActivity.messages > 0
      ? data.bucket === 'day'
        ? `${new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', weekday: 'long' }).format(new Date(`${peakActivity.key}T12:00:00+07:00`))} มีข้อความเข้ามามากที่สุดในช่วงเวลานี้ (${count(peakActivity.messages)} ข้อความ)`
        : `เดือน ${peakActivity.label} มีข้อความเข้ามามากที่สุด (${count(peakActivity.messages)} ข้อความ)`
      : null
  return (
    <div className="min-h-full min-w-0 bg-[#fffaf8] text-slate-800">
      <header className="flex flex-wrap items-center gap-3 border-b border-orange-100/80 bg-white/90 px-4 py-3 shadow-[0_3px_16px_-14px_#9a3412] backdrop-blur md:px-8">
        <form action="/overview" className="relative min-w-0 flex-1 basis-64">
          <label htmlFor="overview-search" className="sr-only">
            ค้นหาชื่อในแชทล่าสุดและชื่อหรือหมายเหตุสลิป
          </label>
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <input
            id="overview-search"
            name="q"
            maxLength={100}
            defaultValue={filters.q}
            placeholder="ค้นหาแชทล่าสุด / หมายเหตุสลิป…"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-20 text-sm"
          />
          <input type="hidden" name="range" value={filters.range} />
          <button className="absolute right-1 top-1 rounded-lg bg-orange-50 px-3 py-2 text-xs font-medium text-orange-700">
            ค้นหา
          </button>
        </form>
        <Link
          href="/slips"
          aria-label={`รอตรวจสลิป ${m.pending ?? 'ยังไม่มีข้อมูล'}`}
          className="relative rounded-xl border border-slate-200 p-2.5 text-slate-500"
        >
          <Bell className="h-5 w-5" />
          {m.pending !== null && m.pending > 0 && (
            <span className="absolute -right-1 -top-1 rounded-full bg-orange-500 px-1 text-[10px] text-white">
              {m.pending > 99 ? '99+' : m.pending}
            </span>
          )}
        </Link>
        <details className="relative">
          <summary
            aria-label="วิธีอ่านข้อมูลภาพรวม"
            className="cursor-pointer list-none rounded-xl border border-slate-200 p-2.5 text-slate-500"
          >
            <HelpCircle className="h-5 w-5" />
          </summary>
          <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border bg-white p-4 text-xs leading-6 shadow-lg">
            ยอดจากสลิปแสดงตามผลตรวจในระบบ ไม่ใช่ยอดรับเงินที่ธนาคารตรวจสอบแล้ว
            คำค้นใช้กับแชทล่าสุดและรายการสลิปของร้านที่เลือกเท่านั้น
          </div>
        </details>
        <Link
          href="/select-page"
          className="flex min-w-0 items-center gap-2 rounded-xl border border-orange-100 px-3 py-2 text-sm"
        >
          <Store className="h-5 w-5 shrink-0 text-orange-500" />
          <span className="max-w-40 truncate">
            {data.shop.name}
            <small className="block text-[10px] text-slate-400">
              เปลี่ยนร้าน / เพจ · {shopCount} ร้าน
            </small>
          </span>
        </Link>
        <Link
          href="/settings"
          aria-label="เปิดการตั้งค่าบัญชี"
          title={userName}
          className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-linear-to-br from-orange-400 to-pink-500 font-bold text-white"
        >
          {Array.from(userName)[0]?.toUpperCase()}
          {profileImageUrl && !profileImageFailed && (
            <Image
              src={profileImageUrl}
              alt=""
              fill
              sizes="40px"
              unoptimized
              referrerPolicy="no-referrer"
              onError={() => setProfileImageFailed(true)}
              className="object-cover"
            />
          )}
        </Link>
      </header>
      <div className="mx-0 w-full min-w-0 max-w-none space-y-6 p-4 md:space-y-7 md:p-8">
        <PageBanner className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 flex-1 basis-72">
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
              ภาพรวมธุรกิจของคุณ <span aria-hidden>👋</span>
            </h1>
            <p className="mt-2 text-sm text-white">
              ดูจำนวนลูกค้า ข้อความ และผลการตรวจสลิปได้ในหน้าเดียว
            </p>
            <p className="mt-1 text-xs leading-5 text-white">
              ข้อมูลในช่วง {filters.range === 'all' ? 'ทั้งหมด' : `${filters.range} วันที่ผ่านมา`} ·
              อัปเดตล่าสุด {date(data.updatedAt)} · เวลาไทย
              {filters.range === 'all' &&
                ' · กราฟรายเดือนแสดงย้อนหลังสูงสุด 10 ปี ยอดรวมคำนวณจากข้อมูลทั้งหมด'}
            </p>
          </div>
          <div className="flex max-w-full flex-wrap items-center gap-2 text-slate-900">
            <form action="/overview" className="flex min-w-0 flex-wrap items-center gap-2">
              <input name="q" type="hidden" value={filters.q} />
              <label htmlFor="overview-range" className="sr-only">
                เลือกช่วงเวลา
              </label>
              <select
                id="overview-range"
                name="range"
                defaultValue={filters.range}
                className="rounded-xl border border-orange-100 bg-white px-3 py-2.5 text-sm shadow-sm"
              >
                {[
                  ['7', '7 วันล่าสุด'],
                  ['30', '30 วันล่าสุด'],
                  ['90', '90 วันล่าสุด'],
                  ['all', 'ตลอดเวลา'],
                ].map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <button className="rounded-xl bg-slate-900 px-3 py-2.5 text-sm text-white">
                แสดงผล
              </button>
            </form>
            <button
              onClick={() => router.refresh()}
              aria-label="อัปเดตข้อมูลล่าสุด"
              className="rounded-xl border border-orange-100 bg-white p-3 text-orange-600 shadow-sm transition hover:bg-orange-50"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </PageBanner>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {kpis.map(({ label, value, foot, icon: Icon, tone }) => (
            <article
              key={label}
              className="group min-w-0 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-md"
            >
              <span className={`mb-4 grid h-11 w-11 place-items-center rounded-xl ${tone}`}>
                <Icon className="h-5 w-5" />
              </span>
              <p className="text-sm font-semibold leading-5 text-slate-600">{label}</p>
              <p className="my-2 break-words text-2xl font-bold tabular-nums tracking-tight text-slate-900 md:text-[1.75rem]">
                {value}
              </p>
              <p className="text-xs leading-5 text-slate-500">{foot}</p>
            </article>
          ))}
          <CustomerGenderCard data={data.customerGenders} />
        </div>
        <div className="grid gap-5 xl:grid-cols-3">
          <Panel
            className="xl:col-span-2"
            title="สถิติการทักข้อความจากลูกค้า"
            subtitle={`ดูจำนวนข้อความและจำนวนลูกค้าที่ทักเข้ามาในแต่ละ${data.bucket === 'day' ? 'วัน' : 'เดือน'}`}
          >
            <MessageActivityChart data={data.activity} />
            {peakSummary && (
              <p className="mt-4 rounded-xl border border-orange-100 bg-orange-50/70 px-4 py-3 text-sm font-medium leading-6 text-orange-900">
                {peakSummary}
              </p>
            )}
          </Panel>
          <Panel
            title="ช่วงเวลาที่ลูกค้าทักมากที่สุด"
            subtitle="ดูว่าลูกค้ามักส่งข้อความเข้ามาช่วงเวลาใด"
          >
            <HourlyActivityChart data={data.hourActivity} />
          </Panel>
        </div>
        <div className="grid gap-5 lg:grid-cols-3">
          <Panel
            title="การตั้งค่าและสถานะระบบ"
            subtitle="ดูว่าระบบใดพร้อมใช้งาน และตั้งค่าส่วนที่ยังไม่เปิดได้ทันที"
          >
            <ul className="space-y-5">
              {data.health.map((h) => (
                <li key={h.name} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{h.name}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{h.detail}</p>
                  </div>
                  {h.status === 'active' ? (
                    <span className="shrink-0 rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700">
                      ใช้งานอยู่
                    </span>
                  ) : (
                    <Link
                      href={h.setupHref}
                      className="shrink-0 rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-700 transition hover:bg-orange-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
                    >
                      ตั้งค่า
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="ทางลัดใช้งานด่วน" subtitle="ไปยังเครื่องมือที่ใช้บ่อย">
            <div className="grid gap-3">
              {[
                { label: 'ตรวจสอบสลิป', href: '/slips', icon: ShieldCheck },
                { label: 'แชทกับลูกค้า', href: '/inbox', icon: MessageCircle },
                { label: 'จัดการสินค้า', href: '/shop', icon: Package },
                { label: 'ส่งข้อความถึงลูกค้า', href: '/broadcast', icon: Radio },
                { label: 'วิเคราะห์ธุรกิจ', href: '/analytics', icon: TrendingUp },
              ].map(({ label, href, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="group flex items-center gap-3 rounded-xl border border-slate-200 p-3.5 text-sm font-medium text-slate-700 transition hover:-translate-y-0.5 hover:border-orange-200 hover:bg-orange-50/70 hover:shadow-sm"
                >
                  <span className="rounded-lg bg-orange-50 p-2 text-orange-500">
                    <Icon className="h-4 w-4" />
                  </span>
                  {label}
                  <ArrowRight className="ml-auto h-4 w-4 text-slate-400 group-hover:text-orange-500" />
                </Link>
              ))}
            </div>
          </Panel>
          <Panel
            title="สรุปการทำงานของ AI"
            subtitle="สรุปจากข้อมูลการตอบกลับที่ระบบบันทึกไว้"
            action={<Sparkles className="h-5 w-5 text-orange-500" />}
          >
            {!data.access.ai ? (
              <Locked />
            ) : !data.ai ? (
              <Empty>
                ยังไม่มีข้อมูลการทำงานของ AI
                <br />
                เปิดใช้งานผู้ช่วย AI เพื่อเริ่มบันทึกข้อมูล
              </Empty>
            ) : (
              <>
                <dl className="space-y-5">
                  {[
                    ['ข้อความที่ AI ส่งสำเร็จ', count(data.ai.replies)],
                    ['บทสนทนาที่ AI ตอบแล้ว', count(data.ai.conversations)],
                    ['รายการที่ส่งต่อให้แอดมิน', count(data.ai.handoffs)],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-3 text-sm">
                      <dt className="text-slate-500">{label}</dt>
                      <dd className="font-semibold tabular-nums">{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-5 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">
                  คำถามที่พบบ่อย: ยังไม่มีการจัดกลุ่มคำถามจริง
                  <br />
                  ตัวเลขนี้นับเฉพาะการทำงานของ AI
                </p>
              </>
            )}
            <Link
              href="/chatbot/conversations"
              className="mt-5 inline-flex items-center gap-1 text-xs font-semibold text-orange-700"
            >
              จัดการผู้ช่วยตอบแชท <ArrowRight className="h-3 w-3" />
            </Link>
          </Panel>
        </div>
        {filters.q && (
          <p role="status" className="rounded-xl border border-orange-100 bg-white p-3 text-sm">
            ผลค้นหา “{filters.q}” ในแชทล่าสุดและรายการสลิปของร้านนี้ ·
            ตัวเลขสรุปและกราฟยังแสดงทั้งช่วงเวลา{' '}
            <Link
              href={`/overview?range=${filters.range}`}
              className="ml-2 text-orange-700 underline"
            >
              ล้างคำค้น
            </Link>
          </p>
        )}
        <div className="grid gap-5 xl:grid-cols-4">
          <Panel
            className="xl:col-span-2"
            title="รายการตรวจสลิปล่าสุด"
            subtitle="รายการล่าสุดของร้านที่เลือก"
            action={
              <Link
                href="/slips"
                className="rounded-lg px-3 py-2 text-xs font-semibold text-orange-700 transition hover:bg-orange-50"
              >
                ดูทั้งหมด →
              </Link>
            }
          >
            {!data.access.slips ? (
              <Locked />
            ) : !data.slips.length ? (
              <Empty>ยังไม่มีรายการที่ตรงกับตัวกรอง</Empty>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-slate-100">
                <table className="w-full min-w-[580px] table-fixed text-left text-xs">
                  <caption className="sr-only">รายการสลิปของร้าน {data.shop.name}</caption>
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      {['เวลา', 'ลูกค้า', 'จำนวนเงิน', 'ผลตรวจ', 'หมายเหตุ'].map((l) => (
                        <th scope="col" key={l} className="px-3 py-3 font-semibold">
                          {l}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.slips.map((s) => (
                      <tr
                        key={s.id}
                        className="border-t border-slate-100 transition hover:bg-orange-50/40"
                      >
                        <td className="w-[24%] px-3 py-3.5 whitespace-nowrap text-slate-600">
                          {date(s.created_at)}
                        </td>
                        <td className="w-[17%] px-3">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <Avatar
                              c={{
                                id: s.id,
                                display_name: s.customer ?? 'ลูกค้า',
                                platform_user_id: '',
                                avatar_url: s.avatar_url,
                              }}
                              className="h-8 w-8 text-xs"
                            />
                            <span className="min-w-0 truncate font-medium text-slate-800">
                              {s.customer ?? '—'}
                            </span>
                          </div>
                        </td>
                        <td className="w-[17%] px-3 font-semibold tabular-nums text-slate-800">
                          {money(s.amount)}
                        </td>
                        <td className="w-[16%] px-3">
                          <span
                            className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-semibold ${resultInfo[s.result].style}`}
                          >
                            {resultInfo[s.result].label}
                          </span>
                        </td>
                        <td
                          className="w-[26%] truncate px-3 text-slate-600"
                          title={s.note ? neutralSlipText(s.note) : undefined}
                        >
                          {neutralSlipText(s.note ?? '—')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.access.slips && (
              <Pagination page={filters.page} total={data.slipMatches} href={href} />
            )}
          </Panel>
          <Panel title="ผลตรวจสลิป" subtitle="สรุปผลตรวจในช่วงเวลาที่เลือก">
            <Donut data={data.results} />
          </Panel>
          <Panel
            title="แชทลูกค้าล่าสุด"
            subtitle="ผู้ดูแลแชทและจำนวนข้อความที่ยังไม่ได้อ่าน"
            action={
              <Link href="/inbox" className="text-xs font-semibold text-orange-700">
                ดูแชททั้งหมด →
              </Link>
            }
          >
            {!data.access.customers ? (
              <Locked />
            ) : !data.chats.length ? (
              <Empty>ยังไม่มีแชทที่ตรงกับตัวกรอง</Empty>
            ) : (
              <ul className="divide-y divide-slate-50">
                {data.chats.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/inbox?customer=${encodeURIComponent(c.id)}`}
                      className="flex gap-3 rounded-xl py-3 hover:bg-orange-50"
                    >
                      <Avatar
                        c={{
                          id: c.id,
                          display_name: c.name,
                          platform_user_id: '',
                          avatar_url: c.avatar_url,
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <strong className="truncate text-sm">{c.name ?? 'ลูกค้า'}</strong>
                          {c.unread_count > 0 && (
                            <span
                              aria-label={`${c.unread_count} ข้อความยังไม่อ่าน`}
                              className="ml-auto rounded-full bg-orange-500 px-1.5 text-[10px] text-white"
                            >
                              {c.unread_count}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 truncate text-xs text-slate-500">
                          {c.body ?? 'ข้อความแนบ / ไม่มีข้อความ'}
                        </p>
                        <div className="mt-1 flex flex-wrap justify-between gap-1 text-[10px] text-slate-400">
                          <time>{date(c.last_message_at)}</time>
                          <span>{c.owner}</span>
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {data.access.customers && (
              <Pagination page={filters.page} total={data.chatMatches} href={href} />
            )}
          </Panel>
        </div>
        <footer className="flex flex-wrap items-center gap-2 pb-2 text-[11px] text-slate-400">
          <Layers className="h-3 w-3" />
          ข้อมูลเฉพาะร้านที่เลือก · ไม่ใช่รายงานกระทบยอดธนาคาร{' '}
          <Link href="/billing" className="ml-auto text-orange-600">
            แพ็กเกจและเครดิต <ArrowDownLeft className="inline h-3 w-3" />
          </Link>
        </footer>
      </div>
    </div>
  )
}
