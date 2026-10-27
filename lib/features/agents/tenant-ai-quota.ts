import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Incoming } from '@/lib/features/agents/chatbot-actions'

async function handoverQuota(db: SupabaseClient, m: Incoming) {
  const result = await db.rpc('handover_tenant_ai_quota', {
    p_tenant: m.tenant.id,
    p_customer: m.customer.id,
    p_message: m.messageId,
  })
  if (result.error || result.data !== true) throw new Error('AI_QUOTA_HANDOVER_FAILED')
  console.info('[ai quota] handover', { tenantId: m.tenant.id, reason: 'quota_exceeded' })
}

export async function reserveAiReplyQuota(
  db: SupabaseClient,
  m: Incoming,
): Promise<{ id?: string; status: string }> {
  const result = await db.rpc('reserve_tenant_ai_reply', {
    p_tenant: m.tenant.id,
    p_customer: m.customer.id,
    p_message: m.messageId,
  })
  if (result.error || typeof result.data?.status !== 'string')
    throw new Error('AI_QUOTA_CHECK_FAILED')
  if (result.data.status === 'quota_exceeded') await handoverQuota(db, m)
  if (result.data.status === 'reserved' && typeof result.data.id !== 'string')
    throw new Error('AI_QUOTA_CHECK_FAILED')
  return result.data
}

export async function authorizeAiReplyQuota(db: SupabaseClient, m: Incoming, reservation: string) {
  const result = await db.rpc('authorize_tenant_ai_reply', { p_reservation: reservation })
  if (result.error || !['authorized', 'blocked', 'quota_exceeded'].includes(result.data))
    throw new Error('AI_QUOTA_CHECK_FAILED')
  if (result.data === 'quota_exceeded') await handoverQuota(db, m)
  return result.data as 'authorized' | 'blocked' | 'quota_exceeded'
}

/** Provider calls are never retried here. SQL reconciles only the durable message outcome. */
export async function settleAiReplyQuota(db: SupabaseClient, reservation: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await db.rpc('settle_tenant_ai_reply', { p_reservation: reservation })
    if (!result.error && ['sent', 'released', 'unknown'].includes(result.data)) return
  }
  console.error('[ai quota] reservation requires reconciliation', { reservation })
}
