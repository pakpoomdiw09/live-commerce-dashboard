import { NextRequest, NextResponse } from 'next/server'
import { verifyLiveCfPaymentToken } from '@/lib/features/commerce/live-cf-payment-link'
import { supabaseAdmin } from '@/lib/supabase/server'
import { isPaymentImage, PAYMENT_MAX_BYTES } from '@/lib/features/payments/payment-validation'
import { tabForOrder } from '@/lib/features/commerce/customer-tabs-server'
import { processSlip } from '@/lib/features/slips/process'
import { notifyVerifiedSlipForCustomer } from '@/lib/features/slips/notify'
import {
  limitLivePaymentIp,
  limitLivePaymentOrder,
} from '@/lib/features/commerce/live-payment-rate-limit'

export const runtime = 'nodejs'
const reply = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
// The file cap is 5 MiB; allow 64 KiB for multipart framing and form fields.
const MAX_MULTIPART_BODY_BYTES = PAYMENT_MAX_BYTES + 64 * 1024

async function readBoundedFormData(req: NextRequest): Promise<FormData | null> {
  const contentType = req.headers.get('content-type')
  if (!contentType?.toLowerCase().startsWith('multipart/form-data;')) return null
  if (!req.body) return null
  const contentLength = req.headers.get('content-length')
  let declaredLength: number | null = null
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) throw new Error('PAYMENT_BODY_LENGTH_INVALID')
    declaredLength = Number(contentLength)
    if (!Number.isSafeInteger(declaredLength) || declaredLength > MAX_MULTIPART_BODY_BYTES)
      throw new Error('PAYMENT_BODY_TOO_LARGE')
  }
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_MULTIPART_BODY_BYTES) {
        try {
          await reader.cancel()
        } catch {
          // Preserve the size-limit result if the underlying stream refuses cancellation.
        }
        throw new Error('PAYMENT_BODY_TOO_LARGE')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  if (declaredLength !== null && declaredLength !== size)
    throw new Error('PAYMENT_BODY_LENGTH_MISMATCH')
  try {
    return await new Response(Buffer.concat(chunks, size), {
      headers: { 'content-type': contentType },
    }).formData()
  } catch {
    return null
  }
}

