import 'server-only'
import { createHash } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getActor, canAccessTenant } from './auth'
import { supabaseAdmin } from './supabase/server'
import { CommerceError, commerceFlag, isUuid, parseCheckout, parseDesign, parseProduct, safeImage, shopV2, slug, text, ORDER_STATES } from './commerce-core'

export function commerceResponse(error: unknown) {
  if (error instanceof CommerceError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store' } })
  console.error('[commerce] unavailable', { code: (error as { code?: string })?.code })
  return NextResponse.json({ error: 'ระบบร้านค้ายังไม่พร้อม กรุณาตรวจการติดตั้งหรือลองใหม่' }, { status: 503 })
}
export function sameOrigin(req: NextRequest) { const origin = req.headers.get('origin'); if (!origin || origin !== req.nextUrl.origin) throw new CommerceError('กรุณาทำรายการจากเว็บไซต์นี้', 403) }
export async function commerceScope(tenantId: string, write = false, req?: NextRequest) {
  if (!shopV2()) throw new CommerceError('ยังไม่เปิดระบบร้านค้าใหม่', 404)
  const actor = await getActor(req)
  if (!actor || actor.kind !== 'user') throw new CommerceError('กรุณาเข้าสู่ระบบ', 401)
  if (!isUuid(tenantId) || !await canAccessTenant(actor, tenantId, write ? 'owner' : 'staff')) throw new CommerceError('ไม่มีสิทธิ์จัดการร้านนี้', 403)
  const db = supabaseAdmin(), tenant = await db.from('tenants').select('id,name,is_active,plan,plan_expires_at').eq('id', tenantId).maybeSingle()
  if (tenant.error || !tenant.data?.is_active) throw new CommerceError('ร้านนี้ยังไม่เปิดใช้งาน', 403)
  const plan = await db.rpc('commerce_plan', { p_tenant: tenantId })
  const limits = Array.isArray(plan.data) ? plan.data[0] : plan.data
  if (plan.error || !limits) throw new CommerceError('กรุณาติดตั้งระบบร้านค้าใหม่ก่อนใช้งาน', 503)
  return { db, actor, tenantId, tenant: tenant.data, limits, canManage: await canAccessTenant(actor, tenantId, 'owner') }
}
export type CommerceScope = Awaited<ReturnType<typeof commerceScope>>
async function rows(query: PromiseLike<{ data: any; error: any }>) { const result = await query; if (result.error) throw result.error; return result.data }
async function allRows(scope: CommerceScope, table: string, columns = '*') {
  const result: any[] = []; for (let offset = 0; ; offset += 1000) { const data = await rows(scope.db.from(table).select(columns).eq('tenant_id', scope.tenantId).order('id').range(offset, offset + 999)); result.push(...data); if (data.length < 1000) return result }
}
export async function commerceSnapshot(scope: CommerceScope) {
  const { db, tenantId } = scope
  const [stores, products, categories, variants, pages, orders, items, customers, audit] = await Promise.all([
    rows(db.from('commerce_stores').select('*').eq('tenant_id', tenantId).maybeSingle()), allRows(scope, 'products'), allRows(scope, 'commerce_categories'), allRows(scope, 'commerce_variants'),
    allRows(scope, 'commerce_pages'), allRows(scope, 'commerce_orders', 'id,number,customer_id,status,total,shipping,tracking,created_at,paid_at'), allRows(scope, 'commerce_order_items'), allRows(scope, 'commerce_customers'),
    rows(db.from('commerce_audit').select('id,entity_id,actor_id,action,detail,created_at').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(300)),
  ])
  // Report entitlement is decided here; the browser cannot request a privileged report by changing tabs.
  const monthly: Record<string, number> = {}
  if (scope.limits.reports) for (const order of orders) if (order.paid_at && ['paid', 'preparing', 'shipped', 'completed'].includes(order.status)) {
    const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(order.paid_at)).slice(0, 7)
    monthly[month] = (monthly[month] ?? 0) + Math.round(Number(order.total) * 100)
  }
  const report = scope.limits.reports ? { monthly: Object.entries(monthly).sort(([a], [b]) => b.localeCompare(a)).map(([month, satang]) => ({ month, total: satang / 100 })) } : null
  return { tenant: { id: tenantId, name: scope.tenant.name }, canManage: scope.canManage, limits: scope.limits, flags: { dashboard: commerceFlag('STORE_DASHBOARD_V2_ENABLED'), products: commerceFlag('PRODUCT_MANAGER_V2_ENABLED'), storefront: commerceFlag('STOREFRONT_V2_ENABLED'), editor: commerceFlag('SALES_PAGE_EDITOR_V2_ENABLED') }, report, store: stores, products: products.filter((p: any) => !p.commerce_archived), categories, variants: variants.filter((v: any) => v.is_active), pages, orders, items, customers, audit }
}
export type CommerceData = Awaited<ReturnType<typeof commerceSnapshot>>
function id(value: unknown) { if (!isUuid(value)) throw new CommerceError('รหัสรายการไม่ถูกต้อง'); return value }
export async function commerceMutation(scope: CommerceScope, input: any) {
  const { db, actor, tenantId } = scope; let result
  if (['product', 'archive', 'category', 'category_delete'].includes(input.action) && !commerceFlag('PRODUCT_MANAGER_V2_ENABLED')) throw new CommerceError('ยังไม่เปิดจัดการสินค้าใหม่', 403)
  const value = input.value ?? {}
  if (input.action === 'product') {
    if (!commerceFlag('PRODUCT_MANAGER_V2_ENABLED')) throw new CommerceError('ยังไม่เปิดจัดการสินค้าใหม่', 403)
    const product = parseProduct(value)
    result = await db.rpc('commerce_save_product', { p_tenant: tenantId, p_actor: actor.id, p_id: input.id ? id(input.id) : null, p_value: product, p_version: input.version ?? null })
  } else if (input.action === 'order') {
    if (!Object.hasOwn(ORDER_STATES, value.status) || !scope.limits.checkout) throw new CommerceError('ยังไม่เปิดการจัดการคำสั่งซื้อสำหรับแพ็กเกจนี้', 403)
    result = await db.rpc('commerce_move_order', { p_tenant: tenantId, p_actor: actor.id, p_id: id(input.id), p_status: value.status, p_note: text(value.note, 1000, true) })
  } else {
    let validated: any
    switch (input.action) {
      case 'store': validated = { slug: slug(value.slug), name: text(value.name, 120, true), description: text(value.description ?? '', 2000), logo: safeImage(value.logo), banner: safeImage(value.banner), contact: text(value.contact ?? '', 500), is_open: value.is_open === true }; break
      case 'category': validated = { id: input.id ? id(input.id) : null, name: text(value.name, 80, true) }; break
      case 'category_delete': case 'archive': validated = { id: id(input.id) }; break
      case 'page':
        if (!commerceFlag('SALES_PAGE_EDITOR_V2_ENABLED')) throw new CommerceError('ยังไม่เปิดตัวออกแบบเซลเพจ', 403)
        if (value.design?.template === 'premium' && !scope.limits.advanced_templates) throw new CommerceError('เทมเพลตนี้ต้องใช้แพ็กเกจที่รองรับ', 403)
        validated = { id: input.id ? id(input.id) : null, name: text(value.name, 120, true), slug: slug(value.slug), design: parseDesign(value.design), version: input.version }; break
      case 'publish': case 'unpublish':
        if (!commerceFlag('SALES_PAGE_EDITOR_V2_ENABLED')) throw new CommerceError('ยังไม่เปิดตัวออกแบบเซลเพจ', 403)
        validated = { id: id(input.id), version: input.version }; break
      default: throw new CommerceError('ไม่พบคำสั่งที่รองรับ')
    }
    result = await db.rpc('commerce_manage', { p_tenant: tenantId, p_actor: actor.id, p_action: input.action, p_value: validated })
  }
  if (result.error) {
    const message = result.error.message ?? ''
    if (message.includes('COMMERCE_CHANGED') || result.error.code === '40001') throw new CommerceError('ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่ก่อนบันทึก', 409)
    if (message.includes('COMMERCE_LIMIT')) throw new CommerceError('ใช้จำนวนรายการครบตามแพ็กเกจแล้ว', 403)
    if (message.includes('COMMERCE_TRANSITION')) throw new CommerceError('เปลี่ยนสถานะตามลำดับก่อนหน้าเท่านั้น', 409)
    if (message.includes('COMMERCE_EVIDENCE')) throw new CommerceError('กรุณาระบุหลักฐานการดำเนินการอย่างน้อย 5 ตัวอักษร')
    if (result.error.code === '23505') throw new CommerceError('รหัส ชื่อ หรือลิงก์นี้ถูกใช้แล้ว', 409)
    throw result.error
  }
  return result.data
}
export async function publicStore(storeSlug: string, pageSlug = 'home') {
  if (!commerceFlag('STOREFRONT_V2_ENABLED')) return null
  try { slug(storeSlug); slug(pageSlug) } catch { return null }
  const db = supabaseAdmin(), store = await db.from('commerce_stores').select('tenant_id,slug,name,description,logo,banner,contact,is_open').eq('slug', slug(storeSlug)).eq('is_open', true).maybeSingle()
  if (store.error || !store.data) return null
  const tenantId = store.data.tenant_id, plan = await db.rpc('commerce_plan', { p_tenant: tenantId })
  const publicLimits = Array.isArray(plan.data) ? plan.data[0] : plan.data
  if (plan.error || !publicLimits) return null
  const publicRows = async (table: string, columns: string) => {
    const result: any[] = []
    for (let offset = 0; ; offset += 1000) {
      let query = db.from(table).select(columns).eq('tenant_id', tenantId).eq('is_active', true)
      if (table === 'products') query = query.eq('commerce_archived', false)
      const page = await rows(query.order('id').range(offset, offset + 999))
      result.push(...page); if (page.length < 1000) return result
    }
  }
  const [products, variants, categories, page] = await Promise.all([
    publicRows('products', 'id,code,name,price,stock,description,image_url,commerce_images,commerce_category_id,commerce_compare_price,commerce_featured'),
    publicRows('commerce_variants', 'id,product_id,label,price,stock'),
    rows(db.from('commerce_categories').select('id,name').eq('tenant_id', tenantId)), rows(db.from('commerce_pages').select('id,published').eq('tenant_id', tenantId).eq('slug', slug(pageSlug)).maybeSingle()),
  ])
  if (page?.published) {
    const allowed = await rows(db.from('commerce_pages').select('id').eq('tenant_id', tenantId).not('published', 'is', null).order('published_at').order('id').limit(publicLimits.max_pages))
    if (!allowed.some((p: any) => p.id === page.id)) return null
    if (page.published.template === 'premium' && !publicLimits.advanced_templates) return null
  }
  if (pageSlug !== 'home' && !page?.published) return null
  const visibleIds = new Set(products.map((p: any) => p.id))
  return { store: { ...store.data, tenant_id: undefined }, products, variants: variants.filter((v: any) => visibleIds.has(v.product_id)), categories, design: page?.published ? parseDesign(page.published) : null, checkout: publicLimits.checkout === true }
}
export type PublicStoreData = NonNullable<Awaited<ReturnType<typeof publicStore>>>
export async function checkout(req: NextRequest, storeSlug: string, input: unknown) {
  if (!commerceFlag('STOREFRONT_V2_ENABLED')) throw new CommerceError('ยังไม่เปิดหน้าร้าน', 404)
  sameOrigin(req)
  const value = parseCheckout(input), db = supabaseAdmin()
  const ip = createHash('sha256').update(`${req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown'}:${storeSlug}`).digest('hex')
  for (const [bucket, max] of [[`checkout:${ip}`, 10], [`store:${storeSlug}`, 120]] as const) {
    const limit = await db.rpc('commerce_rate_limit', { p_bucket: bucket, p_max: max }); if (limit.error || limit.data !== true) throw new CommerceError('มีคำขอจำนวนมาก กรุณารอสักครู่', 429)
  }
  const result = await db.rpc('commerce_checkout', { p_slug: slug(storeSlug), p_value: value })
  if (result.error) {
    if (result.error.message?.includes('COMMERCE_STOCK')) throw new CommerceError('สินค้าบางรายการหมดหรือคงเหลือไม่พอ กรุณาตรวจตะกร้าใหม่', 409)
    if (result.error.message?.includes('COMMERCE_IDEMPOTENCY')) throw new CommerceError('คำสั่งซื้อนี้เคยใช้แล้ว กรุณาเริ่มตะกร้าใหม่', 409)
    throw new CommerceError('ยังสั่งซื้อไม่ได้ กรุณาติดต่อร้านค้าหรือโหลดข้อมูลใหม่', 409)
  }
  return result.data
}
