import { NextRequest, NextResponse } from 'next/server'
import { visionTenant } from '@/lib/features/vision/vision-server'
import { inboxError, InboxError } from '@/lib/features/inbox/inbox-server'
import { UUID } from '@/lib/utils'
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { db, tenantId } = await visionTenant(req, req.nextUrl.searchParams.get('tenantId') ?? '')
    const { id } = await params
    if (!UUID.test(id)) throw new InboxError('รหัสงานไม่ถูกต้อง')
    const job = await db
      .from('vision_jobs')
      .select('image_path')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (job.error) throw job.error
    if (!job.data) throw new InboxError('ไม่พบรูปภาพ', 404)
    const signed = await db.storage.from('vision-images').createSignedUrl(job.data.image_path, 60)
    if (signed.error) throw signed.error
    const response = NextResponse.redirect(signed.data.signedUrl)
    response.headers.set('Cache-Control', 'private, no-store')
    response.headers.set('Referrer-Policy', 'no-referrer')
    return response
  } catch (error) {
    return inboxError(error)
  }
}
