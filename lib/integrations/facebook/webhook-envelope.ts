import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export const WEBHOOK_MAX_BYTES = 2 * 1024 * 1024
export const WEBHOOK_MAX_EVENTS = 1000
export type WebhookObject = Record<string, any>
export type FacebookWebhookEvent = {
  pageId: string
  eventKey: string
  orderingKey: string
  kind: 'message' | 'change'
  payload: WebhookObject
}

export class WebhookInputError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export function verifyWebhookSignature(
  bytes: Uint8Array,
  header: string | null,
  secret: string,
): boolean {
  if (!secret || !header || !/^sha256=[a-f0-9]{64}$/i.test(header)) return false
  const expected = createHmac('sha256', secret).update(bytes).digest()
  return timingSafeEqual(expected, Buffer.from(header.slice(7), 'hex'))
}

export async function readWebhookBody(request: Request): Promise<Buffer> {
  const length = request.headers.get('content-length')
  if (length && (!/^\d+$/.test(length) || Number(length) > WEBHOOK_MAX_BYTES))
    throw new WebhookInputError('Payload too large', 413)
  if (!request.body) throw new WebhookInputError('Empty payload', 400)
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > WEBHOOK_MAX_BYTES) {
        await reader.cancel()
        throw new WebhookInputError('Payload too large', 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, size)
}

function object(value: unknown): value is WebhookObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (object(value))
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonical(value[key]))
        .join(',') +
      '}'
    )
  return JSON.stringify(value)
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

export function parseWebhook(bytes: Uint8Array): {
  raw: string
  hash: string
  events: FacebookWebhookEvent[]
} {
  let raw: string, payload: unknown
  try {
    raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    payload = JSON.parse(raw)
  } catch {
    throw new WebhookInputError('Invalid JSON', 400)
  }
  if (!object(payload) || payload.object !== 'page' || !Array.isArray(payload.entry))
    throw new WebhookInputError('Invalid Page payload', 400)
  const events: FacebookWebhookEvent[] = []
  for (const entry of payload.entry) {
    if (!object(entry) || !/^\d{1,64}$/.test(String(entry.id ?? '')))
      throw new WebhookInputError('Invalid Page entry', 400)
    const pageId = String(entry.id)
    for (const [field, kind] of [
      ['messaging', 'message'],
      ['changes', 'change'],
    ] as const) {
      if (entry[field] !== undefined && !Array.isArray(entry[field]))
        throw new WebhookInputError('Invalid event collection', 400)
      for (const event of entry[field] ?? []) {
        if (!object(event)) throw new WebhookInputError('Invalid event', 400)
        if (events.length >= WEBHOOK_MAX_EVENTS) throw new WebhookInputError('Too many events', 413)
        const externalId =
          kind === 'message'
            ? event.message?.mid
            : event.field === 'feed'
              ? event.value?.comment_id
              : undefined
        if (
          externalId !== undefined &&
          (typeof externalId !== 'string' || !externalId || externalId.length > 512)
        )
          throw new WebhookInputError('Invalid event ID', 400)
        const eventKey = externalId
          ? hash(
              `${kind}:${externalId}:${kind === 'change' ? String(event.value?.verb ?? '') : ''}`,
            )
          : hash(`${kind}:${canonical(event)}`)
        const sender = kind === 'message' ? event.sender?.id : event.value?.from?.id
        const orderingKey =
          typeof sender === 'string' && /^\d{1,64}$/.test(sender) ? sender : pageId
        events.push({ pageId, eventKey, orderingKey, kind, payload: event })
      }
    }
  }
  return { raw, hash: createHash('sha256').update(bytes).digest('hex'), events }
}
