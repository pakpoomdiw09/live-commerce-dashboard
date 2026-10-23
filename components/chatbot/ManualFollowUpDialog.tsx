'use client'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { inputClass } from '@/components/ui/field'
import { apiError, baht } from '@/lib/utils'
import { WORKFLOW_LABELS, type WorkflowKind } from '@/lib/features/follow-ups/smart-followup-types'
import { supabaseBrowser } from '@/lib/supabase/browser'

type Customer = { id: string; display_name: string | null; platform_user_id: string }
type Options = {
  orders: { id: string; product_name: string; status: string; amount: number }[]
  products: { id: string; name: string }[]
}
export function ManualFollowUpDialog({
  tenantId,
  onClose,
  onAdded,
}: {
  tenantId: string
  onClose: () => void
  onAdded: () => Promise<void>
}) {
  const [q, setQ] = useState(''),
    [customers, setCustomers] = useState<Customer[]>([]),
    [customer, setCustomer] = useState<Customer | null>(null)
  const [kind, setKind] = useState<WorkflowKind>('payment'),
    [reference, setReference] = useState(''),
    [options, setOptions] = useState<Options>({ orders: [], products: [] })
  const [error, setError] = useState(''),
    [saving, setSaving] = useState(false),
    [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  const customerId = customer?.id ?? ''
  const savingRef = useRef(false),
    dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  useEffect(() => {
    if (!customerId) return
    const db = supabaseBrowser()
    let timer: ReturnType<typeof setTimeout> | undefined
    let disposed = false
    const channel = db
      .channel(`manual-follow-up-orders:${customerId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `customer_id=eq.${customerId}` },
        () => {
          clearTimeout(timer)
          timer = setTimeout(() => {
            if (!disposed) setRevision((value) => value + 1)
          }, 400)
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' && !disposed) setRevision((value) => value + 1)
      })
    return () => {
      disposed = true
      clearTimeout(timer)
      void db.removeChannel(channel)
    }
  }, [customerId])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    const timer = setTimeout(
      async () => {
        setError('')
        try {
          const params = new URLSearchParams({
            tenantId,
            ...(customer ? { customerId: customer.id } : { q }),
          })
          const res = await fetch(`/api/follow-ups/manual?${params}`, {
            signal: controller.signal,
            cache: 'no-store',
          })
          if (!res.ok) throw new Error(await apiError(res))
          const data = await res.json()
          if (!controller.signal.aborted) {
            if (customer) setOptions({ orders: data.orders ?? [], products: data.products ?? [] })
            else setCustomers(data.customers ?? [])
          }
        } catch (e) {
          if (!controller.signal.aborted)
            setError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ')
        } finally {
          if (!controller.signal.aborted) setLoading(false)
        }
      },
      customer ? 0 : 300,
    )
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [tenantId, q, customer, revision])
  async function submit() {
    if (savingRef.current || !customer) return
    savingRef.current = true
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/follow-ups/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, customerId: customer.id, kind, referenceId: reference }),
      })
      if (!res.ok) throw new Error(await apiError(res))
      await onAdded()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เพิ่มรายการไม่สำเร็จ')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }
  const references =
    kind === 'interested'
      ? options.products.map((p) => ({ id: p.id, label: p.name, disabled: false }))
      : options.orders.map((o) => ({
          id: o.id,
          label: `#${o.id.slice(0, 8)} · ${o.product_name} · ${baht(o.amount)} · ${o.status}`,
          disabled: o.status !== (kind === 'payment' ? 'pending_payment' : 'shipped'),
        }))
  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault()
        if (!saving) onClose()
      }}
      aria-labelledby="manual-followup-title"
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl bg-white p-6 shadow-xl backdrop:bg-black/40"
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <h2 id="manual-followup-title" className="text-lg font-semibold">
          เพิ่มลูกค้าเข้าคิวติดตาม
        </h2>
        <p className="text-sm text-slate-500">
          เลือกลูกค้าที่เคยทักแชทร้าน ระบบใช้กำหนดเวลาและข้อความที่บันทึกไว้ของประเภทนั้น
          และตรวจสอบเงื่อนไขอีกครั้งก่อนส่งจริง
        </p>
        {!customer ? (
          <>
            <label className="block text-sm">
              ค้นหาชื่อ / Customer ID / Facebook PSID
              <input
                autoFocus
                className={`${inputClass} mt-1`}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="พิมพ์ชื่อหรือรหัสลูกค้า"
              />
            </label>
            <p className="text-xs text-slate-500">
              ใช้รายชื่อจากแชทเท่านั้น ลิงก์โปรไฟล์ Facebook ใช้แทนรหัสผู้รับข้อความไม่ได้
            </p>
            <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200">
              {customers.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  className="block w-full border-b border-slate-100 px-3 py-2 text-left hover:bg-blue-50"
                  onClick={() => {
                    setCustomer(c)
                    setReference('')
                    setOptions({ orders: [], products: [] })
                  }}
                >
                  <span className="block text-sm font-medium">
                    {c.display_name || c.platform_user_id}
                  </span>
                  <span className="text-xs text-slate-500">{c.id}</span>
                </button>
              ))}
              {!loading && !customers.length && (
                <p className="p-4 text-sm text-slate-500">ไม่พบลูกค้า</p>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between rounded-xl bg-blue-50 p-3 text-sm">
            <span>{customer.display_name || customer.platform_user_id}</span>
            <Button
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => {
                setCustomer(null)
                setReference('')
              }}
            >
              เปลี่ยนลูกค้า
            </Button>
          </div>
        )}
        <label className="block text-sm">
          ประเภทการติดตาม
          <select
            className={`${inputClass} mt-1`}
            value={kind}
            disabled={saving}
            onChange={(e) => {
              setKind(e.target.value as WorkflowKind)
              setReference('')
            }}
          >
            {Object.entries(WORKFLOW_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {customer && (
          <label className="block text-sm">
            {kind === 'interested' ? 'สินค้าที่สนใจ (ไม่บังคับ)' : 'ออเดอร์อ้างอิง (ไม่บังคับ)'}
            <select
              className={`${inputClass} mt-1`}
              value={reference}
              disabled={saving || loading}
              onChange={(e) => setReference(e.target.value)}
            >
              <option value="">{kind === 'interested' ? 'ไม่ระบุสินค้า' : 'ไม่ระบุออเดอร์'}</option>
              {references.map((r) => (
                <option key={r.id} value={r.id} disabled={r.disabled}>
                  {r.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-500">
              เลือกข้อมูลอ้างอิงได้ หรือเพิ่มเข้าคิวโดยไม่ระบุ
              ระบบให้แอดมินตรวจข้อความจากประวัติแชทก่อนส่ง โดยไม่แต่งยอดเงินหรือสถานะชำระขึ้นเอง
            </span>
          </label>
        )}
        {loading && (
          <p role="status" className="text-sm text-slate-500">
            กำลังโหลด…
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={saving} onClick={onClose}>
            ยกเลิก
          </Button>
          <Button type="submit" loading={saving} disabled={!customer || saving}>
            เพิ่มเข้าคิว
          </Button>
        </div>
      </form>
    </dialog>
  )
}
