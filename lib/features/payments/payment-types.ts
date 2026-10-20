import type { Billing } from '@/lib/features/billing/plans'

export type PaidPlan = 'starter' | 'pro'

export type PaymentSession = {
  id: string
  tenantId: string
  plan: PaidPlan
  amount: number
  credits: number
  createdAt: string
  expiresAt: string
  qrPayload: string
  receiver: { promptpayId: string; bankAccountNo: string; bankAccountName: string; bankName: string }
}

export type PaymentSuccess = { success: true; sessionId: string; billing: Billing }
