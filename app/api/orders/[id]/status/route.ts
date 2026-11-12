import { NextRequest, NextResponse } from 'next/server'
import { canAccessTenant, getActor } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import { CF_ORDER_STATUS } from '@/lib/status'
import { UUID } from '@/lib/utils'

const transitions: Record<string, string[]> = {
  pending_payment: ['paid', 'cancelled'],
  paid: ['shipped', 'cancelled'],
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (req.headers.get('origin') !== req.nextUrl.origin)
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    const actor = await getActor(req)
    if (!actor || actor.kind !== 'user')
      return NextResponse.json({ error: 'Please sign in' }, { status: 401 })

    const { id } = await params
    const input = await req.json().catch(() => null)
    if (
      !UUID.test(id) ||
      !input ||
      typeof input.tenantId !== 'string' ||
      !UUID.test(input.tenantId) ||
      typeof input.status !== 'string' ||
      !Object.hasOwn(CF_ORDER_STATUS, input.status)
    )
      return NextResponse.json({ error: 'Invalid order status request' }, { status: 400 })

    const tenantId = input.tenantId as string
    if (!(await canAccessTenant(actor, tenantId, 'owner')))
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })

    const db = supabaseAdmin()
    const current = await db
      .from('orders')
      .select('status')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (current.error) throw current.error
    if (!current.data) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (!transitions[current.data.status]?.includes(input.status))
      return NextResponse.json({ error: 'Order status transition is not allowed' }, { status: 409 })

    const updated = await db
      .from('orders')
      .update({ status: input.status })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', current.data.status)
      .select('id,status')
      .maybeSingle()
    if (updated.error) throw updated.error
    if (!updated.data)
      return NextResponse.json({ error: 'Order changed; refresh and try again' }, { status: 409 })
    return NextResponse.json({ order: updated.data }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[orders/status] update failed', {
      code: (error as { code?: string })?.code ?? 'ORDER_STATUS_UPDATE_FAILED',
    })
    return NextResponse.json({ error: 'Could not update order status' }, { status: 503 })
  }
}
