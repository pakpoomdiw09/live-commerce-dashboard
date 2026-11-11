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
const disclosurePhrases = [
  'facebook สร้างแชทนี้เนื่องจาก',
  'สร้างแชทนี้เนื่องจาก',
  'ต้องการส่งข้อความส่วนบุคคล ซึ่งอาจเป็นข้อความโปรโมชัน',
]
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{1,64}$/.test(value)

/** Facebook-generated thread disclosures are metadata, not customer chat messages. */
export function isFacebookSystemDisclosure(text: unknown): boolean {
  if (typeof text !== 'string') return false
  const normalized = text.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('th-TH')
  return disclosurePhrases.some((phrase) =>
    normalized.includes(phrase.normalize('NFKC').toLocaleLowerCase('th-TH')),
  )
}

export type FacebookInboundMessage = {
  senderId: string
  messageId: string
  timestamp: number
  occurredAt: string
}

/** Validate Page-to-person echoes separately; they must never count as inbound activity. */
export function facebookMessageEcho(event: unknown, pageId: string, receivedAt: string | number) {
  if (
    !record(event) ||
    !record(event.message) ||
    event.message.is_echo !== true ||
    !record(event.sender) ||
    event.sender.id !== pageId ||
    !record(event.recipient)
  )
    return null
  const { is_echo: _echo, ...message } = event.message
  return facebookInboundMessage(
    { ...event, sender: event.recipient, recipient: event.sender, message },
    pageId,
    receivedAt,
  )
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
  if (isFacebookSystemDisclosure(message.text)) return null
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
