import { randomUUID } from 'node:crypto'

const EVENTS = [
  'system.safe_log',
  'facebook.customer_profile', 'facebook.page_token', 'facebook.page_picture', 'facebook.page_profile',
  'facebook.send_message', 'facebook.comment_reply', 'facebook.private_reply',
  'payment.verify_slip', 'payment.slip_validation', 'payment.proof_save', 'payment.activation',
] as const
const STATUSES = ['started', 'succeeded', 'failed', 'skipped', 'rejected'] as const
const ERRORS = [
  'AUTH_***', 'INPUT_***', 'NETWORK_***', 'RESPONSE_***', 'PROVIDER_***',
  'DB_CONFLICT_***', 'DB_ACCESS_***', 'DB_UNAVAILABLE_***', 'VALIDATION_***', 'UNKNOWN_***',
] as const
export type SafeEventType = typeof EVENTS[number]
export type SafeErrorCode = typeof ERRORS[number]
export type SafeLogMetadata = {
  requestId: string
  eventType: SafeEventType
  status: typeof STATUSES[number] | number
  durationMs: number
  errorCode?: SafeErrorCode
}

export const createLogRequestId = () => randomUUID()

/** Reduce provider codes to fixed categories; never retain the original error. */
export function maskErrorCode(code: unknown): SafeErrorCode {
  if (code === '23505' || code === '40001') return 'DB_CONFLICT_***'
  if (code === '42501') return 'DB_ACCESS_***'
  if (typeof code === 'number' && Number.isSafeInteger(code) && code >= 0) {
    return code === 190 || code === 102 ? 'AUTH_***' : 'PROVIDER_***'
  }
  return 'UNKNOWN_***'
}

/** Build a fresh record so extra fields and custom toJSON methods cannot reach the log. */
export function redactLogMetadata(input: SafeLogMetadata): SafeLogMetadata {
  return {
    requestId: typeof input.requestId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.requestId)
      ? input.requestId : createLogRequestId(),
    eventType: EVENTS.includes(input.eventType) ? input.eventType : 'system.safe_log',
    status: typeof input.status === 'number'
      ? (Number.isInteger(input.status) && input.status >= 100 && input.status <= 599 ? input.status : 'failed')
      : STATUSES.includes(input.status) ? input.status : 'failed',
    durationMs: Number.isFinite(input.durationMs) ? Math.max(0, Math.min(86_400_000, Math.round(input.durationMs))) : 0,
    ...(input.errorCode === undefined ? {} : { errorCode: ERRORS.includes(input.errorCode) ? input.errorCode : 'UNKNOWN_***' }),
  }
}

/** Console and error trackers receive the same sanitized JSON record. */
export function logSafeEvent(input: SafeLogMetadata): void {
  try {
    const metadata = redactLogMetadata(input)
    const entry = JSON.stringify(metadata)
    if (metadata.status === 'failed' || (typeof metadata.status === 'number' && metadata.status >= 500)) console.error(entry)
    else if (metadata.status === 'rejected' || (typeof metadata.status === 'number' && metadata.status >= 400)) console.warn(entry)
    else console.info(entry)
  } catch {
    // Logging failures must not abort message delivery or repeat a payment activation.
  }
}
