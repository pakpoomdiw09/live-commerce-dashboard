'use client'
import { temporaryFullAccess } from '@/lib/full-access'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import Image from 'next/image'
import { FlaskConical, RefreshCw, ScanEye, Upload } from 'lucide-react'
import { PageBanner } from '@/components/ui/page-banner'
import {
  VISION_CONFIDENCE_THRESHOLD,
  type VisionSettings,
  type VisionResult,
  type VisionDecision,
} from '@/lib/features/vision/vision-types'

type History = {
  id: string
  source: string
  status: string
  result: VisionResult | null
  decision: VisionDecision | null
  reason: string | null
  created_at: string
  ai_request_started_at?: string | null
  attempts?: number
}
type Overview = {
  settings: VisionSettings | null
  usage: { used: number; limit: number; remaining: number; month: string }
  productSearch: boolean
  jobs: History[]
  automationEnabled: boolean
}
export function normalizeVisionOverview(value: unknown): Overview {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('ข้อมูล AI Vision ไม่ถูกต้อง กรุณาลองโหลดอีกครั้ง')
  const v = value as Partial<Overview>,
    number = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0)
  const settings =
    v.settings &&
    typeof v.settings === 'object' &&
    typeof v.settings.enabled === 'boolean' &&
    ['rules', 'catalog'].includes(v.settings.mode) &&
    typeof v.settings.confidence_threshold === 'number'
      ? { ...v.settings, mode: 'rules' as const, handoff_enabled: true, confidence_threshold: VISION_CONFIDENCE_THRESHOLD }
      : null
  return {
    ...v,
    settings,
    usage: {
      used: number(v.usage?.used),
      limit: number(v.usage?.limit),
      remaining: number(v.usage?.remaining),
      month: typeof v.usage?.month === 'string' ? v.usage.month : '',
    },
    jobs: Array.isArray(v.jobs)
      ? v.jobs.filter((j) => j && typeof j.id === 'string' && typeof j.status === 'string')
      : [],
    productSearch: v.productSearch === true,
    automationEnabled: v.automationEnabled === true,
  }
}
const box = 'min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5'
const button =
  'rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50'
const statusLabel: Record<string, string> = {
  pending: 'รอประมวลผล',
  processing: 'กำลังประมวลผล',
  completed: 'สำเร็จ',
  requires_review: 'รอแอดมินตรวจสอบ',
  failed: 'ไม่สำเร็จ',
  cancelled: 'ยกเลิก',
}

