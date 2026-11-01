import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { commerceFlag } from '@/lib/features/commerce/commerce-core'
import {
  handleInboundProductMessage,
  type MessengerProduct,
} from '@/lib/features/commerce/messenger-product'
import {
  BotDeliveryBlockedError,
  deliverRichOnce,
  type Recipient,
} from '@/lib/features/slips/notify'
import { InboxAutomationWindowError } from '@/lib/features/inbox/inbox-automation-window'

export async function replyToMessengerProduct(
  db: SupabaseClient,
  tenantId: string,
  recipient: Recipient,
  messageId: string,
  text: unknown,
) {
  if (!commerceFlag('STOREFRONT_V2_ENABLED')) return false
  const rawOrigin =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  const appOrigin =
    rawOrigin && (/^https?:\/\//i.test(rawOrigin) ? rawOrigin : `https://${rawOrigin}`)
  return handleInboundProductMessage(text, {
    appOrigin,
    findProduct: async (code) => {
      const result = await db.rpc('messenger_product_lookup', { p_tenant: tenantId, p_code: code })
      // An older database can still run its ordinary chat until the additive migration is installed.
      if (result.error?.code === 'PGRST202' || result.error?.code === '42883') {
        console.warn('[messenger/product] lookup migration not installed', { tenantId })
        return null
      }
      if (result.error) throw result.error
      return (result.data?.[0] as MessengerProduct | undefined) ?? null
    },
    sendReply: async (reply) => {
      try {
        await deliverRichOnce(
          db,
          recipient,
          `product:${messageId}`,
          reply.body,
          [reply.message],
          'RESPONSE',
          reply.imageUrl ? [{ type: 'image', payload: { url: reply.imageUrl } }] : [],
        )
      } catch (error) {
        if (error instanceof InboxAutomationWindowError) return
        if (error instanceof BotDeliveryBlockedError && error.reason !== 'delivery_busy') return
        throw error
      }
    },
  })
}
