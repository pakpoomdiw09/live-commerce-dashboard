import 'server-only'
import generatePayload from 'promptpay-qr'
import { BANKS, findBank } from '@/lib/features/banking/banks'
import type { PaidPlan, PaymentSession } from '@/lib/features/payments/payment-types'

export type PaymentSessionRow = {
  id: string
  tenant_id: string | null
  plan: PaidPlan
  price_baht: number
  credits: number
  status: 'pending' | 'paid'
  requested_by: string | null
  created_at: string
  expires_at: string
  receiver_promptpay_id: string
  receiver_account_no: string
  receiver_account_name: string
  receiver_bank_name: string
  receiver_bank_code: string
}

export const PAYMENT_SESSION_COLUMNS = 'id,tenant_id,plan,price_baht,credits,status,requested_by,created_at,expires_at,receiver_promptpay_id,receiver_account_no,receiver_account_name,receiver_bank_name,receiver_bank_code'

const clean = (value: string | undefined) => (value ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').trim()

/** Receiver snapshots come from server configuration, never the request body. */
export function paymentReceiver() {
  let promptpayId = (clean(process.env.PROMPTPAY_NO) || clean(process.env.NEXT_PUBLIC_PROMPTPAY_ID)
    || clean(process.env.PROMPTPAY_ID) || clean(process.env.NEXT_PUBLIC_PROMPTPAY_NO)).replace(/[+()\s-]/g, '')
  if (/^0066\d{9}$/.test(promptpayId)) promptpayId = `0${promptpayId.slice(4)}`
  else if (/^66\d{9}$/.test(promptpayId)) promptpayId = `0${promptpayId.slice(2)}`
  const bankAccountNo = clean(process.env.BANK_ACCOUNT_NO) || clean(process.env.NEXT_PUBLIC_BANK_ACCOUNT_NO)
  const bankAccountName = clean(process.env.NEXT_PUBLIC_BANK_ACCOUNT_NAME)
  const configuredName = clean(process.env.NEXT_PUBLIC_BANK_NAME)
  const configuredCode = clean(process.env.PAYMENT_BANK_CODE)
  const normalizedCode = /^\d{1,3}$/.test(configuredCode) ? configuredCode.padStart(3, '0') : configuredCode
  const bank = findBank(normalizedCode) ?? BANKS.find((item) => item.name === configuredName) ?? findBank(configuredName)
  const bankName = configuredName || bank?.name || ''
  const bankCode = bank?.slipCode ?? (/^\d{3}$/.test(configuredCode) ? configuredCode : null)
  if (!/^(0\d{9}|\d{13}|\d{15})$/.test(promptpayId) || !/^\d{6,20}$/.test(bankAccountNo.replace(/[\s-]/g, '')) || !bankAccountName || !bankName || !bankCode) {
    throw new Error('Payment receiver configuration is incomplete')
  }
  return { promptpayId, bankAccountNo, bankAccountName, bankName, bankCode }
}

export function publicPaymentSession(row: PaymentSessionRow): PaymentSession {
  if (!row.tenant_id) throw new Error('Payment tenant no longer exists')
  return {
    id: row.id, tenantId: row.tenant_id, plan: row.plan,
    amount: row.price_baht, credits: row.credits,
    createdAt: row.created_at, expiresAt: row.expires_at,
    qrPayload: generatePayload(row.receiver_promptpay_id, { amount: row.price_baht }),
    receiver: {
      promptpayId: row.receiver_promptpay_id, bankAccountNo: row.receiver_account_no,
      bankAccountName: row.receiver_account_name, bankName: row.receiver_bank_name,
    },
  }
}
