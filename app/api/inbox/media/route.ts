import { NextRequest, NextResponse } from 'next/server'
import { inboxTenant, inboxError, InboxError } from '@/lib/features/inbox/inbox-server'
export const runtime = 'nodejs'
export async function POST(req: NextRequest) {
  try {
    const { db, actor, tenantId } = await inboxTenant(
      req,
      req.nextUrl.searchParams.get('tenantId') ?? '',
    )
    if (Number(req.headers.get('content-length')) > 9 * 1024 * 1024)
      throw new InboxError('ไฟล์ใหญ่เกิน 8 เมกะไบต์', 413)
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File) || !file.size || file.size > 8 * 1024 * 1024)
      throw new InboxError('เลือกไฟล์ขนาดไม่เกิน 8 เมกะไบต์')
    const bytes = Buffer.from(await file.arrayBuffer())
    const mime = bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
      ? 'image/jpeg'
      : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? 'image/png'
        : /^GIF8[79]a/.test(bytes.subarray(0, 6).toString())
          ? 'image/gif'
          : bytes.subarray(0, 4).toString() === 'RIFF' &&
              bytes.subarray(8, 12).toString() === 'WEBP'
            ? 'image/webp'
            : bytes.subarray(0, 5).toString() === '%PDF-'
              ? 'application/pdf'
              : null
    if (!mime) throw new InboxError('รองรับรูปภาพและเอกสารตามประเภทที่กำหนดเท่านั้น')
    const id = crypto.randomUUID(),
      path = `${tenantId}/${id}`
    const name = file.name.replace(/[\x00-\x1f]/g, '').slice(0, 150) || 'attachment'
    const uploaded = await db.storage
      .from('inbox-media')
      .upload(path, bytes, { contentType: mime, upsert: false })
    if (uploaded.error) throw uploaded.error
    const kind = mime === 'application/pdf' ? 'file' : 'image'
    const saved = await db
      .from('inbox_media')
      .insert({ id, tenant_id: tenantId, uploaded_by: actor.id, path, name, mime, kind })
    if (saved.error) {
      await db.storage.from('inbox-media').remove([path])
      throw saved.error
    }
    return NextResponse.json({ id, name, kind })
  } catch (error) {
    return inboxError(error)
  }
}
