import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { deliverOnce, deliverRichOnce, type Recipient } from '@/lib/features/slips/notify'

/** Text and image have distinct durable keys. A media failure never resends text. */
export async function deliverProductReply(
  db: SupabaseClient,
  recipient: Recipient,
  key: string,
  text: string,
  imageUrl: string | null,
) {
  const sent = await deliverOnce(db, recipient, key, text)
  if (!sent || !imageUrl) return sent
  let url: URL
  try {
    url = new URL(imageUrl.trim())
    if (url.protocol !== 'https:' || url.username || url.password) return sent
  } catch {
    return sent
  }
  try {
    const image = { type: 'image' as const, payload: { url: url.href, is_reusable: true } }
    await deliverRichOnce(
      db,
      recipient,
      `${key}:image`,
      '[รูปสินค้า]',
      [{ attachment: image }],
      'RESPONSE',
      [image],
    )
  } catch (error) {
    // The text is already delivered. Unknown image outcomes are recorded by the
    // durable sender and must not be retried automatically.
    console.warn('[ai/product-image] text delivered; media unavailable', {
      code: (error as { code?: string })?.code ?? 'MEDIA_DELIVERY_FAILED',
      customerId: recipient.id,
    })
  }
  return sent
}
