import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SlipStatus } from '@/lib/types'

export type BasicOverviewStats = {
  totalSlips: number
  attentionCount: number
  periodTotal: number
  byStatus: Partial<Record<SlipStatus, number>>
  points: { day: string; amount: number; count: number }[]
  attention: {
    id: string
    amount: number | null
    status: SlipStatus
    created_at: string
    customers: { display_name: string | null } | null
  }[]
}
/** Caller verifies tenant membership and slip entitlement before using service role. */
export async function loadBasicOverview(
  db: SupabaseClient,
  tenantId: string,
  now = new Date(),
): Promise<BasicOverviewStats> {
  const { data, error } = await db.rpc('basic_overview_stats', {
    p_tenant: tenantId,
    p_now: now.toISOString(),
  })
  if (
    error ||
    !data ||
    !Array.isArray(data.points) ||
    data.points.length !== 14 ||
    !Array.isArray(data.attention) ||
    data.attention.length > 8 ||
    !Number.isInteger(data.totalSlips)
  ) {
    console.error('[overview/basic] aggregate unavailable', {
      code: error?.code ?? 'INVALID_RESULT',
    })
    throw new Error('โหลดสรุปสลิปไม่สำเร็จ กรุณาลองใหม่หรือติดต่อผู้ดูแล')
  }
  return data as BasicOverviewStats
}
