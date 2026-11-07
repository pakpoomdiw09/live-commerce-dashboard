import {
  SESSION_WINNER_TEMPLATE,
  SESSION_PUBLIC_WINNER_TEMPLATE,
  AUCTION_CLOSE_TEMPLATE,
  storeAuctionTemplate,
  validAuctionTemplate,
} from './auction-templates'

export type SessionAutomation = {
  /** Confirmation keywords are accepted only from the round's current highest bidder. */
  winnerFlow?: 'on_demand' | 'highest_bid'
  keywords: string[]
  closeKeywords?: string[]
  publicReply: boolean
  privateReply: boolean
  auto_accumulate_summary?: boolean
  bidText: string
  privateText: string
  closeText: string
  bankAccountId: string
  countEnabled: boolean
  closeEnabled: boolean
  heartCloses: boolean
}
export const QUICK_AUCTION_CLOSE_EMOJIS = [
  '❌',
  '🛑',
  '⛔',
  '🚫',
  '🏁',
  '🚩',
  '🔨',
  '🔔',
  '⏰',
  '❤️',
  '🖤',
]
export const normalizeCloseKeyword = (text: string) =>
  text.normalize('NFKC').trim().replace(/\s+/g, ' ')
export function defaultSessionAutomation(bankAccountId = ''): SessionAutomation {
  return {
    winnerFlow: 'on_demand',
    keywords: ['1'],
    closeKeywords: [],
    publicReply: true,
    privateReply: true,
    auto_accumulate_summary: true,
    bidText: SESSION_PUBLIC_WINNER_TEMPLATE,
    privateText: SESSION_WINNER_TEMPLATE,
    closeText: AUCTION_CLOSE_TEMPLATE,
    bankAccountId,
    countEnabled: false,
    closeEnabled: true,
    heartCloses: false,
  }
}
export const normalizeBidKeyword = (text: string) =>
  text.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
/** Retained for older saved workspace settings; confirmation always checks the global leader. */
export const isOnDemandWinnerFlow = (settings?: Pick<SessionAutomation, 'winnerFlow'> | null) =>
  settings?.winnerFlow === 'on_demand'

/** Ledger amounts are supplied by the server; this function only builds separate message bodies. */
export function auctionPrivateMessagePlan(input: {
  enabled: boolean
  hasPreviousUnpaid: boolean
  name: string
  item: string
  price: number
  shipping: number
  remaining: number
  paid: number
  items: { name: string; amount: number }[]
  account: string
  link: string
  singleMessage: string
}): string[] {
  if (!input.enabled || !input.hasPreviousUnpaid) return [input.singleMessage]
  const money = (amount: number) =>
    Number(amount).toLocaleString('th-TH', { maximumFractionDigits: 2 })
  const latest = `🏆 ยินดีด้วยครับคุณ ${input.name.slice(0, 100)} ชนะประมูล ${input.item.slice(0, 200)}\nยอดประมูลชิ้นนี้: ${money(input.price)} บาท`
  const footer = `🚚 ค่าจัดส่ง: ${money(input.shipping)} บาท\n${input.paid > 0 ? `โอนแล้ว: ${money(input.paid)} บาท\n` : ''}💰 ยอดรวมสุทธิที่ต้องชำระ: ${money(input.remaining)} บาท\n\n🏦 บัญชีโอนเงิน: ${input.account}\n🔗 ลิงก์ชำระเงิน/แนบสลิป: ${input.link}`
  const title = '📊 สรุปบิลยอดรวมสะสมทั้งหมดของคุณ:'
  const lines: string[] = []
  for (const [index, item] of input.items.entries()) {
    const line = `${index + 1}. ${item.name.slice(0, 100)} — ${money(item.amount)} บาท`
    if ([title, ...lines, line, footer].join('\n').length > 1850) {
      lines.push('ดูรายการสินค้าทั้งหมดในลิงก์บิลด้านล่าง')
      break
    }
    lines.push(line)
  }
  return [latest, [title, ...lines, footer].join('\n')]
}
export function sessionAuctionTemplate(text: string) {
  return storeAuctionTemplate(
    text.replace(/\{(name|item)\}/g, (_, key: string) =>
      key === 'name' ? '{bidder_name}' : '{product_name}',
    ),
  )
}
export function validSessionAutomation(value: unknown): value is SessionAutomation {
  if (!value || typeof value !== 'object') return false
  const v = value as SessionAutomation
  return (
    (v.winnerFlow === undefined || ['on_demand', 'highest_bid'].includes(v.winnerFlow)) &&
    (v.auto_accumulate_summary === undefined || typeof v.auto_accumulate_summary === 'boolean') &&
    ['publicReply', 'privateReply', 'countEnabled', 'closeEnabled', 'heartCloses'].every(
      (key) => typeof v[key as keyof SessionAutomation] === 'boolean',
    ) &&
    typeof v.bankAccountId === 'string' &&
    /^[a-f0-9-]{36}$/i.test(v.bankAccountId) &&
    Array.isArray(v.keywords) &&
    v.keywords.every(
      (k) =>
        typeof k === 'string' &&
        k.length <= 40 &&
        normalizeBidKeyword(k).length > 0 &&
        !/[\r\n{}]/u.test(k),
    ) &&
    (v.closeKeywords === undefined ||
      (Array.isArray(v.closeKeywords) &&
        v.closeKeywords.every(
          (k) =>
            typeof k === 'string' &&
            k.length <= 40 &&
            normalizeBidKeyword(k).length > 0 &&
            !/[\r\n{}]/u.test(k),
        ))) &&
    (['privateText', 'bidText', 'closeText'] as const).every((key) => {
      if (typeof v[key] !== 'string' || v[key].length > 2000) return false
      const enabled = key === 'privateText' ? v.privateReply : v.publicReply
      if (!v[key].trim()) return !enabled
      return validAuctionTemplate(
        sessionAuctionTemplate(v[key]),
        key === 'privateText' ? 'private' : v.closeKeywords ? 'winner-public' : 'public',
      )
    })
  )
}
export function displaySessionTemplate(text: string) {
  const labels: Record<string, string> = {
    bidder_name: 'ชื่อลูกค้า',
    product_name: 'รายการ',
    price: 'ราคา',
    total: 'ยอดรวมสะสม',
    bank_account: 'เลขบัญชี',
    remaining: 'ยอดค้างสุทธิ',
    payment_link: 'ลิงก์ชำระเงิน',
    min_step: 'ราคาเคาะขั้นต่ำ',
    paid: 'ยอดโอนแล้ว',
  }
  return sessionAuctionTemplate(text).replace(/\{([^{}]+)\}/g, (match, key: string) =>
    labels[key] ? `{${labels[key]}}` : match,
  )
}
