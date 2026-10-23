import { NextRequest, NextResponse } from 'next/server'
import { followUpTenant, followUpDashboard } from '@/lib/features/follow-ups/smart-followup-server'
import { inboxError, InboxError, checkRpc } from '@/lib/features/inbox/inbox-server'
import { parseFollowUpSettings } from '@/lib/features/follow-ups/smart-followup-validation'
export async function GET(req: NextRequest) {
  try {
    const { db, tenantId } = await followUpTenant(
      req,
      req.nextUrl.searchParams.get('tenantId') ?? '',
    )
    return NextResponse.json(
      await followUpDashboard(
        db,
        tenantId,
        req.nextUrl.searchParams.get('before'),
        req.nextUrl.searchParams.get('beforeId'),
      ),
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return inboxError(error)
  }
}
export async function PATCH(req: NextRequest) {
  try {
    const input = await req.json().catch(() => null)
    const { db, tenantId, actor } = await followUpTenant(req, input?.tenantId ?? '')
    let settings: ReturnType<typeof parseFollowUpSettings>
    try {
      settings = parseFollowUpSettings(input)
    } catch (e) {
      throw new InboxError(e instanceof Error ? e.message : 'ข้อมูลไม่ถูกต้อง')
    }
    const { error } = await db.rpc('save_smart_follow_up', {
      p_tenant: tenantId,
      p_actor: actor.id,
      p_policy: settings.policy,
      p_workflows: settings.workflows,
    })
    checkRpc(error)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return inboxError(error)
  }
}
