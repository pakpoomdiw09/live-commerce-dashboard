import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { verifyWithSlipOK, type SlipVerdict } from './slipok'

export const SLIP_MAX_BYTES = 5 * 1024 * 1024
export const SLIP_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export type Tenant = { id: string; account_number: string; bank_code: string }

type Input = {
  file?: File
  qr?: string
  customerId?: string | null
  /** the chat message the slip image came in, so the dashboard can show the verdict inside that bubble */
  messageId?: string | null
  expectedAmount?: number
  tenant?: Tenant | null
  /** CF orders this slip pays for (expectedAmount is their total): marked paid when the slip is valid */
  orderIds?: string[]
}

const NO_CREDIT_NOTE = 'เครดิตตรวจสลิปของร้านหมดแล้ว เติมเครดิตในหน้าตั้งค่าร้านค้า'

/**
 * Compare the tenant's full account number with the receiver account on the slip, which banks
 * mask with 'x' or '*' (e.g. 92xxxx7828, xxx-x-x1234-x). Same length: every visible digit must
 * be in the same place. Different length: the visible digits before and after the mask must be
 * the start and end of the full number. At least 3 visible digits either way; anything else
 * counts as a mismatch, so an unreadable account is rejected.
 */
export function accountMatches(full: string, onSlip: string | undefined): boolean {
  const a = full.replace(/\D/g, '')
  const b = (onSlip ?? '').replace(/\*/g, 'x').replace(/[^0-9x]/gi, '').toLowerCase()
  if (!a || !b) return false
  const visible = b.replace(/x/g, '').length
  if (visible < 3) return false
  if (a.length === b.length) {
    for (let i = 0; i < b.length; i++) {
      if (b[i] !== 'x' && b[i] !== a[i]) return false
    }
    return true
  }
  // lengths differ: only a "<prefix>xxx<suffix>" shape can be lined up
  const m = /^(\d*)x+(\d*)$/.exec(b)
  if (!m) return false
  const [, head, tail] = m
  return head.length + tail.length <= a.length && a.startsWith(head) && a.endsWith(tail)
}

/** SlipOK's numeric bank codes, and the codes a tenant's bank_code may use for the same bank */
const BANK_ALIASES: Record<string, string[]> = {
  '002': ['BBL'],
  '004': ['KBANK'],
  '006': ['KTB'],
  '011': ['TTB', 'TTBNK', 'TMB'],
  '014': ['SCB'],
  '025': ['BAY'],
  '030': ['GSB'],
}

/**
 * Compare the tenant's bank_code (e.g. KTB or 006) with the receiving bank on the slip (e.g. 006).
 * PROMPTPAY tenants are paid via a proxy, so the receiving bank can be anything: skip the check.
 * An unknown or missing bank on either side counts as a mismatch.
 */
export function bankMatches(tenantBank: string | undefined, onSlip: string | undefined): boolean {
  const t = (tenantBank ?? '').trim().toUpperCase()
  if (t === 'PROMPTPAY') return true
  const s = (onSlip ?? '').trim()
  if (!t || !s) return false
  if (t === s) return true
  return BANK_ALIASES[s]?.includes(t) ?? false
}

