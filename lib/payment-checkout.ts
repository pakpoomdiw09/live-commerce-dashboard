import { PLANS } from '@/lib/plans'
import type { PaidPlan, PaymentSession } from '@/lib/payment-types'

/** Requote unpaid cached checkouts after a catalog change; never discard accepted payment proof. */
export function canResumeCheckout(session: PaymentSession, tenantId: string, plan: PaidPlan, status: string, now = Date.now()): boolean {
  if (session.tenantId !== tenantId || session.plan !== plan) return false
  if (status === 'verified' || status === 'paid') return true
  return status === 'pending' && Date.parse(session.expiresAt) > now
    && session.amount === PLANS[plan].price && session.credits === PLANS[plan].credits
}
