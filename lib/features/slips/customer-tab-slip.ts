import 'server-only'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { verifyWithSlipOK } from './slipok'
import { receiverMatchesAny } from './receiver-matching'
import { providerPaidAt } from '@/lib/features/payments/payment-pro-core'
import type { ProcessedSlip, SlipInput } from './process'
import type { TabBalance } from '@/lib/features/commerce/customer-tab-types'
import type { PaymentImageMimeType } from '@/lib/features/payments/payment-validation'

/** One provider attempt per image; a validated partial payment is committed with the ledger. */
export async function processCustomerTabSlip(
  db: SupabaseClient,
  input: SlipInput,
  tabIds: string[],
  fileMimeType: PaymentImageMimeType | null,
): Promise<ProcessedSlip> {
  const tenantId = input.tenant!.id
  const selected = await db
    .from('customer_tabs')
    .select('id,remaining_amount,created_at')
    .eq('tenant_id', tenantId)
    .eq('customer_id', input.customerId!)
    .in('id', tabIds)
    .order('created_at')
    .limit(1)
    .maybeSingle()
  if (selected.error) throw selected.error
  if (!selected.data || Number(selected.data.remaining_amount) <= 0)
    throw new Error('TAB_NOT_PAYABLE')
  if (
    input.requireExactAmount &&
    (!input.expectedAmount ||
      Math.abs(input.expectedAmount - Number(selected.data.remaining_amount)) > 0.005 ||
      !input.auctionSenderId)
  )
    throw new Error('AUCTION_TAB_AMOUNT_CHANGED')
  const selections = await db
    .from('orders')
    .select('live_variant_selection_required,live_variant_confirmed_at')
    .eq('customer_tab_id', selected.data.id)
    .eq('tenant_id', tenantId)
  if (selections.error) throw selections.error
  if (
    selections.data.some(
      (row) => row.live_variant_selection_required && !row.live_variant_confirmed_at,
    )
  )
    return {
      status: 'error',
      amount: null,
      transRef: null,
      note: 'กรุณาเลือกรูปแบบสินค้าและยืนยันราคาในลิงก์บิลก่อนส่งสลิปครับ',
    }
  const bytes = input.file
    ? Buffer.from(await input.file.arrayBuffer())
    : Buffer.from(input.qr ?? '')
  const hash = createHash('sha256').update(bytes).digest('hex')
  const previous = await db
    .from('customer_tab_slip_attempts')
    .select('slip_id')
    .eq('tenant_id', tenantId)
    .eq('image_sha256', hash)
    .maybeSingle()
  if (previous.error) throw previous.error
  const readResult = async (id: string): Promise<ProcessedSlip> => {
    const stored = await db
      .from('slips')
      .select('id,status,amount,trans_ref,note,customer_id,customer_tab_id')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()
    if (stored.error) throw stored.error
    if (
      stored.data.customer_id !== input.customerId ||
      stored.data.customer_tab_id !== selected.data!.id
    )
      return {
        status: 'duplicate',
        amount: null,
        transRef: null,
        note: 'หลักฐานนี้ถูกใช้กับบิลอื่นแล้ว',
      }
    if (stored.data.status === 'pending')
      return {
        id,
        status: 'error',
        amount: null,
        transRef: null,
        note: 'สลิปกำลังตรวจสอบหรือรอตรวจสอบผลการส่ง ห้ามส่งซ้ำอัตโนมัติ',
      }
    const tab = await db
      .from('customer_tabs')
      .select('id,total_amount,paid_amount,remaining_amount,status')
      .eq('id', selected.data!.id)
      .single()
    if (tab.error) throw tab.error
    return {
      id,
      status: stored.data.status,
      amount: stored.data.amount,
      transRef: stored.data.trans_ref,
      note: stored.data.note,
      tabBalance: {
        tabId: tab.data.id,
        totalAmount: Number(tab.data.total_amount),
        paidAmount: Number(tab.data.paid_amount),
        remainingAmount: Number(tab.data.remaining_amount),
        status: tab.data.status,
      },
    }
  }
  if (previous.data) return readResult(previous.data.slip_id)
  const imagePath = input.file ? `tabs/${tenantId}/${crypto.randomUUID()}` : null
  if (imagePath) {
    const upload = await db.storage
      .from('slips')
      .upload(imagePath, input.file!, { contentType: fileMimeType! })
    if (upload.error) throw upload.error
  }
  const claim = await db.rpc('claim_customer_tab_slip', {
    p_tab: selected.data.id,
    p_customer: input.customerId,
    p_hash: hash,
    p_image: imagePath,
    p_message: input.messageId ?? null,
  })
  if (claim.error) {
    // Check the database before cleanup: transport failures can hide a committed RPC.
    if (imagePath) await removeIfUnclaimed(db, imagePath)
    throw claim.error
  }
  if (!claim.data?.slipId) {
    if (imagePath) await removeIfUnclaimed(db, imagePath)
    throw new Error('TAB_SLIP_CLAIM_INVALID')
  }
  if (!claim.data.claimed) {
    if (imagePath && imagePath !== claim.data.imagePath)
      await removeIfUnclaimed(db, imagePath)
    return readResult(claim.data.slipId)
  }
  const slipId = claim.data.slipId as string
  let charged = false
  try {
    const accounts = await db
      .from('bank_accounts')
      .select('bank_code,account_number,is_active')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
    if (accounts.error || !accounts.data?.length) throw new Error('TAB_RECEIVER_UNAVAILABLE')
    const credit = await db.rpc('consume_slip_credit', { p_tenant: tenantId })
    if (credit.error || credit.data !== true) throw new Error('TAB_SLIP_CREDIT_UNAVAILABLE')
    charged = true
    // Auction bills require an exact amount; ordinary customer tabs may be partially paid.
    const result = await verifyWithSlipOK({
      file: input.file,
      qr: input.qr,
      bankAccounts: accounts.data.map((account) => ({
        accountNo: account.account_number,
        bankCode: account.bank_code,
      })),
      ...(input.requireExactAmount
        ? { expectedAmount: Number(selected.data.remaining_amount) }
        : {}),
    })
    console.info('[customer-tabs/payment] SlipOK returned', {
      tabId: selected.data.id,
      slipId,
      verdict: result.verdict,
      amount: result.amount ?? null,
      expectedAmount: input.requireExactAmount ? Number(selected.data.remaining_amount) : null,
      providerFault: result.providerFault === true,
    })
    if (result.providerFault && charged) {
      await db.rpc('refund_slip_credit', { p_tenant: tenantId })
      charged = false
    }
    let verdict = result.verdict
    let note = result.note ?? null
    const receiverMatches = receiverMatchesAny(
      accounts.data,
      result.receiverBank,
      result.receiverAccount,
      result.receiverProxy,
    )
    if (verdict === 'wrong_receiver' && result.branchReceiverMismatch && receiverMatches)
      verdict = 'valid'
    if (verdict === 'valid' && !receiverMatches && !result.matchedBankAccount)
      verdict = 'wrong_receiver'
    if (
      verdict === 'valid' &&
      input.requireExactAmount &&
      (typeof result.amount !== 'number' ||
        Math.abs(result.amount - Number(selected.data.remaining_amount)) > 0.005)
    ) {
      verdict = 'amount_mismatch'
      note = `ยอดในสลิป ${result.amount ?? 'ไม่ทราบ'} ไม่ตรงกับยอดบิล ${selected.data.remaining_amount}`
    }
    const paidAt = providerPaidAt(result.raw)
    if (
      verdict === 'valid' &&
      (!paidAt ||
        !result.transRef?.trim() ||
        !Number.isFinite(result.amount) ||
        Number(result.amount) <= 0 ||
        Date.parse(paidAt) < Date.parse(selected.data.created_at) - 60_000 ||
        Date.parse(paidAt) > Date.now() + 120_000)
    ) {
      verdict = 'error'
      note = 'หลักฐานโอนเงิน ยอดเงิน หรือเวลาทำรายการไม่ถูกต้อง กรุณาให้แอดมินตรวจสอบ'
    }
    const args = {
      p_slip: slipId,
      p_tenant: tenantId,
      p_customer: input.customerId,
      p_verdict: verdict,
      p_amount: result.amount ?? null,
      p_ref: result.transRef ?? null,
      p_paid_at: paidAt,
      p_raw: result.raw,
      p_note: note,
    }
    const useAuctionSettlement = input.requireExactAmount && verdict === 'valid'
    const completeRpc = useAuctionSettlement
      ? 'complete_auction_customer_tab_slip'
      : 'complete_customer_tab_slip'
    const complete = useAuctionSettlement
      ? {
          p_slip: slipId,
          p_tenant: tenantId,
          p_customer: input.customerId,
          p_sender: input.auctionSenderId,
          p_amount: args.p_amount,
          p_ref: args.p_ref,
          p_paid_at: args.p_paid_at,
          p_raw: args.p_raw,
          p_note: args.p_note,
        }
      : args
    let saved = await db.rpc(completeRpc, complete)
    if (saved.error && ['40P01', '40001'].includes(saved.error.code))
      saved = await db.rpc(completeRpc, complete)
    if (saved.error?.code === '23505') {
      verdict = 'duplicate'
      note = 'สลิปนี้เคยถูกใช้ชำระแล้ว'
      saved = await db.rpc('complete_customer_tab_slip', {
        ...args,
        p_verdict: verdict,
        p_note: note,
      })
    }
    if (saved.error) throw saved.error
    console.info('[customer-tabs/payment] verified', { tabId: selected.data.id, slipId, verdict })
    return {
      id: slipId,
      status: verdict,
      amount: result.amount ?? null,
      transRef: result.transRef ?? null,
      note,
      tabBalance: saved.data as TabBalance,
    }
  } catch (error) {
    // Never downgrade a committed valid slip after a lost database response.
    await db
      .from('slips')
      .update({
        status: 'error',
        note: 'ตรวจสลิปไม่สำเร็จ กรุณาให้แอดมินตรวจสอบ',
        verified_at: new Date().toISOString(),
      })
      .eq('id', slipId)
      .eq('status', 'pending')
    console.error('[customer-tabs/payment] review required', {
      slipId,
      code: 'TAB_PAYMENT_UNCONFIRMED',
      errorName: error instanceof Error ? error.name : 'UNKNOWN',
      providerCode: (error as { code?: string } | null)?.code ?? null,
    })
    return readResult(slipId)
  }
}

/** Delete a just-uploaded image only after confirming no slip row references it. */
async function removeIfUnclaimed(db: SupabaseClient, imagePath: string) {
  try {
    const { data, error } = await db
      .from('slips')
      .select('id')
      .eq('image_path', imagePath)
      .maybeSingle()
    if (error || data) return
    const removed = await db.storage.from('slips').remove([imagePath])
    if (removed.error)
      console.error('[customer-tabs/payment] orphan image cleanup failed', {
        code: removed.error.statusCode ?? 'STORAGE_REMOVE_FAILED',
      })
  } catch {
    // Preserve evidence when row state or storage cleanup cannot be confirmed.
    console.error('[customer-tabs/payment] orphan image cleanup uncertain')
  }
}