export type ProcessedSlip = {
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
 * Store the slip image, create a pending row, verify with SlipOK, and save the verdict.
 * Shared by /api/slips/verify and the Facebook webhook. Inputs must be validated by the caller.
 */
export async function processSlip(
  db: SupabaseClient,
  { file, qr, customerId = null, messageId = null, expectedAmount, tenant = null, orderIds = [] }: Input,
): Promise<ProcessedSlip> {
  // 1) keep the original as evidence
  let imagePath: string | null = null
  if (file) {
    imagePath = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}`
    const up = await db.storage.from('slips').upload(imagePath, file, { contentType: file.type })
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
    console.error('slip insert failed', error)
    if (imagePath) {
      // no row will ever point at this image, so don't leave it in the bucket
      const { error: removeError } = await db.storage.from('slips').remove([imagePath])
      if (removeError) console.error('could not remove orphan slip image', imagePath, removeError)
    }
    return { status: 'error', amount: null, transRef: null, note: null, failure: 'db insert failed' }
  }

  // 3-4) From here on the row must not stay 'pending', whatever fails.
  let charged = false
  try {
    // every SlipOK call costs the tenant one credit, taken atomically before the call
    if (tenant) {
      const { data: hasCredit, error: creditError } = await db.rpc('consume_slip_credit', { p_tenant: tenant.id })
      if (creditError) throw new Error(`credit check failed: ${creditError.message}`)
      if (!hasCredit) {
        await db.from('slips').update({ status: 'error', note: NO_CREDIT_NOTE, verified_at: new Date().toISOString() }).eq('id', slip.id)
        return { id: slip.id, status: 'error', amount: null, transRef: null, note: NO_CREDIT_NOTE }
      }
      charged = true
    }

    const r = await verifyWithSlipOK({ file, qr, expectedAmount })
    // not the slip's fault (timeout, SlipOK / bank outage): the tenant shouldn't pay for it
    if (charged && r.providerFault) await refundCredit(db, tenant!.id)
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = r.raw as any
      console.log('--- DEBUG ACCOUNT MATCHING ---')
      console.log('SlipOK code / message:', raw?.code, raw?.message)
      console.log('SlipOK verdict:', r.verdict, r.branchReceiverMismatch ? '(1014 with slip data: tenant check decides)' : '')
      console.log('SlipOK receiver (raw):', JSON.stringify(raw?.data?.receiver ?? null))
      console.log('SlipOK Bank Code:', r.receiverBank)
      console.log('SlipOK Account (used for matching):', r.receiverAccount)
      if (tenant) {
        console.log('Tenant DB Bank Code:', tenant.bank_code)
        console.log('Tenant DB Account Number:', tenant.account_number)
        console.log('bankMatches:', bankMatches(tenant.bank_code, r.receiverBank))
        console.log('accountMatches:', accountMatches(tenant.account_number, r.receiverAccount))
      } else {
        console.log('Tenant: none (no tenantId in the request), receiver check skipped')
      }
    }
    let verdict = r.verdict
    let note = r.note ?? null
    // SlipOK checks the receiver against the branch's one main account (1014). With a tenant,
    // the tenant's own account is what counts: start from 'valid' and let the checks below decide.
    const overridden = verdict === 'wrong_receiver' && !!r.branchReceiverMismatch && !!tenant
    if (overridden) {
      verdict = 'valid'
      note = null
    }
    // SlipOK may stop at 1014 before comparing amounts, so then a missing amount can't pass
    if (overridden && expectedAmount && r.amount === undefined) {
      verdict = 'amount_mismatch'
      note = `อ่านยอดในสลิปไม่ได้ ตรวจกับ ${expectedAmount} ไม่ได้`
    }
    // second check, in case a different provider doesn't compare amounts
    if (verdict === 'valid' && expectedAmount && r.amount !== undefined && Math.abs(r.amount - expectedAmount) > 0.005) {
      verdict = 'amount_mismatch'
      note = `ยอดในสลิป ${r.amount} ไม่ตรงกับ ${expectedAmount}`
    }
    // SlipOK's receiver check knows one account per branch; each tenant has its own
    if (verdict === 'valid' && tenant && !bankMatches(tenant.bank_code, r.receiverBank)) {
      verdict = 'wrong_receiver'
      note = `ธนาคารผู้รับในสลิป (${r.receiverBank ?? 'อ่านไม่ได้'}) ไม่ตรงกับธนาคารของผู้เช่า (${tenant.bank_code})`
    } else if (verdict === 'valid' && tenant && !accountMatches(tenant.account_number, r.receiverAccount)) {
      verdict = 'wrong_receiver'
      note = `บัญชีผู้รับในสลิป (${r.receiverAccount ?? 'อ่านไม่ได้'}) ไม่ตรงกับบัญชีของผู้เช่า`
    }

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
      note = (await usedByOtherTenant(db, r.transRef, tenant?.id)) ? 'สลิปนี้ถูกใช้กับร้านค้าอื่นแล้ว' : 'สลิปนี้เคยถูกใช้แล้ว'
      ;({ error: saveError } = await save())
    }
    if (saveError) throw new Error(`db update failed: ${saveError.message}`)

    if (customerId) await syncOrderStatus(db, customerId, verdict)
    if (verdict === 'valid' && orderIds.length) await markOrdersPaid(db, orderIds, slip.id)

    return { id: slip.id, status: verdict, amount: r.amount ?? null, transRef: r.transRef ?? null, note }
  } catch (e) {
    console.error('slip verify failed', e)
    const note = 'ตรวจสลิปไม่สำเร็จ ลองส่งใหม่อีกครั้ง'
    // minimal update, so it still works if the full one was what failed
    await db.from('slips').update({ status: 'error', note, verified_at: new Date().toISOString() }).eq('id', slip.id)
    return { id: slip.id, status: 'error', amount: null, transRef: null, note, crashed: true }
  }
}

/** Give one credit back. Best effort: logged, never thrown, so the verdict is still saved. */
async function refundCredit(db: SupabaseClient, tenantId: string) {
  const { error } = await db.rpc('refund_slip_credit', { p_tenant: tenantId })
  if (error) console.error('credit refund failed (did you run supabase/platform.sql?)', tenantId, error)
}

/** Whether the accepted ('valid') slip with this trans_ref belongs to a different tenant. */
async function usedByOtherTenant(db: SupabaseClient, transRef: string | undefined, tenantId: string | undefined) {
  if (!transRef) return false
  const { data } = await db.from('slips').select('tenant_id').eq('trans_ref', transRef).eq('status', 'valid').maybeSingle()
  return !!data && data.tenant_id !== (tenantId ?? null)
}

/**
 * Move the customer's order along: a valid slip means paid, anything else needs an admin.
 * Best effort: the slip verdict is already saved, so a failure here is only logged.
 */
async function syncOrderStatus(db: SupabaseClient, customerId: string, verdict: SlipVerdict) {
  const { error } = await db
    .from('customers')
    .update({ order_status: verdict === 'valid' ? 'paid' : 'pending_review' })
    .eq('id', customerId)
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
