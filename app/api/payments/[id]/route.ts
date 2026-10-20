import { NextRequest, NextResponse } from 'next/server'
import { canAccessTenant, getActor } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import { getBilling } from '@/lib/features/billing/billing'
import { PAYMENT_SESSION_COLUMNS, paymentReceiver, publicPaymentSession, type PaymentSessionRow } from '@/lib/features/payments/payments'
import { UUID } from '@/lib/utils'

export const runtime = 'nodejs'
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor(req)
  if (!actor) return bad('กรุณาเข้าสู่ระบบ', 401)
  const { id } = await params
  if (!UUID.test(id)) return bad('รายการชำระเงินไม่ถูกต้อง')
  try {
    const db = supabaseAdmin()
    const { data, error } = await db.from('payment_sessions').select(PAYMENT_SESSION_COLUMNS).eq('id', id).maybeSingle()
    if (error) return bad('อ่านรายการชำระเงินไม่ได้', 503)
    const row = data as PaymentSessionRow | null
    if (!row?.tenant_id || !(await canAccessTenant(actor, row.tenant_id, 'owner'))) return bad('ไม่พบรายการชำระเงิน', 404)
    let status = row.status === 'paid' ? 'paid' : new Date(row.expires_at).getTime() <= Date.now() ? 'expired' : 'pending'
    if (row.status !== 'paid') {
      const { data: proof, error: proofError } = await db.from('payment_receipts').select('session_id').eq('session_id', id).maybeSingle()
      if (proofError) return bad('ตรวจประวัติการชำระเงินไม่ได้', 503)
      if (proof) status = 'verified'
    }
    let receiverChanged = false
    if (status === 'pending') {
      const receiver = paymentReceiver()
      receiverChanged = row.receiver_promptpay_id !== receiver.promptpayId
        || row.receiver_account_no !== receiver.bankAccountNo
        || row.receiver_account_name !== receiver.bankAccountName
        || row.receiver_bank_name !== receiver.bankName
        || row.receiver_bank_code !== receiver.bankCode
    }
    return NextResponse.json({
      receiverChanged,
      session: publicPaymentSession(row), status,
      ...(status === 'paid' ? { billing: await getBilling(db, row.tenant_id) } : {}),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return bad('ตรวจสถานะการชำระเงินไม่ได้', 503)
  }
}
