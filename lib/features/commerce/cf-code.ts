const CODE = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,39}$/u

/** Unicode/case/space normalization shared by the webhook and setup preview. */
export function normalizeCfText(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim()
}

export function normalizeCfCode(value: string | null | undefined): string | null {
  const code = normalizeCfText(value)
  return CODE.test(code) ? code : null
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Match a configured CF code as a complete token (`159` never matches `1590`). */
export function matchesCfCode(text: string | null | undefined, expected: string): boolean {
  const code = normalizeCfCode(expected)
  if (!code) return false
  const normalized = normalizeCfText(text)
  if (!normalized) return false
  const withoutCf = normalized.replace(/^cf\s*[:.\-]?\s*/u, '')
  if (withoutCf === code) return true
  return new RegExp(`(^|[^\\p{L}\\p{N}_-])${escapeRegex(code)}(?=$|[^\\p{L}\\p{N}_-])`, 'u').test(
    normalized,
  )
}

/** Accept a bare code or a short CF-prefixed message; return a canonical code. */
export function cfCode(text: string | null | undefined): string | null {
  const source = (text ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
  const match = /^(?:cf\s*[:.\-]?\s*)?([\p{L}\p{N}][\p{L}\p{N}_-]{0,39})$/iu.exec(source)
  return match ? match[1] : null
}