export function VisionCenter({
  tenantId,
  canManage,
  children,
}: {
  tenantId: string
  canManage: boolean
  children: ReactNode
}) {
  const [data, setData] = useState<Overview | null>(null),
    [settings, setSettings] = useState<VisionSettings | null>(null)
  const [notice, setNotice] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [file, setFile] = useState<File | null>(null),
    [requestId, setRequestId] = useState(''),
    [preview, setPreview] = useState<History | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testError, setTestError] = useState('')
  function selectFile(next: File | null) {
    setPreview(null)
    setTestError('')
    setError('')
    if (!next) {
      setFile(null)
      setRequestId('')
      return
    }
    try {
      const id = crypto.randomUUID()
      setFile(next)
      setRequestId(id)
    } catch {
      setFile(null)
      setRequestId('')
      setTestError('ไม่สามารถเตรียมรูปภาพได้ กรุณาเปิดเว็บผ่าน HTTPS แล้วลองอีกครั้ง')
    }
  }
  useEffect(() => {
    if (!file) {
      setImagePreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setImagePreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  const endpoint = `/api/chatbot/vision?tenantId=${encodeURIComponent(tenantId)}`
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(endpoint, { cache: 'no-store', signal }),
        value = await response.json()
      if (!response.ok) throw new Error(value?.error ?? 'โหลด AI Vision ไม่สำเร็จ')
      const next = normalizeVisionOverview(value)
      setData(next)
      setSettings(next.settings)
      setError(next.settings ? '' : 'โหลดการตั้งค่า Vision ไม่ครบ กรุณาลองอีกครั้ง')
    },
    [endpoint],
  )
  useEffect(() => {
    const abort = new AbortController()
    void load(abort.signal).catch((e) => {
      if (!abort.signal.aborted) setError(e.message)
    })
    return () => abort.abort()
  }, [load])
  async function save(enabled: boolean) {
    if (!settings || !canManage || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          tenantId,
        }),
      })
      const value = await response.json()
      if (!response.ok) throw new Error(value?.error ?? 'บันทึกไม่สำเร็จ')
      const next = normalizeVisionOverview(value)
      setData(next)
      setSettings(next.settings)
      setNotice(enabled ? 'เปิดใช้งานระบบตอบรูปภาพแล้ว' : 'ปิดใช้งานระบบตอบรูปภาพแล้ว')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }
  async function test() {
    if (!file || !requestId) return
    setBusy(true)
    setTesting(true)
    setTestError('')
    setError('')
    setNotice('')
    setPreview(null)
    try {
      const form = new FormData()
      form.set('file', file)
      form.set('requestId', requestId)
      const response = await fetch(
        `/api/chatbot/vision/test?tenantId=${encodeURIComponent(tenantId)}`,
        { method: 'POST', body: form },
      )
      const value = await response.json()
      if (!response.ok) throw new Error(value?.error ?? 'วิเคราะห์ไม่สำเร็จ')
      setPreview(
        value?.job && typeof value.job === 'object' && typeof value.job.status === 'string'
          ? value.job
          : null,
      )
      await load()
    } catch (e) {
      setTestError(e instanceof Error ? e.message : 'วิเคราะห์ไม่สำเร็จ')
    } finally {
      setBusy(false)
      setTesting(false)
    }
  }
  async function retry(jobId: string) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(
        `/api/chatbot/vision/jobs/${jobId}/retry?tenantId=${encodeURIComponent(tenantId)}`,
        { method: 'POST' },
      )
      const value = await response.json()
      if (!response.ok) throw new Error(value?.error ?? 'ลองใหม่ไม่ได้')
      await load()
      setNotice('นำงานที่ยังไม่เคยเรียก AI กลับเข้าคิวแล้ว')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ลองใหม่ไม่ได้')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mx-0 w-full min-w-0 max-w-none space-y-6 p-4 md:p-8">
      <PageBanner className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <ScanEye className="mb-3 h-7 w-7" aria-hidden />
          <h1 className="text-xl font-semibold sm:text-2xl">AI Vision Center</h1>
          <p className="mt-2 text-sm leading-relaxed text-white/90">
            จัดการกฎตอบรูปภาพและทดลองวิเคราะห์ภาพของร้าน
          </p>
        </div>
        <div className="flex items-center justify-between gap-5 rounded-2xl border border-white/25 bg-white/15 p-4 sm:min-w-56">
          <div id="vision-enabled-label">
            <p className="text-sm font-semibold">ระบบตอบรูปภาพ</p>
            <p role="status" className="mt-1 text-xs text-white/85">
              {busy && !testing ? 'กำลังบันทึก…' : !settings ? 'กำลังโหลด…' : settings.enabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
            </p>
          </div>
          <button type="button" role="switch" aria-checked={settings?.enabled ?? false}
            aria-labelledby="vision-enabled-label" disabled={!canManage || busy || !settings}
            onClick={() => void save(!settings?.enabled)}
            className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:opacity-50 ${settings?.enabled ? 'bg-emerald-500' : 'bg-black/25'}`}>
            <span className={`h-6 w-6 rounded-full bg-white shadow transition-transform ${settings?.enabled ? 'translate-x-5.5' : 'translate-x-0.5'}`} />
          </button>
        </div>
      </PageBanner>
      {error && data && (
        <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-xl bg-green-50 p-4 text-sm text-green-800">
          {notice}
        </p>
      )}
      <div className="-mx-4 md:-mx-8">{children}</div>
      {!data ? (
        <div role={error ? 'alert' : 'status'} aria-busy={!error} className="min-w-0 space-y-6">
          {error && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-rose-50 p-4 text-sm text-rose-700">
              <span>{error} หากยังไม่ได้ติดตั้ง กรุณาตรวจสอบโครงสร้างข้อมูล Vision</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setError('')
                  setBusy(true)
                  void load()
                    .catch((e) =>
                      setError(e instanceof Error ? e.message : 'โหลดข้อมูล Vision ไม่สำเร็จ'),
                    )
                    .finally(() => setBusy(false))
                }}
                className="rounded-lg border border-rose-200 bg-white px-3 py-2 font-medium text-rose-700 disabled:opacity-50"
              >
                {busy ? 'กำลังลองอีกครั้ง…' : 'ลองอีกครั้ง'}
              </button>
            </div>
          )}
          <p className="sr-only">กำลังโหลดข้อมูล Vision จากฐานข้อมูล…</p>
            <div aria-hidden="true" className={`${box} ml-auto min-h-48 w-full max-w-sm animate-pulse`}>
              <div className="h-5 w-1/3 rounded bg-slate-200" />
              <div className="mt-4 h-3 w-5/6 rounded bg-slate-100" />
              <div className="mt-3 h-3 w-2/3 rounded bg-slate-100" />
              <div className="mt-6 h-16 rounded-xl bg-slate-100" />
            </div>
          <div aria-hidden="true" className={`${box} min-h-72 animate-pulse`}>
            <div className="h-5 w-1/3 rounded bg-slate-200" />
            <div className="mt-5 space-y-4">
              {[0, 1, 2, 3].map((item) => (
                <div key={item} className="h-10 rounded-lg bg-slate-100" />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <>
            <section aria-label="โหมดทดลองวิเคราะห์ภาพ" className={`${box} w-full max-w-sm border-orange-100 sm:ml-auto`}>
              <div className="flex items-center gap-2">
                <FlaskConical className="h-4 w-4 text-orange-500" aria-hidden />
                <h3 className="font-semibold text-slate-900">โหมดทดลอง</h3>
                <span className="ml-auto rounded-md bg-orange-50 px-2 py-0.5 text-[10px] font-medium text-orange-700">
                  Sandbox
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                JPG / PNG / WebP ไม่เกิน 5 MB · ใช้โควตา 1 ภาพต่อการวิเคราะห์ใหม่
                ไม่ส่งข้อความหาลูกค้า
              </p>
              <label className="mt-3 block rounded-xl border border-dashed border-orange-200 bg-orange-50/40 p-3">
                <span className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-700">
                  <Upload className="h-3.5 w-3.5" aria-hidden /> เลือกรูปภาพทดสอบ
                </span>
                <input
                  aria-label="รูปภาพสำหรับทดลอง AI Vision"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={busy}
                  onChange={(e) => selectFile(e.target.files?.[0] ?? null)}
                  className="block w-full min-w-0 text-xs text-slate-500 file:mr-2 file:cursor-pointer file:rounded-lg file:border-0 file:bg-white file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-orange-700 disabled:opacity-50"
                />
              </label>
              {imagePreview && (
                <div className="mt-3 flex min-w-0 items-center gap-3 rounded-xl bg-slate-50 p-2">
                  <Image
                    src={imagePreview}
                    alt="ภาพที่เลือกสำหรับทดลอง AI Vision"
                    width={64}
                    height={64}
                    unoptimized
                    className="h-16 w-16 shrink-0 rounded-lg border border-slate-200 bg-white object-contain"
                  />
                  <p className="min-w-0 break-all text-xs text-slate-600">{file?.name}</p>
                </div>
              )}
              <button
                type="button"
                className={`${button} mt-3 flex w-full items-center justify-center gap-2`}
                disabled={!file || busy || (!temporaryFullAccess && data.usage.remaining <= 0)}
                onClick={() => void test()}
              >
                {testing && <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />}
                {testing ? 'กำลังวิเคราะห์…' : 'วิเคราะห์ภาพ'}
              </button>
              {testError && (
                <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">
                  {testError}
                </p>
              )}
              {preview && (
                <div
                  role="status"
                  className="mt-3 max-h-48 space-y-2 overflow-y-auto rounded-xl bg-orange-50 p-3 text-xs leading-relaxed break-words"
                >
                  <div className="flex flex-wrap items-center justify-between gap-1 font-medium text-orange-900">
                    <span>{statusLabel[preview.status] ?? preview.status}</span>
                    {preview.result && <span>{Math.round(preview.result.confidence * 100)}%</span>}
                  </div>
                  {preview.result && (
                    <p>
                      <span className="font-medium">{preview.result.category}</span> ·{' '}
                      {preview.result.description}
                    </p>
                  )}
                  {preview.decision && (
                    <p>
                    {preview.decision.responseText ?? 'ไม่พบคำตอบอัตโนมัติ'}
                    </p>
                  )}
                  {preview.decision?.mediaUrl && (
                    <a
                      className="inline-block text-orange-700 underline"
                      href={preview.decision.mediaUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      ดูรูปภาพแนบจากกฎ
                    </a>
                  )}
                  {preview.reason && <p className="text-[11px] text-slate-500">{preview.reason}</p>}
                </div>
              )}
            </section>
          <section className={box}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">ประวัติรูปภาพ · 30 งานล่าสุด</h2>
              <button
                className="flex items-center gap-2 text-sm text-orange-700"
                disabled={busy}
                onClick={() => void load().catch((e) => setError(e.message))}
              >
                <RefreshCw className="h-4 w-4" />
                รีเฟรช
              </button>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="p-2">เวลา</th>
                    <th className="p-2">ที่มา / ประเภท</th>
                    <th className="p-2">สถานะ</th>
                    <th className="p-2">เหตุผล</th>
                    <th className="p-2">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {data.jobs.map((job) => (
                    <tr key={job.id} className="border-b border-slate-100">
                      <td className="whitespace-nowrap p-2">
                        {new Date(job.created_at).toLocaleString('th-TH')}
                      </td>
                      <td className="p-2">
                        {job.source === 'test' ? 'ทดสอบ' : 'Messenger'} ·{' '}
                        {job.result?.category ?? '—'}
                      </td>
                      <td className="p-2">{statusLabel[job.status] ?? job.status}</td>
                      <td className="p-2 text-xs text-slate-500">
                        {job.reason ?? job.decision?.reason ?? '—'}
                      </td>
                      <td className="space-y-2 p-2">
                        <a
                          className="block whitespace-nowrap text-orange-700 underline"
                          href={`/api/chatbot/vision/jobs/${job.id}/image?tenantId=${encodeURIComponent(tenantId)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          ดูภาพ
                        </a>
                        {canManage &&
                          ['requires_review', 'cancelled'].includes(job.status) &&
                          !job.ai_request_started_at &&
                          (job.attempts ?? 0) < 3 && (
                            <button
                              disabled={busy}
                              className="whitespace-nowrap text-xs text-orange-700 underline"
                              onClick={() => void retry(job.id)}
                            >
                              นำกลับเข้าคิว
                            </button>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data.jobs.length && (
                <p className="p-4 text-sm text-slate-500">ยังไม่มีประวัติการวิเคราะห์ภาพ</p>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
