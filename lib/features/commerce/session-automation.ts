import {
  SESSION_WINNER_TEMPLATE,
  SESSION_PUBLIC_WINNER_TEMPLATE,
  AUCTION_CLOSE_TEMPLATE,
  storeAuctionTemplate,
  validAuctionTemplate,
} from './auction-templates'

export type SessionAutomation = {
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
export const DEFAULT_AUCTION_CLOSE_KEYWORDS = [
  'ปิด',
  'จบ',
  'พอ',
  '321',
  '3 2 1',
  'x',
  'X',
  '❌',
  '🛑',
  '⛔',
  '🚫',
  '✖️',
  '🏁',
  '🚩',
  '🔨',
  '🔔',
  '⏰',
  '❤️',
  '🖤',
]
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
    keywords: ['1'],
    closeKeywords: [...DEFAULT_AUCTION_CLOSE_KEYWORDS],
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
    ['publicReply', 'privateReply', 'countEnabled', 'closeEnabled', 'heartCloses'].every(
      (key) => typeof v[key as keyof SessionAutomation] === 'boolean',
    ) &&
    typeof v.bankAccountId === 'string' &&
    /^[a-f0-9-]{36}$/i.test(v.bankAccountId) &&
    Array.isArray(v.keywords) &&
    v.keywords.length > 0 &&
    v.keywords.every(
      (k) =>
        typeof k === 'string' &&
        k.length <= 40 &&
        normalizeBidKeyword(k).length > 0 &&
        !/[\r\n{}]/u.test(k),
    ) &&
    new Set(v.keywords.map(normalizeBidKeyword)).size === v.keywords.length &&
    (v.closeKeywords === undefined ||
      (Array.isArray(v.closeKeywords) &&
        v.closeKeywords.length > 0 &&
        v.closeKeywords.every(
          (k) =>
            typeof k === 'string' &&
            k.length <= 40 &&
            normalizeBidKeyword(k).length > 0 &&
            !/[\r\n{}]/u.test(k),
        ) &&
        new Set(v.closeKeywords.map(normalizeCloseKeyword)).size === v.closeKeywords.length &&
        !v.closeKeywords.some((k) =>
          v.keywords.map(normalizeBidKeyword).includes(normalizeBidKeyword(k)),
        ))) &&
    (['privateText', 'bidText', 'closeText'] as const).every(
      (key) =>
        typeof v[key] === 'string' &&
        validAuctionTemplate(
          sessionAuctionTemplate(v[key]),
          key === 'privateText' ? 'private' : v.closeKeywords ? 'winner-public' : 'public',
        ),
    )
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
