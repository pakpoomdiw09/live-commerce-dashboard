import type { CustomerTab } from './customer-tab-types'
import type { SessionAutomation } from './session-automation'

export type LiveSession = {
  id: string
  page_id: string
  live_post_id: string
  created_at: string
  ended_at: string | null
  cost_amount: number
  ad_spent: number
  shipping_cost: number
  other_fees?: number
  financial_revision: number
  auction_settings?: SessionAutomation | null
  automation_revision?: number
}
export type SessionRound = {
  id: string
  itemName: string
  price: number
  winner: string | null
  winnerId: string | null
  orderId: string | null
  closedAt: string
  status: string
  orderStatus: string | null
  tabId: string | null
  tabRevision: number | null
}
export type SessionTab = {
  fbId?: string
  matched?: boolean
  note?: string
  noteRevision?: number
  id: string
  customerId: string
  name: string
  total: number
  paid: number
  remaining: number
  credit: number
  shipping: number
  slips: number
  revision: number
  canMessage: boolean
  account?: string | null
  items: { orderId: string; name: string; amount: number }[]
  lastReminder: { status: string; at: string | null; code: string | null } | null
}
export type SessionSnapshot = {
  session: LiveSession
  metrics: {
    comments: number
    matched: number
    matchedPeople?: number
    commenters: number
    slips: number
    paid: number
    remaining: number
    unpaidPeople: number
    partialPeople: number
    profit: number
  }
  rounds: SessionRound[]
  tabs: SessionTab[]
  activeAuction?: { id: string; itemName: string; currentPrice?: number } | null
  slips?: {
    id: string
    name: string
    amount: number
    at: string
    transRef: string | null
    senderName?: string | null
    senderBank?: string | null
  }[]
  commenters?: {
    fbId: string
    customerId?: string | null
    name: string
    at: string
    lastText?: string | null
    comments: number
    matched?: boolean
    note?: string
    noteRevision?: number
  }[]
}
export type SessionProofItem = {
  orderId: string
  name: string
  amount: number
  cancelled: boolean
  source: string
  orderStatus: string
  bidAmount: number | null
  commentId: string | null
  commentText: string | null
  bidAt: string | null
  closeAt: string
  originalTime: boolean | null
}
export type SessionProof = {
  tab: CustomerTab
  items: SessionProofItem[]
  payments: { slipId: string; amount: number; at: string }[]
}
export type SessionBid = {
  id: string
  bidder_id: string
  bidder_name: string | null
  bid_amount: number
  comment_text: string
  created_at: string
}

export const sessionMoney = (value: number) =>
  Number(value).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** Convert to integer satang before adding/subtracting; reject precision silently rounded by Number. */
export function inputMoney(value: unknown, max = 999_999_999_999.99): number | null {
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    !/^\d+(?:\.\d{1,2})?$/.test(String(value))
  )
    return null
  const result = Number(value)
  return Number.isFinite(result) &&
    result >= 0 &&
    result <= max &&
    Number.isSafeInteger(Math.round(result * 100))
    ? result
    : null
}
/** Empty expense fields mean no expense; missing or malformed fields still fail validation. */
export const inputExpense = (value: unknown) =>
  inputMoney(value === '' || value === null ? 0 : value)
export const sumMoney = (values: number[]) =>
  values.reduce((sum, value) => sum + Math.round(Number(value) * 100), 0) / 100
/** Counts use one current cumulative tab per customer, never the number of slips or items. */
export function sessionCustomerStatus(tabs: SessionTab[]) {
  const active = tabs.filter((tab) => Number(tab.total) > 0 || Number(tab.paid) > 0)
  return {
    paid: active.filter((tab) => Number(tab.paid) > 0).length,
    unpaid: active.filter((tab) => Number(tab.paid) <= 0 && Number(tab.remaining) > 0).length,
    full: active.filter((tab) => Number(tab.remaining) <= 0 && Number(tab.credit) <= 0).length,
    short: active.filter((tab) => Number(tab.remaining) > 0).length,
    over: active.filter((tab) => Number(tab.credit) > 0).length,
    assigned: active.filter((tab) => Number(tab.total) > 0).length,
    total: sumMoney(active.map((tab) => Number(tab.total))),
    received: sumMoney(active.map((tab) => Number(tab.paid))),
  }
}
export const sessionProfit = (
  sales: number,
  cost: number,
  ads: number,
  shipping: number,
  fees = 0,
) => sumMoney([sales, -cost, -ads, -shipping, -fees])
export function tabFormula(tab: Pick<SessionTab, 'items' | 'shipping' | 'total'>) {
  const amounts = tab.items.map((item) => Number(item.amount))
  if (amounts.length && Number(tab.shipping) > 0) amounts.push(Number(tab.shipping))
  return amounts.length
    ? `${amounts.map(sessionMoney).join(' + ')} = ${sessionMoney(tab.total)} บาท`
    : '0.00 บาท'
}
export const SESSION_FOLLOWUP_TEMPLATE =
  'สวัสดีครับคุณ {name} ทางร้านขอแจ้งยอดพระเครื่องครับ\n{items}\nยอดต้องโอน: {due}\nโอนแล้ว: {paid} บาท\nยอดค้างสุทธิที่ต้องโอนเพิ่ม: {short} บาท\nขอบพระคุณที่อุดหนุนครับ'
export const SESSION_VARIABLES = ['name', 'due', 'paid', 'short', 'items'].map((key) => ({
  tag: `{${key}}`,
  label: `{${key}}`,
}))
export function validSessionTemplate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !!value.trim() &&
    value.length <= 1500 &&
    [...value.matchAll(/\{([^{}]+)\}/g)].every((match) =>
      SESSION_VARIABLES.some((variable) => variable.tag === match[0]),
    )
  )
}
export function renderSessionFollowup(template: string, tab: SessionTab) {
  const values: Record<string, string> = {
    name: tab.name,
    due: tabFormula(tab),
    paid: sessionMoney(tab.paid),
    short: sessionMoney(tab.remaining),
    items:
      tab.items
        .map((item, index) => `${index + 1}. ${item.name} — ${sessionMoney(item.amount)} บาท`)
        .join('\n') || 'ไม่มีรายการที่ต้องชำระ',
  }
  return template.replace(/\{([^{}]+)\}/g, (match, key: string) => values[key] ?? match)
}
