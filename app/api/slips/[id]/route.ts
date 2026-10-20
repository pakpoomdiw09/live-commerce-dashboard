import { hasFeature, featureLockedResponse } from '@/lib/feature-access'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { canAccessTenant, getActor } from '@/lib/auth'
import { loadSlipDetail } from '@/lib/features/slips/detail'
import { UUID } from '@/lib/utils'

export const runtime = 'nodejs'

/** GET: slip row + SlipOK details + a 10-minute signed image URL (the bucket is private). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor(req)
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'id must be a uuid' }, { status: 400 })
  try {
    const db = supabaseAdmin()
    const { data: scope, error } = await db.from('slips').select('tenant_id').eq('id', id).maybeSingle()
    if (error) throw new Error('slip scope lookup failed')
    if (!scope || !(await canAccessTenant(actor, scope.tenant_id))) return NextResponse.json({ error: 'slip not found' }, { status: 404 })
    if (!(await hasFeature(db, scope.tenant_id, 'customer_management'))) return featureLockedResponse('customer_management')
    if (!(await hasFeature(db, scope.tenant_id, 'slip_auto_pilot'))) return featureLockedResponse('slip_auto_pilot')
    const slip = await loadSlipDetail(db, id, scope.tenant_id)
    if (!slip || slip.tenant_id !== scope.tenant_id) return NextResponse.json({ error: 'slip not found' }, { status: 404 })
    return NextResponse.json({ slip }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[slip detail]', e)
    return NextResponse.json({ error: 'slip lookup failed' }, { status: 500 })
  }
}
