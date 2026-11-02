import {
  SHIPPING_FIELDS,
  type ShippingAddress,
  type ShippingShipment,
} from '@/lib/features/shipping/shipping-types'
export const shippingField =
  'mt-1 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-50 disabled:text-slate-500'
export const shippingButton =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50'
export const shippingPrimary =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50'
const courierNames: Record<string, string> = {
  'Flash Express': 'แฟลช เอ็กซ์เพรส',
  'J&T': 'เจแอนด์ที',
  EMS: 'ไปรษณีย์ไทย',
  'Bee Move': 'Bee Move',
}
export const courierLabel = (name: string) => courierNames[name] ?? name
export const addressHelp: Record<string, string> = {
  recipient_name: 'ชื่อผู้รับตามที่ลูกค้าแจ้ง',
  phone_number: 'เบอร์โทรที่ขนส่งติดต่อผู้รับได้',
  shipping_address: 'ระบุบ้านเลขที่ ถนน ตำบล อำเภอ จังหวัด และรหัสไปรษณีย์ให้ครบ',
  subdistrict: 'ชื่อตำบลหรือแขวงของผู้รับ',
  district: 'ชื่ออำเภอหรือเขตของผู้รับ',
  province: 'จังหวัดที่จัดส่ง',
  zipcode: 'รหัสไปรษณีย์ 5 หลักของผู้รับ',
}
export type ShippingPost = (
  input: Record<string, unknown>,
  requestId?: string,
) => Promise<{ ok: boolean; batchId?: string }>
export const addressFromShipment = (shipment: ShippingShipment): ShippingAddress =>
  Object.fromEntries(
    SHIPPING_FIELDS.map((field) => [field.key, shipment[field.key] || '']),
  ) as ShippingAddress
export const shippingStatus: Record<string, string> = {
  pending_address: 'รอแจ้ง / ยืนยันที่อยู่',
  ready_to_ship: 'พร้อมส่ง',
  shipped: 'ส่งพัสดุแล้ว',
  cancelled: 'ยกเลิกรายการส่ง',
}
