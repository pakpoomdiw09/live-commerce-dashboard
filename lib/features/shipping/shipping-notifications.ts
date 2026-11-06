import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pageTokenFor } from '@/lib/integrations/facebook/client'
import { deliverOnce } from '@/lib/features/slips/notify'
import { SHIPPING_PROVIDER_LABELS, type ShippingProvider } from './shipping-types'

type Options = { tenantId?: string; shipmentIds?: string[] }
type Notification = { shipmentId: string; status: 'sent' | 'pending' | 'requires_review' }

/** Drain the transactional outbox for provider creates AND manual dispatch. Never resend ambiguous sends. */
export async function deliverShippingTrackingNotifications(
  db: SupabaseClient,
  options: Options = {},
) {
  let expired = db
    .from('shipping_tracking_deliveries')
    .update({ status: 'requires_review', error_code: 'DELIVERY_LEASE_EXPIRED' })
    .eq('status', 'sending')
    .lt('started_at', new Date(Date.now() - 5 * 60_000).toISOString())
  if (options.tenantId) expired = expired.eq('tenant_id', options.tenantId)
  const recovered = await expired
  if (recovered.error) throw recovered.error
  const defer = async (id: string, reason: string) => {
    const saved = await db
      .from('shipping_tracking_deliveries')
      .update({
        next_attempt_at: new Date(Date.now() + 5 * 60_000).toISOString(),
        error_code: reason,
      })
      .eq('id', id)
      .eq('status', 'pending')
    if (saved.error) throw saved.error
  }
  let query = db
    .from('shipping_tracking_deliveries')
    .select('*')
    .eq('status', 'pending')
    .order('next_attempt_at')
    .order('created_at')
    .limit(options.shipmentIds ? Math.min(options.shipmentIds.length, 100) : 20)
  if (options.tenantId) query = query.eq('tenant_id', options.tenantId)
  if (options.shipmentIds) query = query.in('shipment_id', options.shipmentIds)
  else query = query.lte('next_attempt_at', new Date().toISOString())
  const pending = await query
  if (pending.error) throw pending.error
  const results: Notification[] = []
  for (const delivery of pending.data ?? []) {
    const shipment = await db
      .from('shipping_shipments')
      .select(
        'id,customer_id,fulfillment_status,tracking_number,tracking_url,courier_name,recipient_name',
      )
      .eq('id', delivery.shipment_id)
      .eq('tenant_id', delivery.tenant_id)
      .single()
    if (shipment.error) throw shipment.error
    const row = shipment.data
    if (row.fulfillment_status !== 'shipped' || row.tracking_number !== delivery.tracking_number) {
      const cancelled = await db
        .from('shipping_tracking_deliveries')
        .update({ status: 'cancelled' })
        .eq('id', delivery.id)
        .eq('status', 'pending')
      if (cancelled.error) throw cancelled.error
      continue
    }
    const externalId = `shipping-tracking:${row.id}:${delivery.tracking_number}`
    const recorded = await db
      .from('messages')
      .select('delivery_status')
      .eq('customer_id', row.customer_id)
      .eq('external_id', externalId)
      .maybeSingle()
    if (recorded.error) throw recorded.error
    if (recorded.data) {
      const status = ['sent', 'delivered', 'read'].includes(recorded.data.delivery_status)
        ? 'sent'
        : 'requires_review'
      const saved = await db
        .from('shipping_tracking_deliveries')
        .update({ status, completed_at: new Date().toISOString() })
        .eq('id', delivery.id)
        .eq('status', 'pending')
      if (saved.error) throw saved.error
      const synced = await db
        .from('shipping_provider_jobs')
        .update({ notification_status: status === 'sent' ? 'sent' : 'failed' })
        .eq('shipment_id', row.id)
        .eq('tracking_number', delivery.tracking_number)
        .eq('tenant_id', delivery.tenant_id)
        .eq('status', 'created')
      if (synced.error) throw synced.error
      results.push({ shipmentId: row.id, status })
      continue
    }
    let trackingUrl = delivery.tracking_url || row.tracking_url
    if (!trackingUrl) {
      const integration = await db
        .from('shipping_integrations')
        .select('provider,tracking_url_template')
        .eq('tenant_id', delivery.tenant_id)
        .eq('is_active', true)
      if (integration.error) throw integration.error
      const selected = integration.data?.find(
        (item) => SHIPPING_PROVIDER_LABELS[item.provider as ShippingProvider] === row.courier_name,
      )
      if (selected?.tracking_url_template?.includes('{tracking_number}'))
        trackingUrl = selected.tracking_url_template.replace(
          '{tracking_number}',
          encodeURIComponent(row.tracking_number),
        )
    }
    let validLink = false
    try {
      const url = new URL(trackingUrl)
      validLink = url.protocol === 'https:' && !url.username && !url.password
    } catch {}
    if (!validLink) {
      await defer(delivery.id, 'TRACKING_URL_REQUIRED')
      results.push({ shipmentId: row.id, status: 'pending' })
      continue
    }
    const [tenant, customer] = await Promise.all([
      db
        .from('tenants')
        .select('page_id,page_access_token')
        .eq('id', delivery.tenant_id)
        .eq('is_active', true)
        .single(),
      db
        .from('customers')
        .select('platform,platform_user_id')
        .eq('id', row.customer_id)
        .eq('tenant_id', delivery.tenant_id)
        .single(),
    ])
    if (tenant.error || customer.error) throw tenant.error || customer.error
    const token = pageTokenFor(tenant.data)
    if (
      !token ||
      customer.data.platform !== 'facebook' ||
      !/^\d+$/.test(customer.data.platform_user_id)
    ) {
      await defer(delivery.id, 'MESSENGER_RECIPIENT_UNAVAILABLE')
      results.push({ shipmentId: row.id, status: 'pending' })
      continue
    }
    const claim = await db
      .from('shipping_tracking_deliveries')
      .update({ status: 'sending', started_at: new Date().toISOString() })
      .eq('id', delivery.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (claim.error) throw claim.error
    if (!claim.data) continue
    let status: Notification['status'] = 'sent'
    try {
      const sent = await deliverOnce(
        db,
        { id: row.customer_id, psid: customer.data.platform_user_id, token },
        externalId,
        `📦 แจ้งหมายเลขจัดส่งพัสดุครับ\nคุณ: ${row.recipient_name}\nขนส่ง: ${delivery.courier_name}\nหมายเลขพัสดุ: ${delivery.tracking_number}\nตรวจสอบสถานะพัสดุได้ที่: ${trackingUrl}\nขอบคุณที่อุดหนุนครับ`,
      )
      if (!sent) status = 'requires_review'
    } catch {
      // Policy/lease failures before creating a message are safe to retry on a later worker run.
      const message = await db
        .from('messages')
        .select('delivery_status')
        .eq('customer_id', row.customer_id)
        .eq('external_id', externalId)
        .maybeSingle()
      if (message.error) throw message.error
      status = message.data
        ? ['sent', 'delivered', 'read'].includes(message.data.delivery_status)
          ? 'sent'
          : 'requires_review'
        : 'pending'
    }
    const updated = await db
      .from('shipping_tracking_deliveries')
      .update({
        status,
        completed_at: status === 'pending' ? null : new Date().toISOString(),
        next_attempt_at: new Date(
          Date.now() + (status === 'pending' ? 5 * 60_000 : 0),
        ).toISOString(),
        error_code:
          status === 'sent'
            ? null
            : status === 'pending'
              ? 'DELIVERY_BLOCKED'
              : 'DELIVERY_UNCONFIRMED',
      })
      .eq('id', delivery.id)
      .eq('status', 'sending')
    if (updated.error) throw updated.error
    const job = await db
      .from('shipping_provider_jobs')
      .update({ notification_status: status === 'sent' ? 'sent' : 'failed' })
      .eq('shipment_id', row.id)
      .eq('tracking_number', delivery.tracking_number)
      .eq('tenant_id', delivery.tenant_id)
      .eq('status', 'created')
    if (job.error) throw job.error
    results.push({ shipmentId: row.id, status })
  }
  return results
}
