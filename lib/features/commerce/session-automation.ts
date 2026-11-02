import {
  SESSION_WINNER_TEMPLATE,
  AUCTION_BID_TEMPLATE,
  AUCTION_CLOSE_TEMPLATE,
  storeAuctionTemplate,
  validAuctionTemplate,
} from './auction-templates'

export type SessionAutomation = {
  keywords: string[]
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
export function defaultSessionAutomation(bankAccountId = ''): SessionAutomation {
  return {
    keywords: ['1', '11', '111', '11111', '+1', '+10'],
    publicReply: true,
    privateReply: true,
    bidText: AUCTION_BID_TEMPLATE,
    privateText: SESSION_WINNER_TEMPLATE,
    closeText: AUCTION_CLOSE_TEMPLATE,
    bankAccountId,
    countEnabled: true,
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
    v.keywords.length <= 30 &&
    v.keywords.every(
      (k) =>
        typeof k === 'string' &&
        k.length <= 40 &&
        normalizeBidKeyword(k).length > 0 &&
        !/[\r\n{}]/u.test(k),
    ) &&
    new Set(v.keywords.map(normalizeBidKeyword)).size === v.keywords.length &&
    (['privateText', 'bidText', 'closeText'] as const).every(
      (key) =>
        typeof v[key] === 'string' &&
        validAuctionTemplate(
          sessionAuctionTemplate(v[key]),
          key === 'privateText' ? 'private' : 'public',
        ),
    )
  )
}
