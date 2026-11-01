import { matchOrderCode, normalizeCfText } from './cf-code'

export const MAX_LIVE_CF_CODES = 5
export class LiveCfCodesError extends Error {}

/** Match the database's Live CF alias format; preserve display case, compare canonically. */
export function parseLiveCfCodes(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0)
    throw new LiveCfCodesError('กรุณาเพิ่มรหัสสั่งซื้ออย่างน้อย 1 รหัส')
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
      throw new LiveCfCodesError('รหัสนี้มีอยู่แล้ว ตัวพิมพ์เล็กและใหญ่ถือเป็นรหัสเดียวกัน')
    seen.add(key)
    return code
  })
}

export function addLiveCfCode(codes: readonly string[], value: string) {
  return parseLiveCfCodes([...codes, value])
}

export function matchLiveCfCode(
  comment: string,
  codes: readonly string[],
  mode: 'flexible' | 'strict',
) {
  return codes.find((code) => matchOrderCode(comment, code, mode)) ?? null
}

export function liveCfCodeExamples(codes: readonly string[], mode: 'flexible' | 'strict') {
  return codes.flatMap((code) =>
    mode === 'strict' ? [code] : [code, `รับ ${code}`, `จอง ${code}`],
  )
}
