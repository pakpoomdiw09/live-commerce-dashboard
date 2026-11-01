import { NextRequest, NextResponse } from 'next/server'
import { canAccessTenant, getActor } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { normalizeCfCode } from '@/lib/features/commerce/cf-code'
import { liveCfPaymentLinksReady } from '@/lib/features/commerce/live-cf-payment-link'
import { UUID } from '@/lib/utils'
import { extractFacebookLiveId } from '@/lib/features/commerce/live-cf-setup'

const text = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim().length <= max ? value.trim() : null

export async function POST(req: NextRequest) {
  try {
    if (!isFeatureEnabled('live_cf'))
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (req.headers.get('origin') !== req.nextUrl.origin)
      return NextResponse.json({ error: 'คำขอไม่ถูกต้อง' }, { status: 403 })
    const actor = await getActor(req)
    const input = await req.json()
    const tenantId = text(input.tenantId, 36)
    if (
      !actor ||
      actor.kind !== 'user' ||
      !tenantId ||
      !UUID.test(tenantId) ||
      !(await canAccessTenant(actor, tenantId, 'owner'))
    )
      return NextResponse.json({ error: 'ไม่มีสิทธิ์จัดการร้านค้านี้' }, { status: 403 })

    const pageId = text(input.pageId, 100)
    const postId = extractFacebookLiveId(input.livePostId ?? '')
    const productId = text(input.productId, 36)
    const variantId = text(input.variantId, 36)
    const bankAccountId = text(input.bankAccountId, 36)
    const code = normalizeCfCode(input.code)
    const stockLimit = Number(input.stockLimit)
    if (
      !pageId ||
      !productId ||
      !UUID.test(productId) ||
      (variantId && !UUID.test(variantId)) ||
      (bankAccountId && !UUID.test(bankAccountId)) ||
      !code ||
      !Number.isSafeInteger(stockLimit) ||
      stockLimit < 1 ||
      stockLimit > 1_000_000 ||
      postId === null
    )
      return NextResponse.json({ error: 'ข้อมูลตั้งค่าไม่ถูกต้อง' }, { status: 400 })

    const db = supabaseAdmin()
    const [tenant, product, variant, account] = await Promise.all([
      db.from('tenants').select('page_id').eq('id', tenantId).eq('page_id', pageId).maybeSingle(),
      db
        .from('products')
        .select('id')
        .eq('id', productId)
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .eq('commerce_archived', false)
        .maybeSingle(),
      variantId
        ? db
            .from('commerce_variants')
            .select('id')
            .eq('id', variantId)
            .eq('product_id', productId)
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      bankAccountId
        ? db
            .from('bank_accounts')
            .select('id')
            .eq('id', bankAccountId)
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])
    if (
      !tenant.data ||
      !product.data ||
      (variantId && !variant.data) ||
      (bankAccountId && !account.data)
    )
      return NextResponse.json(
        { error: 'เพจ สินค้า หรือตัวเลือกไม่ใช่ข้อมูลของร้านนี้' },
        { status: 400 },
      )

    const privateReply = input.privateReply === true
    const publicReply = input.publicReply === true
    if (privateReply && !bankAccountId)
      return NextResponse.json(
        { error: 'กรุณาเลือกบัญชีรับเงินสำหรับส่งลิงก์ชำระเงินให้ลูกค้า' },
        { status: 400 },
      )
    if (privateReply && !liveCfPaymentLinksReady())
      return NextResponse.json(
        {
          error:
            'ระบบลิงก์ชำระเงินยังไม่พร้อม กรุณาให้ผู้ดูแลตั้งค่าที่อยู่เว็บไซต์และกุญแจลิงก์ชำระเงินก่อนเปิดส่งข้อความส่วนตัว',
        },
        { status: 503 },
      )
    const matchMode = input.matchMode === 'strict' ? 'strict' : 'flexible'
    const matchType = matchMode === 'strict' ? 'exact' : 'keyword'
    const row = {
      tenant_id: tenantId,
      name: `Live CF ${code}`,
      page_ids: [pageId],
      match_type: matchType,
      keywords: [code],
      reply_enabled: publicReply,
      reply_text: text(input.publicText, 2000),
      inbox_enabled: privateReply,
      inbox_type: 'text',
      inbox_text: text(input.privateText, 2000),
      inbox_image_url: null,
      is_active: input.isActive === true,
      mode: 'live_cf',
      live_product_id: productId,
      live_variant_id: variantId,
      live_stock_limit: stockLimit,
      live_post_id: postId || null,
      live_bank_account_id: bankAccountId,
      live_deduct_stock: input.deductStock !== false,
    }
    const existingId = text(input.id, 36)
    const saved =
      existingId && UUID.test(existingId)
        ? await db
            .from('comment_rules')
            .update(row)
            .eq('id', existingId)
            .eq('tenant_id', tenantId)
            .eq('mode', 'live_cf')
            .select('id')
            .single()
        : await db.from('comment_rules').insert(row).select('id').single()
    if (saved.error) throw saved.error
    return NextResponse.json(
      { id: saved.data.id },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    console.error('[live-cf/setup] save failed', { code: (error as { code?: string }).code })
    return NextResponse.json(
      { error: 'บันทึกการตั้งค่าไม่สำเร็จ กรุณาให้ผู้ดูแลตรวจสอบการติดตั้งฐานข้อมูลแล้วลองใหม่' },
      { status: 500 },
    )
  }
}
