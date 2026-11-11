import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { verifySlip, type SlipVerdict } from '@/lib/features/slips/verification'
import { requireFeature } from '@/lib/feature-access'
import { pendingOrders } from '@/lib/features/commerce/orders'
import { receiverMatchesAny } from '@/lib/features/slips/receiver-matching'
import { assertSlipOrderTimestamp, SlipTimestampError } from '@/lib/features/slips/slip-timestamp'
import {
  isPaymentImage,
  type PaymentImageMimeType,
} from '@/lib/features/payments/payment-validation'
export { SlipTimestampError } from '@/lib/features/slips/slip-timestamp'
export {
  accountMatches,
  bankMatches,
  receiverMatchesAny,
} from '@/lib/features/slips/receiver-matching'

export const SLIP_MAX_BYTES = 5 * 1024 * 1024
export const SLIP_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export type Tenant = { id: string; account_number: string | null; bank_code: string | null }

type Input = {
  /** Server-derived signed bill scope. Never trust a customer-supplied UUID. */
  customerTabId?: string
  /** Server-derived signed-in admin exemption; never copied from form data. */
  adminBypass?: boolean
  file?: File
  qr?: string
  customerId?: string | null
  /** the chat message the slip image came in, so the dashboard can show the verdict inside that bubble */
  messageId?: string | null
  expectedAmount?: number
  tenant?: Tenant | null
  /** CF orders this slip pays for (expectedAmount is their total): marked paid when the slip is valid */
  orderIds?: string[]
  /** Internal auction route: bind the slip to this Facebook winner and use its guarded settlement RPC. */
  requireAuctionSender?: boolean
  auctionSenderId?: string
}
export type SlipInput = Input

const NO_CREDIT_NOTE = 'เครดิตตรวจสลิปของร้านหมดแล้ว เติมเครดิตในหน้าตั้งค่าร้านค้า'
export type ProcessedSlip = {
  tabBalance?: import('@/lib/features/commerce/customer-tab-types').TabBalance
  paymentPro?: boolean
  automationAllowed?: boolean
  id?: string
  status: SlipVerdict
  amount: number | null
  transRef: string | null
  note: string | null
  /** set when the slip could not even be stored (upload / insert failed) */
  failure?: 'upload failed' | 'db insert failed'
  /** the row exists but verification or saving threw; it was marked 'error' */
  crashed?: boolean
}

/**
 * Store the slip image, create a pending row, verify with the configured provider, and save verdict.
 * Shared by /api/slips/verify and the Facebook webhook. Inputs must be validated by the caller.
 */
