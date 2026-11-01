import { NextRequest, NextResponse } from 'next/server'
import { verifyLiveCfPaymentToken } from '@/lib/features/commerce/live-cf-payment-link'
import { supabaseAdmin } from '@/lib/supabase/server'
import { isUuid } from '@/lib/features/commerce/commerce-core'
import { isFeatureEnabled } from '@/lib/feature-flags'

const reply = (error: string, status: number) =>
  NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } })
const reasons: Record<string, string> = {
  LIVE_CF_ORDER_NOT_FOUND: 'ไม่พบรายการสั่งซื้อ',
  LIVE_CF_SELECTION_UNAVAILABLE: 'สินค้านี้ยังไม่พร้อมให้เลือกรูปแบบ กรุณาติดต่อร้านค้า',
  LIVE_CF_SELECTION_LOCKED: 'รายการนี้ยืนยันตัวเลือกหรือดำเนินการแล้ว กรุณาเปิดหน้าชำระเงินใหม่',
  LIVE_CF_PAYMENT_IN_PROGRESS: 'มีสลิปกำลังตรวจสอบ กรุณาติดต่อร้านค้าก่อนเปลี่ยนตัวเลือก',
  LIVE_CF_VARIANT_INVALID: 'ตัวเลือกนี้ไม่ใช่ของสินค้าในรายการสั่งซื้อ',
  LIVE_CF_VARIANT_SOLD_OUT: 'ตัวเลือกนี้หมดแล้ว กรุณาเลือกแบบอื่น',
}
export async function POST(req: NextRequest) {
  try {
    if (!isFeatureEnabled('live_cf')) return reply('ไม่พบหน้าที่ต้องการ', 404)
    if (req.headers.get('origin') !== req.nextUrl.origin)
      return reply('กรุณาทำรายการจากหน้าชำระเงินนี้', 403)
    const raw = await req.text()
    if (raw.length > 4096) return reply('ข้อมูลยาวเกินกำหนด', 413)
    let input
    try {
      input = JSON.parse(raw)
    } catch {
      return reply('ข้อมูลไม่ถูกต้อง', 400)
    }
    if (
      !input ||
      typeof input.token !== 'string' ||
      input.token.length > 512 ||
      !isUuid(input.variantId)
    )
      return reply('ข้อมูลไม่ถูกต้อง', 400)
    const verified = verifyLiveCfPaymentToken(input.token)
    if (!verified) return reply('ลิงก์ชำระเงินไม่ถูกต้องหรือหมดอายุแล้ว', 401)
    const db = supabaseAdmin()
    const rate = await db.rpc('commerce_rate_limit', {
      p_bucket: `live-variant:${verified.orderId}`,
      p_max: 20,
    })
    if (rate.error) return reply('ระบบยังไม่พร้อม กรุณาให้ร้านค้าตรวจสอบการติดตั้งฐานข้อมูล', 503)
    if (rate.data !== true) return reply('ทำรายการถี่เกินไป กรุณารอสักครู่', 429)
    const result = await db.rpc('confirm_live_cf_variant', {
      p_order: verified.orderId,
      p_variant: input.variantId,
    })
    if (result.error) {
      const reason = Object.keys(reasons).find((key) => result.error.message?.includes(key))
      if (reason) return reply(reasons[reason], reason === 'LIVE_CF_ORDER_NOT_FOUND' ? 404 : 409)
      console.error('[live-cf/variant] update failed', { code: result.error.code })
      return reply('ยืนยันตัวเลือกไม่สำเร็จ กรุณาลองใหม่หรือติดต่อร้านค้า', 503)
    }
    return NextResponse.json(result.data, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return reply('ระบบยังไม่พร้อม กรุณาลองใหม่', 503)
  }
}
