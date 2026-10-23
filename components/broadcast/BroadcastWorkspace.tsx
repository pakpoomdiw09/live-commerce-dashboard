'use client'

import { PageBanner } from '@/components/ui/page-banner'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import {
  CheckCircle2,
  Clock3,
  FileText,
  HelpCircle,
  History,
  LoaderCircle,
  Megaphone,
  Save,
  Send,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react'
import { type BroadcastRow, type BroadcastSegment } from '@/lib/features/agents/chatbot'
import type { Billing } from '@/lib/features/billing/plans'
import type { BroadcastPreviewResult } from '@/lib/features/broadcast/broadcast-service'
import { broadcastReasonLabels } from '@/lib/features/broadcast/broadcast-policy'

type Props = {
  tenantId: string
  pageName: string
  pageStatus: string
  canSend: boolean
  tags: string[]
  billing: Billing | null
  broadcasts: BroadcastRow[]
  historyUnavailable?: boolean
}
const recipientSelectionTitle = 'เลือกลูกค้าที่ต้องการส่ง'
const recipientSelectionHint =
  'เลือกเฉพาะลูกค้าที่ผ่านเงื่อนไขและทักมาภายใน 24 ชั่วโมง ระบบจะตรวจเวลาอีกครั้งและข้ามคนที่หมดเวลาก่อนส่ง'
const selectAllLabel = 'เลือกทั้งหมด / ยกเลิกทั้งหมด'
const inputClass =
  'mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-50'
const buttonClass =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium transition hover:border-orange-300 hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-50'
const primaryClass = `${buttonClass.replace('bg-white', 'bg-orange-500').replace('hover:bg-orange-50', 'hover:bg-orange-600')} border-orange-500 text-white hover:text-white`
const number = (value: number | undefined | null) =>
  value == null ? '—' : value.toLocaleString('th-TH')
const date = (value: string) =>
  new Date(value).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    dateStyle: 'medium',
    timeStyle: 'short',
  })
const customerGroups: Record<BroadcastSegment, { label: string; hint: string }> = {
  all: { label: 'ลูกค้าทั้งหมด', hint: 'ลูกค้าทั้งหมดของเพจนี้ที่เข้าเงื่อนไขการส่ง' },
  pending_payment: { label: 'ลูกค้าค้างชำระ', hint: 'ลูกค้าที่มีรายการรอชำระเงิน' },
  paid_before: { label: 'ลูกค้าเก่า', hint: 'ลูกค้าที่เคยชำระเงินหรือจัดส่งสินค้าแล้ว' },
}
const pageLabels: Record<string, string> = {
  verified: 'เพจพร้อมใช้งาน',
  missing: 'ยังไม่เชื่อมต่อเพจ',
  invalid: 'กรุณาเชื่อมต่อเพจใหม่',
  limited: 'เพจยังไม่พร้อมส่งข้อความ',
  unverified: 'ยังตรวจสอบเพจไม่ได้',
}
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  )
}
async function api<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่')
  return result
}

