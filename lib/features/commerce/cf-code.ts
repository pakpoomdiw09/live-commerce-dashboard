/** Accept a bare product/variant code or a short CF-prefixed comment. */
export function cfCode(text: string | null | undefined): string | null {
  const match = /^(?:cf\s*[:.\-]?\s*)?([\p{L}\p{N}_-]{1,20})$/iu.exec(
    (text ?? '').normalize('NFC').trim(),
  )
  return match ? match[1] : null
}
