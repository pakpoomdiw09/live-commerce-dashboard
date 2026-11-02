import { NextRequest, NextResponse } from 'next/server'
import { verifyLiveCfPaymentToken } from '@/lib/features/commerce/live-cf-payment-link'
import { supabaseAdmin } from '@/lib/supabase/server'
import { isPaymentImage, PAYMENT_MAX_BYTES } from '@/lib/features/payments/payment-validation'
import { tabForOrder } from '@/lib/features/commerce/customer-tabs-server'
import { processSlip } from '@/lib/features/slips/process'
import { notifyVerifiedSlipForCustomer } from '@/lib/features/slips/notify'

export const runtime = 'nodejs'
const reply = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (req.headers.get('origin') !== req.nextUrl.origin)
    return reply({ error: 'คำขอไม่ถูกต้อง' }, 403)
  const verified = verifyLiveCfPaymentToken((await params).token)
  if (!verified) return reply({ error: 'ลิงก์หมดอายุหรือไม่ถูกต้อง' }, 403)
  if (Number(req.headers.get('content-length') ?? 0) > PAYMENT_MAX_BYTES + 64 * 1024)
    return reply({ error: 'ไฟล์ต้องไม่เกิน 5 MB' }, 413)
  const db = supabaseAdmin()
  let imagePath: string | null = null
  try {
    const tab = await tabForOrder(db, verified.orderId)
    if (tab) {
      if (Number(tab.remaining_amount) <= 0) return reply({ error: 'บิลนี้ชำระครบแล้ว' }, 409)
      const form = await req.formData()
      const file = form.get('file')
      if (!(file instanceof File) || !(await isPaymentImage(file)))
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
    if (!order.data || order.data.status !== 'pending_payment')
      return reply({ error: 'รายการนี้ไม่พร้อมรับสลิป' }, 409)
    const existing = await db
      .from('auction_payment_proofs')
      .select('order_id')
      .eq('order_id', verified.orderId)
      .maybeSingle()
    if (existing.error) throw existing.error
    if (existing.data) return reply({ submitted: true })
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File) || !(await isPaymentImage(file)))
      return reply({ error: 'กรุณาเลือก JPG, PNG หรือ WebP ขนาดไม่เกิน 5 MB' }, 400)
    imagePath = `auction/${order.data.tenant_id}/${crypto.randomUUID()}`
    const uploaded = await db.storage
      .from('slips')
      .upload(imagePath, file, { contentType: file.type })
    if (uploaded.error) throw uploaded.error
    const saved = await db.rpc('submit_auction_payment_proof', {
      p_order: verified.orderId,
      p_image: imagePath,
    })
    if (saved.error) throw saved.error
    imagePath = null
    console.info('[auction/payment] proof submitted', {
      orderId: verified.orderId,
      slipId: saved.data,
    })
    return reply({ submitted: true })
  } catch (error) {
    if (imagePath) {
      // An uncertain RPC response may already have committed the slip. Keep its image.
      const committed = await db
        .from('slips')
        .select('id')
        .eq('image_path', imagePath)
        .maybeSingle()
      if (!committed.error && !committed.data) await db.storage.from('slips').remove([imagePath])
    }
    const code = (error as { code?: string } | null)?.code
    if (code === '23505') return reply({ submitted: true })
    console.error('[auction/payment] upload failed', {
      orderId: verified.orderId,
      code: 'AUCTION_PROOF_FAILED',
    })
    return reply({ error: 'อัปโหลดไม่สำเร็จ กรุณาลองใหม่หรือติดต่อร้านค้า' }, 503)
  }
}
