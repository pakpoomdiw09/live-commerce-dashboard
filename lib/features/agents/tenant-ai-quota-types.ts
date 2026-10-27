export type TenantAiQuota = { limit: number; used: number; remaining: number }

export function tenantAiQuota(row: {
  ai_quota_limit?: unknown
  ai_quota_used?: unknown
}): TenantAiQuota {
  const limit = row.ai_quota_limit,
    used = row.ai_quota_used
  if (
    typeof limit !== 'number' ||
    !Number.isSafeInteger(limit) ||
    limit < 0 ||
    typeof used !== 'number' ||
    !Number.isSafeInteger(used) ||
    used < 0
  )
    throw new Error('TENANT_AI_QUOTA_UNAVAILABLE: apply supabase/tenant-ai-quota.sql')
  return { limit, used, remaining: Math.max(0, limit - used) }
}
