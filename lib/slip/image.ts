import 'server-only'
import type { Attachment } from '@/lib/types'
import { SLIP_IMAGE_TYPES, SLIP_MAX_BYTES } from './process'

/** Image attachments that could be slips. Stickers also arrive as images, so skip anything with a sticker_id. */
export const slipCandidates = (attachments: Attachment[] | null | undefined) =>
  (attachments ?? []).filter((a) => a.type === 'image' && !a.payload?.sticker_id && a.payload?.url).map((a) => a.payload!.url!)

/** Download a Messenger attachment (a public, short-lived CDN link). null when it isn't a usable slip image. */
export async function downloadSlipImage(url: string): Promise<File | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) {
      console.error('could not download slip image', res.status)
      return null
    }
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim()
    const blob = await res.blob()
    if (!SLIP_IMAGE_TYPES.includes(type) || blob.size === 0 || blob.size > SLIP_MAX_BYTES) return null
    return new File([blob], 'slip', { type })
  } catch (e) {
    // timeout or network error: same as an expired link
    console.error('could not download slip image', e)
    return null
  }
}
