/** Canonical domain states. Legacy database values are adapted, never renamed in place. */
export const LEGACY_SLIP_STATES = ['pending', 'valid', 'amount_mismatch', 'duplicate', 'fake', 'wrong_receiver', 'error'] as const
export type LegacySlipState = typeof LEGACY_SLIP_STATES[number]
export const LEGACY_CUSTOMER_ORDER_STATES = ['new', 'pending_review', 'paid', 'approved', 'shipped'] as const
export type LegacyCustomerOrderState = typeof LEGACY_CUSTOMER_ORDER_STATES[number]
export const PAYMENT_STATES = ['SUCCESS', 'FAILED', 'PENDING_ADMIN', 'DUPLICATE'] as const
export type PaymentState = typeof PAYMENT_STATES[number]
export const CONVERSATION_STATES = ['AI_ACTIVE', 'HUMAN_TAKEN_OVER', 'PAUSED', 'WAITING_APPROVAL'] as const
export type ConversationState = typeof CONVERSATION_STATES[number]
export const ORDER_STATES = ['PENDING_PAYMENT', 'PAID', 'SHIPPED', 'CANCELLED'] as const
export type OrderState = typeof ORDER_STATES[number]

export function paymentState(status: string): PaymentState {
  switch (status) {
    case 'valid': case 'VERIFIED': case 'SUCCESS': return 'SUCCESS'
    case 'duplicate': case 'DUPLICATE': return 'DUPLICATE'
    case 'fake': case 'REJECTED': case 'CANCELLED': case 'FAILED': return 'FAILED'
    default: return 'PENDING_ADMIN'
  }
}
export function conversationState(input: {bot_enabled: boolean; assigned_user_id?: string | null; conversation_status?: string; handover_at?: string | null; agent_opted_out?: boolean}): ConversationState {
  if (input.agent_opted_out || input.conversation_status === 'closed') return 'PAUSED'
  if (input.assigned_user_id) return 'HUMAN_TAKEN_OVER'
  if (input.bot_enabled) return 'AI_ACTIVE'
  return input.handover_at ? 'WAITING_APPROVAL' : 'PAUSED'
}
export function orderState(status: string): OrderState | null {
  switch (status) {
    case 'new': case 'pending_review': case 'pending_payment': return 'PENDING_PAYMENT'
    case 'paid': case 'approved': return 'PAID'
    case 'shipped': return 'SHIPPED'
    case 'cancelled': return 'CANCELLED'
    default: return null
  }
}
