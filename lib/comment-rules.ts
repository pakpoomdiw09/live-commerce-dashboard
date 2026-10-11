// Shared by the webhook (matching) and the dashboard (editor preview).

export type MatchType = 'exact' | 'keyword'

export type CommentRule = {
  id: string
  /** the tenant that owns the rule; it only runs on that tenant's Page */
  tenant_id: string | null
  name: string
  page_ids: string[]
  match_type: MatchType
  keywords: string[]
  reply_enabled: boolean
  reply_text: string | null
  inbox_enabled: boolean
  inbox_type: 'text' | 'image'
  inbox_text: string | null
  inbox_image_url: string | null
  is_active: boolean
  created_at: string
}

export const RULE_COLUMNS =
  'id, tenant_id, name, page_ids, match_type, keywords, reply_enabled, reply_text, inbox_enabled, inbox_type, inbox_text, inbox_image_url, is_active, created_at'

// case- and whitespace-insensitive; NFC so the same Thai text typed on different keyboards compares equal
const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()

// two chars that would glue into one token: digit+digit ("1" inside "915") or Latin+Latin ("cf" inside "cfs").
// Thai is written without spaces, so Thai next to Thai still counts as a boundary ("สนใจ" matches "สนใจค่ะ").
const DIGIT = /\p{N}/u
const LATIN = /\p{Script=Latin}/u
const glued = (a: string | undefined, b: string | undefined) =>
  !!a && !!b && ((DIGIT.test(a) && DIGIT.test(b)) || (LATIN.test(a) && LATIN.test(b)))

/** True if `k` appears in `text` as a whole word/number, not as part of a longer one. */
function containsWord(text: string, k: string): boolean {
  for (let i = text.indexOf(k); i !== -1; i = text.indexOf(k, i + 1)) {
    if (!glued(text[i - 1], k[0]) && !glued(text[i + k.length], k[k.length - 1])) return true
  }
  return false
}

export function ruleMatches(rule: Pick<CommentRule, 'match_type' | 'keywords'>, comment: string): boolean {
  const text = norm(comment)
  const keywords = rule.keywords.map(norm).filter(Boolean)
  return rule.match_type === 'exact' ? keywords.includes(text) : keywords.some((k) => containsWord(text, k))
}
