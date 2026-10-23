import 'server-only'
import { detectImageMime } from '@/lib/image-signature'

export const VISION_MAX_BYTES = 5 * 1024 * 1024
/** Check both declared MIME and magic bytes; never accept SVG, GIF, empty or oversized files. */
export async function validateVisionFile(file: File) {
  if (!file.size || file.size > VISION_MAX_BYTES) throw new Error('รูปภาพต้องมีขนาดไม่เกิน 5 MB')
  const bytes = Buffer.from(await file.arrayBuffer())
  const mime = detectImageMime(bytes)
  if (!mime || mime !== file.type)
    throw new Error('รองรับไฟล์ JPG, PNG และ WebP ที่ถูกต้องเท่านั้น')
  return bytes
}
/** Only signed webhook attachments from Meta's CDN. Never fetch a URL provided by the playground. */
export async function downloadVisionImage(
  value: string,
  catalog?: { tenantId: string },
): Promise<File> {
  const url = new URL(value)
  let trusted = /(^|\.)(?:fbcdn\.net|fbsbx\.com)$/i.test(url.hostname)
  if (catalog) {
    const storage = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
    trusted =
      url.origin === storage.origin &&
      url.pathname.startsWith(
        `/storage/v1/object/public/comment-media/commerce/${catalog.tenantId}/`,
      )
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !trusted)
    throw new Error('UNTRUSTED_IMAGE_HOST')
  console.log('[VISION DOWNLOAD] start', {
    host: url.hostname,
    source: catalog ? 'catalog' : 'customer',
  })
  const response = await fetch(url, {
    signal: AbortSignal.timeout(catalog ? 3000 : 10000),
    redirect: 'error',
  })
  console.log('[VISION DOWNLOAD] response', {
    host: url.hostname,
    status: response.status,
    contentType: response.headers.get('content-type'),
    contentLength: response.headers.get('content-length'),
  })
  if (!response.ok) throw new Error(`IMAGE_DOWNLOAD_HTTP_${response.status}`)
  if (Number(response.headers.get('content-length') ?? 0) > VISION_MAX_BYTES)
    throw new Error('IMAGE_TOO_LARGE')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('IMAGE_DOWNLOAD_FAILED')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value: chunk } = await reader.read()
      if (done) break
      size += chunk.length
      if (size > VISION_MAX_BYTES) throw new Error('IMAGE_TOO_LARGE')
      chunks.push(chunk)
    }
  } finally {
    await reader.cancel()
  }
  const bytes = Buffer.concat(chunks),
    detected = detectImageMime(bytes)
  const declared = (response.headers.get('content-type')?.split(';')[0] ?? '').trim().toLowerCase()
  // Meta CDN can serve valid photos as binary streams. Infer only from magic
  // bytes for missing/generic MIME; strict upload validation remains unchanged.
  const mime =
    !declared || declared === 'application/octet-stream' || declared === 'binary/octet-stream'
      ? detected
      : declared === 'image/jpg'
        ? 'image/jpeg'
        : declared
  if (!detected || mime !== detected)
    throw new Error(`IMAGE_MIME_INVALID:${declared || 'missing'}:${detected || 'unsupported'}`)
  const file = new File([bytes], 'image', { type: mime })
  await validateVisionFile(file)
  return file
}
