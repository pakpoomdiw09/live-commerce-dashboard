/** Shared configuration defaults, never special-case branches in ingestion/matching. */
export const COMMENT_DEFAULTS = {
  confirmationTags: ['1'],
  closingTags: ['ปิด'],
} as const

export const normalizeCommentText = (value: string) =>
  value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .replace(/[\uFE0E\uFE0F]/gu, '')

export function configuredTags(value: unknown, fallback: readonly string[] = []): string[] {
  const tags = Array.isArray(value)
    ? value
        .filter((tag): tag is string => typeof tag === 'string')
        .map(normalizeCommentText)
        .filter(Boolean)
    : []
  return tags.length ? [...new Set(tags)] : [...fallback]
}

export type CommentSettings = {
  mode?: 'auction' | 'cf' | 'auto' | null
  confirmation_keywords?: string[] | null
  closing_keywords?: string[] | null
  confirmation_tags?: string[] | null
  closing_tags?: string[] | null
  keywords?: string[]
  closeKeywords?: string[]
  opening_tags?: string[]
  counting_tags?: Record<string, string>
  public_reply_template?: string
  private_reply_template?: string
  publicReply?: boolean
  privateReply?: boolean
  auction_settings?: CommentSettings | null
  comment_settings?: CommentSettings | null
  [key: string]: unknown
}

/** Keep this order identical to resolve_facebook_comment_settings in Supabase. */
function tagCandidates(
  source: CommentSettings,
  dashboard: string,
  canonical: string,
  alias: string,
) {
  return [
    source.auction_settings?.[dashboard],
    source[dashboard],
    source[canonical],
    source[alias],
    source.comment_settings?.[canonical],
    source.comment_settings?.[alias],
    source.comment_settings?.[dashboard],
    source.auction_settings?.[canonical],
    source.auction_settings?.[alias],
  ]
}

function firstConfiguredTags(candidates: unknown[], fallback: readonly string[]) {
  for (const candidate of candidates) {
    const tags = configuredTags(candidate)
    if (tags.length) return tags
  }
  return configuredTags(fallback)
}

export function resolveCommentSettings(
  session: CommentSettings = {},
  stored: CommentSettings = {},
): CommentSettings & {
  mode: 'auction' | 'cf' | 'auto' | null
  keywords: string[]
  closeKeywords: string[]
  opening_tags: string[]
  counting_tags: Record<string, string>
} {
  const current = { ...session.auction_settings, ...session.comment_settings }
  const settings = { ...stored, ...current, ...session }
  const keywords = firstConfiguredTags(
    [
      ...tagCandidates(session, 'keywords', 'confirmation_keywords', 'confirmation_tags'),
      ...tagCandidates(stored, 'keywords', 'confirmation_keywords', 'confirmation_tags'),
    ],
    COMMENT_DEFAULTS.confirmationTags,
  )
  const closeKeywords = firstConfiguredTags(
    [
      ...tagCandidates(session, 'closeKeywords', 'closing_keywords', 'closing_tags'),
      ...tagCandidates(stored, 'closeKeywords', 'closing_keywords', 'closing_tags'),
    ],
    COMMENT_DEFAULTS.closingTags,
  )
  return {
    ...settings,
    mode: session.mode ?? stored.mode ?? null,
    keywords,
    closeKeywords,
    confirmation_tags: keywords,
    closing_tags: closeKeywords,
    opening_tags: configuredTags(settings.opening_tags),
    counting_tags: Object.fromEntries(
      Object.entries(settings.counting_tags ?? {}).map(([tag, count]) => [
        normalizeCommentText(tag),
        count,
      ]),
    ),
  }
}

/** Reserve the complete billing footer; only merchant-authored introduction text may be cut. */
export function composeBillingMessage(header: string, footer: string, limit = 2000): string {
  const required = footer.normalize('NFC').trim()
  if (required.length > limit) throw new Error('BILLING_FOOTER_TOO_LONG')
  const introduction = header.normalize('NFC').trim()
    .slice(0, Math.max(0, limit - required.length - 2))
    .replace(/[\uD800-\uDBFF]$/u, '').trimEnd()
  return introduction ? `${introduction}\n\n${required}` : required
}

/** Single-pass interpolation; values containing braces never become template instructions. */
export function renderCommentTemplate(template: string, values: Record<string, string>) {
  const aliases: Record<string, string> = {
    customer_name: 'bidder_name',
    item_name: 'product_name',
    total_amount: 'total',
  }
  return template.replace(
    /\{([^{}]+)\}/gu,
    (token, key: string) => values[key] ?? values[aliases[key]] ?? token,
  )
}
