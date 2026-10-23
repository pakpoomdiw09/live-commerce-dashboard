import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

import { withinStandardMessageWindow } from '@/lib/features/inbox/standard-message-window'

export class InboxAutomationWindowError extends Error {
  readonly code = 'MESSAGING_WINDOW_CLOSED'
  constructor() {
    super('หมดเวลา 24 ชั่วโมง กรุณาส่งแชทให้แอดมินดูแล')
  }
}

export async function assertAutomationWindow(
  db: SupabaseClient,
  customerId: string,
  tenantId?: string,
) {
  const customer = await db
    .from('customers')
    .select('tenant_id,platform')
    .eq('id', customerId)
    .maybeSingle()
  if (customer.error) throw customer.error
  if (
    !customer.data ||
    !customer.data.tenant_id ||
    (tenantId && customer.data.tenant_id !== tenantId)
  )
    throw new InboxAutomationWindowError()
  const tenant = await db
    .from('tenants')
    .select('page_id')
    .eq('id', customer.data.tenant_id)
    .eq('is_active', true)
    .maybeSingle()
  if (tenant.error) throw tenant.error
  if (!tenant.data) throw new InboxAutomationWindowError()
  if (customer.data.platform !== 'facebook') return
  const result = await db
    .from('broadcast_messaging_events')
    .select('interacted_at')
    .eq('tenant_id', customer.data.tenant_id)
    .eq('customer_id', customerId)
    .eq('page_id', tenant.data.page_id)
    .eq('kind', 'inbound_message')
    .order('interacted_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (result.error) throw result.error
  const interactedAt = Date.parse(result.data?.interacted_at ?? '')
  const now = Date.now()
  if (!withinStandardMessageWindow(result.data?.interacted_at, now))
    throw new InboxAutomationWindowError()
}
