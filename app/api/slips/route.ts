import { NextRequest, NextResponse } from 'next/server'
import { canAccessTenant, getActor } from '@/lib/auth'
import { getActiveTenant, tenantFilter } from '@/lib/tenant'
import { supabaseServer } from '@/lib/supabase/server'
import { SLIP_COLUMNS } from '@/lib/types'
import { UUID } from '@/lib/utils'
import { InboxError, inboxError } from '@/lib/inbox-server'

/** Session/RLS read endpoint. Verification remains in /api/slips/verify. */
export async function GET(req: NextRequest) {
  try {
    const actor = await getActor(req)
    if (!actor || actor.kind !== 'user') throw new InboxError('กรุณาเข้าสู่ระบบ', 401)
    const tenantId = req.nextUrl.searchParams.get('tenantId') ?? (await getActiveTenant())?.id ?? ''
    if (!UUID.test(tenantId) || !await canAccessTenant(actor, tenantId)) throw new InboxError('ไม่พบร้านค้าหรือไม่มีสิทธิ์', 404)
    const limit = Number(req.nextUrl.searchParams.get('limit') ?? '200')
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new InboxError('จำนวนรายการต้องอยู่ระหว่าง 1 ถึง 200', 400)
    const db = await supabaseServer()
    const { data, error } = await db.from('slips').select(`${SLIP_COLUMNS}, customers(display_name)`).or(tenantFilter(tenantId)).order('created_at', { ascending: false }).limit(limit)
    if (error) throw new InboxError('โหลดประวัติสลิปไม่ได้ กรุณาลองใหม่', 503, 'SLIPS_UNAVAILABLE')
    return NextResponse.json({ slips: data ?? [] }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return inboxError(error) }
}
