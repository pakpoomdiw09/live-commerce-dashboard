import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { canAccessTenant, getActor } from '@/lib/auth'
import { pendingOrders } from '@/lib/orders'
import { markOrdersPaid } from '@/lib/slip/process'
import { APPROVABLE } from '@/lib/status'
import { UUID } from '@/lib/utils'

export const runtime = 'nodejs'

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

/**
 * POST: approve the order paid by this slip. Idempotent: approving twice keeps the first time.
 * Non-valid slips may be approved by hand (e.g. a bank delay made SlipOK answer 'fake'),
 * but never 'pending' (not checked yet) or 'duplicate' (the money was already counted).
 * The customer's open CF orders count as paid by this slip.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor(req)
  if (!actor) return bad('unauthorized', 401)
  const { id } = await params
  if (!UUID.test(id)) return bad('id must be a uuid')

  const db = supabaseAdmin()
  const { data: slip, error } = await db.from('slips').select('id, tenant_id, status, customer_id, approved_at').eq('id', id).maybeSingle()
  if (error) return bad(error.message, 500)
  if (!slip || !(await canAccessTenant(actor, slip.tenant_id))) return bad('slip not found', 404)
  if (!APPROVABLE.includes(slip.status)) return bad(slip.status === 'duplicate' ? 'สลิปซ้ำ อนุมัติไม่ได้' : 'สลิปยังตรวจไม่เสร็จ', 409)

  const approvedAt = slip.approved_at ?? new Date().toISOString()
  if (!slip.approved_at) {
    const { error: updateError } = await db
      .from('slips')
      .update({ approved_at: approvedAt, approved_by: actor.kind === 'user' ? actor.id : null })
      .eq('id', id)
      .is('approved_at', null)
    if (updateError) return bad(`อนุมัติไม่สำเร็จ: ${updateError.message}`, 500)
  }
  if (slip.customer_id) {
    const { error: customerError } = await db.from('customers').update({ order_status: 'approved' }).eq('id', slip.customer_id)
    if (customerError) console.error('[approve] order status update failed', customerError)
    const orders = await pendingOrders(db, slip.customer_id)
    if (orders.ids.length) await markOrdersPaid(db, orders.ids, slip.id)
  }
  return NextResponse.json({ ok: true, approvedAt })
}
