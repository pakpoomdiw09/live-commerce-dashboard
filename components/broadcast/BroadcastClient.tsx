'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Clock, Coins, History, Lock, Megaphone, Send, Tag as TagIcon, Trash2, Users, UserCheck, Wallet } from 'lucide-react'
import { supabaseBrowser } from '@/lib/supabase/browser'
import {
  BROADCAST_SEGMENTS,
  BROADCAST_WINDOWS,
  MESSAGE_TAGS,
  MESSAGE_TAG_VALUES,
  type BroadcastRow,
  type BroadcastSegment,
  type BroadcastWindow,
  type MessageTag,
} from '@/lib/chatbot'
import { creditsLeft, OUT_OF_CREDITS, PLANS, UPGRADE_FOR_TAGS, type Billing } from '@/lib/plans'
import type { Tone } from '@/lib/status'
import { apiError, cn, when } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, PageHeader } from '@/components/ui/card'
import { Field, IconTile, Notice, inputClass } from '@/components/ui/field'
import { BroadcastPreview } from './BroadcastPreview'

type Props = {
  tenantId: string
  pageName?: string
  canSend: boolean
  pageLinked: boolean
  tags: { name: string; count: number }[]
  customerCount: number
  reachableCount: number
  billing: Billing
  broadcasts: BroadcastRow[]
}

const STATUS: Record<BroadcastRow['status'], { label: string; tone: Tone }> = {
  draft: { label: 'ฉบับร่าง', tone: 'neutral' },
  sending: { label: 'กำลังส่ง', tone: 'info' },
  sent: { label: 'ส่งแล้ว', tone: 'success' },
  failed: { label: 'ส่งไม่สำเร็จ', tone: 'danger' },
}

const SEGMENT_ICON = { all: Users, pending_payment: Wallet, paid_before: UserCheck } as const
const WINDOW_ICON = { within_24h: Clock, outside_24h: History } as const

type Audience = { total: number; reachable: number } | null

