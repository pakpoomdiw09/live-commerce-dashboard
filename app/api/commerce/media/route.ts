import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import {
  commerceScope,
  commerceResponse,
  sameOrigin,
} from '@/lib/features/commerce/commerce-server'
import { CommerceError } from '@/lib/features/commerce/commerce-core'
import {
  acquireUploadSlot,
  readUploadForm,
  validateUploadImage,
  UploadError,
  UPLOAD_FILE_BYTES,
  UPLOAD_MAX_PIXELS,
} from '@/lib/upload-security'
export const runtime = 'nodejs'
export const maxDuration = 60
export async function POST(req: NextRequest) {
  let release: (() => void) | undefined
  try {
    sameOrigin(req)
    const scope = await commerceScope(req.nextUrl.searchParams.get('tenantId') ?? '', true, req)
    const rate = await scope.db.rpc('commerce_rate_limit', {
      p_bucket: `upload:${scope.tenantId}:${scope.actor.id}`,
      p_max: 30,
    })
    if (rate.error || rate.data !== true)
      throw new CommerceError('อัปโหลดถี่เกินไป กรุณารอสักครู่', 429)
    release = acquireUploadSlot(`user:${scope.actor.id}`)
    const file = (await readUploadForm(req, { file: UPLOAD_FILE_BYTES })).get('file')
    if (!(file instanceof File)) throw new UploadError('กรุณาแนบรูปภาพ', 400)
    const bytes = await validateUploadImage(file)
    let output: Buffer
    try {
      output = await sharp(bytes, {
        limitInputPixels: UPLOAD_MAX_PIXELS,
        sequentialRead: true,
        failOn: 'warning',
      })
        .timeout({ seconds: 5 })
        .rotate()
        .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer()
    } catch {
      throw new CommerceError('ไฟล์รูปภาพไม่ถูกต้องหรือประมวลผลไม่ได้')
    }
    const path = `commerce/${scope.tenantId}/${randomUUID()}.webp`
    const upload = await scope.db.storage
      .from('comment-media')
      .upload(path, output, { contentType: 'image/webp', upsert: false })
    if (upload.error) throw upload.error
    return NextResponse.json({
      url: scope.db.storage.from('comment-media').getPublicUrl(path).data.publicUrl,
    })
  } catch (e) {
    if (e instanceof UploadError)
      return NextResponse.json(
        { error: e.message },
        {
          status: e.status,
          headers: {
            'Cache-Control': 'no-store',
            ...(e.status === 429 ? { 'Retry-After': '5' } : {}),
          },
        },
      )
    return commerceResponse(e)
  } finally {
    release?.()
  }
}
