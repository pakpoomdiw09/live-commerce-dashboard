import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CustomerTab } from './customer-tab-types'
import { customerTabText } from './customer-tab-types'
import { createLiveCfPaymentLink } from './live-cf-payment-link'
import { findBank } from '@/lib/features/banking/banks'

export const TAB_COLUMNS =
  '*,customer_tab_items(*),customer_tab_payments(slip_id,amount,transferred_at)'
export async function loadCustomerTab(
  db: SupabaseClient,
  id: string,
  tenantId?: string,
): Promise<CustomerTab | null> {
  let query = db.from('customer_tabs').select(TAB_COLUMNS).eq('id', id)
  if (tenantId) query = query.eq('tenant_id', tenantId)
  const result = await query.maybeSingle()
  if (result.error) throw result.error
  const tab = result.data as CustomerTab | null
  if (tab) {
    const orders = await db
      .from('orders')
      .select('id,live_variant_selection_required,live_variant_confirmed_at')
      .eq('customer_tab_id', tab.id)
      .eq('tenant_id', tab.tenant_id)
    if (orders.error) throw orders.error
    for (const item of tab.customer_tab_items) {
      const order = orders.data.find((row) => row.id === item.order_id)
      item.requires_variant =
        !!order?.live_variant_selection_required && !order.live_variant_confirmed_at
      item.selection_link = item.requires_variant ? createLiveCfPaymentLink(item.order_id) : null
    }
  }
  return tab
}

export async function tabForOrder(
  db: SupabaseClient,
  orderId: string,
): Promise<CustomerTab | null> {
  const order = await db
    .from('orders')
    .select('customer_tab_id,tenant_id')
    .eq('id', orderId)
    .maybeSingle()
  if (order.error && ['42703', 'PGRST204'].includes(order.error.code)) return null
  if (order.error) throw order.error
  return order.data?.customer_tab_id
    ? loadCustomerTab(db, order.data.customer_tab_id, order.data.tenant_id)
    : null
}

export async function customerTabSummary(db: SupabaseClient, tab: CustomerTab, greeting?: string) {
  tab.customer_tab_items.sort(
    (a, b) => a.closed_at.localeCompare(b.closed_at) || a.order_id.localeCompare(b.order_id),
  )
  const order = tab.customer_tab_items.find((item) => !item.cancelled)
  const link = order ? createLiveCfPaymentLink(order.order_id) : null
  if (!link) throw new Error('TAB_PAYMENT_LINK_UNAVAILABLE')
  let bankQuery = db
    .from('bank_accounts')
    .select('bank_code,account_name,account_number')
    .eq('tenant_id', tab.tenant_id)
    .eq('is_active', true)
  bankQuery = tab.bank_account_id
    ? bankQuery.eq('id', tab.bank_account_id)
    : bankQuery.eq('is_primary', true)
  const bank = await bankQuery.maybeSingle()
  if (bank.error) throw bank.error
  const account = bank.data
    ? `${findBank(bank.data.bank_code)?.name ?? bank.data.bank_code} ${bank.data.account_number} (${bank.data.account_name})`
    : 'กรุณาติดต่อร้านค้าเพื่อยืนยันบัญชีรับเงิน'
  const text = customerTabText(tab, link, account, greeting)
  const latest = [...tab.customer_tab_items].reverse().find((item) => !item.cancelled)
  const privateText =
    text.length <= 1900
      ? text
      : [
          greeting ?? 'สรุปบิลสะสมพระเครื่องครับ',
          latest
            ? `รายการล่าสุด: ${latest.item_name} ${Number(latest.amount).toLocaleString('th-TH')} บาท`
            : '',
          `ยอดรวมสะสม ${Number(tab.total_amount).toLocaleString('th-TH')} บาท`,
          `ตรวจยอดโอนแล้ว ${Number(tab.paid_amount).toLocaleString('th-TH')} บาท`,
          `ยอดค้างชำระสุทธิ ${Number(tab.remaining_amount).toLocaleString('th-TH')} บาท`,
          account,
          `รายการทั้งหมด / QR / แนบสลิป: ${link}`,
        ]
          .filter(Boolean)
          .join('\n')
  return { link, text, privateText }
}
