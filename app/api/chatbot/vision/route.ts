import { NextRequest, NextResponse } from 'next/server'
import { visionTenant, visionOverview } from '@/lib/features/vision/vision-server'
import { VISION_CONFIDENCE_THRESHOLD } from '@/lib/features/vision/vision-types'
import { inboxError, InboxError } from '@/lib/features/inbox/inbox-server'

export async function GET(req: NextRequest) {
  try {
    const { db, tenantId } = await visionTenant(req, req.nextUrl.searchParams.get('tenantId') ?? '')
    return NextResponse.json(await visionOverview(db, tenantId))
  } catch (error) {
    return inboxError(error)
  }
}
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { db, actor, tenantId } = await visionTenant(req, String(body?.tenantId ?? ''), true)
    if (typeof body?.enabled !== 'boolean') throw new InboxError('ตั้งค่าไม่ถูกต้อง')
    const saved = await db.rpc('save_vision_settings', {
      p_tenant: tenantId,
      p_actor: actor.id,
      p_enabled: body.enabled,
      p_mode: 'rules',
      p_confidence: VISION_CONFIDENCE_THRESHOLD,
      p_handoff: true,
    })
    if (saved.error?.code === '42501')
      throw new InboxError('แพ็กเกจไม่รองรับการตั้งค่านี้', 403, 'FEATURE_LOCKED')
    if (saved.error) throw saved.error
    return NextResponse.json(await visionOverview(db, tenantId))
  } catch (error) {
    return inboxError(error)
  }
}
