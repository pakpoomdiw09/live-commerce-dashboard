import 'server-only'
import sharp from 'sharp'
import { detectImageMime } from '@/lib/image-signature'

export const UPLOAD_FILE_BYTES = 5 * 1024 * 1024
export const UPLOAD_BODY_BYTES = UPLOAD_FILE_BYTES + 64 * 1024
export const UPLOAD_MAX_PIXELS = 16_000_000
const READ_TIMEOUT_MS = 15_000
const MAX_CONCURRENT_UPLOADS = 2
const MAX_MULTIPART_HEADER_BYTES = 4096
const MAX_STREAM_CHUNKS = 16_384
const IMAGE_TIMEOUT_SECONDS = 5

export class UploadError extends Error {
  constructor(message: string, readonly status: 400 | 408 | 413 | 415 | 429) {
    super(message)
  }
}

type Admission = { owners: Set<string> }
const admissionKey = Symbol.for('snapbot.upload-admission.v1')
const shared = globalThis as typeof globalThis & { [admissionKey]?: Admission }

/** Share upload capacity across routes without queuing requests. */
export function acquireUploadSlot(principal: string): () => void {
  const state = shared[admissionKey] ??= { owners: new Set() }
  if (state.owners.size >= MAX_CONCURRENT_UPLOADS || state.owners.has(principal)) throw new UploadError('มีการอัปโหลดอยู่ กรุณารอสักครู่แล้วลองใหม่', 429)
  state.owners.add(principal)
  let released = false
  return () => {
    if (released) return
    released = true
    state.owners.delete(principal)
  }
}

function cancelBody(request: Request) {
  try { void request.body?.cancel().catch(() => undefined) } catch {}
}

type UploadFields = Readonly<Record<string, number>>

/** Reject oversized parts and ambiguous fields before parsing FormData. */
function inspectMultipart(body: Buffer, boundary: string, fields: UploadFields) {
  const marker = Buffer.from(`\r\n--${boundary}`), opening = Buffer.from(`--${boundary}\r\n`)
  if (!body.subarray(0, opening.length).equals(opening)) throw new UploadError('รูปแบบไฟล์อัปโหลดไม่ถูกต้อง', 400)
  const seen = new Set<string>()
  let start = opening.length
  for (;;) {
    const headerEnd = body.indexOf('\r\n\r\n', start)
    if (headerEnd < start || headerEnd - start > MAX_MULTIPART_HEADER_BYTES) throw new UploadError('ส่วนหัวไฟล์อัปโหลดไม่ถูกต้องหรือยาวเกินกำหนด', 400)
    const headers = body.subarray(start, headerEnd).toString('utf8').split('\r\n')
    const disposition = headers.filter(line => /^content-disposition:/i.test(line))
    if (disposition.length !== 1 || !/^content-disposition:\s*form-data;/i.test(disposition[0]) || headers.length > 8
      || headers.some(line => !/^(content-disposition|content-type):/i.test(line))) throw new UploadError('ส่วนหัวไฟล์อัปโหลดไม่ถูกต้อง', 400)
    const name = /;\s*name="([^"\r\n]+)"(?:;|$)/i.exec(disposition[0])?.[1]
    if (!name || !Object.hasOwn(fields, name) || seen.has(name) || [...disposition[0].matchAll(/;\s*name\s*=/gi)].length !== 1) throw new UploadError('ช่องข้อมูลอัปโหลดไม่ถูกต้องหรือซ้ำกัน', 400)
    seen.add(name)
    const isFile = /;\s*filename(?:\*?=)/i.test(disposition[0])
    if (isFile !== (name === 'file')) throw new UploadError('ชนิดช่องข้อมูลอัปโหลดไม่ถูกต้อง', 400)
    const contentStart = headerEnd + 4
    let end = body.indexOf(marker, contentStart)
    while (end >= 0) {
      const suffix = body.toString('ascii', end + marker.length, end + marker.length + 2)
      if (suffix === '--' || suffix === '\r\n') break
      end = body.indexOf(marker, end + marker.length)
    }
    if (end < 0) throw new UploadError('ข้อมูลอัปโหลดไม่ครบถ้วน', 400)
    if (end - contentStart > fields[name]) throw new UploadError(name === 'file' ? 'ไฟล์ต้องมีขนาดไม่เกิน 5 MB' : 'ข้อความในฟอร์มยาวเกินกำหนด', 413)
    start = end + marker.length
    if (body.toString('ascii', start, start + 2) === '--') {
      const remaining = body.subarray(start + 2)
      if (remaining.length && !remaining.equals(Buffer.from('\r\n'))) throw new UploadError('รูปแบบท้ายไฟล์อัปโหลดไม่ถูกต้อง', 400)
      return
    }
    start += 2
  }
}

