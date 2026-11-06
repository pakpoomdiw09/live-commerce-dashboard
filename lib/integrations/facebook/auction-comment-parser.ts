export type AuctionComment =
  | { type: 'HOST_CONTROL'; action: 'close' | 'count'; count: string | null }
  | { type: 'OPENING_BID' }
  | { type: 'STEP_BID' }
  | { type: 'CONFIRM_BID' }
  | { type: 'NUMERIC_BID'; amount: number }
  | { type: 'IGNORE' }

/** Intent is deterministic: numbers in opening chatter (10 ลุ้น) are never prices. */
export function parseAuctionComment(
  text: string,
  isHost = false,
  automation?: {
    keywords: string[]
    winnerFlow?: 'on_demand' | 'highest_bid'
    closeKeywords?: string[]
    countEnabled: boolean
    closeEnabled: boolean
    heartCloses: boolean
  } | null,
): AuctionComment {
  const value = text.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
  if (isHost) {
    const closeKeywords = automation?.closeKeywords ?? []
    if (
      automation?.closeEnabled !== false &&
      closeKeywords.some((keyword) => {
        const token = keyword
          .normalize('NFKC')
          .trim()
          .toLowerCase()
          .replace(/\s+/g, ' ')
          .replace(/[\uFE0E\uFE0F]/gu, '')
        return token.length > 0 && value.replace(/[\uFE0E\uFE0F]/gu, '').includes(token)
      })
    )
      return { type: 'HOST_CONTROL', action: 'close', count: null }
    if (automation?.heartCloses && /^(?:❤\uFE0F?|♥\uFE0F?)$/u.test(value))
      return { type: 'HOST_CONTROL', action: 'close', count: null }
    const count = value.match(/^(?:เคาะ\s*)?([123])$/u)?.[1]
    if (count || value === 'นับขิง')
      return automation?.countEnabled === false
        ? { type: 'IGNORE' }
        : { type: 'HOST_CONTROL', action: 'count', count: count ?? 'นับขิง' }
    return { type: 'IGNORE' }
  }
  const matchesKeyword = automation?.keywords.some(
    (word) => word.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ') === value,
  )
  if (automation?.winnerFlow === 'on_demand' && matchesKeyword) return { type: 'CONFIRM_BID' }
  if (
    /^(?:\+|(?:ขอ)?เปิด(?:ให้|ครับ|ค่ะ|คะ)?(?:\s.*)?|เจิม(?:ครับ|ค่ะ|คะ)?(?:\s.*)?)$/u.test(value)
  )
    return { type: 'OPENING_BID' }
  if (matchesKeyword) return { type: 'STEP_BID' }
  // Whole price only; ignore phone numbers, product chatter and malformed grouping.
  if (/^(?:\d{1,9}|\d{1,3}(?:,\d{3}){1,2})(?:\.\d{1,2})?(?:\s*บาท)?$/u.test(value)) {
    const amount = Number(value.replace(/บาท|,|\s/g, ''))
    if (Number.isFinite(amount) && amount > 0 && amount <= 999_999_999)
      return { type: 'NUMERIC_BID', amount }
  }
  return { type: 'IGNORE' }
}
