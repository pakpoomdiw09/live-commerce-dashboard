import { hasSlipAccess, featureLockedResponse, FeatureLockedError } from '@/lib/feature-access'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { canAccessTenant, getActor, isPlatformAdmin } from '@/lib/auth'
import { processSlip, SLIP_IMAGE_TYPES, SLIP_MAX_BYTES, type Tenant } from '@/lib/slip/process'
import { UUID } from '@/lib/utils'

export const runtime = 'nodejs'
export const maxDuration = 60 // the provider call times out at 20 s; leave room for upload and saving

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

/**
 * POST multipart/form-data
 *   file            slip image (jpg/png/webp, up to 5 MB)   or
 *   qr              the QR payload string from the slip
 *   customerId      optional: uuid, links the slip to a customer
 *   tenantId        uuid, the slip must be paid into this tenant's account (and uses its credit).
 *                   Only platform admins / internal calls may leave it out.
 *   expectedAmount  optional: positive number, turns on the amount check
 */
export async function POST(req: NextRequest) {
  const actor = await getActor(req)
  if (!actor) return bad('unauthorized', 401)

  // formData() throws when the body isn't multipart, or when Content-Type was set by hand
  // without a boundary (a common Postman mistake). Answer 400 instead of crashing with 500.
  let form: FormData
  try {
    form = await req.formData()
  } catch (e) {
    console.error('slip verify: could not parse form data', req.headers.get('content-type'), e)
    return bad('body must be multipart/form-data')
  }
  const entry = form.get('file')
  const file = entry instanceof File && entry.size > 0 ? entry : undefined
  const qr = String(form.get('qr') ?? '').trim() || undefined
  const customerId = String(form.get('customerId') ?? '').trim() || null
  const tenantId = String(form.get('tenantId') ?? '').trim() || null
  const amountText = String(form.get('expectedAmount') ?? '').trim()
  const expectedAmount = amountText ? Number(amountText) : undefined
  if (process.env.NODE_ENV !== 'production') {
    console.log('slip verify: input', {
      file: file ? { name: file.name, type: file.type, size: file.size } : null,
      qr: !!qr,
      customerId,
      tenantId,
      expectedAmount,
    })
  }

  // Validate everything before touching storage or the database. A bad expectedAmount is
  // rejected rather than ignored, so a typo can't silently switch the amount check off.
  if (!file && !qr) return bad('send file or qr')
  if (file && (!SLIP_IMAGE_TYPES.includes(file.type) || file.size > SLIP_MAX_BYTES)) return bad('file must be jpg/png/webp, up to 5 MB')
  if (customerId && !UUID.test(customerId)) return bad('customerId must be a uuid')
  if (tenantId && !UUID.test(tenantId)) return bad('tenantId must be a uuid')
  if (expectedAmount !== undefined && !(Number.isFinite(expectedAmount) && expectedAmount > 0)) {
    return bad('expectedAmount must be a positive number')
  }

  // a check without a tenant costs no tenant credit: platform admins only
  if (!tenantId && !isPlatformAdmin(actor)) return bad('tenantId is required')
  if (tenantId && !(await canAccessTenant(actor, tenantId))) return bad('tenant not found', 404)

  const db = supabaseAdmin()
  if (!tenantId || !(await hasSlipAccess(db, tenantId))) return featureLockedResponse('slip_auto_pilot')
  if (customerId) {
    // the slip may only be linked to a customer of the same tenant
    const { data: c } = await db.from('customers').select('tenant_id').eq('id', customerId).maybeSingle()
    if (!c || (tenantId ? c.tenant_id !== tenantId : !isPlatformAdmin(actor))) return bad('customer not found', 404)
  }
  let tenant: Tenant | null = null
  if (tenantId) {
    const { data, error } = await db.from('tenants').select('id, account_number, bank_code').eq('id', tenantId).maybeSingle()
    if (error) {
      console.error('slip verify: tenant lookup failed', tenantId, error)
      return NextResponse.json({ error: 'tenant lookup failed' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'tenant not found' }, { status: 404 })
    tenant = data
  }

  // Shared verification prefers server-side order totals; never use legacy shop defaults.
  let r
  try {
    r = await processSlip(db, { file, qr, customerId, expectedAmount, tenant,
      adminBypass: actor.kind === 'user' && isPlatformAdmin(actor) })
  } catch (error) {
    if (error instanceof FeatureLockedError) return featureLockedResponse(error.feature)
    return bad(error instanceof Error ? error.message : 'อ่านข้อมูลตรวจสลิปไม่ได้ กรุณาลองอีกครั้ง', 503)
  }
  if (r.failure) return NextResponse.json({ error: r.failure }, { status: 500 })
  if (r.crashed) return NextResponse.json({ id: r.id, status: 'error' }, { status: 500 })
  return NextResponse.json({ id: r.id, status: r.status, amount: r.amount, transRef: r.transRef, note: r.note })
}