/** Count actual streamed bytes, with an absolute deadline; never call request.formData(). */
export async function readUploadForm(request: Request, fields: UploadFields): Promise<FormData> {
  const contentType = request.headers.get('content-type') ?? ''
  const match = /^multipart\/form-data\s*;\s*boundary=(?:"([^"\r\n]{1,70})"|([^;\s]{1,70}))\s*$/i.exec(contentType)
  const boundary = match?.[1] ?? match?.[2]
  if (!boundary || !/^[0-9A-Za-z'()+_,.\/:=? -]+$/.test(boundary) || boundary.endsWith(' ')) {
    cancelBody(request)
    throw new UploadError('กรุณาอัปโหลดด้วย multipart/form-data ที่ถูกต้อง', 415)
  }
  const encoding = request.headers.get('content-encoding')
  if (encoding && encoding.toLowerCase() !== 'identity') { cancelBody(request); throw new UploadError('ไม่รองรับข้อมูลอัปโหลดที่บีบอัด', 415) }
  const declared = request.headers.get('content-length')
  if (declared !== null && !/^\d+$/.test(declared)) { cancelBody(request); throw new UploadError('ขนาดคำขอไม่ถูกต้อง', 400) }
  if (declared !== null && (declared.length > 16 || BigInt(declared) > BigInt(UPLOAD_BODY_BYTES))) { cancelBody(request); throw new UploadError('ข้อมูลอัปโหลดมีขนาดเกินกำหนด', 413) }
  if (!request.body || request.bodyUsed || request.body.locked) throw new UploadError('ไม่พบข้อมูลอัปโหลดที่อ่านได้', 400)
  const reader = request.body.getReader(), bytes = new Uint8Array(UPLOAD_BODY_BYTES)
  const expiresAt = Date.now() + READ_TIMEOUT_MS
  let size = 0, chunks = 0, failure: UploadError | undefined
  const stop = (error: UploadError) => {
    failure ??= error
    try { void reader.cancel().catch(() => undefined) } catch {}
  }
  const timer = setTimeout(() => stop(new UploadError('อัปโหลดนานเกินกำหนด กรุณาลองใหม่', 408)), READ_TIMEOUT_MS)
  const abort = () => stop(new UploadError('การอัปโหลดถูกยกเลิก', 400))
  request.signal.addEventListener('abort', abort, { once: true })
  if (request.signal.aborted) abort()
  try {
    for (;;) {
      if (failure) throw failure
      if (Date.now() >= expiresAt) throw new UploadError('อัปโหลดนานเกินกำหนด กรุณาลองใหม่', 408)
      const { done, value } = await reader.read()
      if (failure) throw failure
      if (done) break
      if (++chunks > MAX_STREAM_CHUNKS) throw new UploadError('ข้อมูลอัปโหลดแบ่งย่อยมากเกินกำหนด', 413)
      if (value.byteLength > UPLOAD_BODY_BYTES - size) throw new UploadError('ข้อมูลอัปโหลดมีขนาดเกินกำหนด', 413)
      bytes.set(value, size)
      size += value.byteLength
    }
  } catch (error) {
    try { void reader.cancel().catch(() => undefined) } catch {}
    if (error instanceof UploadError) throw error
    throw new UploadError('อ่านข้อมูลอัปโหลดไม่ได้ กรุณาลองใหม่', 400)
  } finally {
    clearTimeout(timer)
    request.signal.removeEventListener('abort', abort)
    try { reader.releaseLock() } catch {}
  }
  inspectMultipart(Buffer.from(bytes.buffer, 0, size), boundary, fields)
  if (declared !== null && BigInt(declared) !== BigInt(size)) throw new UploadError('ขนาดคำขอไม่ตรงกับข้อมูลที่ส่งมา', 400)
  try {
    const form = await new Request('http://upload.invalid', { method: 'POST', headers: { 'content-type': contentType }, body: bytes.subarray(0, size) }).formData()
    const names = new Set<string>()
    for (const [name, value] of form) {
      if (!Object.hasOwn(fields, name) || names.has(name) || (name === 'file') !== (value instanceof File)) throw new UploadError('ช่องข้อมูลอัปโหลดไม่ถูกต้องหรือซ้ำกัน', 400)
      names.add(name)
      if ((typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : value.size) > fields[name]) throw new UploadError('ข้อมูลอัปโหลดมีขนาดเกินกำหนด', 413)
    }
    return form
  } catch (error) {
    if (error instanceof UploadError) throw error
    throw new UploadError('รูปแบบข้อมูลอัปโหลดไม่ถูกต้อง', 400)
  }
}

/** Match declared MIME to magic bytes, bound decoded pixels, and reject corrupt/animated images. */
export async function validateUploadImage(file: File): Promise<Buffer> {
  if (file.size > UPLOAD_FILE_BYTES) throw new UploadError('ไฟล์ต้องมีขนาดไม่เกิน 5 MB', 413)
  if (!file.size) throw new UploadError('ไฟล์รูปภาพว่างเปล่า', 400)
  const head = Buffer.from(await file.slice(0, 12).arrayBuffer())
  const mime = detectImageMime(head)
  if (!mime || file.type !== mime) throw new UploadError('รองรับรูป JPG, PNG และ WebP ที่มีเนื้อหาไฟล์ถูกต้องเท่านั้น', 415)
  const format = mime.slice('image/'.length)
  const bytes = Buffer.from(await file.arrayBuffer())
  try {
    const image = sharp(bytes, { limitInputPixels: UPLOAD_MAX_PIXELS, sequentialRead: true, failOn: 'warning' }).timeout({ seconds: IMAGE_TIMEOUT_SECONDS })
    const meta = await image.metadata()
    if (meta.format !== format || !meta.width || !meta.height || (meta.pages ?? 1) !== 1) throw new UploadError('รูปภาพไม่ถูกต้อง หรือเป็นภาพเคลื่อนไหว', 415)
    if (meta.width * meta.height > UPLOAD_MAX_PIXELS) throw new UploadError('ความละเอียดรูปภาพสูงเกิน 16 ล้านพิกเซล', 413)
    await image.resize({ width: 1, height: 1, fit: 'inside' }).raw().toBuffer()
  } catch (error) {
    if (error instanceof UploadError) throw error
    if (error instanceof Error && /pixel limit/i.test(error.message)) throw new UploadError('ความละเอียดรูปภาพสูงเกิน 16 ล้านพิกเซล', 413)
    throw new UploadError('รูปภาพเสียหายหรือประมวลผลไม่ได้', 415)
  }
  return bytes
}
