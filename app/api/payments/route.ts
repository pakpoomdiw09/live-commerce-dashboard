import { NextRequest, NextResponse } from 'next/server'
import { canAccessTenant, getActor } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import { PLANS } from '@/lib/features/billing/plans'
import {
  PAYMENT_SESSION_COLUMNS,
  paymentReceiver,
  publicPaymentSession,
  type PaymentSessionRow,
} from '@/lib/features/payments/payments'
import { UUID } from '@/lib/utils'

export const runtime = 'nodejs'
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

/** Server-controlled amount, credits, receiver and expiry for a package purchase. */
export async function POST(req: NextRequest) {
  const actor = await getActor(req)
  if (!actor) return bad('กรุณาเข้าสู่ระบบ', 401)
  const body = await req.json().catch(() => null)
  const tenantId = String(body?.tenantId ?? '')
  const plan = body?.plan
  if (!UUID.test(tenantId) || (plan !== 'starter' && plan !== 'pro'))
    return bad('ร้านหรือแพ็กเกจไม่ถูกต้อง')
  if (!(await canAccessTenant(actor, tenantId, 'owner')))
    return bad('เฉพาะเจ้าของร้านที่ชำระค่าแพ็กเกจได้', 403)
  try {
    const receiver = paymentReceiver()
    const pack = PLANS[plan as 'starter' | 'pro']
    const { data, error } = await supabaseAdmin()
      .from('payment_sessions')
      .insert({
        tenant_id: tenantId,
        plan,
        price_baht: pack.price,
        credits: pack.credits,
        requested_by: actor.kind === 'user' ? actor.id : null,
        receiver_promptpay_id: receiver.promptpayId,
        receiver_account_no: receiver.bankAccountNo,
        receiver_account_name: receiver.bankAccountName,
        receiver_bank_name: receiver.bankName,
        receiver_bank_code: receiver.bankCode,
      })
      .select(PAYMENT_SESSION_COLUMNS)
      .single()
    if (error) {
      console.error('[payments] create failed', error.code)
      return bad('สร้างรายการชำระเงินไม่ได้ กรุณาติดต่อผู้ดูแลระบบ', 503)
    }
    return NextResponse.json(
      { session: publicPaymentSession(data as PaymentSessionRow) },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch {
    return bad('ยังไม่ได้ตั้งค่าระบบชำระเงิน กรุณาติดต่อผู้ดูแล', 503)
  }
}