async function currentAuctionProofStatus(
  db: ReturnType<typeof supabaseAdmin>,
  orderId: string,
  tenantId: string,
) {
  const proof = await db
    .from('auction_payment_proofs')
    .select('slip_id,submission_attempts')
    .eq('order_id', orderId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (proof.error) throw proof.error
  if (!proof.data) return null
  const slip = await db
    .from('slips')
    .select('status')
    .eq('id', proof.data.slip_id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (slip.error) throw slip.error
  if (!slip.data) throw new Error('AUCTION_PROOF_SLIP_MISSING')
  if (slip.data.status === 'rejected')
    return proof.data.submission_attempts < 5
      ? { submitted: false, status: 'allowed_to_resubmit' }
      : { submitted: false, status: 'attempt_limit_reached' }
  return { submitted: true, status: 'pending_review' }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (req.headers.get('origin') !== req.nextUrl.origin)
    return reply({ error: 'คำขอไม่ถูกต้อง' }, 403)
  const contentLength = req.headers.get('content-length')
  if (contentLength !== null && !/^\d+$/.test(contentLength))
    return reply({ error: 'ขนาดคำขอไม่ถูกต้อง' }, 400)
  const declaredLength = contentLength === null ? null : Number(contentLength)
  if (
    declaredLength !== null &&
    (!Number.isSafeInteger(declaredLength) || declaredLength > MAX_MULTIPART_BODY_BYTES)
  )
    return reply({ error: 'ไฟล์ต้องไม่เกิน 5 MB' }, 413)
  let db: ReturnType<typeof supabaseAdmin> | null = null
  let imagePath: string | null = null
  let orderIdForStatus: string | null = null
  let tenantIdForStatus: string | null = null
  let auctionProofExists = false
  let auctionProofAttemptLimitReached = false
  try {
    db = supabaseAdmin()
    const ipLimit = await limitLivePaymentIp(db, req.headers, 'post')
    if (ipLimit === 'unavailable') return reply({ error: 'บริการชำระเงินไม่พร้อมใช้งาน' }, 503)
    if (ipLimit === 'limited') return reply({ error: 'ส่งคำขอถี่เกินไป กรุณาลองใหม่ภายหลัง' }, 429)
    const verified = verifyLiveCfPaymentToken((await params).token)
    if (!verified) return reply({ error: 'ลิงก์หมดอายุหรือไม่ถูกต้อง' }, 403)
    orderIdForStatus = verified.orderId
    const orderLimit = await limitLivePaymentOrder(db, verified.orderId, 'post')
    if (orderLimit === 'unavailable') return reply({ error: 'บริการชำระเงินไม่พร้อมใช้งาน' }, 503)
    if (orderLimit === 'limited') return reply({ error: 'ส่งคำขอถี่เกินไป กรุณาลองใหม่ภายหลัง' }, 429)
    const tab = await tabForOrder(db, verified.orderId)
    if (tab) {
      if (Number(tab.remaining_amount) <= 0) return reply({ error: 'บิลนี้ชำระครบแล้ว' }, 409)
      const form = await readBoundedFormData(req)
      if (!form) return reply({ error: 'กรุณาส่งไฟล์ด้วย multipart/form-data' }, 400)
      const file = form.get('file')
      if (!(file instanceof File))
        return reply({ error: 'กรุณาเลือก JPG, PNG หรือ WebP ขนาดไม่เกิน 5 MB' }, 400)
      if (file.size > PAYMENT_MAX_BYTES) return reply({ error: 'ไฟล์ต้องไม่เกิน 5 MB' }, 413)
      const check = await isPaymentImage(file)
      if (!check.isValid)
        return reply({ error: 'กรุณาเลือก JPG, PNG หรือ WebP ขนาดไม่เกิน 5 MB' }, 400)
      const tenant = await db
        .from('tenants')
        .select('id,account_number,bank_code')
        .eq('id', tab.tenant_id)
        .eq('page_id', tab.page_id)
        .eq('is_active', true)
        .single()
      if (tenant.error) throw tenant.error
      const result = await processSlip(db, {
        file,
        customerId: tab.customer_id,
        customerTabId: tab.id,
        tenant: tenant.data,
      })
      if (result.status !== 'valid')
        return reply(
          {
            error: result.note || 'ยังยืนยันสลิปไม่ได้ กรุณาตรวจสอบหลักฐานหรือติดต่อร้านค้า',
            status: result.status,
          },
          422,
        )
      await notifyVerifiedSlipForCustomer(db, result, tab.customer_id, tab.tenant_id)
      return reply({ submitted: true, balance: result.tabBalance })
    }
    const order = await db
      .from('orders')
      .select('id,tenant_id,status')
      .eq('id', verified.orderId)
      .eq('source', 'live_auction')
      .maybeSingle()
    if (order.error) throw order.error
    if (!order.data)
      return reply({ error: 'รายการนี้ไม่พร้อมรับสลิป' }, 409)
    tenantIdForStatus = order.data.tenant_id
    if (['paid', 'shipped'].includes(order.data.status))
      return reply({ submitted: true, status: 'paid' })
    if (order.data.status !== 'pending_payment')
      return reply({ error: 'รายการนี้ไม่พร้อมรับสลิป' }, 409)
    const existing = await currentAuctionProofStatus(db, verified.orderId, order.data.tenant_id)
    if (existing && existing.status !== 'allowed_to_resubmit')
      return reply(existing, existing.status === 'attempt_limit_reached' ? 409 : 200)
    const form = await readBoundedFormData(req)
    if (!form) return reply({ error: 'กรุณาส่งไฟล์ด้วย multipart/form-data' }, 400)
    const file = form.get('file')
    if (!(file instanceof File))
      return reply({ error: 'กรุณาเลือก JPG, PNG หรือ WebP ขนาดไม่เกิน 5 MB' }, 400)
    if (file.size > PAYMENT_MAX_BYTES) return reply({ error: 'ไฟล์ต้องไม่เกิน 5 MB' }, 413)
    const check = await isPaymentImage(file)
    if (!check.isValid)
      return reply({ error: 'กรุณาเลือก JPG, PNG หรือ WebP ขนาดไม่เกิน 5 MB' }, 400)
    imagePath = `auction/${order.data.tenant_id}/${crypto.randomUUID()}`
    const uploaded = await db.storage
      .from('slips')
      .upload(imagePath, file, { contentType: check.mimeType })
    if (uploaded.error) throw uploaded.error
    const saved = await db.rpc('submit_auction_payment_proof', {
      p_order: verified.orderId,
      p_image: imagePath,
    })
    if (saved.error) {
      auctionProofExists =
        saved.error.code === '23505' && saved.error.message === 'AUCTION_PROOF_EXISTS'
      auctionProofAttemptLimitReached =
        saved.error.code === '54000' &&
        saved.error.message === 'AUCTION_PROOF_ATTEMPTS_EXHAUSTED'
      throw saved.error
    }
    imagePath = null
    console.info('[auction/payment] proof submitted', {
      orderId: verified.orderId,
      slipId: saved.data,
    })
    return reply({ submitted: true, status: 'pending_review' })
  } catch (error) {
    if (imagePath && db) {
      try {
        // Keep the image if the database confirms the insert or its state is uncertain.
        const committed = await db
          .from('slips')
          .select('id')
          .eq('image_path', imagePath)
          .maybeSingle()
        if (!committed.error && !committed.data) {
          const removed = await db.storage.from('slips').remove([imagePath])
          if (removed.error)
            console.error('[auction/payment] orphan image cleanup failed', {
              code: removed.error.statusCode ?? 'STORAGE_REMOVE_FAILED',
            })
        }
      } catch {
        console.error('[auction/payment] orphan image cleanup uncertain')
      }
    }
    if (auctionProofExists) {
      try {
        if (db && orderIdForStatus && tenantIdForStatus) {
          const status = await currentAuctionProofStatus(db, orderIdForStatus, tenantIdForStatus)
          if (status)
            return reply(status, status.status === 'attempt_limit_reached' ? 409 : 200)
        }
      } catch {
        // Return a conservative status when the same-order proof cannot be read.
      }
      return reply({ submitted: true, status: 'pending_review' }, 200)
    }
    if (auctionProofAttemptLimitReached)
      return reply({ error: 'จำนวนครั้งที่ส่งสลิปครบกำหนดแล้ว กรุณาติดต่อร้านค้า' }, 409)
    if ((error as Error | null)?.message === 'PAYMENT_BODY_TOO_LARGE')
      return reply({ error: 'ไฟล์ต้องไม่เกิน 5 MB' }, 413)
    if ((error as Error | null)?.message === 'PAYMENT_BODY_LENGTH_MISMATCH')
      return reply({ error: 'ขนาดคำขอไม่ถูกต้อง' }, 400)
    if ((error as Error | null)?.message === 'PAYMENT_BODY_LENGTH_INVALID')
      return reply({ error: 'ขนาดคำขอไม่ถูกต้อง' }, 400)
    console.error('[auction/payment] upload failed', {
      orderId: orderIdForStatus,
      code: 'AUCTION_PROOF_FAILED',
    })
    return reply({ error: 'อัปโหลดไม่สำเร็จ กรุณาลองใหม่หรือติดต่อร้านค้า' }, 503)
  }
}
