import { NextRequest, NextResponse } from 'next/server'
import { followUpTenant } from '@/lib/features/follow-ups/smart-followup-server'
import { inboxError, InboxError, checkRpc } from '@/lib/features/inbox/inbox-server'
import { UUID } from '@/lib/utils'

/** Take responsibility through the same version/lease/audit guard used by the Inbox. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const input = await req.json().catch(() => null),
      { id } = await params
    const { db, actor, tenantId } = await followUpTenant(req, input?.tenantId ?? '')
    if (!UUID.test(id)) throw new InboxError('รหัสลูกค้าไม่ถูกต้อง')
    const customer = await db
      .from('customers')
      .select('id,conversation_version')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (customer.error) throw customer.error
    if (!customer.data) throw new InboxError('ไม่พบลูกค้า', 404)
    const result = await db.rpc('manage_inbox_conversation', {
      p_customer: id,
      p_actor: actor.id,
      p_action: 'claim',
      p_version: customer.data.conversation_version,
      p_assignee: null,
    })
    checkRpc(result.error)
    return NextResponse.json({ ok: true, customerId: id })
  } catch (error) {
    return inboxError(error)
  }
}
