import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SlipRow } from '@/lib/types'

export type SlipHistoryRow = SlipRow & {
  customers: { display_name: string | null } | null
  source: 'slip' | 'standalone'
  standalone?: {
    sender_name: string | null
    sender_bank: string | null
    receiver_name: string | null
    receiver_account: string | null
    trans_timestamp: string
  }
}

type JoinedSlip = SlipRow & {
  customers: { display_name: string | null } | null
  tenants: { page_id: string | null }
}

type StandaloneSlip = {
  id: string
  tenant_id: string
  customer_id: string | null
  message_id: string | null
  trans_ref: string
  amount: number
  sender_name: string | null
  sender_bank: string | null
  receiver_name: string | null
  receiver_account: string | null
  trans_timestamp: string
  created_at: string
  customers: { display_name: string | null } | null
}

/** Lists both slip ledgers for the tenant's currently selected Facebook page. */
export async function loadSlipHistory(
  db: SupabaseClient,
  tenantId: string,
  pageId: string | null,
  limit = 200,
): Promise<SlipHistoryRow[]> {
  if (!pageId) return []
  const [verified, standalone] = await Promise.all([
    db
      .from('slips')
      .select(
        'id,tenant_id,customer_id,message_id,amount,expected_amount,trans_ref,status,note,created_at,verified_at,approved_at,confirmed_at,customers(display_name),tenants!inner(page_id)',
      )
      .eq('tenant_id', tenantId)
      .eq('tenants.page_id', pageId)
      .order('created_at', { ascending: false })
      .limit(limit),
    db
      .from('standalone_slips')
      .select(
        'id,tenant_id,customer_id,message_id,trans_ref,amount,sender_name,sender_bank,receiver_name,receiver_account,trans_timestamp,created_at,customers(display_name),tenants!inner(page_id)',
      )
      .eq('tenant_id', tenantId)
      .eq('tenants.page_id', pageId)
      .order('created_at', { ascending: false })
      .limit(limit),
  ])
  if (verified.error) throw verified.error
  if (standalone.error) throw standalone.error

  const regularRows = (verified.data ?? []) as unknown as JoinedSlip[]
  const standaloneRows = (standalone.data ?? []) as unknown as StandaloneSlip[]
  const rows: SlipHistoryRow[] = [
    ...regularRows.map(({ tenants: _tenant, ...row }) => ({ ...row, source: 'slip' as const })),
    ...standaloneRows.map((row) => ({
      id: `standalone:${row.id}`,
      tenant_id: row.tenant_id,
      customer_id: row.customer_id,
      message_id: row.message_id,
      amount: Number(row.amount),
      expected_amount: null,
      trans_ref: row.trans_ref,
      status: 'valid' as const,
      note: null,
      created_at: row.created_at,
      verified_at: row.created_at,
      approved_at: null,
      confirmed_at: null,
      customers: {
        display_name: row.customers?.display_name ?? row.sender_name,
      },
      source: 'standalone' as const,
      standalone: {
        sender_name: row.sender_name,
        sender_bank: row.sender_bank,
        receiver_name: row.receiver_name,
        receiver_account: row.receiver_account,
        trans_timestamp: row.trans_timestamp,
      },
    })),
  ]

  return rows
    .sort((left, right) => {
      const leftTime = left.verified_at ?? left.created_at
      const rightTime = right.verified_at ?? right.created_at
      return rightTime.localeCompare(leftTime) || left.id.localeCompare(right.id)
    })
    .slice(0, limit)
}
