import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { inboundBroadcastEvidence } from './broadcast-policy'

/** Only called after the signature and unique inbound message have been verified. */
export async function recordBroadcastInteraction(db: SupabaseClient, tenantId: string, customerId: string, pageId: string, event: Parameters<typeof inboundBroadcastEvidence>[0]) {
  const evidence = inboundBroadcastEvidence(event, pageId)
  if (!evidence) return
  try {
    const result = await db.from('broadcast_messaging_events').upsert({ ...evidence, tenant_id: tenantId, customer_id: customerId }, { onConflict: 'tenant_id,event_id', ignoreDuplicates: true })
    if (result.error) console.warn('[broadcast/evidence] not recorded', { code: result.error.code })
  } catch { console.warn('[broadcast/evidence] unavailable') }
}

/** Delivery/read events are evidence, not permission to send another message. */
export async function recordBroadcastReceipt(db: SupabaseClient, tenantId: string, customerId: string, event: { delivery?: { mids?: unknown[] }; read?: { watermark?: number } }) {
  try {
    const mids = event.delivery?.mids?.filter((id): id is string => typeof id === 'string').slice(0, 100)
    if (mids?.length) await db.from('broadcast_deliveries').update({ status: 'delivered' }).eq('tenant_id', tenantId).eq('customer_id', customerId).in('provider_message_id', mids).eq('status', 'accepted')
    const watermark = event.read?.watermark
    if (typeof watermark === 'number' && Number.isFinite(watermark) && watermark > 0 && watermark <= Date.now()) await db.from('broadcast_deliveries').update({ status: 'read' }).eq('tenant_id', tenantId).eq('customer_id', customerId).lte('accepted_at', new Date(watermark).toISOString()).in('status', ['accepted', 'delivered'])
  } catch { console.warn('[broadcast/receipt] unavailable') }
}
