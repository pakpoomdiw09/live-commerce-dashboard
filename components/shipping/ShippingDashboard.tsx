'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Printer, RefreshCw, Settings, Truck } from 'lucide-react'
import { SessionDialog } from '@/components/live-cf/SessionDialog'
import { ShippingAddressModal } from './ShippingAddressModal'
import { ShippingSettingsModal } from './ShippingSettingsModal'
import {
  addressFromShipment,
  shippingField as field,
  shippingButton as button,
  shippingPrimary as primary,
  shippingStatus,
  type ShippingPost,
} from './shipping-ui'
import {
  COURIERS,
  shippingMoney as money,
  type ShippingShipment,
  type ShippingSettings,
} from '@/lib/features/shipping/shipping-types'

type ShippingData = {
  shipments: ShippingShipment[]
  settings: ShippingSettings | null
  sessions: { id: string; live_post_id: string; created_at: string }[]
}
const filters = [
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'pending_address', label: 'รอแจ้งที่อยู่' },
  { id: 'ready_to_ship', label: 'พร้อมส่ง (โอนครบแล้ว)' },
  { id: 'printed', label: 'พิมพ์ใบปะหน้าแล้ว' },
  { id: 'shipped', label: 'ส่งพัสดุแล้ว' },
  { id: 'cancelled', label: 'ยกเลิกรายการส่ง' },
]
export function ShippingDashboard({ tenantId, shopName }: { tenantId: string; shopName: string }) {
  const [data, setData] = useState<ShippingData>({ shipments: [], settings: null, sessions: [] })
  const [session, setSession] = useState('all'),
    [status, setStatus] = useState('all'),
    [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true)
  const [version, setVersion] = useState(0),
    [updated, setUpdated] = useState(''),
    [printLink, setPrintLink] = useState('')
  const [modal, setModal] = useState<
    { kind: 'address'; shipment: ShippingShipment } | { kind: 'settings' } | { kind: 'bee' } | null
  >(null)
  const [carrier, setCarrier] = useState('Bee Move'),
    [tracking, setTracking] = useState<Record<string, string>>({})
  const requests = useRef(new Map<string, string>())
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let pending = false
    const load = async () => {
      if (pending || controller.signal.aborted) return
      pending = true
      try {
        if (!document.hidden) {
          const params = new URLSearchParams({ tenantId })
          if (!['all', 'legacy'].includes(session)) params.set('sessionId', session)
          const response = await fetch(`/api/shipping?${params}`, {
            cache: 'no-store',
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
          })
          const result = await response.json()
          if (!response.ok) throw new Error(result.error || 'โหลดรายการจัดส่งไม่สำเร็จ')
          if (!controller.signal.aborted) {
            setData(result)
            setError('')
            setUpdated(new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' }))
          }
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'โหลดรายการไม่สำเร็จ')
      } finally {
        pending = false
        if (!controller.signal.aborted) {
          setLoading(false)
          timer = setTimeout(load, 5000)
        }
      }
    }
    const visible = () => {
      if (!document.hidden) {
        clearTimeout(timer)
        void load()
      }
    }
    void load()
    document.addEventListener('visibilitychange', visible)
    return () => {
      controller.abort()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [tenantId, session, version])
  const post = useCallback<ShippingPost>(
    async (input, requestId) => {
      const key = JSON.stringify(input)
      if (!requests.current.has(key)) requests.current.set(key, crypto.randomUUID())
      const response = await fetch('/api/shipping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          requestId: requestId || requests.current.get(key),
          ...input,
        }),
        signal: AbortSignal.timeout(40000),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'บันทึกไม่สำเร็จ')
      requests.current.delete(key)
      setVersion((previous) => previous + 1)
      setNotice('บันทึกรายการจัดส่งแล้ว')
      return result
    },
    [tenantId],
  )
  const sessionRows = data.shipments.filter(
    (shipment) => session !== 'legacy' || !shipment.live_session_id,
  )
  const rows = sessionRows.filter(
    (shipment) =>
      status === 'all' ||
      (status === 'printed' ? !!shipment.label_printed_at : shipment.fulfillment_status === status),
  )
  const targets = selected.length
    ? sessionRows.filter((shipment) => selected.includes(shipment.id))
    : rows
        .filter(
          (shipment) => shipment.fulfillment_status === 'ready_to_ship' && shipment.payment_ready,
        )
        .slice(0, 100)
  const validTargets =
    targets.length > 0 &&
    targets.length <= 100 &&
    targets.every(
      (shipment) =>
        ['ready_to_ship', 'shipped'].includes(shipment.fulfillment_status) &&
        shipment.payment_ready,
    )
  async function prepare(format: 'thermal' | 'a4') {
    const opened = window.open('about:blank', '_blank')
    if (opened) opened.opener = null
    setBusy(true)
    setError('')
    try {
      const result = await post({
        action: 'prepare_print',
        ids: targets.map((shipment) => shipment.id),
        format,
      })
      const href = `/shipping/print/${result.batchId}`
      setPrintLink(href)
      if (opened) opened.location.href = href
    } catch (cause) {
      opened?.close()
      setError(cause instanceof Error ? cause.message : 'เตรียมฉลากไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }
  async function exportCsv() {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/shipping/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          requestId: crypto.randomUUID(),
          ids: targets.map((shipment) => shipment.id),
        }),
      })
      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Export ไม่สำเร็จ')
      }
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = `snapbot-${carrier.replace(/[^A-Za-z0-9]/g, '-')}-shipping.csv`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice(
        `ดาวน์โหลด CSV ${targets.length} รายการแล้ว ยังไม่ได้จองขนส่งหรือเปลี่ยนสถานะเป็นส่งแล้ว`,
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Export ไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }
  async function bulk(action: 'dispatch' | 'cancel' | 'restore') {
    setBusy(true)
    setError('')
    try {
      await post({ action, ids: selected })
      setSelected([])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'อัปเดตไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="min-w-0 shrink-0 space-y-5 p-4 md:p-8" data-shipping-dashboard>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <Truck className="h-6 w-6 text-orange-500" />
            ระบบจัดส่งพัสดุ
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            รวมพระจากบิลที่ชำระครบเป็นกล่องเดียว • อัปเดตทุก 5 วินาที {updated && `• ${updated}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className={button}
            type="button"
            onClick={() => setVersion((previous) => previous + 1)}
          >
            <RefreshCw className="h-4 w-4" />
            โหลดใหม่
          </button>
          <button className={button} type="button" onClick={() => setModal({ kind: 'settings' })}>
            <Settings className="h-4 w-4" />
            ตั้งค่าผู้ส่ง
          </button>
        </div>
      </header>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          [
            'รอแจ้ง / ยืนยันที่อยู่',
            sessionRows.filter((row) => row.fulfillment_status === 'pending_address').length,
          ],
          [
            'พร้อมส่ง',
            sessionRows.filter(
              (row) => row.fulfillment_status === 'ready_to_ship' && row.payment_ready,
            ).length,
          ],
          ['พิมพ์ใบปะหน้าแล้ว', sessionRows.filter((row) => row.label_printed_at).length],
          [
            'ส่งพัสดุแล้ว',
            sessionRows.filter((row) => row.fulfillment_status === 'shipped').length,
          ],
        ].map(([label, value]) => (
          <div className="rounded-2xl border border-slate-200 bg-white p-4" key={label}>
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
          </div>
        ))}
      </div>
      <section className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 md:p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-semibold">
            Session ไลฟ์สด
            <select
              aria-label="Session จัดส่ง"
              className={field}
              value={session}
              onChange={(event) => {
                setSession(event.target.value)
                setSelected([])
                setLoading(true)
              }}
            >
              <option value="all">ทุก Session</option>
              <option value="legacy">ออเดอร์นอก Session</option>
              {data.sessions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.live_post_id} • {new Date(item.created_at).toLocaleDateString('th-TH')}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold">
            สถานะการจัดส่ง
            <select
              aria-label="สถานะการจัดส่ง"
              className={field}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value)
                setSelected([])
              }}
            >
              {filters.map((filter) => (
                <option key={filter.id} value={filter.id}>
                  {filter.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={primary}
            disabled={busy || !validTargets}
            onClick={() => setModal({ kind: 'bee' })}
          >
            <Truck className="h-4 w-4" />
            ส่งผ่าน Bee Move / เตรียมไฟล์
          </button>
          <button
            type="button"
            className={button}
            disabled={busy || !validTargets}
            onClick={() => void prepare('thermal')}
          >
            <Printer className="h-4 w-4" />
            พิมพ์สติกเกอร์ 100×150 mm
          </button>
          <button
            type="button"
            className={button}
            disabled={busy || !validTargets}
            onClick={() => void prepare('a4')}
          >
            <Printer className="h-4 w-4" />
            พิมพ์ A4 / 4 รายการ
          </button>
          <button
            type="button"
            className={button}
            disabled={busy || !validTargets}
            onClick={() => void exportCsv()}
          >
            <Download className="h-4 w-4" />
            ดาวน์โหลด CSV สำหรับขนส่ง
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-2 text-xs text-slate-500">
            เลือก {selected.length} รายการ • สูงสุด 100 รายการต่อครั้ง
          </span>
          <button
            type="button"
            className={button}
            disabled={busy || !selected.length}
            onClick={() => void bulk('dispatch')}
          >
            อัปเดตเป็นส่งพัสดุแล้ว
          </button>
          <button
            type="button"
            className={button}
            disabled={busy || !selected.length}
            onClick={() => void bulk('cancel')}
          >
            ลบรายการที่เลือก
          </button>
          <button
            type="button"
            className={button}
            disabled={busy || !selected.length}
            onClick={() => void bulk('restore')}
          >
            คืนรายการ / พร้อมส่งตามเงื่อนไข
          </button>
        </div>
        <p className="text-xs leading-relaxed text-slate-500">
          ถ้าไม่ติ๊กเลือก จะใช้รายการพร้อมส่งที่แสดงสูงสุด 100 รายการ การลบเป็นการยกเลิกรายการจัดส่ง
          ไม่ลบบิลหรือเงินที่ชำระ • CSV มี 10 คอลัมน์และ COD 0 สำหรับนำเข้า Excel
          ให้ตั้งคอลัมน์เบอร์โทรและรหัสไปรษณีย์เป็นข้อความ
        </p>
        {!data.settings && (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            ตั้งค่าชื่อ เบอร์โทร และที่อยู่ผู้ส่งก่อนพิมพ์ใบปะหน้า
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
            {notice}
          </p>
        )}
        {printLink && (
          <a
            className="block text-sm font-semibold text-orange-600 underline"
            href={printLink}
            target="_blank"
            rel="noreferrer"
          >
            เปิดหน้าพิมพ์ที่เตรียมไว้
          </a>
        )}
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="p-3">
                  <input
                    type="checkbox"
                    aria-label="เลือกพัสดุที่แสดง"
                    checked={
                      rows.length > 0 &&
                      rows.slice(0, 100).every((row) => selected.includes(row.id))
                    }
                    onChange={(event) =>
                      setSelected(
                        event.target.checked ? rows.slice(0, 100).map((row) => row.id) : [],
                      )
                    }
                  />
                </th>
                {[
                  'ลูกค้า Facebook',
                  'ผู้รับ / ที่อยู่จัดส่ง',
                  'รายการพระ / ยอดโอน',
                  'สถานะ',
                  'ขนส่ง / เลขพัสดุ',
                  'จัดการ',
                ].map((label) => (
                  <th className="p-3" key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((shipment) => (
                <tr key={shipment.id}>
                  <td className="p-3 align-top">
                    <input
                      type="checkbox"
                      aria-label={`เลือกพัสดุ ${shipment.customer_name}`}
                      checked={selected.includes(shipment.id)}
                      disabled={busy || (!selected.includes(shipment.id) && selected.length >= 100)}
                      onChange={(event) =>
                        setSelected((previous) =>
                          event.target.checked
                            ? [...previous, shipment.id]
                            : previous.filter((id) => id !== shipment.id),
                        )
                      }
                    />
                  </td>
                  <td className="max-w-48 break-words p-3 align-top">
                    <b>{shipment.customer_name}</b>
                    <a
                      href={`/inbox?customer=${shipment.customer_id}`}
                      className="mt-1 block text-xs text-blue-600 underline"
                    >
                      เปิดแช็ต Messenger ใน Inbox
                    </a>
                    <span className="mt-2 block text-[10px] text-slate-400">
                      พัสดุ #{shipment.id.slice(0, 8)}
                    </span>
                  </td>
                  <td className="max-w-72 p-3 align-top">
                    <p className="font-semibold">
                      {shipment.recipient_name || 'รอชื่อผู้รับ'} •{' '}
                      {shipment.phone_number || 'รอเบอร์โทร'}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-600">
                      {shipment.shipping_address || 'รอลูกค้าแจ้งที่อยู่ใน Messenger หรือกรอกเอง'}
                    </p>
                    {shipment.zipcode && (
                      <p className="mt-1 text-xs text-slate-500">
                        {shipment.subdistrict} • {shipment.district} • {shipment.province}{' '}
                        {shipment.zipcode}
                      </p>
                    )}
                  </td>
                  <td className="max-w-56 p-3 align-top">
                    <details>
                      <summary className="cursor-pointer text-xs font-semibold">
                        {shipment.items.length} รายการ • ดูใบจัดของ
                      </summary>
                      {shipment.items.map((item) => (
                        <p key={item.order_id} className="mt-2 break-words text-xs">
                          {item.item_name}
                          <span className="block text-[10px] text-slate-400">{item.order_id}</span>
                        </p>
                      ))}
                    </details>
                    <p className="mt-2 font-semibold">โอนแล้ว ฿{money(shipment.paid_amount)}</p>
                    <span className="text-[10px] text-slate-500">
                      ยอดรับเงินของบิล / ออเดอร์ที่เกี่ยวข้อง
                    </span>
                  </td>
                  <td className="p-3 align-top">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-semibold ${shipment.fulfillment_status === 'shipped' ? 'bg-blue-50 text-blue-700' : shipment.fulfillment_status === 'ready_to_ship' && shipment.payment_ready ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}
                    >
                      {shippingStatus[shipment.fulfillment_status]}
                    </span>
                    {!shipment.payment_ready && shipment.fulfillment_status !== 'cancelled' && (
                      <p className="mt-2 text-xs text-red-600">ยอดเปลี่ยน / รอชำระเพิ่ม</p>
                    )}
                    {shipment.label_printed_at ? (
                      <p className="mt-2 text-xs text-slate-500">
                        เปิดพิมพ์แล้ว {new Date(shipment.label_printed_at).toLocaleString('th-TH')}
                      </p>
                    ) : (
                      shipment.label_print_count > 0 && (
                        <p className="mt-2 text-xs text-red-600">ข้อมูลเปลี่ยน ต้องพิมพ์ฉบับใหม่</p>
                      )
                    )}
                  </td>
                  <td className="w-56 p-3 align-top">
                    <p className="text-xs text-slate-500">{shipment.courier_name}</p>
                    <input
                      aria-label={`Tracking ${shipment.customer_name}`}
                      className={field}
                      maxLength={100}
                      value={tracking[shipment.id] ?? shipment.tracking_number ?? ''}
                      disabled={busy || shipment.fulfillment_status !== 'ready_to_ship'}
                      onChange={(event) =>
                        setTracking((previous) => ({
                          ...previous,
                          [shipment.id]: event.target.value,
                        }))
                      }
                    />
                    <button
                      type="button"
                      className="mt-2 text-xs font-semibold text-orange-700 underline disabled:opacity-40"
                      disabled={
                        busy ||
                        shipment.fulfillment_status !== 'ready_to_ship' ||
                        tracking[shipment.id] === undefined
                      }
                      onClick={async () => {
                        setBusy(true)
                        setError('')
                        try {
                          await post({
                            action: 'edit',
                            ids: [shipment.id],
                            address: addressFromShipment(shipment),
                            courier: shipment.courier_name,
                            tracking: tracking[shipment.id],
                            confirmed: !!shipment.address_confirmed_at,
                            note: shipment.note,
                            revision: Number(shipment.revision),
                          })
                          setTracking((previous) => {
                            const next = { ...previous }
                            delete next[shipment.id]
                            return next
                          })
                        } catch (cause) {
                          setError(
                            cause instanceof Error ? cause.message : 'บันทึกเลขพัสดุไม่สำเร็จ',
                          )
                        } finally {
                          setBusy(false)
                        }
                      }}
                    >
                      บันทึกเลขพัสดุ
                    </button>
                  </td>
                  <td className="p-3 align-top">
                    <button
                      type="button"
                      className={button}
                      onClick={() => setModal({ kind: 'address', shipment })}
                    >
                      {shipment.fulfillment_status === 'shipped' ? 'ดูข้อมูลผู้รับ' : 'แก้ไขผู้รับ'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <p className="p-8 text-center text-sm text-slate-500">
              {loading
                ? 'กำลังโหลดรายการ…'
                : 'ไม่มีรายการในตัวกรองนี้ ระบบสร้างรายการส่งเมื่อชำระบิลครบแล้ว'}
            </p>
          )}
        </div>
      </section>
      {modal?.kind === 'address' && (
        <ShippingAddressModal
          key={modal.shipment.id}
          shipment={modal.shipment}
          post={post}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === 'settings' && (
        <ShippingSettingsModal
          settings={
            data.settings || {
              sender_name: shopName,
              sender_phone: '',
              sender_address: '',
              default_courier: 'Bee Move',
            }
          }
          post={post}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === 'bee' && (
        <SessionDialog
          title="ส่งผ่าน Bee Move / เตรียมไฟล์ขนส่ง"
          onClose={() => setModal(null)}
          busy={busy}
        >
          <p className="text-sm text-slate-600">
            เตรียม {targets.length} รายการที่พร้อมส่ง ใช้ไฟล์ CSV มาตรฐาน 10
            คอลัมน์สำหรับนำเข้าขนส่ง และเลือกขนาดใบปะหน้าได้
          </p>
          <label className="block text-sm font-semibold">
            ตัวเลือกขนส่ง
            <select
              aria-label="ตัวเลือกขนส่ง Export"
              className={field}
              value={carrier}
              onChange={(event) => setCarrier(event.target.value)}
            >
              {COURIERS.map((courier) => (
                <option key={courier}>{courier}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            API Key สำหรับการเชื่อมต่อในอนาคต
            <input
              type="password"
              disabled
              className={field}
              placeholder="ยังไม่เปิดรับหรือบันทึก API Key"
            />
          </label>
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            ขั้นตอนนี้ยังไม่เรียก API และยังไม่จองขนส่ง นำ CSV ไปอัปโหลดกับขนส่ง
            แล้วบันทึกเลขพัสดุที่ได้รับกลับมาที่หน้านี้
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={primary}
              disabled={busy || !validTargets}
              onClick={() => void exportCsv()}
            >
              ดาวน์โหลด CSV
            </button>
            <button
              type="button"
              className={button}
              disabled={busy || !validTargets}
              onClick={() => void prepare('thermal')}
            >
              ฉลาก 100×150 mm
            </button>
            <button
              type="button"
              className={button}
              disabled={busy || !validTargets}
              onClick={() => void prepare('a4')}
            >
              ฉลาก A4
            </button>
          </div>
        </SessionDialog>
      )}
    </div>
  )
}
