import { crc16, qrFields } from '@/lib/features/payments/payment-codes-core'

/** Validate a receiving QR, not payment evidence. The registered account verifies slip receivers. */
export function validateBankQrPayload(payload: string): string {
  if (
    typeof payload !== 'string' ||
    new TextEncoder().encode(payload).length > 2048 ||
    !/6304[0-9a-f]{4}$/i.test(payload)
  )
    throw new Error('กรุณาใช้ QR รับเงินจากแอปธนาคาร')
  const root = qrFields(payload)
  if (
    root.get('00') !== '01' ||
    root.get('53') !== '764' ||
    root.get('58') !== 'TH' ||
    crc16(new TextEncoder().encode(payload.slice(0, -4))) !== payload.slice(-4).toUpperCase()
  )
    throw new Error('QR รับเงินไม่ถูกต้อง กรุณาใช้รูปต้นฉบับจากแอปธนาคาร')
  const merchant = root.get('29') ?? root.get('30')
  if (!merchant || !qrFields(merchant).get('00')?.startsWith('A000000677'))
    throw new Error('รูปนี้ไม่ใช่ QR รับเงินที่รองรับ กรุณาใช้ QR รับเงินจากแอปธนาคาร')
  return payload
}

export type BankQrAccount = {
  id: string
  bank_code: string
  account_name: string
  account_number: string
  is_active: boolean
  is_primary: boolean
}
export type BankQrState = { account: BankQrAccount | null; hasQr: boolean; version: number }
