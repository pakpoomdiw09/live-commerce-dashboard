import { hasSlipAccess, featureLockedResponse, FeatureLockedError } from '@/lib/feature-access'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { canAccessTenant, getActor } from '@/lib/auth'
import { processSlip } from '@/lib/slip/process'
import { downloadSlipImage, slipCandidates } from '@/lib/slip/image'
import { STALE_PENDING_MS } from '@/lib/status'
import type { Attachment } from '@/lib/types'
import { UUID } from '@/lib/utils'

export const runtime = 'nodejs'
export const maxDuration = 60 // up to a few images, SlipOK times out at 20 s each

const STALE_NOTE = 'การตรวจครั้งก่อนค้างเกิน 3 นาที (ระบบหยุดกลางคัน) แอดมินสั่งตรวจใหม่แล้ว'

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

/**
 * POST: verify the slip images of one chat message by hand (Auto-Pilot was off, or the admin wants
 * a re-check after a failed one). Refused while a check is running or once a slip of it passed.
 * No message is sent to the customer: the admin decides what to reply.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor(req)
  if (!actor) return bad('unauthorized', 401)
  const { id } = await params
  if (!UUID.test(id)) return bad('id must be a uuid')

  const db = supabaseAdmin()
  const { data: message, error } = await db
    .from('messages')
    .select('id, customer_id, attachments, customers(tenant_id, tenants(id, account_number, bank_code))')
    .eq('id', id)
    .maybeSingle()
  if (error) return bad(error.message, 500)
  const customer = message?.customers as unknown as {
    tenant_id: string | null
    tenants: { id: string; account_number: string; bank_code: string } | null
  } | null
  if (!message || !(await canAccessTenant(actor, customer?.tenant_id ?? null))) return bad('message not found', 404)
  if (!customer?.tenant_id || !(await hasSlipAccess(db, customer.tenant_id))) return featureLockedResponse('slip_auto_pilot')

  const urls = slipCandidates(message.attachments as Attachment[])
  if (urls.length === 0) return bad('ข้อความนี้ไม่มีรูปสลิป')

  const { data: existing } = await db.from('slips').select('id, status, created_at').eq('message_id', id)
  if (existing?.some((s) => s.status === 'valid')) return bad('สลิปนี้ตรวจผ่านแล้ว', 409)
  const pending = (existing ?? []).filter((s) => s.status === 'pending')
  const stale = pending.filter((s) => Date.now() - Date.parse(s.created_at) > STALE_PENDING_MS)
  if (stale.length < pending.length) return bad('กำลังตรวจสลิปนี้อยู่', 409)
  if (stale.length) {
    // close the stuck rows first, so the dashboard shows the new check instead
    const { error: staleError } = await db
      .from('slips')
      .update({ status: 'error', note: STALE_NOTE, verified_at: new Date().toISOString() })
      .in('id', stale.map((s) => s.id))
      .eq('status', 'pending')
    if (staleError) return bad(`ปิดรายการที่ค้างไม่สำเร็จ: ${staleError.message}`, 500)
  }

  const t = customer?.tenants ?? null
  const tenant = t && { id: t.id, account_number: t.account_number, bank_code: t.bank_code }

  const results = []
  for (const url of urls) {
    // Meta CDN links expire: an old message may no longer be downloadable
    const file = await downloadSlipImage(url)
    if (!file) {
      results.push({ status: 'error', note: 'ดาวน์โหลดรูปจาก Messenger ไม่ได้ (ลิงก์อาจหมดอายุ)' })
      continue
    }
    let r
    try {
      r = await processSlip(db, {
      file,
      customerId: message.customer_id,
      messageId: message.id,
      tenant,
      adminBypass: actor.kind === 'user' && actor.isPlatformAdmin,
    })
    } catch (error) {
      if (error instanceof FeatureLockedError) return featureLockedResponse(error.feature)
      results.push({ status: 'error', note: error instanceof Error ? error.message : 'อ่านข้อมูลตรวจสลิปไม่ได้ กรุณาลองอีกครั้ง' })
      continue
    }
    results.push({ id: r.id, status: r.status, note: r.note, failure: r.failure })
  }
  return NextResponse.json({ results })
}
