'use client'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { AgentUpgradeDialog } from '@/components/chatbot/AgentUpgradeDialog'
import { Activity, ArrowRight, CheckCircle2, Clock3, CreditCard, Info, MessageCircle, RefreshCw, ShieldCheck, Users } from 'lucide-react'
import type { AgentOverviewData, AgentOverviewRange, AgentCapability } from '@/lib/features/agents/agent-overview-core'

const panel = 'min-w-0 rounded-3xl border border-orange-100 bg-white p-5 shadow-sm md:p-6'
const n = (value: number) => value.toLocaleString('th-TH', { maximumFractionDigits: 1 })
const capabilities: { key: AgentCapability; label: string; description: string; href: string }[] = [
  { key: 'answers', label: 'ตอบคำถามอัตโนมัติ', description: 'ตอบตามคำที่ร้านตั้งไว้ก่อน หากไม่พบคำตอบจึงให้ผู้ช่วย AI ดูแล โดยใช้ข้อมูลร้านและโควตาที่เหลือ ระบบอัตโนมัติจะหยุดเมื่อแอดมินรับช่วงดูแลแชท', href: '/chatbot/conversations' },
  { key: 'followup', label: 'ติดตามลูกค้า', description: 'ติดตามออเดอร์ค้างชำระตามเวลาที่ตั้งไว้ ตรวจออเดอร์และสลิปล่าสุดก่อนส่ง หากมีสลิปเข้าหรือชำระแล้วจะระงับข้อความติดตาม การส่งจริงยังขึ้นกับการเปิดใช้งานฝั่งเซิร์ฟเวอร์ เครดิต และเวลาที่อนุญาตให้ติดต่อ', href: '/chatbot/follow-ups' },
  { key: 'handoff', label: 'ส่งต่อแอดมิน', description: 'ส่งต่อให้แอดมินเมื่อพบคำหรือกรณีที่ร้านตั้งไว้ และพักการตอบอัตโนมัติในแชทนั้น แม้ปิดสวิตช์นี้ ระบบยังส่งต่อกรณีที่จำเป็นเพื่อความปลอดภัย', href: '/inbox' },
]

function CapabilityHelp({ label, description, status }: { label: string; description: string; status: string }) {
  const id = useId(), [open, setOpen] = useState(false)
  return <span className="inline-flex shrink-0 items-center" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
    <button type="button" aria-label={`คำอธิบาย${label}`} aria-describedby={open ? id : undefined} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={() => setOpen(true)} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) } }} className="rounded-full p-1.5 text-slate-400 transition hover:bg-orange-50 hover:text-orange-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"><Info aria-hidden="true" className="h-4 w-4"/></button>
    {open && <span id={id} role="tooltip" className="absolute inset-x-3 top-full z-30 mt-1 rounded-2xl border border-orange-100 bg-white p-4 text-left text-xs font-normal leading-6 text-slate-600 shadow-lg"><span className="block font-semibold text-slate-900">{label}</span><span className="mt-1 block">{description}</span><span className="mt-2 block border-t border-slate-100 pt-2 text-orange-800">{status}</span></span>}
  </span>
}

function Switch({ checked, disabled, label, onClick }: { checked: boolean; disabled: boolean; label: string; onClick: () => void }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onClick} className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-500 disabled:cursor-not-allowed disabled:opacity-40 ${checked ? 'bg-orange-500' : 'bg-slate-300'}`}><span className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : ''}`}/></button>
}

