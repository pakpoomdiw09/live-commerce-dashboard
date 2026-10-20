import { hasFeature, featureLockedResponse } from '@/lib/feature-access'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { canAccessTenant, getActor } from '@/lib/auth'
import { MissingPageTokenError, pageTokenFor } from '@/lib/integrations/facebook/client'
import { sendSlipConfirmation } from '@/lib/features/slips/notify'
import { UUID } from '@/lib/utils'

export const runtime = 'nodejs'

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

/** POST: send the "payment received" card to the customer in Messenger. Once per slip. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor(req)
  if (!actor) return bad('unauthorized', 401)
  const { id } = await params
  if (!UUID.test(id)) return bad('id must be a uuid')

  const db = supabaseAdmin()
  const { data, error } = await db
    .from('slips')
    .select('id, tenant_id, status, amount, trans_ref, approved_at, customers(id, platform_user_id), tenants(name, page_id, page_access_token)')
    .eq('id', id)
    .maybeSingle()
  if (error) return bad(error.message, 500)
  if (!data || !(await canAccessTenant(actor, data.tenant_id))) return bad('slip not found', 404)
  if (!(await hasFeature(db, data.tenant_id, 'customer_management'))) return featureLockedResponse('customer_management')
  // embedded to-one relations come back as an object (typed loosely by supabase-js without generated types)
  const customer = data.customers as unknown as { id: string; platform_user_id: string } | null
  const tenant = data.tenants as unknown as { name: string; page_id: string | null; page_access_token: string | null } | null
  if (!customer) return bad('สลิปนี้ไม่ได้ผูกกับลูกค้าในแชท', 409)
  if (data.status !== 'valid' && !data.approved_at) return bad('ยืนยันได้เฉพาะสลิปที่ถูกต้องหรืออนุมัติแล้ว', 409)
  const token = pageTokenFor(tenant)
  if (!token) return bad(new MissingPageTokenError().message, 409)

  try {
    const sent = await sendSlipConfirmation(db, data, { id: customer.id, psid: customer.platform_user_id, token }, tenant?.name)
    return NextResponse.json({ ok: true, alreadySent: !sent })
  } catch (e) {
    console.error('[confirm] Send API failed', e)
    const msg = e instanceof Error ? e.message : 'send failed'
    return bad(msg.includes('2018278') ? 'ส่งไม่ได้: เกิน 24 ชั่วโมงนับจากข้อความล่าสุดของลูกค้า' : msg, 502)
  }
}
