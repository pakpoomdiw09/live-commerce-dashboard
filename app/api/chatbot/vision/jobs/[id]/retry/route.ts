import { NextRequest, NextResponse } from 'next/server'
import { visionTenant } from '@/lib/features/vision/vision-server'
import { inboxError, InboxError } from '@/lib/features/inbox/inbox-server'
import { UUID } from '@/lib/utils'
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { db, tenantId, actor } = await visionTenant(
      req,
      req.nextUrl.searchParams.get('tenantId') ?? '',
      true,
    )
    const { id } = await params
    if (!UUID.test(id)) throw new InboxError('รหัสงานไม่ถูกต้อง')
    const retry = await db.rpc('retry_unstarted_vision', {
      p_job: id,
      p_tenant: tenantId,
      p_actor: actor.id,
    })
    if (retry.error) throw retry.error
    if (retry.data !== true)
      throw new InboxError(
        'งานนี้เคยเริ่มประมวลผลแล้วหรือไม่พบงาน จึงไม่สามารถลองซ้ำอัตโนมัติได้',
        409,
        'UNSAFE_RETRY',
      )
    return NextResponse.json({ ok: true })
  } catch (error) {
    return inboxError(error)
  }
}