export async function processSlip(
  db: SupabaseClient,
  {
    file,
    qr,
    customerId = null,
    messageId = null,
    expectedAmount,
    tenant = null,
    orderIds = [],
    customerTabId,
    requireAuctionSender = false,
    auctionSenderId,
  }: Input,
): Promise<ProcessedSlip> {
  if (!tenant) throw new Error('FEATURE_LOCKED: tenant required')
  console.info('[slip/process] started', {
    tenantId: tenant.id,
    customerId,
    messageId,
    hasImageFile: Boolean(file),
    hasQr: Boolean(qr),
    auctionSenderRequired: requireAuctionSender,
  })
  let fileMimeType: PaymentImageMimeType | null = null
  if (file) {
    const image = await isPaymentImage(file)
    if (!image.isValid)
      return {
        status: 'error',
        amount: null,
        transRef: null,
        note: 'กรุณาเลือก JPG, PNG หรือ WebP ขนาดไม่เกิน 5 MB',
        failure: 'upload failed',
      }
    fileMimeType = image.mimeType
  }
  try {
    await requireFeature(db, tenant.id, 'slip_auto_pilot')
  } catch (error) {
    console.error('[slip/process] feature gate rejected verification', {
      tenantId: tenant.id,
      code: (error as { code?: string } | null)?.code ?? 'SLIP_AUTO_PILOT_REQUIRED',
    })
    throw error
  }
  if (
    requireAuctionSender &&
    (!customerId ||
      !customerTabId ||
      !auctionSenderId ||
      !Number.isFinite(expectedAmount) ||
      expectedAmount! <= 0)
  )
    throw new Error('AUCTION_PAYMENT_SCOPE_INVALID')
  if (customerId) {
    const pending = await pendingOrders(db, customerId, tenant.id)
    const tabIds = customerTabId ? [customerTabId] : pending.tabIds
    if (tabIds?.length) {
      const { processCustomerTabSlip } = await import('./customer-tab-slip')
      return processCustomerTabSlip(
        db,
        {
          file,
          qr,
          customerId,
          messageId,
          tenant,
          customerTabId,
          expectedAmount,
          requireAuctionSender,
          auctionSenderId,
        },
        tabIds,
        fileMimeType,
      )
    }
  }
  if (process.env.PAYMENT_PRO_ENABLED === 'true') {
    const { processPaymentPro } = await import('@/lib/features/payments/payment-pro')
    const result = await processPaymentPro(db, {
      file,
      qr,
      customerId,
      messageId,
      expectedAmount,
      tenant,
      orderIds,
    }, fileMimeType)
    if (result) return result
  }
  let accounts: { bank_code: string; account_number: string; is_active: boolean }[] = []
  let receiverSetupMissing = false
  if (tenant) {
    const { data, error } = await db
      .from('bank_accounts')
      .select('bank_code,account_number,is_active')
      .eq('tenant_id', tenant.id)
      .eq('is_active', true)
    if (error) {
      console.error('[slip/process] receiver account lookup failed', {
        tenantId: tenant.id,
        code: error.code,
      })
      throw new Error('อ่านบัญชีรับเงินไม่ได้ กรุณาตรวจสอบการติดตั้ง bank-accounts.sql')
    }
    accounts = data ?? []
    receiverSetupMissing = accounts.length === 0
  }
  // The database's outstanding order total always wins over manual/client amounts.
  if (customerId && tenant) {
    const orders = await pendingOrders(db, customerId, tenant.id)
    orderIds = orders.ids
    if (orderIds.length) expectedAmount = orders.total
  }
  // 1) keep the original as evidence
  let imagePath: string | null = null
  if (file) {
    imagePath = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}`
    const up = await db.storage
      .from('slips')
      .upload(imagePath, file, { contentType: fileMimeType! })
    if (up.error) {
      console.error('slip upload failed', imagePath, up.error)
      return { status: 'error', amount: null, transRef: null, note: null, failure: 'upload failed' }
    }
  }

  // 2) pending row: appears on the dashboard right away through Realtime
  const { data: slip, error } = await db
    .from('slips')
    .insert({
      customer_id: customerId,
      tenant_id: tenant?.id ?? null,
      message_id: messageId,
      image_path: imagePath,
      expected_amount: expectedAmount ?? null,
    })
    .select('id')
    .single()
  if (error || !slip) {
    console.error('[slip/process] slip history insert failed', { code: error?.code ?? 'NO_ROW' })
    if (imagePath) {
      // no row will ever point at this image, so don't leave it in the bucket
      const { error: removeError } = await db.storage.from('slips').remove([imagePath])
      if (removeError) console.error('could not remove orphan slip image', imagePath, removeError)
    }
    return {
      status: 'error',
      amount: null,
      transRef: null,
      note: null,
      failure: 'db insert failed',
    }
  }
  console.info('[slip/process] history recorded', {
    slipId: slip.id,
    tenantId: tenant.id,
    customerId,
    messageId,
    expectedAmount: expectedAmount ?? null,
  })

  // 3-4) From here on the row must not stay 'pending', whatever fails.
  let charged = false
  try {
    if (receiverSetupMissing) {
      const note = 'กรุณาเพิ่มหรือเปิดใช้งานบัญชีรับเงินของร้านก่อนตรวจสลิป'
      const saved = await db
        .from('slips')
        .update({ status: 'error', note, verified_at: new Date().toISOString() })
        .eq('id', slip.id)
      if (saved.error) throw saved.error
      console.error('[slip/process] verification blocked by missing receiver account', {
        slipId: slip.id,
        tenantId: tenant.id,
      })
      return { id: slip.id, status: 'error', amount: null, transRef: null, note }
    }
    // Every provider call costs the tenant one credit, taken atomically before the call.
    if (tenant) {
      const { data: hasCredit, error: creditError } = await db.rpc('consume_slip_credit', {
        p_tenant: tenant.id,
      })
      if (creditError) throw new Error(`credit check failed: ${creditError.message}`)
      if (!hasCredit) {
        await db
          .from('slips')
          .update({ status: 'error', note: NO_CREDIT_NOTE, verified_at: new Date().toISOString() })
          .eq('id', slip.id)
        return { id: slip.id, status: 'error', amount: null, transRef: null, note: NO_CREDIT_NOTE }
      }
      charged = true
    }

    const r = await verifySlip({
      file,
      qr,
      expectedAmount,
      bankAccounts: accounts.map((account) => ({
        accountNo: account.account_number,
        bankCode: account.bank_code,
      })),
    })
    console.info('[slip/process] provider returned', {
      slipId: slip.id,
      tenantId: tenant.id,
      verdict: r.verdict,
      amount: r.amount ?? null,
      providerFault: r.providerFault === true,
    })
    // Provider or bank outages are not the slip's fault; refund the tenant's credit.
    if (charged && r.providerFault) await refundCredit(db, tenant!.id)
    if (process.env.NODE_ENV !== 'production') {
      console.debug('[slip] verification metadata', {
        verdict: r.verdict,
        activeAccountCount: accounts.length,
        receiverMatches: receiverMatchesAny(
          accounts,
          r.receiverBank,
          r.receiverAccount,
          r.receiverProxy,
        ),
      })
    }
    let verdict = r.verdict
    let note = r.note ?? null
    // A provider-specific receiver mismatch may be reconciled against the tenant's active accounts.
    const overridden = verdict === 'wrong_receiver' && !!r.branchReceiverMismatch && !!tenant
    if (overridden) {
      verdict = 'valid'
      note = null
    }
    // A provider may stop at receiver matching before comparing amounts, so missing amount can't pass.
    if (
      verdict === 'valid' &&
      expectedAmount &&
      (r.amount === undefined || !Number.isFinite(r.amount))
    ) {
      verdict = 'amount_mismatch'
      note = `อ่านยอดในสลิปไม่ได้ ตรวจกับ ${expectedAmount} ไม่ได้`
    }
    // second check, in case a different provider doesn't compare amounts
    if (
      verdict === 'valid' &&
      expectedAmount &&
      r.amount !== undefined &&
      Math.abs(r.amount - expectedAmount) > 0.005
    ) {
      verdict = 'amount_mismatch'
      note = `ยอดในสลิป ${r.amount} ไม่ตรงกับ ${expectedAmount}`
    }
    // Require a local receiver match unless the provider confirmed a match against this tenant's list.
    if (
      verdict === 'valid' &&
      tenant &&
      !r.matchedBankAccount &&
      !receiverMatchesAny(accounts, r.receiverBank, r.receiverAccount, r.receiverProxy)
    ) {
      verdict = 'wrong_receiver'
      note = 'บัญชีผู้รับในสลิปไม่ตรงกับบัญชีรับเงินที่เปิดใช้งานของร้าน'
    }

    // NULL/blank references bypass the partial unique index. Never accept an untraceable transfer.
    if (verdict === 'valid' && (typeof r.transRef !== 'string' || !r.transRef.trim())) {
      verdict = 'error'
      note = 'ไม่มีเลขอ้างอิงธุรกรรมจากผู้ให้บริการ กรุณาให้แอดมินตรวจสอบ'
    }
    if (
      verdict === 'valid' &&
      (typeof r.amount !== 'number' || !Number.isFinite(r.amount) || r.amount <= 0)
    ) {
      verdict = 'error'
      note = 'ยอดเงินจากผู้ให้บริการไม่ถูกต้อง กรุณาให้แอดมินตรวจสอบ'
    }

    // Reject old/missing provider times before accepting the slip, claiming its
    // transfer reference, or marking the customer/orders paid. Check every order
    // in a combined payment, not just the oldest order in that payment.
    if (verdict === 'valid' && orderIds.length)
      await assertSlipOrderTimestamp(db, r.raw, orderIds, tenant.id, customerId)

    // The unique index on trans_ref is partial (where status = 'valid'): it rejects a second
    // 'valid' row for the same transfer. Saving again as 'duplicate' moves the row outside
    // that index, so trans_ref can stay as it is.
    const save = () =>
      db
        .from('slips')
        .update({
          status: verdict,
          note,
          amount: r.amount ?? null,
          trans_ref: r.transRef ?? null,
          raw: r.raw,
          verified_at: new Date().toISOString(),
        })
        .eq('id', slip.id)

    let { error: saveError } = await save()
    if (saveError?.code === '23505') {
      // The index has no tenant_id, so this also catches a slip already accepted by another tenant
      verdict = 'duplicate'
      note = (await usedByOtherTenant(db, r.transRef, tenant?.id))
        ? 'สลิปนี้ถูกใช้กับร้านค้าอื่นแล้ว'
        : 'สลิปนี้เคยถูกใช้แล้ว'
      ;({ error: saveError } = await save())
    }
    if (saveError) throw new Error(`db update failed: ${saveError.message}`)

    if (customerId) await syncOrderStatus(db, customerId, tenant.id, verdict)
    if (verdict === 'valid' && orderIds.length) await markOrdersPaid(db, orderIds, slip.id)

    return {
      id: slip.id,
      status: verdict,
      amount: r.amount ?? null,
      transRef: r.transRef ?? null,
      note,
    }
  } catch (e) {
    console.error('[slip/process] verification failed', {
      slipId: slip.id,
      tenantId: tenant.id,
      errorName: e instanceof Error ? e.name : 'UNKNOWN',
      code: (e as { code?: string } | null)?.code ?? null,
    })
    const note =
      e instanceof SlipTimestampError ? e.message : 'ตรวจสลิปไม่สำเร็จ ลองส่งใหม่อีกครั้ง'
    // minimal update, so it still works if the full one was what failed
    const saved = await db
      .from('slips')
      .update({ status: 'error', note, verified_at: new Date().toISOString() })
      .eq('id', slip.id)
    if (saved.error)
      console.error('[slip/process] failed to save error verdict', {
        slipId: slip.id,
        code: saved.error.code,
      })
    // Preserve the explicit validation error for API callers; never hide a
    // rejected timestamp behind the generic technical-failure result.
    if (e instanceof SlipTimestampError) throw e
    return { id: slip.id, status: 'error', amount: null, transRef: null, note, crashed: true }
  }
}

/** Give one credit back. Best effort: logged, never thrown, so the verdict is still saved. */
async function refundCredit(db: SupabaseClient, tenantId: string) {
  const { error } = await db.rpc('refund_slip_credit', { p_tenant: tenantId })
  if (error)
    console.error('credit refund failed (did you run supabase/platform.sql?)', tenantId, error)
}

/** Whether the accepted ('valid') slip with this trans_ref belongs to a different tenant. */
async function usedByOtherTenant(
  db: SupabaseClient,
  transRef: string | undefined,
  tenantId: string | undefined,
) {
  if (!transRef) return false
  const { data } = await db
    .from('slips')
    .select('tenant_id')
    .eq('trans_ref', transRef)
    .eq('status', 'valid')
    .maybeSingle()
  return !!data && data.tenant_id !== (tenantId ?? null)
}

/**
 * Move the customer's order along: a valid slip means paid, anything else needs an admin.
 * Best effort: the slip verdict is already saved, so a failure here is only logged.
 */
async function syncOrderStatus(
  db: SupabaseClient,
  customerId: string,
  tenantId: string,
  verdict: SlipVerdict,
) {
  const { error } = await db
    .from('customers')
    .update({ order_status: verdict === 'valid' ? 'paid' : 'pending_review' })
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .in('order_status', ['new', 'pending_review'])
  if (error) console.error('order status update failed', customerId, error)
}

/** CF orders paid by this slip. Only orders still waiting for payment move, so a paid one is never re-linked. */
export async function markOrdersPaid(db: SupabaseClient, orderIds: string[], slipId: string) {
  const { error } = await db
    .from('orders')
    .update({ status: 'paid', paid_at: new Date().toISOString(), slip_id: slipId })
    .in('id', orderIds)
    .eq('status', 'pending_payment')
  if (error) console.error('orders paid update failed', orderIds, error)
}