export function BroadcastClient({ tenantId, pageName, canSend, pageLinked, tags, customerCount, reachableCount, billing, broadcasts }: Props) {
  const router = useRouter()
  const db = useMemo(() => supabaseBrowser(), [])
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [segment, setSegment] = useState<BroadcastSegment>('all')
  const [picked, setPicked] = useState<string[]>([])
  const [sendWindow, setSendWindow] = useState<BroadcastWindow>('within_24h')
  const [messageTag, setMessageTag] = useState<MessageTag | ''>('')
  const needsTag = sendWindow === 'outside_24h' && !messageTag
  const tagsAllowed = billing.featureBypass || PLANS[billing.plan].messageTags
  const credits = billing.featureBypass ? Infinity : creditsLeft(billing)
  // Free plan: the outside-24h option is locked (and a saved outside-24h draft can't be sent)
  const locked = sendWindow === 'outside_24h' && !tagsAllowed
  const [audience, setAudience] = useState<Audience>(null)
  const [busy, setBusy] = useState<string | null>(null) // broadcast id being sent, or 'new'
  const [progress, setProgress] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)

  // audience size for the current filters (debounced)
  useEffect(() => {
    setAudience(null)
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      const q = new URLSearchParams({ tenantId, segment, tags: picked.join(','), window: sendWindow, tag: sendWindow === 'outside_24h' ? messageTag : '' })
      const res = await fetch(`/api/broadcasts/audience?${q}`, { signal: ctrl.signal }).catch(() => null)
      if (res?.ok) setAudience(await res.json())
    }, 300)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [tenantId, segment, picked, sendWindow, messageTag])

  /** Call the send route until it reports done (each call sends what fits in its time budget). */
  async function sendLoop(id: string) {
    setBusy(id)
    setNotice(null)
    try {
      for (let round = 0; round < 200; round++) {
        const res = await fetch(`/api/broadcasts/${id}/send`, { method: 'POST' })
        if (!res.ok) throw new Error(await apiError(res))
        const r = (await res.json()) as { done: boolean; sent: number; failed: number; skipped: number; remaining: number; lastError: string | null }
        setProgress(`ส่งแล้ว ${r.sent.toLocaleString('th-TH')} · เหลือ ${r.remaining.toLocaleString('th-TH')}`)
        if (r.done) {
          setNotice({
            tone: r.lastError ? 'error' : 'success',
            text: `ส่งสำเร็จ ${r.sent.toLocaleString('th-TH')} คน${r.failed ? ` · ไม่สำเร็จ ${r.failed}` : ''}${r.skipped ? ` · ข้าม ${r.skipped} คน (อยู่นอกกลุ่มที่ส่งได้)` : ''}${r.lastError ? ` · ${r.lastError}` : ''}`,
          })
          return true
        }
      }
      return false
    } catch (e) {
      setNotice({ tone: 'error', text: `ส่งไม่สำเร็จ: ${e instanceof Error ? e.message : e}` })
      return false
    } finally {
      setBusy(null)
      setProgress(null)
      router.refresh()
    }
  }

  async function create(sendNow: boolean) {
    if (!name.trim() || !message.trim()) return setNotice({ tone: 'error', text: 'ใส่ชื่อรายการส่งและข้อความ' })
    if (locked) return setNotice({ tone: 'error', text: UPGRADE_FOR_TAGS })
    if (needsTag) return setNotice({ tone: 'error', text: 'ส่งหาลูกค้าที่ไม่ได้ทักเกิน 24 ชม. ต้องเลือกหมวดหมู่ข้อความก่อน' })
    const via = sendWindow === 'outside_24h' && messageTag ? ` หมวดหมู่ “${MESSAGE_TAGS[messageTag].label}”` : ''
    if (sendNow && !confirm(`ส่งข้อความถึงลูกค้า ${audience?.reachable ?? 0} คน${via} ตอนนี้? ส่งแล้วยกเลิกไม่ได้`)) return
    setBusy('new')
    setNotice(null)
    const { data, error } = await db
      .from('broadcasts')
      .insert({
        tenant_id: tenantId,
        name: name.trim(),
        message: message.trim(),
        audience_segment: segment,
        audience_tags: picked,
        audience_window: sendWindow,
        message_tag: sendWindow === 'outside_24h' ? messageTag : null,
      })
      .select('id')
      .single()
    if (error || !data) {
      setBusy(null)
      return setNotice({ tone: 'error', text: `บันทึกไม่สำเร็จ: ${error?.message ?? 'ไม่มีข้อมูลตอบกลับ'}` })
    }
    setName('')
    setMessage('')
    if (sendNow) await sendLoop(data.id)
    else {
      setBusy(null)
      setNotice({ tone: 'success', text: 'บันทึกฉบับร่างแล้ว' })
      router.refresh()
    }
  }

  async function remove(b: BroadcastRow) {
    if (!confirm(`ลบฉบับร่าง "${b.name}"?`)) return
    const { error } = await db.from('broadcasts').delete().eq('id', b.id)
    if (error) return setNotice({ tone: 'error', text: `ลบไม่สำเร็จ: ${error.message}` })
    router.refresh()
  }

  const outside = customerCount - reachableCount

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-8">
      <PageHeader title="ส่งข้อความหาลูกค้าทั้งหมด" description="ส่งข้อความถึงลูกค้าหลายคนพร้อมกัน เลือกกลุ่มลูกค้าและป้ายกำกับได้" />

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {!pageLinked && <Notice tone="error">ร้านนี้ยังไม่ได้เชื่อมเพจ จึงยังส่งข้อความไม่ได้ (ตั้งค่า &gt; ตั้งค่าเพจ)</Notice>}

      <div className="flex gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
        <Clock className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" aria-hidden />
        <div>
          <p className="font-semibold">กฎ 24 ชั่วโมงของระบบ Facebook</p>
          <p className="mt-0.5 text-sky-800">
            เพจส่งข้อความหาลูกค้าได้เฉพาะภายใน 24 ชม. หลังข้อความล่าสุดของลูกค้า ตอนนี้ส่งถึงได้{' '}
            <b>{reachableCount.toLocaleString('th-TH')}</b> จาก {customerCount.toLocaleString('th-TH')} คน
            {outside > 0 && <> · อีก {outside.toLocaleString('th-TH')} คนไม่ได้ทักเกิน 24 ชม. ต้องเลือกหมวดหมู่ข้อความให้ตรงกับเนื้อหา</>} (ห้ามใช้หมวดหมู่เหล่านี้ส่งโปรโมชันหรือโฆษณา)
          </p>
        </div>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="เขียนข้อความถึงลูกค้า" description="เลือกกลุ่มลูกค้า เขียนข้อความ แล้วส่งทันทีหรือบันทึกเป็นฉบับร่าง" />
          <div className="space-y-5 p-5">
            <div>
              <span className="mb-1.5 block text-sm font-medium text-slate-700">ช่วงเวลาที่ลูกค้าทักล่าสุด</span>
              <div role="radiogroup" aria-label="ช่วงเวลาที่ลูกค้าทักล่าสุด" className="grid gap-1 rounded-2xl bg-slate-100 p-1 sm:grid-cols-2">
                {(Object.keys(BROADCAST_WINDOWS) as BroadcastWindow[]).map((w) => {
                  const Icon = WINDOW_ICON[w]
                  const off = w === 'outside_24h' && !tagsAllowed
                  return (
                    <label
                      key={w}
                      className={cn(
                        'flex items-start gap-2.5 rounded-xl p-3 transition has-checked:bg-white has-checked:shadow-sm has-checked:ring-1 has-checked:ring-orange-300',
                        off ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-white/60',
                      )}
                    >
                      <input type="radio" name="window" checked={sendWindow === w} disabled={off} onChange={() => setSendWindow(w)} className="sr-only" />
                      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', sendWindow === w ? 'text-orange-600' : 'text-slate-400')} aria-hidden />
                      <span>
                        <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                          {BROADCAST_WINDOWS[w].label}
                          {off && (
                            <span className="inline-flex items-center gap-1 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                              <Lock className="h-3 w-3" aria-hidden />
                              แพ็กเกจเริ่มต้นขึ้นไป
                            </span>
                          )}
                        </span>
                        <span className="block text-xs text-slate-500">{BROADCAST_WINDOWS[w].hint}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
              {!tagsAllowed && (
                <p className="mt-1.5 text-xs text-slate-500">
                  แพ็กเกจฟรีส่งได้เฉพาะลูกค้าภายใน 24 ชม.{' '}
                  <Link href="/billing" className="font-medium text-orange-600 hover:underline">
                    อัปเกรดเพื่อเลือกหมวดหมู่ข้อความ
                  </Link>
                </p>
              )}
            </div>

            {sendWindow === 'outside_24h' && tagsAllowed && (
              <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                <Field label="หมวดหมู่ข้อความ (จำเป็นต้องเลือก)" hint="Meta กำหนดให้การส่งหาลูกค้าที่ไม่ได้ทักเกิน 24 ชม. ต้องเลือกหมวดหมู่ให้ตรงกับเนื้อหาเท่านั้น">
                  <select required value={messageTag} onChange={(e) => setMessageTag(e.target.value as MessageTag | '')} className={inputClass}>
                    <option value="">เลือกหมวดหมู่ข้อความ...</option>
                    {MESSAGE_TAG_VALUES.map((t) => (
                      <option key={t} value={t}>
                        {MESSAGE_TAGS[t].label}
                      </option>
                    ))}
                  </select>
                </Field>
                <ul className="space-y-1 text-xs text-amber-900">
                  {MESSAGE_TAG_VALUES.map((t) => (
                    <li key={t} className={cn(messageTag === t && 'font-semibold')}>
                      <span>{MESSAGE_TAGS[t].label}</span> · {MESSAGE_TAGS[t].hint}
                    </li>
                  ))}
                </ul>
                <p className="flex items-start gap-1.5 text-xs text-amber-800">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  ห้ามใช้หมวดหมู่เหล่านี้ส่งข้อความโปรโมชันหรือโฆษณา หากเนื้อหาไม่ตรง เพจอาจถูก Facebook จำกัดการส่งข้อความได้
                </p>
              </div>
            )}

            <div>
              <span className="mb-1.5 block text-sm font-medium text-slate-700">กลุ่มลูกค้า</span>
              <div role="radiogroup" aria-label="กลุ่มลูกค้า" className="grid gap-2 sm:grid-cols-3">
                {(Object.keys(BROADCAST_SEGMENTS) as BroadcastSegment[]).map((s) => {
                  const Icon = SEGMENT_ICON[s]
                  return (
                    <label
                      key={s}
                      className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 p-3 transition hover:bg-slate-50 has-checked:border-orange-300 has-checked:bg-orange-50/60"
                    >
                      <input type="radio" name="segment" checked={segment === s} onChange={() => setSegment(s)} className="sr-only" />
                      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', segment === s ? 'text-orange-600' : 'text-slate-400')} aria-hidden />
                      <span>
                        <span className="block text-sm font-medium text-slate-900">{BROADCAST_SEGMENTS[s].label}</span>
                        <span className="block text-xs text-slate-500">{BROADCAST_SEGMENTS[s].hint}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>

            <div>
              <span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700">
                <TagIcon className="h-4 w-4 text-slate-400" aria-hidden />
                แท็กลูกค้า <span className="font-normal text-slate-400">(ไม่เลือก = ทุกแท็ก, เลือกหลายแท็ก = มีแท็กใดแท็กหนึ่ง)</span>
              </span>
              {tags.length === 0 ? (
                <p className="text-xs text-slate-500">ยังไม่มีแท็ก: เพิ่มแท็กให้ลูกค้าได้ที่หน้ารวมแชทหรือรายชื่อลูกค้า</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((t) => {
                    const on = picked.includes(t.name)
                    return (
                      <button
                        key={t.name}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setPicked((p) => (on ? p.filter((x) => x !== t.name) : [...p, t.name]))}
                        className={cn(
                          'rounded-full px-3 py-1 text-xs font-medium ring-1 transition',
                          on ? 'bg-orange-500 text-white ring-orange-500' : 'bg-white text-slate-600 ring-slate-200 hover:ring-orange-300',
                        )}
                      >
                        {t.name} <span className={on ? 'text-white/80' : 'text-slate-400'}>{t.count}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 text-sm">
              <Users className="h-4 w-4 text-slate-400" aria-hidden />
              {audience ? (
                <>
                  <span>
                    ตรงเงื่อนไข <b className="tabular-nums">{audience.total.toLocaleString('th-TH')}</b> คน
                  </span>
                  <span className="text-emerald-700">
                    ส่งได้ <b className="tabular-nums">{audience.reachable.toLocaleString('th-TH')}</b>
                  </span>
                  {audience.total > audience.reachable && (
                    <span className="flex items-center gap-1 text-amber-700">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                      ข้าม {(audience.total - audience.reachable).toLocaleString('th-TH')} (
                      {sendWindow === 'within_24h' ? 'เกิน 24 ชม.' : messageTag === 'HUMAN_AGENT' ? 'ไม่อยู่ในช่วง 1-7 วัน' : 'ยังอยู่ใน 24 ชม. หรือไม่เคยทัก'})
                    </span>
                  )}
                </>
              ) : null}
              <span className={cn('ml-auto flex items-center gap-1', audience && audience.reachable > credits ? 'text-amber-700' : 'text-slate-500')}>
                <Coins className="h-3.5 w-3.5" aria-hidden />
                เครดิตคงเหลือ <b className="tabular-nums">{billing.featureBypass ? 'ไม่จำกัด (ผู้ดูแล)' : credits.toLocaleString('th-TH')}</b>
                {audience && audience.reachable > credits && <> · ส่งได้แค่ {credits.toLocaleString('th-TH')} คนแรก</>}
                <Link href="/billing" className="ml-1 font-medium text-orange-600 hover:underline">
                  {credits ? 'เติมเครดิต' : 'อัปเกรด / เติมเครดิต'}
                </Link>
              </span>
              {audience ? null : needsTag ? (
                <span className="text-amber-700">เลือกหมวดหมู่ข้อความเพื่อดูจำนวนผู้รับ</span>
              ) : (
                <span className="text-slate-400">กำลังนับผู้รับ...</span>
              )}
            </div>

            <Field label="ชื่อรายการส่งข้อความ" hint="แสดงเฉพาะในระบบหลังบ้าน">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="เช่น แจ้งของเข้าใหม่ ต.ค." className={inputClass} />
            </Field>
            <Field label="ข้อความ" hint={`${message.length}/2000`}>
              <textarea
                rows={5}
                maxLength={2000}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="เช่น สวัสดีค่ะ ของรอบใหม่เข้าแล้ว พิมพ์รหัสสินค้าเพื่อสั่งซื้อได้เลยนะคะ"
                className={cn(inputClass, 'resize-none')}
              />
            </Field>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {credits === 0 && <span className="mr-auto text-xs text-rose-600">{OUT_OF_CREDITS}</span>}
              {!canSend && <span className="mr-auto text-xs text-slate-500">เฉพาะเจ้าของร้านเท่านั้นที่กดส่งได้ ทีมงานบันทึกฉบับร่างได้</span>}
              <Button variant="secondary" onClick={() => create(false)} disabled={!!busy || needsTag}>
                บันทึกร่าง
              </Button>
              <Button onClick={() => create(true)} loading={busy === 'new'} disabled={!!busy || !canSend || !pageLinked || needsTag || locked || !credits || !audience?.reachable}>
                <Send className="h-4 w-4" aria-hidden />
                ส่งเลย
              </Button>
            </div>
            {progress && <p className="text-right text-xs text-slate-500 tabular-nums">{progress}</p>}
          </div>
        </Card>

        <Card>
          <CardHeader title="ตัวอย่างข้อความในแชท" />
          <div className="p-5">
            <BroadcastPreview message={message} pageName={pageName} />
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="ประวัติการส่งข้อความถึงลูกค้า" description="50 รายการล่าสุด" />
        {broadcasts.length === 0 ? (
          <div className="grid place-items-center px-6 py-12 text-center">
            <IconTile className="h-12 w-12">
              <Megaphone className="h-6 w-6" aria-hidden />
            </IconTile>
            <p className="mt-3 text-sm text-slate-500">ยังไม่มีประวัติการส่งข้อความถึงลูกค้า</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {broadcasts.map((b) => {
              const done = b.sent + b.failed
              const pct = b.total - b.skipped > 0 ? Math.round((done / (b.total - b.skipped)) * 100) : 0
              return (
                <li key={b.id} className="flex flex-wrap items-center gap-4 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
                      <span className="truncate">{b.name}</span>
                      <Badge tone={STATUS[b.status].tone}>{STATUS[b.status].label}</Badge>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {BROADCAST_SEGMENTS[b.audience_segment].label}
                      {b.audience_tags.length > 0 && ` · แท็ก ${b.audience_tags.join(', ')}`}
                      {` · ${BROADCAST_WINDOWS[b.audience_window].label}`}
                      {b.message_tag && ` · ${MESSAGE_TAGS[b.message_tag]?.label ?? 'หมวดหมู่ข้อความ'}`} · {b.message}
                    </p>
                    {b.last_error && <p className="mt-0.5 truncate text-xs text-rose-600">{b.last_error}</p>}
                  </div>
                  {b.status !== 'draft' && (
                    <div className="w-48 text-xs text-slate-500">
                      <div className="flex justify-between tabular-nums">
                        <span>
                          ส่ง {b.sent.toLocaleString('th-TH')}
                          {b.failed > 0 && <span className="text-rose-600"> · พลาด {b.failed}</span>}
                        </span>
                        <span>ข้าม {b.skipped.toLocaleString('th-TH')}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )}
                  <time className="w-28 text-right text-xs text-slate-400" suppressHydrationWarning>
                    {when(b.finished_at ?? b.started_at ?? b.created_at)}
                  </time>
                  <div className="flex gap-1">
                    {b.status !== 'sent' && canSend && (
                      <Button size="sm" variant="secondary" onClick={() => (b.status !== 'draft' || confirm(`ส่ง "${b.name}" ตอนนี้? ส่งแล้วยกเลิกไม่ได้`)) && sendLoop(b.id)} loading={busy === b.id} disabled={!!busy || !pageLinked}>
                        <Send className="h-3.5 w-3.5" aria-hidden />
                        {b.status === 'draft' ? 'ส่ง' : 'ส่งต่อ'}
                      </Button>
                    )}
                    {b.status === 'draft' && (
                      <Button size="icon" variant="ghost" onClick={() => remove(b)} aria-label={`ลบ ${b.name}`} className="hover:text-rose-600">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
