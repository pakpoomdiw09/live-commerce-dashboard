import 'server-only'
import type { Attachment } from '@/lib/types'
import { SLIP_IMAGE_TYPES, SLIP_MAX_BYTES } from '@/lib/features/slips/process'

/** Image attachments that could be slips. Stickers also arrive as images, so skip anything with a sticker_id. */
export const slipCandidates = (attachments: Attachment[] | null | undefined) =>
  (Array.isArray(attachments) ? attachments : [])
    .filter(
      (a) =>
        a?.type === 'image' &&
        !a.payload?.sticker_id &&
        typeof a.payload?.url === 'string' &&
        a.payload.url,
    )
    .map((a) => a.payload!.url!)

/** Download a Messenger attachment (a public, short-lived CDN link). null when it isn't a usable slip image. */
export async function downloadSlipImage(url: string): Promise<File | null> {
  let host = 'invalid_url'
  try {
    const parsed = new URL(url)
    host = parsed.host
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
      throw new Error('UNSAFE_ATTACHMENT_URL')
    console.info('[slip/image] download started', { host })
    const res = await fetch(parsed, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      console.error('[slip/image] download rejected', { host, httpStatus: res.status })
      return null
    }
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim()
    const blob = await res.blob()
    if (!SLIP_IMAGE_TYPES.includes(type) || blob.size === 0 || blob.size > SLIP_MAX_BYTES) {
      console.error('[slip/image] downloaded content is not an allowed slip image', {
        host,
        contentType: type || null,
        bytes: blob.size,
        supportedType: SLIP_IMAGE_TYPES.includes(type),
        withinSizeLimit: blob.size > 0 && blob.size <= SLIP_MAX_BYTES,
      })
      return null
    }
    console.info('[slip/image] download complete', { host, contentType: type, bytes: blob.size })
    return new File([blob], 'slip', { type })
  } catch (error) {
    // timeout or network error: same as an expired link
    console.error('[slip/image] download failed', {
      host,
      errorName: error instanceof Error ? error.name : 'UNKNOWN',
    })
    return null
  }
}