export function BroadcastWorkspace({
  tenantId,
  pageName,
  pageStatus,
  canSend,
  tags,
  billing,
  broadcasts,
  historyUnavailable,
}: Props) {
  const router = useRouter()
  const [id, setId] = useState<string | null>(null),
    [name, setName] = useState(''),
    [message, setMessage] = useState('')
  const [segment, setSegment] = useState<BroadcastSegment>('all'),
    [picked, setPicked] = useState<string[]>([])
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([])
  const [preview, setPreview] = useState<BroadcastPreviewResult | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; message?: string }>({}),
    [history, setHistory] = useState(broadcasts),
    [progress, setProgress] = useState('')
  const [deliveryReport, setDeliveryReport] = useState<{
    name: string
    sent: number
    delivered: number
    read: number
    failed: number
    unknown: number
    skipped: number
  } | null>(null)
  const [deleting, setDeleting] = useState<BroadcastRow | null>(null)
  const deleteDialog = useRef<HTMLDialogElement>(null)
  const deliveryDialog = useRef<HTMLDialogElement>(null)
  const review = useRef<HTMLDialogElement>(null),
    help = useRef<HTMLDialogElement>(null),
    historySection = useRef<HTMLElement>(null),
    lock = useRef(false)
  const revision = JSON.stringify([tenantId, name, message, segment, picked]),
    currentRevision = useRef(revision)
  currentRevision.current = revision
  useEffect(() => {
    setPreview(null)
    review.current?.close()
  }, [revision])
  function valid() {
    const errors = {
      name:
        !name.trim() || name.trim().length > 100 ? 'ใส่ชื่อรายการไม่เกิน 100 ตัวอักษร' : undefined,
      message:
        !message.trim() || message.trim().length > 2000
          ? 'ใส่ข้อความไม่เกิน 2,000 ตัวอักษร'
          : undefined,
    }
    setFieldErrors(errors)
    return !errors.name && !errors.message
  }
  async function saveDraft(selected_customer_ids: string[] | null = null) {
    const draftId = id ?? crypto.randomUUID()
    setId(draftId)
    const saved = await api<{ broadcast: BroadcastRow }>('/api/broadcasts', {
      id: draftId,
      tenantId,
      name,
      message,
      audience_segment: segment,
      audience_tags: picked,
      selected_customer_ids,
    })
    setHistory((rows) => [saved.broadcast, ...rows.filter((row) => row.id !== saved.broadcast.id)])
    return saved.broadcast
  }
  async function act(action: () => Promise<void>) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ดำเนินการไม่สำเร็จ')
    } finally {
      lock.current = false
      setBusy(false)
      setProgress('')
    }
  }
  async function checkRecipients() {
    if (!valid()) return
    const checkedRevision = revision
    await act(async () => {
      const draft = await saveDraft()
      const result = await api<BroadcastPreviewResult>('/api/broadcasts/preview', {
        tenantId,
        id: draft.id,
      })
      if (currentRevision.current !== checkedRevision) {
        setNotice('ข้อมูลเปลี่ยนแล้ว กรุณาตรวจผู้รับใหม่')
        return
      }
      assertPreviewContent(result)
      setPreview(result)
      setSelectedRecipients(
        result.members.filter((member) => member.reason === 'eligible').map((member) => member.id),
      )
    })
  }
  async function confirmSend() {
    if (!preview?.reachable || !selectedRecipients.length || !id || lock.current) return
    review.current?.close()
    await act(async () => {
      let confirmedPreview = preview
      if (!immutable) {
        await saveDraft(selectedRecipients)
        confirmedPreview = await api<BroadcastPreviewResult>('/api/broadcasts/preview', {
          tenantId,
          id,
        })
        if (!confirmedPreview.reachable) {
          setPreview(confirmedPreview)
          setSelectedRecipients([])
          setNotice('No eligible selected recipients remain; refresh the recipient list.')
          return
        }
      }
      // Repeated requests only continue unclaimed recipients; errors stop this loop.
      for (let batch = 0; batch < 200; batch++) {
        const result = await api<{
          done: boolean
          sent: number
          failed: number
          unknown: number
          skipped: number
          remaining: number
          total: number
          outOfCredits?: boolean
        }>(`/api/broadcasts/${id}/send`, {
          confirmed: true,
          fingerprint: confirmedPreview.fingerprint,
        })
        setProgress(
          `ส่งให้ Facebook แล้ว ${number(result.sent)} คน · เหลือ ${number(result.remaining)} คน`,
        )
        setHistory((rows) =>
          rows.map((row) =>
            row.id === id
              ? {
                  ...row,
                  sent: result.sent,
                  failed: result.failed,
                  skipped: result.skipped,
                  total: result.total,
                  status: result.done ? 'sent' : 'sending',
                }
              : row,
          ),
        )
        if (result.done || result.outOfCredits) {
          setNotice(
            `ส่งให้ Facebook แล้ว ${number(result.sent)} คน · ไม่สำเร็จ ${number(result.failed)} · ข้าม ${number(result.skipped)} · ยังไม่ทราบผล ${number(result.unknown)}${result.outOfCredits ? ' · เครดิตหมด กรุณาเติมก่อนส่งส่วนที่เหลือ' : ''}`,
          )
          setPreview(null)
          setId(null)
          router.refresh()
          return
        }
      }
      setNotice('หยุดพักการส่ง กรุณาเปิดรายการในประวัติเพื่อตรวจสอบและส่งส่วนที่เหลือ')
    })
  }
  async function openDraft(row: BroadcastRow) {
    await act(async () => {
      const response = await fetch(
        `/api/broadcasts/${row.id}?tenantId=${encodeURIComponent(tenantId)}`,
        { cache: 'no-store' },
      )
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'เปิดฉบับร่างไม่ได้')
      const draft = result.broadcast as BroadcastRow | undefined
      if (!draft || draft.status !== 'draft')
        throw new Error('รายการนี้เริ่มส่งแล้ว กรุณาโหลดประวัติใหม่')
      setId(draft.id)
      setName(draft.name)
      setMessage(draft.message)
      setSegment(draft.audience_segment)
      setPicked(draft.audience_tags)
      setHistory((rows) => rows.map((value) => (value.id === draft.id ? draft : value)))
      setPreview(null)
      review.current?.close()
      setFieldErrors({})
      setNotice('เปิดฉบับร่างแล้ว แก้ไขข้อความและตรวจสอบผู้รับใหม่ก่อนส่งได้เลย')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }
  async function deleteDraft() {
    if (!deleting || !canSend) return
    await act(async () => {
      const response = await fetch(
        `/api/broadcasts/${deleting.id}?tenantId=${encodeURIComponent(tenantId)}`,
        { method: 'DELETE', cache: 'no-store' },
      )
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'ลบฉบับร่างไม่ได้')
      setHistory((rows) => rows.filter((row) => row.id !== deleting.id))
      if (id === deleting.id) {
        setId(null)
        setName('')
        setMessage('')
        setSegment('all')
        setPicked([])
        setPreview(null)
        setFieldErrors({})
        review.current?.close()
      }
      deleteDialog.current?.close()
      setDeleting(null)
      setNotice('ลบฉบับร่างแล้ว')
      router.refresh()
    })
  }
  async function resume(row: BroadcastRow) {
    await act(async () => {
      const result = await api<BroadcastPreviewResult>('/api/broadcasts/preview', {
        tenantId,
        id: row.id,
      })
      setId(row.id)
      setName(row.name)
      setMessage(row.message)
      setSegment(row.audience_segment)
      setPicked(row.audience_tags)
      // Form changes invalidate old previews; the next review uses the stored immutable campaign.
      setNotice('เปิดรายการแล้ว กดตรวจสอบรายการเดิมด้านล่างก่อนส่งต่อ')
      setPreview(null)
      if (!result.policyVerified) setNotice(result.readiness.message)
    })
  }
  const existing = history.find((row) => row.id === id),
    immutable = !!existing && existing.status !== 'draft'
  function assertPreviewContent(result: BroadcastPreviewResult) {
    if (
      result.draft.name !== name.trim() ||
      result.draft.message !== message.trim() ||
      result.draft.audience_segment !== segment ||
      JSON.stringify([...result.draft.audience_tags].sort()) !== JSON.stringify([...picked].sort())
    )
      throw new Error('ฉบับร่างถูกแก้ไขจากที่อื่น กรุณาเปิดรายการใหม่และตรวจผู้รับอีกครั้ง')
  }
  async function checkStored() {
    if (!id) return
    const checkedRevision = revision
    await act(async () => {
      const result = await api<BroadcastPreviewResult>('/api/broadcasts/preview', { tenantId, id })
      if (currentRevision.current === checkedRevision) {
        assertPreviewContent(result)
        setPreview(result)
      }
    })
  }
  async function loadDeliveryStatus(row: BroadcastRow) {
    await act(async () => {
      const response = await fetch(`/api/broadcasts/${row.id}`, { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'อ่านผลส่งไม่ได้')
      setDeliveryReport({ ...result, name: row.name })
      deliveryDialog.current?.showModal()
    })
  }

  return (
    <div className="mx-0 w-full min-w-0 max-w-none space-y-6 bg-slate-50 p-4 sm:p-6 lg:p-8">
      <PageBanner className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-orange-100 text-orange-600">
            <Megaphone className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold">บรอดแคสต์</h1>
            <p className="mt-1 text-sm text-white">ส่งข่าวสารถึงลูกค้าได้ง่าย ๆ ใน 3 ขั้นตอน</p>
          </div>
        </div>
        <div className="flex max-w-full flex-wrap gap-2 text-slate-900">
          <button
            type="button"
            className={buttonClass}
            onClick={() => historySection.current?.scrollIntoView({ behavior: 'smooth' })}
          >
            <History className="h-4 w-4" />
            ประวัติการส่ง
          </button>
          <button type="button" className={buttonClass} onClick={() => help.current?.showModal()}>
            <HelpCircle className="h-4 w-4" />
            วิธีใช้งาน
          </button>
        </div>
      </PageBanner>
      <section
        aria-label="เพจที่ใช้งาน"
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5"
      >
        <div className="min-w-0">
          <p className="text-xs text-slate-500">ส่งจากเพจที่คุณกำลังใช้งาน</p>
          <p className="mt-1 break-words font-semibold text-slate-900">{pageName}</p>
          <p className="mt-1 text-xs text-slate-500">
            ใช้เพจนี้ตลอดรายการ เพื่อป้องกันการส่งผิดเพจ
          </p>
        </div>
        <p
          className={
            pageStatus === 'verified' ? 'text-sm text-green-700' : 'text-sm text-amber-700'
          }
        >
          {pageLabels[pageStatus] ?? pageLabels.unverified}
        </p>
      </section>
      <ol aria-label="ขั้นตอนบรอดแคสต์" className="grid gap-2 sm:grid-cols-3">
        {['เลือกกลุ่มลูกค้า', 'เขียนข้อความ', 'ตรวจทานและส่ง'].map((step, index) => (
          <li
            key={step}
            className="flex items-center gap-3 rounded-xl border border-orange-100 bg-orange-50 p-3 text-sm"
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-orange-500 text-white">
              {index + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900"
        >
          {notice}
        </p>
      )}
      {!canSend && (
        <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
          ดูประวัติได้ แต่เฉพาะเจ้าของร้านหรือแอดมินที่มีสิทธิ์เท่านั้นที่บันทึกและส่งได้
        </p>
      )}
      <p className="flex items-start gap-3 rounded-2xl border border-orange-100 bg-orange-50 p-4 text-sm leading-6 text-orange-900">
        <Clock3 className="mt-1 h-4 w-4 shrink-0" />
        ส่งหาลูกค้าที่ทักแชทเข้ามาภายใน 24 ชั่วโมงล่าสุด ตามกติกาของ Facebook
        เพื่อช่วยป้องกันเพจถูกจำกัดการส่งข้อความ
      </p>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]">
        <div className="min-w-0 space-y-6">
          <Panel title="1. เลือกกลุ่มลูกค้า">
            <fieldset disabled={busy || immutable || !canSend} className="space-y-5">
              <div>
                <label htmlFor="broadcast-segment" className="text-sm font-medium">
                  กลุ่มลูกค้า
                </label>
                <select
                  id="broadcast-segment"
                  className={inputClass}
                  value={segment}
                  onChange={(event) => setSegment(event.target.value as BroadcastSegment)}
                >
                  {Object.entries(customerGroups).map(([key, value]) => (
                    <option key={key} value={key}>
                      {value.label}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-slate-500">{customerGroups[segment].hint}</p>
              </div>
              <div>
                <p className="text-sm font-medium">เลือกตามป้ายชื่อลูกค้า (ไม่บังคับ)</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  เลือกป้ายชื่อลูกค้าได้หลายป้าย ลูกค้าที่ตรงกับป้ายใดป้ายหนึ่งจะอยู่ในกลุ่มนี้
                  หากไม่เลือก จะรวมทุกคน
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {[...new Set([...tags, ...picked])].map((tag) => (
                    <label
                      key={tag}
                      className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-slate-200 px-3 py-2 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={picked.includes(tag)}
                        onChange={() =>
                          setPicked((values) =>
                            values.includes(tag)
                              ? values.filter((value) => value !== tag)
                              : [...values, tag],
                          )
                        }
                      />
                      {tag}
                    </label>
                  ))}
                  {!tags.length && <p className="text-sm text-slate-400">ยังไม่มีป้ายชื่อลูกค้า</p>}
                </div>
              </div>
            </fieldset>
            <p aria-live="polite" className="rounded-xl bg-orange-50 p-3 text-sm text-orange-900">
              ลูกค้าที่ส่งได้:{' '}
              <strong>{preview ? `${number(preview.reachable)} คน` : 'รอตรวจสอบ'}</strong>
              <span className="mt-1 block text-xs">
                {preview
                  ? 'ตามกลุ่มที่เลือกและผลตรวจล่าสุด'
                  : 'เขียนข้อความแล้วกดตรวจสอบผู้รับเพื่อดูจำนวนจริง'}
              </span>
            </p>
          </Panel>
          <Panel title="2. เขียนข้อความ">
            <fieldset disabled={busy || immutable || !canSend} className="space-y-5">
              <div>
                <label htmlFor="broadcast-name" className="text-sm font-medium">
                  ชื่อรายการ <span className="text-slate-400">สำหรับค้นหาในประวัติ</span>
                </label>
                <input
                  id="broadcast-name"
                  className={inputClass}
                  maxLength={100}
                  value={name}
                  aria-invalid={!!fieldErrors.name}
                  aria-describedby={fieldErrors.name ? 'broadcast-name-error' : undefined}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="เช่น แจ้งข่าวร้านเดือนนี้"
                />
                {fieldErrors.name && (
                  <p id="broadcast-name-error" className="mt-1 text-xs text-red-700">
                    {fieldErrors.name}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="broadcast-message" className="text-sm font-medium">
                  ข้อความถึงลูกค้า
                </label>
                <textarea
                  id="broadcast-message"
                  className={`${inputClass} min-h-44 resize-y leading-6`}
                  maxLength={2000}
                  value={message}
                  aria-invalid={!!fieldErrors.message}
                  aria-describedby={fieldErrors.message ? 'broadcast-message-error' : undefined}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="เขียนข้อความที่ต้องการส่ง"
                />
                <div className="mt-1 flex justify-between gap-3 text-xs">
                  <p id="broadcast-message-error" className="text-red-700">
                    {fieldErrors.message}
                  </p>
                  <span className="shrink-0 text-slate-400">
                    {message.length.toLocaleString('th-TH')} / 2,000
                  </span>
                </div>
              </div>
            </fieldset>
            <p className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">
              ตอนนี้ส่งได้เฉพาะข้อความ บันทึกไว้ก่อนหรือกดตรวจสอบผู้รับเมื่อพร้อมได้เลย
            </p>
          </Panel>
        </div>
        <aside className="min-w-0 space-y-4 xl:sticky xl:top-4">
          <Panel title="3. ตรวจทานและส่ง">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Users className="h-5 w-5 text-orange-500" />
              {preview?.page.name ?? pageName}
            </div>
            <dl className="space-y-3 text-sm">
              {[
                ['จำนวนลูกค้าทั้งหมดในกลุ่ม', preview?.total],
                ['ส่งข้อความได้ทันที (ใน 24 ชม.)', preview?.reachable],
                ['ยังส่งไม่ได้ (เกิน 24 ชม. หรือถูกพักแชท)', preview?.skipped],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex justify-between gap-3">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="shrink-0 font-semibold tabular-nums">
                    {number(value as number | undefined)}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="border-t border-slate-100 pt-4 text-sm">
              <p>
                เครดิตข้อความคงเหลือ:{' '}
                <strong>
                  {number(preview?.credits ?? (billing ? billing.monthly + billing.topup : null))}
                </strong>
              </p>
              {preview && (
                <p className="mt-1 text-xs text-slate-500">
                  ใช้ไม่เกิน {number(preview.estimatedCredits)} เครดิต ตามผู้รับที่ตรวจผ่านจริง
                </p>
              )}
            </div>
            {preview ? (
              <>
                <p className="text-xs leading-5 text-slate-500">
                  ตรวจเมื่อ {date(preview.checkedAt)} ระบบตรวจใหม่ก่อนส่งแต่ละคน
                  จำนวนผู้รับอาจเปลี่ยนได้
                </p>
                {!preview.evidenceReady && (
                  <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                    ยังตรวจสอบลูกค้าที่เข้าเงื่อนไขไม่ได้ กรุณาให้เจ้าของร้านตรวจสอบความพร้อมก่อนส่ง
                  </p>
                )}
                {!preview.policyVerified && (
                  <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                    {preview.readiness?.message ??
                      'ยังไม่พร้อมส่ง กรุณาให้เจ้าของร้านตรวจสอบความพร้อมก่อนส่ง'}
                  </p>
                )}
                {preview.reachable === 0 && (
                  <p className="text-sm font-medium text-orange-800">
                    ยังไม่มีผู้รับที่ส่งได้ บันทึกฉบับร่างไว้ก่อนได้
                  </p>
                )}
                <details className="rounded-xl border border-slate-200 p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    ดูรายชื่อและเหตุผล
                  </summary>
                  <ul className="mt-3 max-h-80 space-y-3 overflow-y-auto text-xs">
                    {preview.members.map((member) => (
                      <li key={member.id}>
                        <strong>{member.name}</strong>
                        <p className="mt-1 text-slate-500">
                          {broadcastReasonLabels[member.reason] ??
                            'ยังส่งไม่ได้ กรุณาตรวจสอบอีกครั้ง'}
                        </p>
                      </li>
                    ))}
                  </ul>
                  {preview.membersLimited && (
                    <p className="mt-3 text-xs text-slate-400">
                      แสดง 100 คนแรก จำนวนสรุปนับผู้รับทั้งหมด
                    </p>
                  )}
                </details>
                <div className="space-y-1 text-xs text-slate-500">
                  {Object.entries(preview.reasons)
                    .filter(([reason]) => reason !== 'eligible')
                    .map(([reason, count]) => (
                      <p key={reason}>
                        {broadcastReasonLabels[reason as keyof typeof broadcastReasonLabels]}:{' '}
                        {number(count)}
                      </p>
                    ))}
                </div>
              </>
            ) : (
              <p className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-500">
                1. เลือกกลุ่มและเขียนข้อความให้ครบถ้วน → 2. กด &apos;ตรวจสอบผู้รับ&apos;
                เพื่อเช็กยอด → 3. กดยืนยันส่งได้ทันที
              </p>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                className={`${buttonClass} w-full min-w-0`}
                disabled={busy || !canSend || immutable}
                onClick={() => {
                  if (valid())
                    void act(async () => {
                      await saveDraft()
                      setNotice('บันทึกฉบับร่างแล้ว เปิดกลับมาแก้จากประวัติได้')
                    })
                }}
              >
                <Save className="h-4 w-4" />
                บันทึกฉบับร่าง
              </button>
              <button
                type="button"
                className={`${primaryClass} w-full min-w-0`}
                disabled={busy || !canSend}
                onClick={() => void (immutable ? checkStored() : checkRecipients())}
              >
                {busy ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                ตรวจสอบ{immutable ? 'รายการเดิม' : 'ผู้รับ'}
              </button>
              {id && (
                <button
                  type="button"
                  className={`${buttonClass} w-full sm:col-span-2`}
                  disabled={busy}
                  onClick={() => {
                    setId(null)
                    setName('')
                    setMessage('')
                    setPicked([])
                    setSegment('all')
                    setPreview(null)
                  }}
                >
                  สร้างรายการใหม่
                </button>
              )}
            </div>
            <button
              type="button"
              className={`${primaryClass} w-full`}
              disabled={busy || !canSend || !preview?.reachable || !selectedRecipients.length}
              onClick={() => review.current?.showModal()}
            >
              <Send className="h-4 w-4" />
              ตรวจทานและยืนยันส่ง
            </button>
            {progress && (
              <p role="status" className="text-xs text-orange-700">
                {progress}
              </p>
            )}
          </Panel>
        </aside>
      </div>
      <section
        ref={historySection}
        className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"
      >
        <h2 className="flex items-center gap-2 font-semibold">
          <History className="h-5 w-5 text-orange-500" />
          ประวัติการส่งและฉบับร่าง
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          50 รายการล่าสุด · “ส่งให้ Facebook แล้ว” หมายถึงรอ Facebook นำส่งให้ลูกค้า
        </p>
        {historyUnavailable && (
          <p role="alert" className="mt-4 text-sm text-red-700">
            โหลดประวัติไม่ได้ กรุณาลองใหม่
          </p>
        )}
        {history.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead className="border-b text-xs text-slate-500">
                <tr>
                  {[
                    'ชื่อรายการ',
                    'สถานะ',
                    'ส่งให้ Facebook แล้ว',
                    'ไม่สำเร็จ / ข้าม',
                    'สร้างเมื่อ',
                    'จัดการ',
                  ].map((label) => (
                    <th key={label} className="px-3 py-3 font-medium">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((row) => (
                  <tr key={row.id}>
                    <td className="max-w-48 px-3 py-4">
                      <span className="block truncate">{row.name}</span>
                      {row.status !== 'draft' && (
                        <button
                          type="button"
                          className="mt-1 block text-xs text-orange-700 underline"
                          disabled={busy}
                          onClick={() => void loadDeliveryStatus(row)}
                        >
                          ดูผลส่ง
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-4">
                      {
                        {
                          draft: 'ฉบับร่าง',
                          sending: 'กำลังส่ง',
                          sent: 'จบรายการแล้ว',
                          failed: 'หยุดส่ง / ต้องตรวจสอบ',
                        }[row.status]
                      }
                    </td>
                    <td className="px-3 py-4 tabular-nums">{number(row.sent)}</td>
                    <td className="px-3 py-4 tabular-nums">
                      {number(row.failed)} / {number(row.skipped)}
                    </td>
                    <td className="px-3 py-4 text-xs text-slate-500">{date(row.created_at)}</td>
                    <td className="px-3 py-4">
                      {row.status === 'draft' ? (
                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            className="py-2 text-orange-700 underline"
                            disabled={busy}
                            onClick={() => void openDraft(row)}
                          >
                            เปิดฉบับร่าง
                          </button>
                          {canSend && (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-lg px-2 py-2 text-red-700 hover:bg-red-50 disabled:opacity-50"
                              disabled={busy}
                              aria-label={`ลบฉบับร่าง ${row.name}`}
                              onClick={() => {
                                setError('')
                                setDeleting(row)
                                deleteDialog.current?.showModal()
                              }}
                            >
                              <Trash2 aria-hidden="true" className="h-4 w-4" />
                              ลบ
                            </button>
                          )}
                        </div>
                      ) : row.status !== 'sent' ? (
                        <button
                          type="button"
                          className="text-orange-700 underline"
                          disabled={busy}
                          onClick={() => void resume(row)}
                        >
                          ตรวจส่วนที่เหลือ
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">เก็บประวัติแล้ว</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-slate-400">
            <FileText className="mx-auto mb-2 h-7 w-7" />
            ยังไม่มีรายการบรอดแคสต์
          </p>
        )}
      </section>
      {preview && (
        <Panel title={recipientSelectionTitle}>
          <p className="text-sm text-slate-500">{recipientSelectionHint}</p>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              disabled={busy || immutable}
              checked={
                preview.members.some((m) => m.reason === 'eligible') &&
                preview.members
                  .filter((m) => m.reason === 'eligible')
                  .every((m) => selectedRecipients.includes(m.id))
              }
              onChange={(event) =>
                setSelectedRecipients(
                  event.target.checked
                    ? preview.members.filter((m) => m.reason === 'eligible').map((m) => m.id)
                    : [],
                )
              }
            />
            {selectAllLabel} ({selectedRecipients.length})
          </label>
          <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
            {preview.members
              .filter((member) => member.reason === 'eligible')
              .map((member) => (
                <li key={member.id}>
                  <label className="flex cursor-pointer items-center gap-3 py-3 text-sm">
                    <input
                      type="checkbox"
                      disabled={busy || immutable}
                      checked={selectedRecipients.includes(member.id)}
                      onChange={(event) => {
                        review.current?.close()
                        setSelectedRecipients((ids) =>
                          event.target.checked
                            ? [...new Set([...ids, member.id])]
                            : ids.filter((id) => id !== member.id),
                        )
                      }}
                    />
                    <span>
                      {member.name}
                      {member.lastInteractionAt && (
                        <span className="mt-1 block text-xs text-slate-500">
                          {date(member.lastInteractionAt)}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
          </ul>
        </Panel>
      )}
      <dialog
        ref={review}
        aria-labelledby="broadcast-review-title"
        className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl backdrop:bg-slate-900/40"
      >
        <h2 id="broadcast-review-title" className="flex items-center gap-2 text-lg font-semibold">
          <CheckCircle2 className="h-5 w-5 text-orange-500" />
          ตรวจทานก่อนส่งจริง
        </h2>
        <p className="mt-3 text-sm">
          เพจ: {preview?.page.name} · ส่งได้ล่าสุด {number(selectedRecipients.length)} คน
        </p>
        <p className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4 text-sm leading-6">
          {message}
        </p>
        <p className="mt-3 text-xs leading-5 text-slate-500">
          ระบบตรวจความพร้อมอีกครั้งก่อนส่ง ข้อความที่ส่งให้ Facebook แล้วเรียกคืนไม่ได้
          รายการที่ยังไม่ทราบผลจะไม่ส่งซ้ำอัตโนมัติ
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" className={buttonClass} onClick={() => review.current?.close()}>
            กลับไปแก้ไข
          </button>
          <button
            type="button"
            className={primaryClass}
            disabled={busy || !preview?.reachable}
            onClick={() => void confirmSend()}
          >
            ยืนยันส่งข้อความจริง
          </button>
        </div>
      </dialog>
      <dialog
        ref={help}
        aria-labelledby="broadcast-help-title"
        aria-describedby="broadcast-help-notice"
        className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-orange-100 bg-white p-5 text-slate-800 shadow-xl backdrop:bg-slate-900/40 sm:p-6"
      >
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-orange-100 text-orange-600">
            <HelpCircle aria-hidden="true" className="h-5 w-5" />
          </span>
          <h2 id="broadcast-help-title" className="text-lg font-semibold text-slate-900">
            วิธีใช้งานบรอดแคสต์
          </h2>
        </div>
        <ol className="mt-5 list-decimal space-y-4 pl-6 text-sm leading-7 marker:font-semibold marker:text-orange-600">
          <li className="pl-1">ตรวจชื่อเพจที่ใช้งาน แล้วเลือกกลุ่มลูกค้าที่ต้องการ</li>
          <li className="pl-1">ตั้งชื่อรายการและเขียนข้อความ บันทึกฉบับร่างไว้ก่อนได้</li>
          <li className="pl-1">กดตรวจสอบผู้รับ อ่านเหตุผลที่ต้องข้าม แล้วตรวจทานก่อนยืนยันส่ง</li>
        </ol>
        <div
          id="broadcast-help-notice"
          className="mt-5 flex items-start gap-3 rounded-xl border border-orange-100 bg-orange-50 p-4 text-sm leading-6 text-orange-900"
        >
          <Clock3 aria-hidden="true" className="mt-1 h-4 w-4 shrink-0" />
          <p>
            ส่งได้เฉพาะลูกค้าที่ทักแชทเข้ามาภายใน 24 ชั่วโมงล่าสุด หากยังส่งไม่ได้
            บันทึกฉบับร่างไว้ก่อนได้
          </p>
        </div>
        <div className="mt-5 flex justify-end border-t border-slate-100 pt-4">
          <button
            type="button"
            className={primaryClass + ' w-full sm:w-auto'}
            onClick={() => help.current?.close()}
          >
            ปิดคู่มือ
          </button>
        </div>
      </dialog>
      <dialog
        ref={deleteDialog}
        aria-labelledby="broadcast-delete-title"
        aria-describedby="broadcast-delete-description"
        className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white p-6 shadow-xl backdrop:bg-slate-900/40"
        onCancel={(event) => {
          if (busy) event.preventDefault()
        }}
      >
        <h2 id="broadcast-delete-title" className="text-lg font-semibold">
          ลบฉบับร่างนี้หรือไม่?
        </h2>
        <p
          id="broadcast-delete-description"
          className="mt-3 break-words text-sm leading-6 text-slate-600"
        >
          {deleting?.name} · เมื่อลบแล้วจะนำกลับมาไม่ได้
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() => {
              deleteDialog.current?.close()
              setDeleting(null)
            }}
          >
            ยกเลิก
          </button>
          <button
            type="button"
            className={buttonClass + ' border-red-200 text-red-700 hover:bg-red-50'}
            disabled={busy || !deleting}
            onClick={() => void deleteDraft()}
          >
            {busy ? 'กำลังลบ…' : 'ยืนยันลบ'}
          </button>
        </div>
      </dialog>
      <dialog
        ref={deliveryDialog}
        aria-labelledby="broadcast-results-title"
        className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl bg-white p-6 shadow-xl backdrop:bg-slate-900/40"
      >
        <h2 id="broadcast-results-title" className="font-semibold">
          ผลส่ง: {deliveryReport?.name}
        </h2>
        <dl className="mt-5 space-y-3 text-sm">
          {[
            ['ส่งให้ Facebook แล้ว', deliveryReport?.sent],
            [
              'กำลังรอ Facebook ยืนยัน',
              deliveryReport
                ? Math.max(0, deliveryReport.sent - deliveryReport.delivered)
                : undefined,
            ],
            ['ส่งสำเร็จถึงลูกค้า', deliveryReport?.delivered],
            ['ลูกค้าอ่านแล้ว', deliveryReport?.read],
            ['ไม่สำเร็จ', deliveryReport?.failed],
            ['ยังไม่ทราบผล / ต้องตรวจสอบ', deliveryReport?.unknown],
            ['ข้าม', deliveryReport?.skipped],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex justify-between gap-3">
              <dt>{label}</dt>
              <dd className="font-semibold">{number(value as number | undefined)}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-slate-500">
          สถานะส่งสำเร็จและอ่านแล้วจะแสดงเมื่อได้รับการยืนยันจาก Facebook
        </p>
        <button
          type="button"
          className={`${buttonClass} mt-5`}
          onClick={() => deliveryDialog.current?.close()}
        >
          ปิดผลส่ง
        </button>
      </dialog>
    </div>
  )
}
