import 'server-only'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { paymentProConfig, paymentProAvailable } from '@/lib/features/payments/payment-pro-flags'
import {
  amountSatang,
  evaluatePayment,
  providerPaidAt,
} from '@/lib/features/payments/payment-pro-core'
import { verifyWithSlipOK } from '@/lib/features/slips/slipok'
import { receiverMatchesAny } from '@/lib/features/slips/receiver-matching'
import type { ProcessedSlip, SlipInput } from '@/lib/features/slips/process'
import { validateVisionFile } from '@/lib/features/vision/vision-image'
type ClaimedPayment = {
  id: string
  slip_id: string
  customer_id: string | null
  claim_token: string | null
  expected_satang: number | null
  image_path: string | null
}

export async function processPaymentPro(
  db: SupabaseClient,
  input: SlipInput,
): Promise<ProcessedSlip | null> {
  if (!input.tenant) return null
  const tenantId = input.tenant.id,
    flags = await paymentProConfig(db, tenantId)
  if (!flags?.riskEngine) return null
  if (input.file) await validateVisionFile(input.file)
  const hash = createHash('sha256')
    .update(input.file ? Buffer.from(await input.file.arrayBuffer()) : String(input.qr ?? ''))
    .digest('hex')
  const existing = await db
    .from('payment_pro_attempts')
    .select('id,slip_id,status,customer_id')
    .eq('tenant_id', tenantId)
    .eq('proof_sha256', hash)
    .maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data)
    return existing.data.customer_id !== (input.customerId ?? null)
      ? duplicateProof()
      : readResult(db, existing.data.slip_id, tenantId)
  const imagePath = input.file ? `payment-pro/${tenantId}/${crypto.randomUUID()}` : null
  if (imagePath) {
    const upload = await db.storage
      .from('slips')
      .upload(imagePath, input.file!, { contentType: input.file!.type })
    if (upload.error) throw new Error('จัดเก็บหลักฐานไม่สำเร็จ')
  }
  const claim = await db.rpc('claim_payment_pro', {
    p_tenant: tenantId,
    p_customer: input.customerId ?? null,
    p_message: input.messageId ?? null,
    p_hash: hash,
    p_image: imagePath,
    p_kind: input.file ? 'image' : 'qr',
  })
  if (claim.error) {
    if (imagePath) await db.storage.from('slips').remove([imagePath])
    throw claim.error
  }
  const attempt = claim.data as ClaimedPayment
  if (imagePath && attempt.image_path !== imagePath)
    await db.storage.from('slips').remove([imagePath])
  if (!attempt.claim_token)
    return attempt.customer_id !== (input.customerId ?? null)
      ? duplicateProof()
      : readResult(db, attempt.slip_id, tenantId)
  return verifyClaimedPayment(db, input, attempt)
}
async function verifyClaimedPayment(
  db: SupabaseClient,
  input: SlipInput,
  attempt: ClaimedPayment,
): Promise<ProcessedSlip> {
  const tenantId = input.tenant!.id
  try {
    const accounts = await db
      .from('bank_accounts')
      .select('bank_code,account_number,is_active')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
    if (accounts.error) throw accounts.error
    if (!accounts.data?.length) throw new Error('NO_ACTIVE_RECEIVER')
    const started = await db.rpc('start_payment_pro_provider', {
      p_attempt: attempt.id,
      p_claim: attempt.claim_token,
    })
    if (started.error) throw started.error
    if (started.data !== true) return readResult(db, attempt.slip_id, tenantId)
    // Existing adapter, endpoint, API key, request defaults and response contract are unchanged.
    const verdict = await verifyWithSlipOK({
      file: input.file,
      qr: input.qr,
      expectedAmount: attempt.expected_satang ? Number(attempt.expected_satang) / 100 : undefined,
    })
    const duplicate = verdict.transRef
      ? await db
          .from('payment_transfer_ledger')
          .select('source_id')
          .eq('trans_ref', verdict.transRef)
          .maybeSingle()
      : { data: null, error: null }
    if (duplicate.error) throw duplicate.error
    const evaluation = evaluatePayment({
      providerVerified: verdict.verdict === 'valid' || verdict.branchReceiverMismatch === true,
      transactionRef: verdict.transRef,
      expectedAmountSatang:
        attempt.expected_satang === null ? null : Number(attempt.expected_satang),
      verifiedAmountSatang: amountSatang(verdict.amount),
      receiverMatches: receiverMatchesAny(
        accounts.data,
        verdict.receiverBank,
        verdict.receiverAccount,
        verdict.receiverProxy,
      ),
      duplicateTransaction: verdict.verdict === 'duplicate' || !!duplicate.data,
      providerError: verdict.providerFault,
    })
    const saved = await db.rpc('complete_payment_pro', {
      p_attempt: attempt.id,
      p_claim: attempt.claim_token,
      p_evidence: {
        auto_permitted: paymentProAvailable(),
        provider_verified: verdict.verdict === 'valid' || verdict.branchReceiverMismatch === true,
        provider_fault: verdict.providerFault === true,
        provider_verdict: verdict.verdict,
        amount_satang: amountSatang(verdict.amount),
        trans_ref: verdict.transRef ?? null,
        receiver_bank: verdict.receiverBank ?? null,
        receiver_account: verdict.receiverAccount ?? null,
        receiver_proxy: verdict.receiverProxy ?? null,
        paid_at: providerPaidAt(verdict.raw),
        raw: verdict.raw,
        engine_decision: evaluation.decision,
        engine_reason: evaluation.reason,
      },
    })
    if (saved.error) throw saved.error
  } catch (error) {
    console.error('[payment-pro] verification needs review', {
      attemptId: attempt.id,
      code: (error as { code?: string })?.code ?? 'PROCESSING_FAILED',
    })
    const failed = await db.rpc('review_payment_pro_failure', {
      p_attempt: attempt.id,
      p_claim: attempt.claim_token,
    })
    if (failed.error)
      console.error('[payment-pro] recovery pending', {
        attemptId: attempt.id,
        code: failed.error.code,
      })
  }
  return readResult(db, attempt.slip_id, tenantId, true)
}
/** Owner-requested recovery of an image whose previous attempt NEVER reached SlipOK. */
export async function resumePaymentPro(db: SupabaseClient, attemptId: string, tenantId: string) {
  const row = await db
    .from('payment_pro_attempts')
    .select(
      'id,slip_id,customer_id,message_id,claim_token,expected_satang,image_path,provider_started_at,status',
    )
    .eq('id', attemptId)
    .eq('tenant_id', tenantId)
    .single()
  if (
    row.error ||
    !row.data ||
    row.data.provider_started_at ||
    row.data.status !== 'VERIFYING' ||
    !row.data.claim_token ||
    !row.data.image_path
  )
    throw new Error('UNSAFE_PAYMENT_RETRY')
  const attempt = row.data
  try {
    const image = await db.storage.from('slips').download(attempt.image_path)
    if (image.error || !image.data) throw new Error('PAYMENT_IMAGE_UNAVAILABLE')
    const file = new File([image.data], 'slip', { type: image.data.type })
    await validateVisionFile(file)
    return await verifyClaimedPayment(
      db,
      {
        file,
        tenant: { id: tenantId, account_number: null, bank_code: null },
        customerId: attempt.customer_id,
        messageId: attempt.message_id,
      },
      attempt,
    )
  } catch (error) {
    await db.rpc('review_payment_pro_failure', {
      p_attempt: attempt.id,
      p_claim: attempt.claim_token,
    })
    throw error
  }
}
const duplicateProof = (): ProcessedSlip => ({
  status: 'duplicate',
  amount: null,
  transRef: null,
  note: 'หลักฐานนี้ถูกส่งสำหรับลูกค้ารายอื่นแล้ว กรุณาใช้หลักฐานของรายการนี้',
  paymentPro: true,
  automationAllowed: false,
})
async function readResult(
  db: SupabaseClient,
  slipId: string,
  tenantId: string,
  allowNotify = false,
): Promise<ProcessedSlip> {
  const result = await db
    .from('slips')
    .select('id,status,amount,trans_ref,note')
    .eq('id', slipId)
    .eq('tenant_id', tenantId)
    .single()
  if (result.error) throw result.error
  const flags = await paymentProConfig(db, tenantId)
  return {
    id: result.data.id,
    status: result.data.status,
    amount: result.data.amount,
    transRef: result.data.trans_ref,
    note: result.data.note,
    paymentPro: true,
    automationAllowed:
      allowNotify &&
      result.data.status === 'valid' &&
      process.env.NODE_ENV === 'production' &&
      process.env.PAYMENT_PRO_SEND_ENABLED === 'true' &&
      flags?.messengerAutomation === true,
  }
}
