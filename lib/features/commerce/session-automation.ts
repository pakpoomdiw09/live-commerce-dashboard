import {
  SESSION_WINNER_TEMPLATE,
  SESSION_PUBLIC_WINNER_TEMPLATE,
  AUCTION_CLOSE_TEMPLATE,
  storeAuctionTemplate,
  validAuctionTemplate,
} from './auction-templates'

export type SessionAutomation = {
  winnerFlow?: 'on_demand' | 'highest_bid'
  keywords: string[]
  closeKeywords?: string[]
  publicReply: boolean
  privateReply: boolean
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
    keywords: [],
    closeKeywords: [],
    publicReply: true,
    privateReply: true,
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
/** Configured keywords request the sender's own bill; they never synthesize a price. */
export const isOnDemandWinnerFlow = (settings?: Pick<SessionAutomation, 'winnerFlow'> | null) =>
  settings?.winnerFlow === 'on_demand'
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
