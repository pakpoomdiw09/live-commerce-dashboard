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

function externalId(value: unknown): string | undefined {
  if (object(value)) return externalId(value.id)
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value)
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** Canonicalize before enqueue so persistence, deduplication and matching see the same comment. */
export function normalizeCommentChange(event: WebhookObject): WebhookObject {
  if (
    !['feed', 'live_comments', 'live_videos', 'comments'].includes(event.field) ||
    !object(event.value)
  )
    return event
  const v = event.value
  const alternate = event.field === 'live_videos' || event.field === 'comments'
  const item = typeof v.item === 'string' ? v.item.toLowerCase() : null
  if (
    !alternate &&
    event.field !== 'live_comments' &&
    item !== 'comment' &&
    item !== 'live_comment' &&
    !(!item && (v.comment_id != null || object(v.comment)))
  )
    return event
  const author = object(v.from)
    ? v.from
    : object(v.comment?.from)
      ? v.comment.from
      : object(v.sender)
        ? v.sender
        : {}
  const authorId = externalId(author.id ?? v.sender_id)
  const commentId = externalId(v.comment_id ?? v.comment?.id ?? (alternate ? undefined : v.id))
  const message = v.message ?? v.comment?.message ?? v.text
  // Video lifecycle events are not comments merely because they include a title/message.
  if (alternate && (!commentId || !authorId || typeof message !== 'string' || !message.trim()))
    return event
  const postId = externalId(v.post_id ?? v.comment?.post_id)
  const videoId = externalId(v.video_id ?? v.video?.id)
  const liveVideoId = externalId(v.live_video_id)
  return {
    ...event,
    value: {
      ...v,
      comment_id: commentId ?? v.comment_id,
      post_id: postId ?? videoId ?? liveVideoId,
      ...(videoId ? { video_id: videoId } : {}),
      ...(liveVideoId ? { live_video_id: liveVideoId } : {}),
      ...(authorId
        ? { from: { ...author, id: authorId, name: author.name ?? v.sender_name } }
        : {}),
      message,
      item: 'comment',
      // Meta's live_comments payload has no verb: every delivery is a new comment. All other
      // fields must state verb 'add' explicitly (edited/remove/missing are dropped downstream).
      verb:
        v.deleted === true
          ? 'remove'
          : typeof v.verb === 'string'
            ? v.verb.toLowerCase()
            : event.field === 'live_comments'
              ? 'add'
              : v.verb,
    },
  }
}

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
    if (
      !object(entry) ||
      (typeof entry.id === 'number' && !Number.isSafeInteger(entry.id)) ||
      !/^\d{1,64}$/.test(String(entry.id ?? ''))
    )
      throw new WebhookInputError('Invalid Page entry', 400)
    const pageId = String(entry.id)
    for (const [field, kind] of [
      ['messaging', 'message'],
      ['changes', 'change'],
    ] as const) {
      if (entry[field] !== undefined && !Array.isArray(entry[field]))
        throw new WebhookInputError('Invalid event collection', 400)
      for (const original of entry[field] ?? []) {
        let event = original
        if (!object(event)) throw new WebhookInputError('Invalid event', 400)
        // Canonical shape is also persisted by the durable worker. feed/live_comments
        // deliveries of the same comment must share one idempotency key.
        if (kind === 'change') event = normalizeCommentChange(event)
        if (events.length >= WEBHOOK_MAX_EVENTS) throw new WebhookInputError('Too many events', 413)
        const externalId =
          kind === 'message'
            ? event.message?.mid
            : ['feed', 'live_comments', 'live_videos', 'comments'].includes(event.field) &&
                event.value?.item === 'comment'
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
        const sender =
          kind === 'message'
            ? event.message?.is_echo === true && event.sender?.id === pageId
              ? event.recipient?.id
              : event.sender?.id
            : event.value?.from?.id
        const orderingKey =
          kind === 'change' && event.value?.item === 'comment'
            ? `comments:${pageId}`
            : typeof sender === 'string' && /^\d{1,64}$/.test(sender)
              ? sender
              : pageId
        events.push({ pageId, eventKey, orderingKey, kind, payload: event })
      }
    }
  }
  return { raw, hash: createHash('sha256').update(bytes).digest('hex'), events }
}
