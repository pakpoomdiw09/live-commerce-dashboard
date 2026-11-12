import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CustomerTab } from './customer-tab-types'
import { customerTabItemLabel, customerTabText } from './customer-tab-types'
import { createLiveCfPaymentLink } from './live-cf-payment-link'
import { findBank } from '@/lib/features/banking/banks'

export const TAB_COLUMNS =
  '*,customer_tab_items(*),customer_tab_payments(slip_id,amount,transferred_at)'

export async function enrichCustomerTabs(db: SupabaseClient, tabs: CustomerTab[]) {
  if (!tabs.length) return tabs
  const tenantId = tabs[0].tenant_id
  const result = await db
    .from('orders')
    .select(
      'id,customer_tab_id,source,source_code,status,paid_amount,live_variant_selection_required,live_variant_confirmed_at',
    )
    .eq('tenant_id', tenantId)
    .in(
      'customer_tab_id',
      tabs.map((tab) => tab.id),
    )
  if (result.error) throw result.error
  const orders = new Map((result.data ?? []).map((order) => [order.id, order]))
  return tabs.map((tab) => ({
    ...tab,
    customer_tab_items: tab.customer_tab_items.map((item) => {
      const order = orders.get(item.order_id)
      const requiresVariant =
        !!order?.live_variant_selection_required && !order.live_variant_confirmed_at
      return {
        ...item,
        order_type:
          item.order_type ??
          (order?.source === 'live_auction'
            ? 'auction'
            : order?.source === 'live_comment' ||
                order?.source === 'facebook_comment' ||
                order?.source_code
              ? 'cf'
              : null),
        source_code: item.source_code ?? order?.source_code ?? null,
        requires_variant: requiresVariant,
        selection_link: requiresVariant ? createLiveCfPaymentLink(item.order_id) : null,
        order_status: order?.status ?? null,
        order_paid_amount: Number(order?.paid_amount ?? 0),
        can_cancel:
          order?.status === 'pending_payment' && Number(order?.paid_amount ?? 0) <= 0,
      }
    }),
  }))
}

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
  if (!tab) return null
  return (await enrichCustomerTabs(db, [tab]))[0]
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

/** Bank lookup also serves public winner templates without requiring a payment link. */
export async function customerTabAccount(db: SupabaseClient, tab: CustomerTab) {
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
  return bank.data
    ? `${findBank(bank.data.bank_code)?.name ?? bank.data.bank_code} ${bank.data.account_number} (${bank.data.account_name})`
    : 'กรุณาติดต่อร้านค้าเพื่อยืนยันบัญชีรับเงิน'
}

export async function customerTabSummary(
  db: SupabaseClient,
  tab: CustomerTab,
  greeting?: string,
  includePaymentLink = true,
) {
  tab.customer_tab_items.sort(
    (a, b) => a.closed_at.localeCompare(b.closed_at) || a.order_id.localeCompare(b.order_id),
  )
  const order = tab.customer_tab_items.find((item) => !item.cancelled)
  const link = includePaymentLink && order ? createLiveCfPaymentLink(order.order_id) : null
  if (includePaymentLink && !link) throw new Error('TAB_PAYMENT_LINK_UNAVAILABLE')
  const account = await customerTabAccount(db, tab)
  const text = customerTabText(tab, link ?? '', account, greeting)
  const linkSafeText = includePaymentLink
    ? text
    : text.split('\n').filter((line) => !line.includes('QR /')).join('\n')
  const latest = [...tab.customer_tab_items].reverse().find((item) => !item.cancelled)
  const privateText =
    linkSafeText.length <= 1900
      ? linkSafeText
      : [
          greeting ?? 'สรุปบิลสะสมของคุณครับ',
          latest
            ? `รายการล่าสุด: ${customerTabItemLabel(latest)} ${Number(latest.amount).toLocaleString('th-TH')} บาท`
            : '',
          `ยอดรวมสะสม ${Number(tab.total_amount).toLocaleString('th-TH')} บาท`,
          `ตรวจยอดโอนแล้ว ${Number(tab.paid_amount).toLocaleString('th-TH')} บาท`,
          `ยอดค้างชำระสุทธิ ${Number(tab.remaining_amount).toLocaleString('th-TH')} บาท`,
          account,
          `รายการทั้งหมด / QR / แนบสลิป: ${link}`,
        ]
          .filter(Boolean)
          .filter((line) => includePaymentLink || !line.includes('QR /'))
          .join('\n')
  return { link: link ?? '', text: linkSafeText, privateText, account }
}
