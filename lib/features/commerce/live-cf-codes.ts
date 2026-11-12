import { cfQuantity, normalizeCfText } from './cf-code'

export const MAX_LIVE_CF_CODES = 5
export class LiveCfCodesError extends Error {}

/** Match the database's Live CF alias format; preserve display case, compare canonically. */
export function parseLiveCfCodes(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0)
    throw new LiveCfCodesError('กรุณาเพิ่มรหัสสำหรับสั่งซื้ออย่างน้อย 1 รหัส')
  if (input.length > MAX_LIVE_CF_CODES) throw new LiveCfCodesError('เพิ่มได้สูงสุด 5 รหัส')
  const seen = new Set<string>()
  return input.map((value) => {
    if (typeof value !== 'string' || !value.trim())
      throw new LiveCfCodesError('กรุณากรอกรหัสก่อนเพิ่ม')
    const code = value.normalize('NFKC').trim()
    if (!/^[\p{L}\p{N}][\p{L}\p{N}\p{M}_-]{0,39}$/u.test(code))
      throw new LiveCfCodesError('รหัสใช้ตัวอักษร ตัวเลข - หรือ _ ไม่เกิน 40 ตัว โดยไม่มีช่องว่าง')
    const key = normalizeCfText(code)
    if (seen.has(key))
      throw new LiveCfCodesError('รหัสนี้มีอยู่แล้ว โดยไม่แยกตัวพิมพ์เล็กและใหญ่')
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
  const withoutBooking = value.replace(
    /^(?:\u{0E02}\u{0E2D}\u{0E23}\u{0E31}\u{0E1A}|\u{0E23}\u{0E31}\u{0E1A}|\u{0E40}\u{0E2D}\u{0E32}|\u{0E08}\u{0E2D}\u{0E07}|\u{0E2A}\u{0E31}\u{0E48}\u{0E07}|\u{0E2A}\u{0E19}\u{0E43}\u{0E08}|\u{0E02}\u{0E2D})\s*[:.\\-_]?\s*/iu,
    '',
  )
  return withoutBooking.replace(/^(?:cf|fc)\s*[:.\\-_]?\s*/iu, '')
}
function codeText(value: string, _codes: readonly string[], mode: 'flexible' | 'strict') {
  const normalized = normalizeCfText(value)
  // Exact means the entire normalized comment must equal the configured tag;
  // punctuation and prose are not stripped in strict mode.
  if (mode === 'strict') return normalized
  // Contains mode searches the normalized comment using token boundaries below.
  // Keep surrounding prose and quantity suffixes so aliases work in natural comments.
  return normalized
    .replace(/(?:\u{0E04}\u{0E23}\u{0E31}\u{0E1A}|\u{0E04}\u{0E48}\u{0E30}|\u{0E04}\u{0E30}|\u{0E08}\u{0E49}\u{0E32}|\u{0E08}\u{0E49}\u{0E30}|\u{0E19}\u{0E30}|\u{0E19}\u{0E49}\u{0E32})\s*[.!?~]*$/u, '')
    .replace(/[^\p{L}\p{N}\p{M}_-]+$/gu, '')
    .trim()
}
export function liveCfQuantity(value: string | null | undefined) {
  return cfQuantity(value)
}

function containsToken(text: string, keyword: string) {
  // A CF/FC prefix makes a longer live-code alias unambiguous; tolerate prose
  // wrapping the complete alias while still refusing a longer numeric SKU.
  if (/^(?:cf|fc)[\p{L}\p{N}]/iu.test(keyword)) {
    const start = text.indexOf(keyword)
    if (start !== -1) {
      const after = [...text.slice(start + keyword.length)][0]
      if (!after || !/[\p{N}_-]/u.test(after)) return true
    }
  }
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
  const rawText = codeText(comment, codes, mode)
  const text = mode === 'strict' ? normalizeCfText(rawText) : containsText(rawText)
  const strippedText = mode === 'strict' ? text : containsText(withoutCfPrefix(withoutCfPrefix(rawText)))
  if (!text) return null
  return (
    codes.find((code) => {
      const keyword = mode === 'strict' ? normalizeCfText(code) : containsText(code)
      return !!keyword && (mode === 'strict' ? text === keyword : containsToken(text, keyword) || containsToken(strippedText, keyword))
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
