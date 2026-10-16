'use client'
import {useCallback, useEffect, useState} from 'react'
import {ErrorMessage,LoadingSpinner} from '@/components/ui/feedback'

type SafetyStatus = {enabled: boolean; stopped?: boolean; canManage: boolean}
export function AutomationEmergencyStop({tenantId}: {tenantId: string}) {
  const [status, setStatus] = useState<SafetyStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const endpoint = `/api/automation-safety?tenantId=${encodeURIComponent(tenantId)}`
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(endpoint, {cache: 'no-store', signal})
    const value = await response.json()
    if (!response.ok) throw new Error(value.error ?? 'ตรวจสถานะหยุดฉุกเฉินไม่ได้')
    setStatus(value)
  }, [endpoint])
  useEffect(() => {
    const controller = new AbortController()
    setStatus(null)
    setError('')
    void load(controller.signal).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [load])
  async function toggle() {
    if (!status?.canManage || busy) return
    if (status.stopped && !window.confirm('เปิดระบบตอบอัตโนมัติอีกครั้งหรือไม่? งานที่รอตรวจสอบจะยังต้องตรวจแยกต่างหาก')) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(endpoint, {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({stopped: !status.stopped, reason: status.stopped ? 'เจ้าของร้านเปิดระบบอีกครั้งจากศูนย์ควบคุม' : 'เจ้าของร้านกดหยุดฉุกเฉินจากศูนย์ควบคุม'})})
      const value = await response.json()
      if (!response.ok) throw new Error(value.error ?? 'เปลี่ยนสถานะไม่สำเร็จ')
      await load()
    } catch (error) { setStatus(null); setError(error instanceof Error ? error.message : 'เปลี่ยนสถานะไม่สำเร็จ') }
    finally { setBusy(false) }
  }
  return <section aria-label="ระบบหยุดฉุกเฉิน" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-white p-4">
    <div><p role="status" className="font-semibold">{!status ? (error ? 'ยังยืนยันสถานะระบบหยุดฉุกเฉินไม่ได้' : <LoadingSpinner label="กำลังตรวจสถานะระบบหยุดฉุกเฉิน"/>) : !status.enabled ? 'ระบบหยุดฉุกเฉินรายร้านยังไม่เปิดใช้งาน' : status.stopped ? 'หยุดระบบตอบอัตโนมัติฉุกเฉินแล้ว' : 'ระบบตอบอัตโนมัติไม่ได้ถูกหยุดฉุกเฉิน'}</p><p className="mt-1 text-xs text-slate-600">หยุดคำตอบอัตโนมัติ AI ภาพ และการติดตามลูกค้าในร้านนี้ แอดมินยังตอบเองได้ ข้อความที่ส่งไปแล้วเรียกคืนไม่ได้</p></div>
    {status?.enabled && <button type="button" disabled={!status.canManage || busy} onClick={() => void toggle()} className="rounded-xl bg-rose-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'กำลังบันทึก…' : status.stopped ? 'เปิดระบบอีกครั้ง' : 'หยุดฉุกเฉิน'}</button>}
    {error && <ErrorMessage>{error}<button type="button" className="ml-3 underline" onClick={() => void load().then(() => setError('')).catch(error => setError(error.message))}>ตรวจสถานะอีกครั้ง</button></ErrorMessage>}
  </section>
}
