import { cfQuantity, normalizeCfText } from './cf-code'

export const MAX_LIVE_CF_CODES = 5
export class LiveCfCodesError extends Error {}

/** Match the database's Live CF alias format; preserve display case, compare canonically. */
export function parseLiveCfCodes(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0)
    throw new LiveCfCodesError('เธเธฃเธธเธ“เธฒเน€เธเธดเนเธกเธฃเธซเธฑเธชเธชเธฑเนเธเธเธทเนเธญเธญเธขเนเธฒเธเธเนเธญเธข 1 เธฃเธซเธฑเธช')
  if (input.length > MAX_LIVE_CF_CODES) throw new LiveCfCodesError('เน€เธเธดเนเธกเนเธ”เนเธชเธนเธเธชเธธเธ” 5 เธฃเธซเธฑเธช')
  const seen = new Set<string>()
  return input.map((value) => {
    if (typeof value !== 'string' || !value.trim())
      throw new LiveCfCodesError('เธเธฃเธธเธ“เธฒเธเธฃเธญเธเธฃเธซเธฑเธชเธเนเธญเธเน€เธเธดเนเธก')
    const code = value.normalize('NFKC').trim()
    if (!/^[\p{L}\p{N}][\p{L}\p{N}\p{M}_-]{0,39}$/u.test(code))
      throw new LiveCfCodesError('เธฃเธซเธฑเธชเนเธเนเธ•เธฑเธงเธญเธฑเธเธฉเธฃ เธ•เธฑเธงเน€เธฅเธ - เธซเธฃเธทเธญ _ เนเธกเนเน€เธเธดเธ 40 เธ•เธฑเธง เนเธ”เธขเนเธกเนเธกเธตเธเนเธญเธเธงเนเธฒเธ')
    const key = normalizeCfText(code)
    if (seen.has(key))
      throw new LiveCfCodesError('เธฃเธซเธฑเธชเธเธตเนเธกเธตเธญเธขเธนเนเนเธฅเนเธง เธ•เธฑเธงเธเธดเธกเธเนเน€เธฅเนเธเนเธฅเธฐเนเธซเธเนเธ–เธทเธญเน€เธเนเธเธฃเธซเธฑเธชเน€เธ”เธตเธขเธงเธเธฑเธ')
    seen.add(key)
    return code
  })
}

export function addLiveCfCode(codes: readonly string[], value: string) {
  return parseLiveCfCodes([...codes, value])
}

/** The unfinished tag is previewed immediately, but invalid/duplicate input never becomes a rule. */
export function previewLiveCfCodes(codes: readonly string[], draft: string) {
  if (!draft.trim()) return [...codes]
  if (codes.some((code) => normalizeCfText(code) === normalizeCfText(draft))) return [...codes]
  try {
    return addLiveCfCode(codes, draft)
  } catch {
    return [...codes]
  }
}

/** Keep configured separators, ignore trailing punctuation and join letter/number spacing. */
function containsText(value: string) {
  return normalizeCfText(value)
    .replace(/[^\p{L}\p{N}\p{M}_-]+$/gu, '')
    .replace(/([\p{L}\p{M}])\s+(?=\p{N})/gu, '$1')
    .replace(/(\p{N})\s+(?=[\p{L}\p{M}])/gu, '$1')
}

function withoutCfPrefix(value: string) {
  return value.replace(/^(?:cf|fc|เธเธญเธฃเธฑเธ|เธฃเธฑเธ|เน€เธญเธฒ|เธเธญเธ|เธชเธฑเนเธ|เธชเธเนเธ|เธเธญ)\s*[:.\\-_]?\s*/iu, '')
}

function codeText(value: string, codes: readonly string[]) {
  const normalized = normalizeCfText(value)
  const suffix = /(?:\*|x)\s*\d+\s*$/iu.exec(normalized) ?? /\s+\d+\s*$/u.exec(normalized)
  const withoutQuantity = suffix ? normalized.slice(0, suffix.index).trim() : normalized
  if (codes.some((code) => normalizeCfText(code) === withoutQuantity)) return withoutQuantity
  return withoutCfPrefix(withoutQuantity)
}

export function liveCfQuantity(value: string | null | undefined) {
  return cfQuantity(value)
}

function containsToken(text: string, keyword: string) {
  for (let start = text.indexOf(keyword); start !== -1; start = text.indexOf(keyword, start + 1)) {
    const end = start + keyword.length
    const before = start > 0 ? [...text.slice(0, start)].at(-1) : undefined
    const after = text[end]
    // Thai text is commonly adjacent to an alias without spaces; only Latin
    // letters/digits that can extend a SKU should prevent a boundary match.
    const extendsSku = (character: string | undefined) =>
      !!character && /[\p{Script=Latin}\p{N}\p{M}_-]/u.test(character)
    if (!extendsSku(before)) {
      if (!extendsSku(after)) return true
    }
  }
  return false
}

/** Shared by the setup preview and inbound live-comment rules. */
export function matchLiveCfCode(
  comment: string,
  codes: readonly string[],
  mode: 'flexible' | 'strict',
) {
  const rawText = codeText(comment, codes)
  const text = mode === 'strict' ? normalizeCfText(rawText) : containsText(rawText)
  if (!text) return null
  return (
    codes.find((code) => {
      const keyword = mode === 'strict' ? normalizeCfText(code) : containsText(code)
      return !!keyword && (mode === 'strict' ? text === keyword : containsToken(text, keyword))
    }) ?? null
  )
}

export function liveCfCodeExamples(
  codes: readonly string[],
  mode: 'flexible' | 'strict',
  prefixes: readonly string[] = [],
) {
  return codes.flatMap((code) =>
    mode === 'strict'
      ? [code]
      : [
          code,
          ...prefixes.filter((prefix) => prefix.trim()).map((prefix) => `${prefix.trim()} ${code}`),
        ],
  )
}
