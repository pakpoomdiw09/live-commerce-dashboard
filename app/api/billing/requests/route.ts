import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { canAccessTenant, getActor } from '@/lib/auth'
import { BILLING_ITEMS, BILLING_REQUEST_COLUMNS, type BillingItem } from '@/lib/plans'
import { UUID } from '@/lib/utils'
import { paymentReceiver } from '@/lib/payments'

export const runtime = 'nodejs'

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

/**
 * Buy a plan month or a top-up pack. Body: { tenantId, item }. Shop owners only.
 * Nothing changes until a platform admin approves the request (after the payment arrives).
 */
export async function POST(req: NextRequest) {
  const actor = await getActor(req)
  if (!actor) return bad('unauthorized', 401)
  const body = await req.json().catch(() => null)
  const tenantId = String(body?.tenantId ?? '')
  const item = String(body?.item ?? '') as BillingItem
  if (!UUID.test(tenantId)) return bad('tenantId must be a uuid')
  if (!Object.hasOwn(BILLING_ITEMS, item)) return bad('unknown item')
  if (!(await canAccessTenant(actor, tenantId, 'owner'))) return bad('เฉพาะเจ้าของร้านเท่านั้นที่สั่งซื้อแพ็กเกจได้', 403)

  const db = supabaseAdmin()

  const { price, credits } = BILLING_ITEMS[item]
  let receiver = {}
  try {
    const configured = paymentReceiver()
    receiver = { receiver_promptpay_id: configured.promptpayId, receiver_account_no: configured.bankAccountNo, receiver_bank_code: configured.bankCode }
  } catch { /* Keep manual approval available when automatic receiver setup is incomplete. */ }
  const { data, error } = await db
    .from('billing_requests')
    .insert({ tenant_id: tenantId, item, price_baht: price, credits, ...receiver, requested_by: actor.kind === 'user' ? actor.id : null })
    .select(BILLING_REQUEST_COLUMNS)
    .single()
  if (error?.code === '23505') {
    const { data: existing, error: lookupError } = await db.from('billing_requests').select(BILLING_REQUEST_COLUMNS)
      .eq('tenant_id', tenantId).eq('item', item).eq('status', 'pending').maybeSingle()
    if (!lookupError && existing) return NextResponse.json({ request: existing })
    return bad('มีคำสั่งซื้อรายการนี้รออนุมัติอยู่แล้ว กรุณาเปิดประวัติการสั่งซื้อ', 409)
  }
  if (error) return bad(error.message, 500)
  return NextResponse.json({ request: data })
}
