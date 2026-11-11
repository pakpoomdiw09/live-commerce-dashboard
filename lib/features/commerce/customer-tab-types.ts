export type CustomerTabItem = {
  order_type?: 'auction' | 'cf' | null
  source_code?: string | null
  requires_variant?: boolean
  selection_link?: string | null
  order_id: string
  item_name: string
  variant_label: string | null
  quantity?: number
  item_price?: number
  amount: number
  closed_at: string
  cancelled: boolean
}
export type CustomerTabPayment = { slip_id: string; amount: number; transferred_at: string }
export type CustomerTab = {
  id: string
  tenant_id: string
  customer_id: string
  customer_fb_id: string
  page_id: string
  live_session_id: string
  bank_account_id: string | null
  shipping_fee: number
  total_amount: number
  paid_amount: number
  remaining_amount: number
  credit_amount: number
  status: 'open' | 'pending_payment' | 'fully_paid'
  revision: number
  created_at: string
  updated_at: string
  customer_tab_items: CustomerTabItem[]
  customer_tab_payments: CustomerTabPayment[]
}
export type TabBalance = {
  tabId: string
  totalAmount: number
  paidAmount: number
  remainingAmount: number
  status: string
}
export const tabMoney = (value: number) =>
  Number(value).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function customerTabItemLabel(
  item: Pick<CustomerTabItem, 'item_name' | 'order_type' | 'source_code' | 'quantity' | 'item_price'>,
) {
  const prefix =
    item.order_type === 'auction'
      ? '[ประมูล] '
      : item.order_type === 'cf'
        ? `[CF${item.source_code ? `-${item.source_code.toUpperCase()}` : ''}] `
        : ''
  const quantity = Math.max(1, Number(item.quantity ?? 1))
  const unitPrice = item.item_price == null ? '' : ` (ชิ้นละ ${tabMoney(item.item_price)} บาท)`
  return `${prefix}${item.item_name}${quantity > 1 ? ` x ${quantity}` : ''}${unitPrice}`
}

/** Financial lines are rendered from the ledger, never from model-generated amounts. */
export function customerTabText(
  tab: CustomerTab,
  paymentLink: string,
  account?: string,
  greeting = 'สวัสดีครับ ทางร้านขอแจ้งสรุปรายการพระเครื่องที่รับไว้ครับ',
) {
  return [
    greeting,
    ...tab.customer_tab_items
      .filter((i) => !i.cancelled)
      .map(
        (item, index) =>
          `${index + 1}. ${customerTabItemLabel(item)}${item.variant_label ? ` (${item.variant_label})` : ''} — ${tabMoney(item.amount)} บาท • ${new Date(item.closed_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`,
      ),
    `ค่าจัดส่งครั้งเดียวต่อไลฟ์: ${tabMoney(tab.shipping_fee)} บาท`,
    `ยอดรวมสะสม: ${tabMoney(tab.total_amount)} บาท`,
    `โอนแล้วและตรวจสอบผ่าน: ${tabMoney(tab.paid_amount)} บาท`,
    `ยอดค้างชำระสุทธิที่ต้องโอนเพิ่ม: ${tabMoney(tab.remaining_amount)} บาท`,
    ...(tab.credit_amount > 0 ? [`ยอดโอนเกินคงเหลือ: ${tabMoney(tab.credit_amount)} บาท`] : []),
    account,
    `ดูบิล / QR / แนบสลิป: ${paymentLink}`,
    'โอนบางส่วนได้ครับ ระบบจะหักยอดที่ตรวจสอบผ่านให้ ขอบพระคุณที่อุดหนุนครับ',
    ...(tab.updated_at
      ? [`ยอด ณ ${new Date(tab.updated_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`]
      : []),
  ]
    .filter(Boolean)
    .join('\n')
}

export function splitTabMessage(text: string, limit = 1700): string[] {
  const chunks: string[] = []
  let current = ''
  for (const line of text.split('\n')) {
    for (let offset = 0; offset < Math.max(line.length, 1); offset += limit) {
      const part = line.slice(offset, offset + limit)
      if (current && current.length + part.length + 1 > limit) {
        chunks.push(current)
        current = ''
      }
      current += `${current ? '\n' : ''}${part}`
    }
  }
  if (current) chunks.push(current)
  return chunks
}
