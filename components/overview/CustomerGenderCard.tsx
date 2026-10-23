import { Users } from 'lucide-react'
import type { CustomerGenderSummary } from '@/lib/features/overview/overview-activity-core'

export function CustomerGenderCard({ data }: { data: CustomerGenderSummary | null }) {
  const total = data ? data.male + data.female + data.unspecified : 0
  const groups = data ? [
    { label: 'เพศชาย', value: data.male, color: 'bg-blue-400' },
    { label: 'เพศหญิง', value: data.female, color: 'bg-rose-400' },
    { label: 'ไม่ระบุเพศ', value: data.unspecified, color: 'bg-slate-300' },
  ] : []
  return <article className="min-w-0 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
    <span className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-orange-50 text-orange-600"><Users className="h-5 w-5"/></span>
    <h2 className="text-sm font-semibold leading-5 text-slate-600">เพศของลูกค้าที่ทักมา</h2>
    {!data ? <p className="mt-3 text-sm text-slate-500">ยังไม่สามารถโหลดข้อมูลได้</p> : <>
      <dl className="mt-3 space-y-2 text-sm">{groups.map(group => <div key={group.label} className="flex justify-between gap-2">
        <dt className="flex items-center gap-2 text-slate-500"><span aria-hidden className={`h-2 w-2 rounded-full ${group.color}`}/>{group.label}</dt>
        <dd className="font-semibold tabular-nums">{group.value.toLocaleString('th-TH')} คน</dd>
      </div>)}</dl>
      {total > 0 && <div aria-hidden className="mt-3 flex h-2 overflow-hidden rounded-full bg-slate-100">{groups.map(group => <span key={group.label} className={group.color} style={{ width: `${group.value / total * 100}%` }}/>)}</div>}
      <p className="mt-3 text-xs leading-5 text-slate-500">{total === 0 ? 'ยังไม่มีลูกค้าทักมาในช่วงเวลาที่เลือก' : 'นับแต่ละคนครั้งเดียวจากข้อมูลเพศที่บันทึกไว้'}</p>
    </>}
  </article>
}
