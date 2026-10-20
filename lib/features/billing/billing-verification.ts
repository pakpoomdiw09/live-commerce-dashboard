import 'server-only'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getBilling } from '@/lib/features/billing/billing'
import { paymentReceiver } from '@/lib/features/payments/payments'
import { validatePaymentSlip } from '@/lib/features/payments/payment-validation'
import { verifyWithSlipOK } from '@/lib/features/slips/slipok'

export type VerifiableBillingRequest = {
  tenant_id: string; status: string; proof_path: string | null; price_baht: number; created_at: string
  receiver_promptpay_id: string | null; receiver_account_no: string | null; receiver_bank_code: string | null
}
export const BILLING_VERIFICATION_COLUMNS = 'tenant_id,status,proof_path,price_baht,created_at,receiver_promptpay_id,receiver_account_no,receiver_bank_code'
export const APPROVAL_SUCCESS = 'อนุมัติสำเร็จ! ระบบเพิ่มเครดิตให้เรียบร้อยแล้ว'

/** Trusted proofs persist before credit activation, so activation retries never call SlipOK again. */
export async function verifyBillingRequest(db: SupabaseClient, id: string, request: VerifiableBillingRequest, uploaded?: File) {
  const pending = async (message: string, verified = false) => {
    await db.from('billing_requests').update({ verification_status: verified ? 'verified' : 'failed', verification_error: message })
      .eq('id', id).eq('status', 'pending')
    return { ok: true, status: 'pending' as const, message: `${message} · คำสั่งซื้อยังรอผู้ดูแลตรวจสอบ`, verified }
  }
  const { data: receipt, error: receiptError } = await db.from('billing_payment_receipts').select('request_id').eq('request_id', id).maybeSingle()
  if (receiptError) return pending('ระบบตรวจสอบอัตโนมัติยังไม่พร้อม กรุณาติดต่อผู้ดูแล')
  if (!receipt) {
    if (!process.env.SLIPOK_BRANCH_ID?.trim() || !process.env.SLIPOK_API_KEY?.trim()) return pending('ยังไม่ได้ตั้งค่าระบบตรวจสลิป')
    let receiver: ReturnType<typeof paymentReceiver>
    try {
      receiver = request.receiver_account_no && request.receiver_bank_code && request.receiver_promptpay_id
        ? { promptpayId: request.receiver_promptpay_id, bankAccountNo: request.receiver_account_no, bankCode: request.receiver_bank_code, bankAccountName: '', bankName: '' }
        : paymentReceiver()
    } catch { return pending('ยังไม่ได้ตั้งค่าบัญชีรับเงินสำหรับตรวจอัตโนมัติ') }
    let file = uploaded
    if (!file) {
      if (!request.proof_path) return pending('ยังไม่ได้แนบสลิป')
      const { data: image, error } = await db.storage.from('billing-proofs').download(request.proof_path)
      if (error || !image) return pending('อ่านสลิปที่แนบไม่ได้ กรุณาลองใหม่')
      file = new File([image], 'slip', { type: image.type })
    }
    const hash = createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex')
    const { error: hashError } = await db.from('billing_requests').update({ proof_sha256: hash }).eq('id', id).eq('status', 'pending')
    if (hashError) return pending('บันทึกข้อมูลสลิปไม่สำเร็จ กรุณาลองใหม่')
    const { data: imageClaim, error: imageError } = await db.from('payment_image_ledger').select('source,source_id').eq('image_sha256', hash).maybeSingle()
    if (imageError) return pending('ตรวจประวัติสลิปซ้ำไม่ได้ กรุณาลองใหม่')
    if (imageClaim && (imageClaim.source !== 'billing' || imageClaim.source_id !== id)) return pending('สลิปนี้เคยใช้ชำระเงินแล้ว')
    // Validate the exact order amount locally after SlipOK verifies the Dashboard receiver.
    const result = await verifyWithSlipOK({ file, log: true })
    const now = Date.now()
    const checked = validatePaymentSlip(result, {
      price_baht: request.price_baht, created_at: request.created_at,
      expires_at: new Date(now + 120_000).toISOString(),
      receiver_promptpay_id: receiver.promptpayId, receiver_account_no: receiver.bankAccountNo, receiver_bank_code: receiver.bankCode,
    }, now, false, 'provider')
    if (!checked.ok) return pending(checked.error)
    const { data: claim, error: claimError } = await db.from('payment_transfer_ledger').select('source,source_id').eq('trans_ref', checked.transRef).maybeSingle()
    if (claimError) return pending('ตรวจเลขอ้างอิงธุรกรรมซ้ำไม่ได้ กรุณาลองใหม่')
    if (claim && (claim.source !== 'billing' || claim.source_id !== id)) return pending('เลขอ้างอิงธุรกรรมนี้เคยใช้ในระบบแล้ว')
    const { error: saveError } = await db.from('billing_payment_receipts').insert({
      request_id: id, trans_ref: checked.transRef, image_sha256: hash, amount: checked.amount, paid_at: checked.paidAt,
    })
    if (saveError) {
      const { data: same, error: sameError } = await db.from('billing_payment_receipts').select('trans_ref,image_sha256').eq('request_id', id).maybeSingle()
      if (sameError || !same || same.trans_ref !== checked.transRef || same.image_sha256 !== hash) {
        return pending(saveError.code === '23505' ? 'สลิปนี้เคยใช้ชำระเงินแล้ว' : 'สลิปตรวจผ่าน แต่บันทึกผลไม่สำเร็จ กรุณาติดต่อผู้ดูแลและไม่ต้องโอนซ้ำ')
      }
    }
  }
  const { data: approved, error } = await db.rpc('activate_billing_payment', { p_request: id })
  if (error || approved !== true) return pending('บันทึกผลตรวจแล้ว แต่เพิ่มเครดิตไม่สำเร็จ กดตรวจสอบอีกครั้งได้โดยไม่ต้องโอนซ้ำ', true)
  const billing = await getBilling(db, request.tenant_id).catch(() => null)
  return { ok: true, status: 'approved' as const, message: APPROVAL_SUCCESS, billing }
}
