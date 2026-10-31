import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { findBank } from '@/lib/features/banking/banks'
import { cfCode } from '@/lib/features/commerce/cf-code'

export { cfCode } from '@/lib/features/commerce/cf-code'

const baht = (n: number) =>
  n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export type CfResult =
  | {
      status: 'created'
      orderId: string
      name: string
      code: string
      amount: number
      variantLabel: string | null
    }
  | { status: 'sold_out'; name: string; code: string }
  | { status: 'require_variant'; name: string; code: string }
  | { status: 'no_match' }

type CfOrderRow = {
  r_status: string
  r_order_id: string | null
  r_name: string | null
  r_code: string | null
  r_amount: number | null
  r_variant_label: string | null
}

function cfResult(data: unknown): CfResult {
  const row = (Array.isArray(data) ? data[0] : data) as CfOrderRow | undefined
  if (row?.r_status === 'created')
    return {
      status: 'created',
      orderId: row.r_order_id!,
      name: row.r_name!,
      code: row.r_code!,
      amount: Number(row.r_amount),
      variantLabel: row.r_variant_label ?? null,
    }
  if (row?.r_status === 'sold_out')
    return { status: 'sold_out', name: row.r_name!, code: row.r_code! }
  if (row?.r_status === 'require_variant')
    return { status: 'require_variant', name: row.r_name!, code: row.r_code! }
  return { status: 'no_match' }
}

/** Place a chat order; product or variant stock is changed atomically in the database. */
async function callCfOrder(db: SupabaseClient, rpc: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(rpc, args)
  if (error)
    throw new Error(
      `place_cf_order failed (did you run supabase/live-cf-variants.sql?): ${error.message}`,
    )
  return cfResult(data)
}

export async function placeCfOrder(
  db: SupabaseClient,
  input: { tenantId: string; customerId: string; messageId: string; code: string },
): Promise<CfResult> {
  return callCfOrder(db, 'place_cf_order', {
    p_tenant: input.tenantId,
    p_customer: input.customerId,
    p_message: input.messageId,
    p_code: input.code,
  })
}

/** Orders from comments are keyed by comment ID and resolve the tenant's Facebook customer by PSID. */
export async function placeCfCommentOrder(
  db: SupabaseClient,
  input: { tenantId: string; customerPsid: string; commentId: string; code: string },
): Promise<CfResult> {
  return callCfOrder(db, 'place_cf_order', {
    p_tenant_id: input.tenantId,
    p_code: input.code,
    p_customer_psid: input.customerPsid,
    p_source: 'facebook_comment',
    p_source_id: input.commentId,
  })
}

export type PayTo = { bank_code: string; account_number: string; account_name: string | null }

/** Order summary + where to pay. Edit the wording here. */
export function orderSummaryText(
  order: { name: string; code: string; amount: number },
  pendingTotal: number,
  payTo: PayTo,
): string {
  const bank = findBank(payTo.bank_code)?.name ?? payTo.bank_code
  return [
    'รับออเดอร์แล้วค่ะ 🧾',
    `สินค้า: ${order.name} (รหัส ${order.code})`,
    `ราคา: ${baht(order.amount)} บาท`,
    ...(pendingTotal > order.amount ? [`ยอดค้างชำระทั้งหมด: ${baht(pendingTotal)} บาท`] : []),
    '',
    `โอนเข้า ${bank}`,
    `เลขที่ ${payTo.account_number}${payTo.account_name ? ` (${payTo.account_name})` : ''}`,
    'โอนแล้วส่งสลิปในแชทนี้ได้เลย ระบบจะตรวจให้อัตโนมัติค่ะ',
  ].join('\n')
}

export const soldOutText = (p: { name: string; code: string }) =>
  `ขออภัยค่ะ ${p.name} (รหัส ${p.code}) หมดแล้ว แอดมินจะแจ้งเมื่อมีของเข้านะคะ`

/** The customer's orders still waiting for payment: a slip from this customer pays for all of them. */
export async function pendingOrders(
  db: SupabaseClient,
  customerId: string,
  tenantId?: string,
): Promise<{ ids: string[]; total: number }> {
  let query = db
    .from('orders')
    .select('id, amount')
    .eq('customer_id', customerId)
    .eq('status', 'pending_payment')
  if (tenantId) query = query.eq('tenant_id', tenantId)
  const { data, error } = await query
  if (error) {
    if (tenantId) throw new Error('อ่านยอดรวมออเดอร์ไม่ได้ กรุณาลองอีกครั้ง')
    // before supabase/orders.sql has run there is no orders table: carry on without orders
    console.error('[orders] pending lookup failed', error.message)
    return { ids: [], total: 0 }
  }
  const rows = data ?? []
  // sum in satang so 0.1 + 0.2 stays 0.30
  const total = rows.reduce((s, o) => s + Math.round(Number(o.amount) * 100), 0) / 100
  return { ids: rows.map((o) => o.id as string), total }
}
