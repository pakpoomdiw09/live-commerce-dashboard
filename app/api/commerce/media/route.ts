import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { commerceScope, commerceResponse, sameOrigin } from '@/lib/commerce-server'
import { CommerceError } from '@/lib/commerce-core'
export const runtime = 'nodejs'
export async function POST(req: NextRequest) {
  try {
    sameOrigin(req); const scope = await commerceScope(req.nextUrl.searchParams.get('tenantId') ?? '', true, req)
    const rate = await scope.db.rpc('commerce_rate_limit', { p_bucket: `upload:${scope.tenantId}:${scope.actor.id}`, p_max: 30 })
    if (rate.error || rate.data !== true) throw new CommerceError('อัปโหลดถี่เกินไป กรุณารอสักครู่', 429)
    if (Number(req.headers.get('content-length') ?? 0) > 6 * 1024 * 1024) throw new CommerceError('รูปภาพต้องไม่เกิน 5 MB')
    const file = (await req.formData()).get('file')
    if (!(file instanceof File) || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) throw new CommerceError('รองรับ JPG PNG WebP ไม่เกิน 5 MB')
    let output: Buffer
    try { const image = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 25000000 }); const meta = await image.metadata(); if (`image/${meta.format}` !== file.type || meta.pages && meta.pages > 1) throw Error(); output = await image.rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer() } catch { throw new CommerceError('ไฟล์รูปภาพไม่ถูกต้องหรือใหญ่เกินกำหนด') }
    const path = `commerce/${scope.tenantId}/${randomUUID()}.webp`
    const upload = await scope.db.storage.from('comment-media').upload(path, output, { contentType: 'image/webp', upsert: false })
    if (upload.error) throw upload.error
    return NextResponse.json({ url: scope.db.storage.from('comment-media').getPublicUrl(path).data.publicUrl })
  } catch (e) { return commerceResponse(e) }
}
