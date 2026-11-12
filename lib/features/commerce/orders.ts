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
      quantity: number
      unitPrice: number
      subtotal: number
      quantityClamped: boolean
      remainingStock: number | null
      amount: number
      variantLabel: string | null
    }
  | { status: 'sold_out'; name: string; code: string; remainingStock?: number }
  | { status: 'insufficient_stock'; name: string; code: string; remainingStock?: number }
  | { status: 'require_variant'; name: string; code: string }
  | { status: 'no_match' }

type CfOrderRow = {
  r_status: string
  r_order_id: string | null
  r_name: string | null
  r_code: string | null
  r_amount: number | null
  r_variant_label: string | null
  r_quantity?: number | null
  r_unit_price?: number | null
  r_subtotal?: number | null
  r_quantity_clamped?: boolean | null
  r_remaining_stock?: number | null
}

function cfResult(data: unknown): CfResult {
  const row = (Array.isArray(data) ? data[0] : data) as CfOrderRow | undefined
  if (row?.r_status === 'created')
    return {
      status: 'created',
      orderId: row.r_order_id!,
      name: row.r_name!,
      code: row.r_code!,
      quantity: Number(row.r_quantity ?? 1),
      unitPrice: Number(row.r_unit_price ?? row.r_amount),
      subtotal: Number(row.r_subtotal ?? row.r_amount),
      quantityClamped: row.r_quantity_clamped === true,
      remainingStock: row.r_remaining_stock == null ? null : Number(row.r_remaining_stock),
      amount: Number(row.r_subtotal ?? row.r_amount),
      variantLabel: row.r_variant_label ?? null,
    }
  if (row?.r_status === 'sold_out')
    return { status: 'sold_out', name: row.r_name!, code: row.r_code! }
  if (row?.r_status === 'insufficient_stock')
    return {
      status: 'insufficient_stock',
      name: row.r_name!,
      code: row.r_code!,
      ...(row.r_remaining_stock == null ? {} : { remainingStock: Number(row.r_remaining_stock) }),
    }
  if (row?.r_status === 'require_variant')
    return { status: 'require_variant', name: row.r_name!, code: row.r_code! }
  return { status: 'no_match' }
}

/** Place a chat order; product or variant stock is changed atomically in the database. */
async function callCfOrder(db: SupabaseClient, rpc: string, args: Record<string, unknown>) {
  const context = {
    rpc,
    tenantId: args.p_tenant ?? args.p_tenant_id,
    ruleId: args.p_rule,
    commentId: args.p_comment ?? args.p_source_id,
    postId: args.p_post,
    pageId: args.p_page,
    code: args.p_code,
  }
  console.info('[live-cf/order] RPC started', context)
  const { data, error } = await db.rpc(rpc, args)
  if (error) {
    console.error('[live-cf/order] RPC failed', {
      ...context,
      errorCode: error.code,
      hint: error.hint,
    })
    throw Object.assign(new Error('PLACE_CF_ORDER_FAILED'), { code: error.code })
  }
  const result = cfResult(data)
  console.info('[live-cf/order] RPC result', {
    ...context,
    status: result.status,
    reason:
      result.status === 'no_match'
        ? 'PRODUCT_RULE_CODE_OR_SESSION_NOT_FOUND_OR_INACTIVE'
        : result.status === 'sold_out'
          ? 'PRODUCT_VARIANT_OR_RULE_STOCK_EXHAUSTED'
          : result.status === 'require_variant'
            ? 'VARIANT_SELECTION_REQUIRED'
            : 'ORDER_CREATED',
  })
  return result
}

export async function placeCfOrder(
  db: SupabaseClient,
  input: { tenantId: string; customerId: string; code: string } & (
    | { messageId: string; source?: undefined }
    | {
        source: 'live_comment'
        quantity?: number
        commentId: string
        ruleId: string
        postId: string | null
        pageId: string
      }
  ),
): Promise<CfResult> {
  if (input.source === 'live_comment')
    return callCfOrder(db, 'place_live_cf_order', {
      p_tenant: input.tenantId,
      p_customer: input.customerId,
      p_rule: input.ruleId,
      p_code: input.code,
      p_comment: input.commentId,
      p_post: input.postId,
      p_page: input.pageId,
      p_quantity: input.quantity ?? 1,
    })
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
  tenantId: string,
): Promise<{ ids: string[]; total: number; tabIds?: string[] }> {
  let query = db
    .from('orders')
    .select('id, amount, paid_amount, customer_tab_id')
    .eq('customer_id', customerId)
    .eq('tenant_id', tenantId)
    .eq('status', 'pending_payment')
  let { data, error } = await query
  if (error && ['42703', 'PGRST204'].includes(error.code)) {
    let legacy = db
      .from('orders')
      .select('id,amount')
      .eq('customer_id', customerId)
      .eq('tenant_id', tenantId)
      .eq('status', 'pending_payment')
    const fallback = await legacy
    data = fallback.data as typeof data
    error = fallback.error
  }
  if (error) {
    console.error('[orders] pending lookup failed', error.message)
    throw new Error('อ่านยอดรวมออเดอร์ไม่ได้ กรุณาลองอีกครั้ง')
  }
  const rows = data ?? []
  // sum in satang so 0.1 + 0.2 stays 0.30
  const total =
    rows.reduce(
      (s, o) =>
        s +
        Math.max(
          0,
          Math.round(Number(o.amount) * 100) - Math.round(Number(o.paid_amount ?? 0) * 100),
        ),
      0,
    ) / 100
  const tabIds = [
    ...new Set(
      rows.map((o) => o.customer_tab_id as string | null).filter((id): id is string => !!id),
    ),
  ]
  return { ids: rows.map((o) => o.id as string), total, ...(tabIds.length ? { tabIds } : {}) }
}
