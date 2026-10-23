export const PAYMENT_PRO_FLAGS = [
  'riskEngine',
  'duplicateDetection',
  'orderMatching',
  'autoConfirmation',
  'messengerAutomation',
  'followUpIntegration',
  'advancedDashboard',
  'analytics',
] as const
export type PaymentProFlag = (typeof PAYMENT_PRO_FLAGS)[number]
export type PaymentProFlags = Record<PaymentProFlag, boolean>
export function paymentReportFilters(
  range: string | null = '30',
  query: string | null = '',
  now = new Date(),
) {
  const days = range ?? '30',
    q = (query ?? '').trim()
  if (!['7', '30', '90'].includes(days) || q.length > 100) throw new Error('INVALID_REPORT_FILTER')
  const day = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
  return {
    days,
    q,
    from: new Date(
      new Date(day + 'T00:00:00+07:00').getTime() - (Number(days) - 1) * 86400000,
    ).toISOString(),
    to: now.toISOString(),
  }
}
export const DEFAULT_PAYMENT_PRO_FLAGS: PaymentProFlags = {
  riskEngine: false,
  duplicateDetection: false,
  orderMatching: false,
  autoConfirmation: false,
  messengerAutomation: false,
  followUpIntegration: false,
  advancedDashboard: false,
  analytics: false,
}
export type PaymentProState =
  'PENDING' | 'VERIFYING' | 'VERIFIED' | 'REVIEW_REQUIRED' | 'REJECTED' | 'CANCELLED'
const transitions: Record<PaymentProState, readonly PaymentProState[]> = {
  PENDING: ['VERIFYING', 'CANCELLED'],
  VERIFYING: ['VERIFIED', 'REVIEW_REQUIRED', 'REJECTED'],
  REVIEW_REQUIRED: ['VERIFYING', 'VERIFIED', 'REJECTED', 'CANCELLED'],
  VERIFIED: [],
  REJECTED: [],
  CANCELLED: [],
}
export const canTransition = (current: PaymentProState, next: PaymentProState) =>
  transitions[current]?.includes(next) ?? false
export function assertTransition(current: PaymentProState, next: PaymentProState) {
  if (!canTransition(current, next))
    throw new Error(`Invalid payment transition: ${current} -> ${next}`)
}
/** Decimal input to integer satang. No floating point equality or rounding of fractional satang. */
export function amountSatang(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(String(value))
  if (!match) return null
  const result = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  return Number.isSafeInteger(result) && result > 0 ? result : null
}
export type VerificationInput = {
  providerVerified: boolean
  transactionRef?: string
  expectedAmountSatang: number | null
  verifiedAmountSatang: number | null
  receiverMatches: boolean
  duplicateTransaction: boolean
  providerError?: boolean
}
export function evaluatePayment(input: VerificationInput): {
  decision: 'VERIFIED' | 'REVIEW_REQUIRED' | 'REJECTED'
  reason: string
} {
  if (input.duplicateTransaction) return { decision: 'REJECTED', reason: 'DUPLICATE_TRANSACTION' }
  if (input.providerError) return { decision: 'REVIEW_REQUIRED', reason: 'PROVIDER_ERROR' }
  if (!input.providerVerified)
    return { decision: 'REVIEW_REQUIRED', reason: 'NOT_PROVIDER_VERIFIED' }
  if (!input.transactionRef?.trim())
    return { decision: 'REVIEW_REQUIRED', reason: 'MISSING_TRANSACTION_REFERENCE' }
  if (
    !Number.isSafeInteger(input.expectedAmountSatang) ||
    !input.expectedAmountSatang ||
    !Number.isSafeInteger(input.verifiedAmountSatang) ||
    !input.verifiedAmountSatang
  )
    return { decision: 'REVIEW_REQUIRED', reason: 'INVALID_AMOUNT' }
  if (input.expectedAmountSatang !== input.verifiedAmountSatang)
    return { decision: 'REVIEW_REQUIRED', reason: 'AMOUNT_MISMATCH' }
  if (!input.receiverMatches)
    return { decision: 'REVIEW_REQUIRED', reason: 'RECEIVER_NOT_CONFIRMED' }
  return { decision: 'VERIFIED', reason: 'ALL_CHECKS_PASSED' }
}
export function providerPaidAt(raw: unknown): string | null {
  const data = (raw as { data?: Record<string, unknown> } | null)?.data
  if (!data) return null
  if (
    typeof data.transTimestamp === 'string' &&
    /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(data.transTimestamp) &&
    Number.isFinite(Date.parse(data.transTimestamp))
  )
    return new Date(data.transTimestamp).toISOString()
  const date = String(data.transDate ?? ''),
    time = String(data.transTime ?? '')
  if (!/^\d{8}$/.test(date) || !/^\d{2}:\d{2}:\d{2}$/.test(time)) return null
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time}+07:00`
  return Number.isFinite(Date.parse(iso)) ? new Date(iso).toISOString() : null
}
/** Escape formulas as well as CSV separators; exported fields may contain customer-controlled text. */
export function csvCell(value: unknown) {
  const text = String(value ?? '')
  return '"' + (/^[\s]*[=+@-]/.test(text) ? "'" + text : text).replace(/"/g, '""') + '"'
}
