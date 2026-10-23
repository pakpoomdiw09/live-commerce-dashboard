import { NextRequest, NextResponse } from 'next/server'
import { followUpTenant } from '@/lib/features/follow-ups/smart-followup-server'
import { inboxError, InboxError, checkRpc } from '@/lib/features/inbox/inbox-server'
import { UUID } from '@/lib/utils'
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const input = await req.json().catch(() => null)
    const { id } = await params
    const { db, actor, tenantId } = await followUpTenant(req, input?.tenantId ?? '')
    if (!UUID.test(id) || !['cancel', 'skip', 'approve', 'retry'].includes(input?.action))
      throw new InboxError('การดำเนินการไม่ถูกต้อง')
    if (
      input.action === 'approve' &&
      (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 2000)
    )
      throw new InboxError('กรุณาตรวจทานข้อความยาวไม่เกิน 2,000 ตัวอักษร')
    const result = await db.rpc('act_follow_up_job', {
      p_job: id,
      p_tenant: tenantId,
      p_actor: actor.id,
      p_action: input.action,
      p_text: input.text ?? null,
    })
    checkRpc(result.error)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return inboxError(error)
  }
}
