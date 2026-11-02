import type { ShippingShipment } from './shipping-types'

export const SHIPPING_CSV_HEADERS = [
  'ชื่อผู้รับ (Recipient Name)',
  'เบอร์โทรศัพท์ (Phone Number)',
  'ที่อยู่จัดส่งฉบับเต็ม (Address)',
  'ตำบล/แขวง (Subdistrict)',
  'อำเภอ/เขต (District)',
  'จังหวัด (Province)',
  'รหัสไปรษณีย์ (Zipcode)',
  'รายการสินค้า/เลขออเดอร์ (Items / Order ID)',
  'ยอดเก็บเงินปลายทาง COD',
  'หมายเหตุ (Remark)',
] as const
export function csvCell(value: unknown) {
  let text = String(value ?? '').replace(/\u0000/g, '')
  if (/^[\s\uFEFF]*[=+@-]/u.test(text) || /^[\t\r]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}
/** UTF-8 BOM, CRLF and quoted cells; raw numeric-looking strings keep carrier imports compatible. */
export function shippingCsv(shipments: ShippingShipment[]) {
  return (
    '\uFEFF' +
    [
      SHIPPING_CSV_HEADERS.map(csvCell).join(','),
      ...shipments.map((shipment) =>
        [
          shipment.recipient_name,
          shipment.phone_number,
          shipment.shipping_address,
          shipment.subdistrict,
          shipment.district,
          shipment.province,
          shipment.zipcode,
          shipment.items.map((item) => `${item.item_name} [${item.order_id}]`).join('; '),
          '0',
          shipment.note || `SnapBot ${shipment.id}`,
        ]
          .map(csvCell)
          .join(','),
      ),
    ].join('\r\n') +
    '\r\n'
  )
}
