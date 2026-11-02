'use client'
import { QRCodeSVG } from 'qrcode.react'
import type { ShippingSettings, ShippingShipment } from '@/lib/features/shipping/shipping-types'

export function ShippingLabel({
  shipment,
  sender,
}: {
  shipment: ShippingShipment
  sender: ShippingSettings
}) {
  return (
    <article className="shipping-label" aria-label={`ใบปะหน้า ${shipment.recipient_name}`}>
      <div className="label-brand">
        <strong>SnapBot</strong>
        <span>{shipment.courier_name} • ชำระแล้ว / COD 0</span>
      </div>
      <div className="label-sender">
        <b>ผู้ส่ง: {sender.sender_name}</b> • {sender.sender_phone}
        <div>{sender.sender_address}</div>
      </div>
      <div className="label-recipient">
        <span>ผู้รับ</span>
        <h2>{shipment.recipient_name}</h2>
        <strong className="label-phone">{shipment.phone_number}</strong>
        <p className={shipment.shipping_address.length > 350 ? 'long-address' : ''}>
          {shipment.shipping_address}
        </p>
        <b>
          {shipment.subdistrict} • {shipment.district} • {shipment.province} {shipment.zipcode}
        </b>
      </div>
      <div className="label-pick">
        <b>รายการจัดของ {shipment.items.length} รายการ</b>
        {shipment.items.slice(0, 5).map((item) => (
          <div key={item.order_id}>
            {item.item_name} <span>#{item.order_id.slice(0, 8)}</span>
          </div>
        ))}
        {shipment.items.length > 5 && (
          <b>และอีก {shipment.items.length - 5} รายการ — ตรวจรายการทั้งหมดในหน้า Shipping / CSV</b>
        )}
        {shipment.note && <div>หมายเหตุ: {shipment.note.slice(0, 120)}</div>}
      </div>
      <footer className="label-footer">
        <QRCodeSVG value={`SNAPBOT-PARCEL:${shipment.id}`} size={76} level="M" />
        <div>
          <b>พัสดุ #{shipment.id.slice(0, 8).toUpperCase()}</b>
          <span>
            {shipment.tracking_number
              ? `Tracking: ${shipment.tracking_number}`
              : 'เลขอ้างอิงจัดของ SnapBot'}
          </span>
          <small>{shipment.id}</small>
        </div>
      </footer>
    </article>
  )
}
