import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { canAccessTenant, getActor } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import { getBilling } from '@/lib/billing'
import { PAYMENT_SESSION_COLUMNS, type PaymentSessionRow } from '@/lib/payments'
import { isPaymentImage, PAYMENT_MAX_BYTES, validatePaymentSlip } from '@/lib/payment-validation'
import { verifyWithSlipOK } from '@/lib/slip/slipok'
import { UUID } from '@/lib/utils'

export const runtime = 'nodejs'
export const maxDuration = 60
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

/** A genuine SlipOK proof is persisted before activation so a failed activation can retry safely. */
export async function POST(req: NextRequest) {
  const actor = await getActor(req)
  if (!actor) return bad('กรุณาเข้าสู่ระบบ', 401)
  if (Number(req.headers.get('content-length') ?? 0) > PAYMENT_MAX_BYTES + 64 * 1024) return bad('สลิปต้องมีขนาดไม่เกิน 5 MB', 413)
  let form: FormData
  try { form = await req.formData() } catch { return bad('กรุณาอัปโหลดสลิปด้วย multipart/form-data') }
  const sessionId = String(form.get('sessionId') ?? '')
  if (!UUID.test(sessionId)) return bad('รายการชำระเงินไม่ถูกต้อง')

  try {
    const db = supabaseAdmin()
    const { data, error } = await db.from('payment_sessions').select(PAYMENT_SESSION_COLUMNS).eq('id', sessionId).maybeSingle()
    if (error) return bad('อ่านรายการชำระเงินไม่ได้ กรุณาลองอีกครั้งหรือติดต่อผู้ดูแล', 503)
    const session = data as PaymentSessionRow | null
    if (!session?.tenant_id || !(await canAccessTenant(actor, session.tenant_id, 'owner'))) return bad('ไม่พบรายการชำระเงิน', 404)
    if (session.status === 'paid') {
      return NextResponse.json({ success: true, sessionId, billing: await getBilling(db, session.tenant_id) }, { headers: { 'Cache-Control': 'no-store' } })
    }

    const { data: proof, error: proofError } = await db.from('payment_receipts').select('session_id').eq('session_id', sessionId).maybeSingle()
    if (proofError) return bad('ตรวจประวัติการชำระเงินไม่ได้', 503)
    if (!proof) {
      if (new Date(session.expires_at).getTime() <= Date.now()) return bad('QR รายการนี้หมดเวลาแล้ว กรุณาเปิดรายการชำระเงินใหม่', 410)
      const entry = form.get('file')
      if (!(entry instanceof File) || !(await isPaymentImage(entry))) return bad('กรุณาเลือกสลิป JPG, PNG หรือ WebP ขนาดไม่เกิน 5 MB')
      if (!process.env.SLIPOK_BRANCH_ID?.trim() || !process.env.SLIPOK_API_KEY?.trim()) return bad('ระบบตรวจสลิปยังไม่พร้อม กรุณาติดต่อผู้ดูแล', 503)
      const hash = createHash('sha256').update(Buffer.from(await entry.arrayBuffer())).digest('hex')
      const { data: previous, error: duplicateError } = await db.from('payment_receipts').select('session_id').eq('image_sha256', hash).maybeSingle()
      if (duplicateError) return bad('ตรวจสลิปซ้ำไม่ได้ กรุณาลองอีกครั้ง', 503)
      if (previous && previous.session_id !== sessionId) return bad('สลิปนี้เคยใช้ชำระเงินแล้ว', 409)
      if (!previous) {
        // SlipOK log:true verifies the receiver configured in its Dashboard.
        // Shared database transfer/image ledgers still reject duplicates atomically.
        const result = await verifyWithSlipOK({ file: entry, log: true })
        const slipokData = result.raw
        console.log('=== SLIPOK RESPONSE DATA ===', JSON.stringify(slipokData, null, 2))
        const checked = validatePaymentSlip(result, session, Date.now(), false, 'provider')
        if (!checked.ok) {
          console.warn('[payments] slip rejected', { sessionId, tenantId: session.tenant_id, plan: session.plan, expectedAmount: session.price_baht, receivedAmount: result.amount, verdict: result.verdict, reason: checked.error })
          return bad(checked.error, checked.status)
        }
        console.log('[payments] slip validated', { sessionId, tenantId: session.tenant_id, expectedAmount: session.price_baht, receivedAmount: checked.amount })
        const { error: saveError } = await db.from('payment_receipts').insert({
          session_id: sessionId, trans_ref: checked.transRef, image_sha256: hash,
          amount: checked.amount, paid_at: checked.paidAt,
        })
        if (saveError) {
          if (saveError.code === '23505') {
            // A simultaneous retry of this same checkout may already have recorded its proof.
            const { data: same, error: sameError } = await db.from('payment_receipts').select('trans_ref,image_sha256').eq('session_id', sessionId).maybeSingle()
            if (sameError || !same || same.trans_ref !== checked.transRef || same.image_sha256 !== hash) return bad('สลิปนี้เคยใช้ชำระเงินแล้ว', 409)
          } else {
            console.error('[payments] proof save failed', saveError.code)
            return bad('สลิปตรวจผ่าน แต่บันทึกการชำระเงินไม่ได้ กรุณาติดต่อผู้ดูแลพร้อมสลิปเดิม และไม่ต้องโอนซ้ำ', 503)
          }
        }
      }
    }

    const { data: billing, error: applyError } = await db.rpc('activate_payment', { p_session: sessionId })
    if (applyError || !billing) {
      console.error('[payments] activation failed', { sessionId, tenantId: session.tenant_id, code: applyError?.code })
      return bad('บันทึกสลิปแล้ว แต่เปิดแพ็กเกจไม่สำเร็จ กดตรวจสอบอีกครั้งได้โดยไม่ต้องโอนซ้ำ', 503)
    }
    const updatedBilling = await getBilling(db, session.tenant_id)
    console.log('[payments] payment activated', { sessionId, tenantId: session.tenant_id, status: 'paid', plan: updatedBilling.plan, credits: session.credits, balance: updatedBilling.monthly })
    return NextResponse.json({ success: true, sessionId, billing: updatedBilling }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[payments] verification failed', { sessionId, errorType: error instanceof Error ? error.name : 'UnknownError' })
    return bad('ระบบชำระเงินไม่พร้อม กรุณาลองอีกครั้งหรือติดต่อผู้ดูแล', 503)
  }
}
