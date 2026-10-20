import { hasSlipAccess, featureLockedResponse, FeatureLockedError } from '@/lib/feature-access'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { canAccessTenant, getActor, isPlatformAdmin } from '@/lib/auth'
import { processSlip, type Tenant } from '@/lib/features/slips/process'
import { UUID } from '@/lib/utils'
import { acquireUploadSlot, readUploadForm, validateUploadImage, UploadError, UPLOAD_FILE_BYTES } from '@/lib/upload-security'

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
  let release: (() => void) | undefined
  try {
    const actor = await getActor(req)
    if (!actor) return bad('unauthorized', 401)
    release = acquireUploadSlot(actor.kind === 'user' ? `user:${actor.id}` : 'internal')
    const form = await readUploadForm(req, { file: UPLOAD_FILE_BYTES, qr: 4096, customerId: 128, tenantId: 128, expectedAmount: 32 })
    const entry = form.get('file')
    const file = entry instanceof File ? entry : undefined
    const qr = String(form.get('qr') ?? '').trim() || undefined
    const customerId = String(form.get('customerId') ?? '').trim() || null
    const tenantId = String(form.get('tenantId') ?? '').trim() || null
    const amountText = String(form.get('expectedAmount') ?? '').trim()
    const expectedAmount = amountText ? Number(amountText) : undefined

    // Reject invalid amounts rather than silently disabling the amount check.
    if (!file && !qr) return bad('send file or qr')
    if (customerId && !UUID.test(customerId)) return bad('customerId must be a uuid')
    if (tenantId && !UUID.test(tenantId)) return bad('tenantId must be a uuid')
    if (expectedAmount !== undefined && !(Number.isFinite(expectedAmount) && expectedAmount > 0)) {
      return bad('expectedAmount must be a positive number')
    }

    if (!tenantId && !isPlatformAdmin(actor)) return bad('tenantId is required')
    if (tenantId && !(await canAccessTenant(actor, tenantId))) return bad('tenant not found', 404)

    const db = supabaseAdmin()
    if (!tenantId || !(await hasSlipAccess(db, tenantId))) return featureLockedResponse('slip_auto_pilot')
    if (file) await validateUploadImage(file)
    if (customerId) {
      // the slip may only be linked to a customer of the same tenant
      const { data: c } = await db.from('customers').select('tenant_id').eq('id', customerId).maybeSingle()
      if (!c || (tenantId ? c.tenant_id !== tenantId : !isPlatformAdmin(actor))) return bad('customer not found', 404)
    }
    let tenant: Tenant | null = null
    if (tenantId) {
      const { data, error } = await db.from('tenants').select('id, account_number, bank_code').eq('id', tenantId).maybeSingle()
      if (error) {
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
  } catch (error) {
    if (error instanceof UploadError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store', ...(error.status === 429 ? { 'Retry-After': '5' } : {}) } })
    if (error instanceof FeatureLockedError) return featureLockedResponse(error.feature)
    return bad('ระบบตรวจสลิปไม่พร้อม กรุณาลองใหม่อีกครั้ง', 503)
  } finally { release?.() }
}
