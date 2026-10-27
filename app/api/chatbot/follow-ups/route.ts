import { NextRequest, NextResponse } from 'next/server'
import { followUpTenant } from '@/lib/features/follow-ups/smart-followup-server'
import { inboxError, InboxError, checkRpc } from '@/lib/features/inbox/inbox-server'

/** Save approval independently so changing it never cancels or approves existing jobs. */
export async function PATCH(req: NextRequest) {
  try {
    const input = await req.json().catch(() => null)
    const { db, tenantId, actor } = await followUpTenant(req, input?.tenantId ?? '')
    if (!['manual_review', 'auto_approve'].includes(input?.approvalMode))
      throw new InboxError('กรุณาเลือกโหมดอนุมัติให้ถูกต้อง')
    const { data, error } = await db.rpc('set_follow_up_approval_mode', {
      p_tenant: tenantId,
      p_actor: actor.id,
      p_mode: input.approvalMode,
    })
    checkRpc(error)
    return NextResponse.json({ approvalMode: data })
  } catch (error) {
    return inboxError(error)
  }
}