export function AgentOverview({ tenantId, onSaved }: { tenantId: string; onSaved: () => Promise<void> }) {
  const [days, setDays] = useState<AgentOverviewRange>(7), [data, setData] = useState<AgentOverviewData | null>(null)
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [upgrade, setUpgrade] = useState('')
  const lock = useRef(false), generation = useRef(0)
  const endpoint = `/api/agent-control/overview?tenantId=${encodeURIComponent(tenantId)}&days=${days}`
  const load = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++generation.current
    const response = await fetch(endpoint, { cache: 'no-store', signal }), value = await response.json()
    if (!response.ok) throw new Error(value.error ?? 'โหลดข้อมูลไม่สำเร็จ')
    if (sequence === generation.current && !signal?.aborted) setData(value)
  }, [endpoint])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError('')
    void load(controller.signal).catch(e => { if (!controller.signal.aborted) setError(e.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort() }
  }, [load])
  async function change(capability: AgentCapability, enabled: boolean) {
    if (!data?.canManage || lock.current) return
    const entitlement = data.entitlements[capability]
    if (enabled && !entitlement.allowed) { setError(''); setNotice(''); setUpgrade(entitlement.message); return }
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch(endpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ capability, enabled }) })
      const value = await response.json()
      if (!response.ok && ['FEATURE_LOCKED', 'AI_QUOTA_EXHAUSTED', 'SLIP_QUOTA_EXHAUSTED'].includes(value.code)) {
        setUpgrade(value.error); await load(); return
      }
      if (!response.ok) throw new Error(value.error ?? 'บันทึกการตั้งค่าไม่สำเร็จ')
      await load(); await onSaved(); setNotice('บันทึกการตั้งค่าเรียบร้อยแล้ว')
    } catch (e) { setError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ') }
    finally { lock.current = false; setBusy(false) }
  }
  const refresh = () => { setLoading(true); setError(''); void load().catch(e => setError(e.message)).finally(() => setLoading(false)) }
  if (!data) return <section className={panel} aria-busy={loading}>{error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : <p role="status" className="animate-pulse text-sm text-slate-500">กำลังโหลดสถานะและสถิติผู้ช่วย AI…</p>}<button onClick={refresh} disabled={loading} className="mt-4 text-sm text-orange-700 disabled:opacity-50">โหลดข้อมูลอีกครั้ง</button></section>
  const maximum = Math.max(1, ...data.points.flatMap(point => [point.messages, point.customers]))
  const metrics = [
    { label: 'ข้อความที่ AI ตอบวันนี้', value: n(data.repliesToday), unit: 'ข้อความ', detail: 'ส่งสำเร็จแล้ว · ตามเวลาไทย', icon: MessageCircle },
    { label: 'ลูกค้าที่ AI ดูแลทั้งหมด', value: n(data.customersTotal), unit: 'คน', detail: 'ลูกค้าที่เคยได้รับคำตอบจาก AI ไม่ซ้ำคน', icon: Users },
    { label: 'ส่งต่อให้แอดมิน', value: n(data.handoffs), unit: 'ครั้ง', detail: `งานส่งต่อในช่วง ${days} วัน`, icon: ShieldCheck },
    { label: 'เวลาตอบกลับเฉลี่ย', value: data.averageSeconds === null ? '—' : n(data.averageSeconds), unit: 'วินาที', detail: 'ตั้งแต่เริ่มงานจนบันทึกว่าส่งสำเร็จ', icon: Clock3 },
    { label: 'อัตราความสำเร็จ', value: data.successRate === null ? '—' : n(data.successRate), unit: '%', detail: 'งาน AI ที่จบแล้ว ไม่รวมฉบับร่างหรืองานข้าม', icon: CheckCircle2 },
  ]
  return <div className="space-y-5" aria-busy={loading || busy}>
    {upgrade && <AgentUpgradeDialog message={upgrade} onClose={() => setUpgrade('')}/>}
    <div aria-label="สถิติภาพรวมผู้ช่วย AI" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{metrics.map(({ label, value, unit, detail, icon: Icon }) => <article key={label} className={panel}><Icon className="mb-4 h-5 w-5 text-orange-500"/><h3 className="text-sm font-medium text-slate-500">{label}</h3><p className="mt-2 text-3xl font-bold tabular-nums text-slate-900">{value}<span className="ml-2 text-xs font-normal text-slate-500">{unit}</span></p><p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p></article>)}</div>
    {!data.entitlements.answers.allowed && <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-orange-100 bg-orange-50/70 p-4"><p className="text-sm leading-6 text-orange-900">{data.entitlements.answers.message}</p><Link href="/billing" className="shrink-0 rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600">ชำระเงิน / เพิ่มโควตา</Link></div>}
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{error}</p>}{notice && <p role="status" className="rounded-xl bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
    {data.notices.map(message => <p key={message} className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{message}</p>)}
    <section className={panel} aria-label="ความสามารถหลักของผู้ช่วย"><h2 className="text-lg font-bold">ความสามารถของผู้ช่วย</h2><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{capabilities.map(item => {
      const entitlement = data.entitlements[item.key]
      const status = !entitlement.allowed ? entitlement.message : !data.available[item.key] ? 'กรุณาตั้งค่าระบบก่อนเปิดใช้งาน' : 'สวิตช์แสดงค่าที่บันทึกไว้ การทำงานจริงยังขึ้นกับสถานะระบบหลัก สิทธิ์แพ็กเกจ โควตา และโหมดความปลอดภัยของร้าน'
      return <article key={item.key} className="relative min-w-0 rounded-2xl border border-orange-100 bg-gradient-to-br from-white to-orange-50/40 p-4 hover:z-20 focus-within:z-20">
        <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-1"><h3 className="text-sm font-semibold leading-6">{item.label}</h3><CapabilityHelp label={item.label} description={item.description} status={status}/></div><Switch checked={data.capabilities[item.key]} disabled={!data.canManage || busy || loading} label={item.label} onClick={() => void change(item.key, !data.capabilities[item.key])}/></div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2"><span className={`text-xs font-medium ${!entitlement.allowed || !data.available[item.key] ? 'text-amber-700' : data.capabilities[item.key] ? 'text-emerald-700' : 'text-slate-500'}`}>{!entitlement.allowed ? 'ตรวจสอบแพ็กเกจและโควตา' : !data.available[item.key] ? 'รอตั้งค่า' : data.capabilities[item.key] ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</span><Link aria-label={`ตั้งค่า${item.label}`} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-orange-700" href={item.href}>ตั้งค่า<ArrowRight aria-hidden="true" className="h-3 w-3"/></Link></div>
      </article>
    })}</div></section>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <section className={panel}><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">ประสิทธิภาพการตอบแชท</h2><p className="mt-1 text-xs text-slate-500">จำนวนข้อความที่ส่งสำเร็จ และลูกค้าที่ได้รับคำตอบในแต่ละวัน</p></div><select aria-label="ช่วงเวลาสถิติ AI" value={days} disabled={busy} onChange={e => setDays(Number(e.target.value) as AgentOverviewRange)} className="rounded-xl border border-orange-100 bg-white px-3 py-2 text-sm">{[7, 30, 90].map(day => <option key={day} value={day}>{day} วันล่าสุด</option>)}</select></div>
        {data.points.some(point => point.messages) ? <><div role="img" aria-label={`สถิติการตอบแชทย้อนหลัง ${days} วัน`} className="mt-6 h-56 overflow-x-auto rounded-2xl bg-orange-50/40 p-4"><div className="flex h-full min-w-full items-end gap-2" style={{ minWidth: data.points.length * 22 }}>{data.points.map((point, index) => <div key={point.day} title={`${point.day} · ${point.messages} ข้อความ · ${point.customers} คน`} className="flex h-full min-w-3 flex-1 flex-col justify-end"><div className="flex h-[85%] items-end justify-center gap-0.5"><span className="w-2/5 rounded-t bg-orange-400" style={{ height: `${point.messages / maximum * 100}%` }}/><span className="w-2/5 rounded-t bg-pink-300" style={{ height: `${point.customers / maximum * 100}%` }}/></div><span className="mt-2 h-4 text-center text-[9px] text-slate-500">{index % Math.ceil(days / 7) === 0 ? point.day.slice(5).split('-').reverse().join('/') : ''}</span></div>)}</div></div><div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500"><span>🟠 ข้อความที่ AI ส่งสำเร็จ</span><span>🩷 ลูกค้าที่ได้รับคำตอบ</span></div><details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">ดูข้อมูลรายวัน</summary><div className="mt-2 max-h-48 overflow-auto"><table className="w-full text-left"><thead><tr><th>วันที่</th><th>ข้อความ</th><th>ลูกค้า</th></tr></thead><tbody>{data.points.map(point => <tr key={point.day}><td className="py-1">{point.day}</td><td>{n(point.messages)}</td><td>{n(point.customers)}</td></tr>)}</tbody></table></div></details></> : <div className="mt-5 grid min-h-56 place-items-center rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-500">ยังไม่มีข้อความที่ AI ส่งสำเร็จในช่วงเวลานี้</div>}
      </section>
      <section className={panel}><CreditCard className="mb-3 h-6 w-6 text-orange-500"/><h2 className="text-lg font-bold">โควตาผู้ช่วย AI</h2><p className="mt-1 text-sm text-slate-500">{data.quota.plan}</p><p className="mt-5 text-3xl font-bold tabular-nums">{n(data.quota.remaining)} <span className="text-sm font-normal text-slate-500">ครั้งคงเหลือ</span></p><div role="progressbar" aria-label="การใช้โควตา AI" aria-valuemin={0} aria-valuemax={Math.max(1, data.quota.limit)} aria-valuenow={Math.min(data.quota.used, Math.max(1, data.quota.limit))} className="mt-4 h-2 overflow-hidden rounded-full bg-orange-50"><div className="h-full rounded-full bg-gradient-to-r from-orange-400 to-pink-400" style={{ width: `${data.quota.limit ? Math.min(100, data.quota.used / data.quota.limit * 100) : 0}%` }}/></div><p className="mt-3 text-sm text-slate-600">ใช้แล้ว {n(data.quota.used)} / {n(data.quota.limit)} ครั้ง</p><p className="mt-3 text-xs leading-5 text-slate-500">รอบเดือน {new Date(data.quota.month).toLocaleDateString('th-TH', { month: 'long', year: 'numeric', timeZone: 'UTC' })} ตามเวลาสากล · แยกจากเครดิตส่งข้อความ</p>{!data.quota.limit && <p className="mt-3 text-xs text-amber-800">ยังไม่ได้กำหนดโควตา AI ให้ร้านนี้</p>}<Link href="/billing" className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-orange-700">ดูแพ็กเกจและเครดิต <ArrowRight className="h-4 w-4"/></Link></section>
    </div>
    <section className={panel}><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-lg font-bold"><Activity className="h-5 w-5 text-orange-500"/>กิจกรรมล่าสุดของผู้ช่วย</h2><button disabled={loading || busy} onClick={refresh} className="inline-flex items-center gap-2 text-sm text-orange-700 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}/>อัปเดตข้อมูล</button></div>{!data.recent.length ? <p className="mt-5 rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">ยังไม่มีกิจกรรมของผู้ช่วย AI</p> : <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[580px] text-left text-sm"><thead className="bg-orange-50/60 text-xs text-slate-500"><tr>{['เวลา', 'ลูกค้า', 'ช่องทาง', 'กิจกรรม', 'สถานะ'].map(label => <th key={label} scope="col" className="px-3 py-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{data.recent.map(job => <tr key={job.id}><td className="whitespace-nowrap px-3 py-4 text-xs text-slate-500">{new Date(job.created_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' })}</td><td className="max-w-44 truncate px-3">{job.customer ?? 'ลูกค้า'}</td><td className="px-3 text-xs text-slate-500">Facebook</td><td className="px-3 text-xs">{({ AI: 'ผู้ช่วย AI', KEYWORD: 'ตอบตามคำที่ตั้งไว้', ADMIN: 'ส่งต่อแอดมิน', FALLBACK: 'ข้อความสำรอง', SKIP: 'ข้ามการตอบ' } as Record<string, string>)[job.route ?? ''] ?? 'กำลังประเมินข้อความ'}</td><td className="px-3"><span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs ${job.status === 'sent' ? 'bg-emerald-50 text-emerald-700' : job.status === 'failed' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>{({ processing: 'กำลังดำเนินการ', sent: 'ส่งสำเร็จ', review: 'รอแอดมินตรวจสอบ', draft: 'ฉบับร่าง', skipped: 'ข้ามรายการ', failed: 'ไม่สำเร็จ' } as Record<string, string>)[job.status] ?? 'รอตรวจสอบ'}</span></td></tr>)}</tbody></table></div>}<p className="mt-4 text-xs text-slate-400">10 งานล่าสุด · อัปเดต {new Date(data.updatedAt).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' })} น.</p></section>
  </div>
}
