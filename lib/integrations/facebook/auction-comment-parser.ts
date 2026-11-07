import {
  configuredTags,
  normalizeCommentText,
  resolveCommentSettings,
  type CommentSettings,
} from '@/lib/features/commerce/comment-config'

export type AuctionComment =
  | { type: 'HOST_CONTROL'; action: 'close' | 'count'; count: string | null }
  | { type: 'OPENING_BID' }
  | { type: 'STEP_BID' }
  | { type: 'CONFIRM_BID' }
  | { type: 'NUMERIC_BID'; amount: number }
  | { type: 'IGNORE' }

/** One normalization for dashboard tags and inbound comments, including emoji selectors. */
export const normalizeAuctionTag = normalizeCommentText

export function auctionTags(
  tags: readonly string[] | null | undefined,
  fallback: string,
): string[] {
  return configuredTags(tags, [fallback])
}

/** Intent is deterministic: numbers in opening chatter (10 ลุ้น) are never prices. */
export function parseAuctionComment(
  text: string,
  isHost = false,
  automation?:
    | (CommentSettings & {
        keywords: string[]
        winnerFlow?: 'on_demand' | 'highest_bid'
        closeKeywords?: string[]
        countEnabled: boolean
        closeEnabled: boolean
        heartCloses: boolean
      })
    | null,
): AuctionComment {
  const value = normalizeAuctionTag(text)
  const settings = resolveCommentSettings({}, automation ?? {})
  if (isHost) {
    if (automation?.closeEnabled !== false && settings.closeKeywords.includes(value))
      return { type: 'HOST_CONTROL', action: 'close', count: null }
    // Counting remains separate from closing; configured closing tags take precedence.
    const count = settings.counting_tags[value]
    if (count)
      return automation?.countEnabled === false
        ? { type: 'IGNORE' }
        : { type: 'HOST_CONTROL', action: 'count', count }
    return { type: 'IGNORE' }
  }
  const matchesKeyword = settings.keywords.includes(value)
  if (matchesKeyword) return { type: 'CONFIRM_BID' }
  if (settings.opening_tags.includes(value)) return { type: 'OPENING_BID' }
  // Whole price only; ignore phone numbers, product chatter and malformed grouping.
  if (/^(?:\d{1,9}|\d{1,3}(?:,\d{3}){1,2})(?:\.\d{1,2})?(?:\s*บาท)?$/u.test(value)) {
    const amount = Number(value.replace(/บาท|,|\s/g, ''))
    if (Number.isFinite(amount) && amount > 0 && amount <= 999_999_999)
      return { type: 'NUMERIC_BID', amount }
  }
  return { type: 'IGNORE' }
}
