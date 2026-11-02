'use client'
import { useRef, useState } from 'react'
import { SessionDialog } from '@/components/live-cf/SessionDialog'
import {
  COURIERS,
  SHIPPING_FIELDS,
  validShippingAddress,
  type ShippingShipment,
} from '@/lib/features/shipping/shipping-types'
import {
  addressFromShipment,
  shippingField as field,
  shippingButton as button,
  shippingPrimary as primary,
  type ShippingPost,
} from './shipping-ui'

export function ShippingAddressModal({
  shipment,
  post,
  onClose,
}: {
  shipment: ShippingShipment
  post: ShippingPost
  onClose: () => void
}) {
  const [address, setAddress] = useState(addressFromShipment(shipment)),
    [courier, setCourier] = useState(shipment.courier_name)
  const [tracking, setTracking] = useState(shipment.tracking_number || ''),
    [note, setNote] = useState(shipment.note)
  const [confirmed, setConfirmed] = useState(!!shipment.address_confirmed_at),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const request = useRef(crypto.randomUUID())
  const locked = ['shipped', 'cancelled'].includes(shipment.fulfillment_status)
  return (
    <SessionDialog title={`ข้อมูลผู้รับ • ${shipment.customer_name}`} onClose={onClose} busy={busy}>
      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault()
          setBusy(true)
          setError('')
          try {
            await post(
              {
                action: 'edit',
                ids: [shipment.id],
                address,
                courier,
                tracking,
                note,
                confirmed,
                revision: Number(shipment.revision),
              },
              request.current,
            )
            onClose()
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'บันทึกที่อยู่ไม่สำเร็จ')
          } finally {
            setBusy(false)
          }
        }}
      >
        <div className="grid gap-4 md:grid-cols-2">
          {SHIPPING_FIELDS.map((spec) => (
            <label
              key={spec.key}
              className={`text-sm font-medium ${spec.key === 'shipping_address' ? 'md:col-span-2' : ''}`}
            >
              {spec.label}
              {spec.key === 'shipping_address' ? (
                <textarea
                  aria-label={spec.label}
                  rows={3}
                  maxLength={spec.max}
                  required
                  disabled={busy || locked}
                  className={field}
                  value={address[spec.key]}
                  onChange={(event) => {
                    setAddress((previous) => ({ ...previous, [spec.key]: event.target.value }))
                    setConfirmed(false)
                    request.current = crypto.randomUUID()
                  }}
                />
              ) : (
                <input
                  aria-label={spec.label}
                  className={field}
                  required
                  maxLength={spec.max}
                  disabled={busy || locked}
                  inputMode={['phone_number', 'zipcode'].includes(spec.key) ? 'tel' : 'text'}
                  value={address[spec.key]}
                  onChange={(event) => {
                    setAddress((previous) => ({ ...previous, [spec.key]: event.target.value }))
                    setConfirmed(false)
                    request.current = crypto.randomUUID()
                  }}
                />
              )}
            </label>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-medium">
            ขนส่ง
            <select
              aria-label="ขนส่ง"
              className={field}
              value={courier}
              disabled={busy || locked}
              onChange={(event) => {
                setCourier(event.target.value)
                request.current = crypto.randomUUID()
              }}
            >
              {COURIERS.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            เลขพัสดุ Tracking
            <input
              aria-label="เลขพัสดุ Tracking"
              maxLength={100}
              className={field}
              value={tracking}
              disabled={busy || locked}
              onChange={(event) => {
                setTracking(event.target.value)
                request.current = crypto.randomUUID()
              }}
            />
          </label>
        </div>
        <label className="block text-sm font-medium">
          หมายเหตุ
          <input
            aria-label="หมายเหตุจัดส่ง"
            className={field}
            maxLength={500}
            value={note}
            disabled={busy || locked}
            onChange={(event) => {
              setNote(event.target.value)
              request.current = crypto.randomUUID()
            }}
          />
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            aria-label="ตรวจสอบที่อยู่ถูกต้องแล้ว"
            checked={confirmed}
            disabled={busy || locked}
            onChange={(event) => {
              setConfirmed(event.target.checked)
              request.current = crypto.randomUUID()
            }}
          />
          ตรวจสอบกับลูกค้าแล้ว ชื่อ เบอร์โทร และที่อยู่ถูกต้อง พร้อมใช้จัดส่ง
        </label>
        <p className="text-xs text-slate-500">
          ที่อยู่จาก Messenger ต้องให้ลูกค้ากดยืนยัน หรือให้ผู้ดูแลตรวจสอบที่นี่ก่อนออกฉลาก
          การแก้ข้อมูลจะให้เตรียมใบปะหน้าใหม่
        </p>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={button} disabled={busy} onClick={onClose}>
            ปิด
          </button>
          {!locked && (
            <button
              type="submit"
              className={primary}
              disabled={busy || !validShippingAddress(address)}
            >
              {busy ? 'กำลังบันทึก…' : 'บันทึกข้อมูลผู้รับ'}
            </button>
          )}
        </div>
      </form>
    </SessionDialog>
  )
}
