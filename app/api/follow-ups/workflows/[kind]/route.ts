import { NextRequest, NextResponse } from 'next/server'
import { followUpTenant } from '@/lib/features/follow-ups/smart-followup-server'
import { checkRpc, inboxError, InboxError } from '@/lib/features/inbox/inbox-server'
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  try {
    const input = await req.json().catch(() => null),
      { kind } = await params
    const { db, tenantId, actor } = await followUpTenant(req, input?.tenantId ?? '')
    if (
      !['payment', 'interested', 'after_sales'].includes(kind) ||
      !Number.isInteger(input?.version) ||
      input.version < 0 ||
      (input.index != null &&
        (!Number.isInteger(input.index) || input.index < 0 || input.index > 2))
    )
      throw new InboxError('ข้อมูลขั้นตอนติดตามไม่ถูกต้อง')
    const { data, error } = await db.rpc('save_follow_up_workflow', {
      p_tenant: tenantId,
      p_actor: actor.id,
      p_kind: kind,
      p_version: input.version,
      p_index: input.index ?? null,
      p_steps: input.steps,
      p_config: input.config,
    })
    if (error?.code === '22023')
      throw new InboxError(
        'เวลาต้องเป็นจำนวนเต็มและเรียงเพิ่มขึ้นแต่ละขั้น ข้อความต้องมี 1–2,000 ตัวอักษร และกรุณาบันทึกขั้นก่อนหน้าก่อนเพิ่มขั้นใหม่',
      )
    checkRpc(error)
    return NextResponse.json({ workflow: data })
  } catch (error) {
    return inboxError(error)
  }
}
