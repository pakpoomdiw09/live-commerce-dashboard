'use client'
import { useEffect, useState } from 'react'
import { apiError } from '@/lib/utils'
type State = { followup_opted_out: boolean; contact_suspended: boolean }
export function FollowUpContactControl({
  customerId,
  tenantId,
}: {
  customerId: string
  tenantId: string
}) {
  const [state, setState] = useState<State | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  async function refresh() {
    const res = await fetch(`/api/follow-ups/customers/${customerId}?tenantId=${tenantId}`, {
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(await apiError(res))
    setState(await res.json())
  }
  useEffect(() => {
    let alive = true
    setState(null)
    setError('')
    const controller = new AbortController()
    void fetch(`/api/follow-ups/customers/${customerId}?tenantId=${tenantId}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.ok && alive) setState(await res.json())
      })
      .catch(() => {})
    return () => {
      alive = false
      controller.abort()
    }
  }, [customerId, tenantId])
  async function act(action: string) {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/follow-ups/customers/${customerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, action }),
      })
      if (!res.ok) throw new Error(await apiError(res))
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกไม่ได้')
    } finally {
      setBusy(false)
    }
  }
  if (!state) return null
  return (
    <section className="rounded-xl border border-orange-100 bg-orange-50/40 p-3 text-xs">
      <h3 className="mb-2 font-medium text-slate-700">การติดตามลูกค้า</h3>
      <p className="text-slate-500">
        {state.followup_opted_out
          ? 'ลูกค้าไม่รับข้อความติดตาม'
          : state.contact_suspended
            ? 'พักติดตามรายนี้แล้ว'
            : 'อนุญาตให้ติดตามตามเงื่อนไขที่ตั้งไว้'}
      </p>
      {state.followup_opted_out ? (
        <p className="mt-2 text-[11px] text-slate-400">
          เปิดใหม่ได้เมื่อลูกค้าส่ง “เริ่มติดตาม” อีกครั้ง ในแชท
        </p>
      ) : (
        <button
          disabled={busy}
          onClick={() => void act('opt_out')}
          className="mt-2 rounded-lg border border-orange-200 bg-white p-2 text-orange-800 disabled:opacity-50"
        >
          หยุดติดตามรายนี้
        </button>
      )}
      <button
        disabled={busy}
        onClick={() => void act(state.contact_suspended ? 'unsuspend' : 'suspend')}
        className="mt-2 ml-1 rounded-lg p-2 text-slate-500 disabled:opacity-50"
      >
        {state.contact_suspended ? 'ยกเลิกพักติดตาม (เจ้าของร้าน)' : 'พักติดตาม (เจ้าของร้าน)'}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-rose-600">
          {error}
        </p>
      )}
    </section>
  )
}
