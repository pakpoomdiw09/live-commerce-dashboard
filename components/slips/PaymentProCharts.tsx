'use client'
import { useState } from 'react'
import { RevenueChart, type DayPoint } from '@/components/overview/RevenueChart'
export function PaymentProCharts({
  stats,
  series,
}: {
  stats: Record<string, number>
  series: { day: string; amount: number; count: number }[]
}) {
  const [counts, setCounts] = useState(false)
  const groups = [
    { label: 'ผ่าน', value: stats.verified ?? 0, color: '#22c55e' },
    { label: 'รอตรวจสอบ / กำลังตรวจ', value: stats.review ?? 0, color: '#fb923c' },
    { label: 'ไม่ผ่าน', value: stats.rejected ?? 0, color: '#f43f5e' },
    { label: 'ยกเลิก', value: stats.cancelled ?? 0, color: '#94a3b8' },
  ]
  let at = 0
  const total = groups.reduce((n, g) => n + Number(g.value), 0),
    gradient = groups
      .map((g) => {
        const start = at
        at += total ? (Number(g.value) / total) * 360 : 0
        return `${g.color} ${start}deg ${at}deg`
      })
      .join(',')
  const points: DayPoint[] = series.map((s) => ({
    ...s,
    amount: counts ? s.count : s.amount,
    label: new Date(s.day + 'T12:00:00+07:00').toLocaleDateString('th-TH', {
      day: 'numeric',
      month: 'short',
      timeZone: 'Asia/Bangkok',
    }),
  }))
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <section className="rounded-3xl border border-orange-100 bg-white p-5 shadow-sm lg:col-span-2">
        <div className="mb-6 flex flex-wrap justify-between gap-3">
          <div>
            <h2 className="font-semibold">ยอดเงินและสลิปรายวัน</h2>
            <p className="mt-1 text-xs text-slate-500">
              ยอดที่ตรวจผ่านใน Payment Pro ไม่ใช่รายงานกระทบยอดธนาคาร
            </p>
          </div>
          <button
            className="rounded-xl bg-orange-50 p-2 text-xs text-orange-700"
            aria-pressed={counts}
            onClick={() => setCounts(!counts)}
          >
            {counts ? 'แสดงยอดเงิน' : 'แสดงจำนวนสลิป'}
          </button>
        </div>
        {points.length ? (
          <RevenueChart
            data={points}
            orange
            numberOnly={counts}
            caption={counts ? 'จำนวนรายการตรวจรายวัน' : 'ยอดเงินที่ตรวจผ่านรายวัน'}
            unit="รายการตรวจ"
          />
        ) : (
          <p className="py-12 text-center text-sm text-slate-500">ยังไม่มีข้อมูลในช่วงเวลานี้</p>
        )}
      </section>
      <section className="rounded-3xl border border-orange-100 bg-white p-5 shadow-sm">
        <h2 className="mb-5 font-semibold">ผลตรวจสลิป</h2>
        <div
          role="img"
          aria-label={groups.map((g) => `${g.label} ${g.value}`).join(', ')}
          className="mx-auto grid h-40 w-40 place-items-center rounded-full"
          style={{ background: total ? `conic-gradient(${gradient})` : '#f1f5f9' }}
        >
          <div className="grid h-28 w-28 content-center rounded-full bg-white text-center">
            <strong className="text-3xl">{total.toLocaleString('th-TH')}</strong>
            <span className="text-xs text-slate-500">รายการตรวจ</span>
          </div>
        </div>
        <ul className="mt-5 space-y-2 text-sm">
          {groups.map((g) => (
            <li key={g.label} className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: g.color }} />
              {g.label}
              <strong className="ml-auto">{Number(g.value).toLocaleString('th-TH')}</strong>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
