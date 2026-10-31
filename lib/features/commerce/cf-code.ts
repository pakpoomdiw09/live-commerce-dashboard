// Permissive code regex: allows letters (any language including Thai), numbers, spaces, symbols up to 60 chars
const CODE = /^[\p{L}\p{N}][\p{L}\p{N}_\-\s]{0,59}$/u

/** Unicode/case/space normalization shared by the webhook and setup preview. */
export function normalizeCfText(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim()
}

export function normalizeCfCode(value: string | null | undefined): string | null {
  const code = normalizeCfText(value)
  if (!code) return null
  return code.slice(0, 60)
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Match comment against targetCode according to mode ('flexible' | 'strict'):
 * - strict: Exact match 100% (ignoring leading/trailing spaces and case)
 * - flexible: Matches bare code or code preceded by prefixes like CF, FC, จอง, เอา, สนใจ or as a complete token
 */
export function matchOrderCode(
  comment: string | null | undefined,
  targetCode: string | null | undefined,
  mode: 'flexible' | 'strict' = 'flexible',
): boolean {
  if (!comment || !targetCode) return false
  const normComment = normalizeCfText(comment)
  const normTarget = normalizeCfText(targetCode)
  if (!normComment || !normTarget) return false

  if (mode === 'strict') {
    return normComment === normTarget
  }

  // mode === 'flexible'
  if (normComment === normTarget) return true

  // Strip common live-shopping prefixes: cf, fc, เอา, จอง, สนใจ, รับ, ขอ (case-insensitive, optional colon/hyphen/period/space)
  const prefixRegex = /^(?:cf|fc|เอา|จอง|สนใจ|รับ|ขอ)\s*[:.\-]?\s*/iu
  const withoutPrefix = normComment.replace(prefixRegex, '').trim()
  if (withoutPrefix === normTarget) return true

  // Also check if targetCode appears as a distinct word/token in the comment
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_-])${escapeRegex(normTarget)}(?=$|[^\\p{L}\\p{N}_-])`, 'u')
  return pattern.test(normComment)
}

/** Match a configured CF code as a complete token (`159` never matches `1590`). Backward compatible. */
export function matchesCfCode(text: string | null | undefined, expected: string): boolean {
  return matchOrderCode(text, expected, 'flexible')
}

/** Accept a bare code or a short CF/FC/เอา/จอง/สนใจ-prefixed message; return a canonical code. */
export function cfCode(text: string | null | undefined): string | null {
  const source = (text ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
  const match = /^(?:(?:cf|fc|เอา|จอง|สนใจ|รับ|ขอ)\s*[:.\-]?\s*)?([\p{L}\p{N}][\p{L}\p{N}_\-\s]{0,59})$/iu.exec(source)
  return match ? match[1].trim() : null
}
