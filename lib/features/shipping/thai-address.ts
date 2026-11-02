import { normalizeThaiPhone, validShippingAddress, type ShippingAddress } from './shipping-types'

const thaiDigits = '๐๑๒๓๔๕๖๗๘๙'
/** Conservative extraction only: no invented province, postcode, name or telephone. */
export function parseThaiShippingAddress(input: string): ShippingAddress | null {
  if (!input || input.length > 6000) return null
  const text = input
    .normalize('NFC')
    .replace(/[๐-๙]/g, (digit) => String(thaiDigits.indexOf(digit)))
  const phones = [...text.matchAll(/(?<!\d)(?:\+66[\s.-]?|0)[1-9](?:[\s().-]?\d){7,8}(?!\d)/g)]
    .map((match) => normalizeThaiPhone(match[0]))
    .filter((phone): phone is string => !!phone)
  if (new Set(phones).size !== 1) return null
  const withoutPhone = text.replace(/(?<!\d)(?:\+66[\s.-]?|0)[1-9](?:[\s().-]?\d){7,8}(?!\d)/g, ' ')
  const zips = [...withoutPhone.matchAll(/(?<!\d)[1-9]\d{4}(?!\d)/g)].map((match) => match[0])
  if (new Set(zips).size !== 1) return null
  const capture = (pattern: RegExp) =>
    withoutPhone
      .match(pattern)?.[1]
      ?.trim()
      .replace(/[\s,;]+$/, '') ?? ''
  const subdistrict = capture(
    /(?:ตำบล|ต\.|แขวง)\s*([^\d\n,]+?)(?=\s*(?:อำเภอ|อ\.|เขต|จังหวัด|จ\.|กทม|กรุงเทพ|\d{5}|\n|,|$))/u,
  )
  const district = capture(
    /(?:อำเภอ|อ\.|เขต)\s*([^\d\n,]+?)(?=\s*(?:จังหวัด|จ\.|กทม|กรุงเทพ|\d{5}|\n|,|$))/u,
  )
  let province = capture(/(?:จังหวัด|จ\.)\s*([^\d\n,]+?)(?=\s*(?:รหัสไปรษณีย์|\d{5}|\n|,|$))/u)
  if (!province && /กรุงเทพมหานคร|กรุงเทพฯ|กรุงเทพ|กทม\.?/.test(withoutPhone))
    province = 'กรุงเทพมหานคร'
  const lines = withoutPhone
    .split(/[\n\r]+/)
    .map((line) => line.trim())
    .filter(Boolean)
  const named = text
    .match(
      /(?:^|\n)\s*(?:ชื่อผู้รับ|ผู้รับ|ชื่อ(?:\s*[-–]?\s*สกุล)?)\s*[:：]?\s*([^\n\d]{2,200}?)(?=\s*(?:ที่อยู่|\d|\n|$))/u,
    )?.[1]
    ?.trim()
  const first =
    lines[0]?.replace(/^(?:จัดส่งที่|ส่งที่|ที่อยู่จัดส่ง|ที่อยู่)\s*[:：]?\s*/, '').trim() ?? ''
  const inlineName = first.match(/^([^\d]{2,150}?)\s+(?=\d{1,5}(?:\/|\s))/u)?.[1]?.trim()
  const recipient_name =
    named ||
    (inlineName && !/(?:บ้านเลขที่|ที่อยู่|โอน|เลขบัญชี|ธนาคาร)/.test(inlineName)
      ? inlineName
      : '') ||
    (/^[^\d]{2,200}$/.test(first) &&
    (first.split(/\s+/).length >= 2 || /^(?:นาย|นาง|นางสาว|คุณ|ดร\.)/.test(first)) &&
    !/(?:ตำบล|แขวง|อำเภอ|จังหวัด|โอน|เลขบัญชี|ธนาคาร|สวัสดี|ขอบคุณ|ขอแจ้ง|ตามนี้|ครับ|ค่ะ)/.test(
      first,
    )
      ? first
      : '')
  const addressLines = lines
    .filter(
      (line) =>
        line !== recipient_name && !/^(?:โทร|โทรศัพท์|เบอร์(?:โทร)?)\s*[:：]?\s*$/.test(line),
    )
    .map((line) => line.replace(/^(?:ที่อยู่จัดส่ง|ที่อยู่|จัดส่งที่|ส่งที่)\s*[:：]?\s*/, ''))
  const shipping_address = addressLines
    .join('\n')
    .replace(/(?:ชื่อผู้รับ|ผู้รับ|ชื่อ)\s*[:：]?[^\n]+\n/u, '')
    .replace(new RegExp(`^${recipient_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`), '')
    .trim()
  const result: ShippingAddress = {
    recipient_name,
    phone_number: phones[0],
    shipping_address,
    subdistrict,
    district,
    province,
    zipcode: zips[0] ?? '',
  }
  // A street/house number and all locality levels are required before auto-saving.
  return /\d/.test(shipping_address.replace(result.zipcode, '')) && validShippingAddress(result)
    ? result
    : null
}
export const isShippingConfirmation = (text: string) =>
  /^(?:ยืนยันที่อยู่|ที่อยู่ถูกต้อง|ยืนยันที่อยู่จัดส่ง)[\s.!ๆ]*$/u.test(text.trim())
export function addressConfirmationText(address: ShippingAddress) {
  return `ขอทวนที่อยู่จัดส่งครับ\nผู้รับ: ${address.recipient_name}\nโทร: ${address.phone_number}\n${address.shipping_address}\n\nหากถูกต้อง กด “ยืนยันที่อยู่” หรือพิมพ์ ยืนยันที่อยู่ ครับ หากต้องการแก้ กรุณาส่งชื่อ ที่อยู่ และเบอร์โทรใหม่ให้ครบถ้วน`
}
