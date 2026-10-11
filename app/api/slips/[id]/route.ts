import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { canAccessTenant, getActor } from '@/lib/auth'
import { loadSlipDetail } from '@/lib/slip/detail'
import { UUID } from '@/lib/utils'

export const runtime = 'nodejs'

/** GET: slip row + SlipOK details + a 10-minute signed image URL (the bucket is private). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor(req)
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'id must be a uuid' }, { status: 400 })
  try {
    const slip = await loadSlipDetail(supabaseAdmin(), id)
    if (!slip || !(await canAccessTenant(actor, slip.tenant_id))) return NextResponse.json({ error: 'slip not found' }, { status: 404 })
    return NextResponse.json({ slip }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[slip detail]', e)
    return NextResponse.json({ error: 'slip lookup failed' }, { status: 500 })
  }
}
