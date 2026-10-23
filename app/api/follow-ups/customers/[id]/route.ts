import { NextRequest, NextResponse } from 'next/server'
import { followUpTenant } from '@/lib/features/follow-ups/smart-followup-server'
import { inboxError, InboxError } from '@/lib/features/inbox/inbox-server'
import { canAccessTenant } from '@/lib/auth'
import { UUID } from '@/lib/utils'
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { db, tenantId } = await followUpTenant(
      req,
      req.nextUrl.searchParams.get('tenantId') ?? '',
    )
    const { id } = await params
    if (!UUID.test(id)) throw new InboxError('รหัสลูกค้าไม่ถูกต้อง')
    const result = await db
      .from('customers')
      .select('followup_opted_out,followup_opted_out_at,contact_suspended')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (result.error) throw result.error
    if (!result.data) throw new InboxError('ไม่พบลูกค้า', 404)
    return NextResponse.json(result.data, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return inboxError(error)
  }
}
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const input = await req.json().catch(() => null),
      { id } = await params
    const { db, tenantId, actor } = await followUpTenant(req, input?.tenantId ?? '')
    if (!UUID.test(id) || !['opt_out', 'suspend', 'unsuspend'].includes(input?.action))
      throw new InboxError('การดำเนินการไม่ถูกต้อง')
    if (input.action !== 'opt_out' && !(await canAccessTenant(actor, tenantId, 'owner')))
      throw new InboxError('เฉพาะเจ้าของร้านปรับการพักติดตามได้', 403)
    const result = await db
      .from('customers')
      .update(
        input.action === 'opt_out'
          ? { followup_opted_out: true, followup_opted_out_at: new Date().toISOString() }
          : { contact_suspended: input.action === 'suspend' },
      )
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('id')
      .maybeSingle()
    if (result.error) throw result.error
    if (!result.data) throw new InboxError('ไม่พบลูกค้า', 404)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return inboxError(error)
  }
}
