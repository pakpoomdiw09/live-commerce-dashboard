import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { canAccessTenant, getActor, isPlatformAdmin } from '@/lib/auth'
import { UUID } from '@/lib/utils'

export const runtime = 'nodejs'

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

/**
 * PATCH { action, note? } on a pending request:
 *   approve / reject  platform admins (approve applies the plan or credits)
 *   cancel            the shop's owner
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor(req)
  if (!actor) return bad('unauthorized', 401)
  const { id } = await params
  if (!UUID.test(id)) return bad('id must be a uuid')
  const body = await req.json().catch(() => null)
  const action = String(body?.action ?? '')
  const note = body?.note ? String(body.note).slice(0, 500) : null
  if (!['approve', 'reject', 'cancel'].includes(action)) return bad('unknown action')

  const db = supabaseAdmin()
  const { data: r } = await db
    .from('billing_requests')
    .select('tenant_id, status')
    .eq('id', id)
    .maybeSingle()
  if (!r || !(await canAccessTenant(actor, r.tenant_id))) return bad('request not found', 404)
  if (r.status !== 'pending') return bad('คำขอนี้ถูกดำเนินการไปแล้ว', 409)
  const adminId = actor.kind === 'user' ? actor.id : null

  if (action === 'approve') {
    if (!isPlatformAdmin(actor)) return bad('เฉพาะผู้ดูแลแพลตฟอร์มเท่านั้นที่อนุมัติได้', 403)
    const { data: refused, error } = await db.rpc('approve_billing_request', {
      p_request: id,
      p_admin: adminId,
    })
    if (error)
      return bad(
        error.code === '23505' ? 'สลิปนี้เคยใช้ชำระเงินแล้ว กรุณาตรวจสอบคำสั่งซื้อ' : error.message,
        error.code === '23505' ? 409 : 500,
      )
    if (refused) return bad(String(refused), 409)
    return NextResponse.json({ ok: true })
  }

  if (action === 'reject' && !isPlatformAdmin(actor))
    return bad('เฉพาะผู้ดูแลแพลตฟอร์มเท่านั้นที่ปฏิเสธได้', 403)
  if (action === 'cancel' && !(await canAccessTenant(actor, r.tenant_id, 'owner')))
    return bad('เฉพาะเจ้าของร้านเท่านั้นที่ยกเลิกได้', 403)
  const { data: decided, error } = await db
    .from('billing_requests')
    .update({
      status: action === 'reject' ? 'rejected' : 'cancelled',
      note,
      decided_by: adminId,
      decided_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()
  if (error) return bad(error.message, 500)
  if (!decided) return bad('คำขอนี้ถูกดำเนินการไปแล้ว กรุณาโหลดหน้าใหม่', 409)
  return NextResponse.json({ ok: true })
}
