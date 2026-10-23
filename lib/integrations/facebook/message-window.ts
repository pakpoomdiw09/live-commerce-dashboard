const systemEvents = [
  'delivery',
  'read',
  'postback',
  'optin',
  'referral',
  'account_linking',
  'reaction',
  'message_reaction',
  'message_edit',
  'pass_thread_control',
  'take_thread_control',
  'request_thread_control',
] as const
const attachmentTypes = new Set(['image', 'audio', 'video', 'file', 'location', 'fallback'])
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{1,64}$/.test(value)

export type FacebookInboundMessage = {
  senderId: string
  messageId: string
  timestamp: number
  occurredAt: string
}

/** The caller must obtain the event and its immutable receipt time from the signature-verified queue. */
export function facebookInboundMessage(
  event: unknown,
  pageId: string,
  receivedAt: string | number,
): FacebookInboundMessage | null {
  if (
    !identifier(pageId) ||
    !record(event) ||
    systemEvents.some((key) => Object.hasOwn(event, key))
  )
    return null
  if (!record(event.sender) || !identifier(event.sender.id) || event.sender.id === pageId)
    return null
  if (!record(event.recipient) || event.recipient.id !== pageId || !record(event.message))
    return null
  const message = event.message
  if (
    ['is_echo', 'is_deleted', 'is_unsupported'].some(
      (key) => Object.hasOwn(message, key) && message[key] !== false,
    )
  )
    return null
  if (typeof message.mid !== 'string' || !message.mid.trim() || message.mid.length > 512)
    return null
  const text = typeof message.text === 'string' && message.text.trim().length > 0
  const media =
    Array.isArray(message.attachments) &&
    message.attachments.some(
      (attachment) =>
        record(attachment) &&
        typeof attachment.type === 'string' &&
        attachmentTypes.has(attachment.type) &&
        record(attachment.payload),
    )
  if (!text && !media) return null
  const timestamp = event.timestamp,
    receiptTime = typeof receivedAt === 'number' ? receivedAt : Date.parse(receivedAt)
  if (
    typeof timestamp !== 'number' ||
    !Number.isSafeInteger(timestamp) ||
    timestamp <= 0 ||
    !Number.isFinite(receiptTime) ||
    timestamp > receiptTime
  )
    return null
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return null
  return {
    senderId: event.sender.id,
    messageId: message.mid,
    timestamp,
    occurredAt: date.toISOString(),
  }
}
