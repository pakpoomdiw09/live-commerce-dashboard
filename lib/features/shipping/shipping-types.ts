export type ShippingAddress = {
  recipient_name: string
  phone_number: string
  shipping_address: string
  subdistrict: string
  district: string
  province: string
  zipcode: string
}
export type ShippingSettings = {
  sender_name: string
  sender_phone: string
  sender_address: string
  default_courier: string
}
export const SHIPPING_PROVIDERS = [
  'beemove',
  'dmove',
  'flash_express',
  'jnt',
  'thailand_post',
] as const
export type ShippingProvider = (typeof SHIPPING_PROVIDERS)[number]
export const SHIPPING_PROVIDER_LABELS: Record<ShippingProvider, string> = {
  beemove: 'Bee Move',
  dmove: 'DMove (Generic API)',
  flash_express: 'Flash Express',
  jnt: 'J&T Express',
  thailand_post: 'ไปรษณีย์ไทย',
}
export type ShippingIntegrationSummary = {
  provider: ShippingProvider
  api_endpoint: string
  sender_info: { name: string; phone: string; address: string }
  tracking_url_template: string
  weight_kg: number
  is_active: boolean
  is_default: boolean
  credentials_configured: boolean
  last_tested_at: string | null
}
export type ShippingItem = { order_id: string; item_name: string; amount: number }
export type ShippingShipment = ShippingAddress & {
  id: string
  tenant_id: string
  customer_id: string
  customer_tab_id: string | null
  live_session_id: string | null
  customer_name: string
  courier_name: string
  tracking_number: string | null
  tracking_url: string | null
  label_pdf_url: string | null
  fulfillment_status: 'pending_address' | 'ready_to_ship' | 'shipped' | 'cancelled'
  label_printed_at: string | null
  label_print_count: number
  address_confirmed_at: string | null
  revision: number
  created_at: string
  shipped_at: string | null
  paid_amount: number
  payment_ready: boolean
  items: ShippingItem[]
  note: string
}
export type ShippingPrintBatch = {
  id: string
  tenant_id: string
  format: 'thermal' | 'a4'
  sender: ShippingSettings
  shipments: ShippingShipment[]
  created_at: string
  opened_at: string | null
}
export const COURIERS = ['Bee Move', 'Flash Express', 'J&T', 'EMS', 'อื่น ๆ'] as const
export const SHIPPING_FIELDS: readonly {
  key: keyof ShippingAddress
  label: string
  max: number
}[] = [
  { key: 'recipient_name', label: 'ชื่อผู้รับ', max: 200 },
  { key: 'phone_number', label: 'เบอร์โทรศัพท์ผู้รับ', max: 20 },
  { key: 'shipping_address', label: 'ที่อยู่จัดส่งฉบับเต็ม', max: 1200 },
  { key: 'subdistrict', label: 'ตำบล / แขวง', max: 100 },
  { key: 'district', label: 'อำเภอ / เขต', max: 100 },
  { key: 'province', label: 'จังหวัด', max: 100 },
  { key: 'zipcode', label: 'รหัสไปรษณีย์', max: 5 },
]
export function normalizeThaiPhone(value: string) {
  const phone = value.replace(/[\s().-]/g, '').replace(/^\+66/, '0')
  return /^0[1-9]\d{7,8}$/.test(phone) ? phone : null
}
export function validShippingAddress(value: unknown): value is ShippingAddress {
  const address = value as ShippingAddress | null
  return (
    !!address &&
    SHIPPING_FIELDS.every(
      (field) =>
        typeof address[field.key] === 'string' &&
        !!address[field.key].trim() &&
        address[field.key].length <= field.max,
    ) &&
    !!normalizeThaiPhone(address.phone_number) &&
    address.recipient_name.trim().length >= 2 &&
    address.shipping_address.trim().length >= 10 &&
    /^[1-9]\d{4}$/.test(address.zipcode) &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(address.shipping_address)
  )
}
export const emptyAddress = (): ShippingAddress => ({
  recipient_name: '',
  phone_number: '',
  shipping_address: '',
  subdistrict: '',
  district: '',
  province: '',
  zipcode: '',
})
export const shippingMoney = (value: number) =>
  Number(value).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
