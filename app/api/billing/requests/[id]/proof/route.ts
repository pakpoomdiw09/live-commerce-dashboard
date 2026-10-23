import { NextRequest, NextResponse } from 'next/server'
import { createHash, randomUUID } from 'node:crypto'
import { canAccessTenant, getActor, isPlatformAdmin } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import { isPaymentImage, PAYMENT_MAX_BYTES } from '@/lib/features/payments/payment-validation'
import { UUID } from '@/lib/utils'
import {
  APPROVAL_SUCCESS,
  BILLING_VERIFICATION_COLUMNS,
  verifyBillingRequest,
  type VerifiableBillingRequest,
} from '@/lib/features/billing/billing-verification'
import { getBilling } from '@/lib/features/billing/billing'

export const runtime = 'nodejs'
export const maxDuration = 60
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor()
  if (!actor) return bad('กรุณาเข้าสู่ระบบ', 401)
  const { id } = await params
  if (!UUID.test(id)) return bad('รหัสคำสั่งซื้อไม่ถูกต้อง')
  const db = supabaseAdmin()
  const { data, error } = await db
    .from('billing_requests')
    .select('tenant_id, proof_path')
    .eq('id', id)
    .maybeSingle()
  if (error) return bad('อ่านหลักฐานไม่ได้ กรุณาตรวจสอบการติดตั้งระบบ', 503)
  if (!data || !(await canAccessTenant(actor, data.tenant_id, 'owner')))
    return bad('ไม่พบหลักฐาน', 404)
  if (!data.proof_path) return bad('ยังไม่ได้แนบสลิป', 404)
  const { data: signed, error: signError } = await db.storage
    .from('billing-proofs')
    .createSignedUrl(data.proof_path, 120)
  if (signError || !signed) return bad('เปิดหลักฐานไม่ได้ กรุณาลองใหม่', 503)
  return NextResponse.json({ url: signed.signedUrl }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor()
  if (!actor) return bad('กรุณาเข้าสู่ระบบ', 401)
  const { id } = await params
  if (!UUID.test(id)) return bad('รหัสคำสั่งซื้อไม่ถูกต้อง')
  const db = supabaseAdmin()
  const { data: row, error } = await db
    .from('billing_requests')
    .select(BILLING_VERIFICATION_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  const request = row as VerifiableBillingRequest | null
  if (error) return bad('อ่านคำสั่งซื้อไม่ได้ กรุณาตรวจสอบการติดตั้งระบบ', 503)
  if (!request || !(await canAccessTenant(actor, request.tenant_id, 'owner')))
    return bad('ไม่พบคำสั่งซื้อ', 404)
  if (isPlatformAdmin(actor) && actor.kind !== 'user')
    return bad('กรุณาแนบสลิปด้วยบัญชีผู้ใช้', 403)
  if (request.status === 'approved')
    return NextResponse.json(
      {
        ok: true,
        status: 'approved',
        message: APPROVAL_SUCCESS,
        billing: await getBilling(db, request.tenant_id).catch(() => null),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  if (request.status !== 'pending') return bad('แนบสลิปได้เฉพาะคำสั่งซื้อที่รออนุมัติ', 409)
  if (Number(req.headers.get('content-length') ?? 0) > PAYMENT_MAX_BYTES + 64 * 1024)
    return bad('สลิปต้องไม่เกิน 5 MB', 413)
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (request.proof_path) {
    if (file instanceof File) return bad('แนบสลิปแล้ว กรุณากดตรวจสอบอีกครั้งหรือติดต่อผู้ดูแล', 409)
    return verifySaved(request)
  }
  if (!(file instanceof File) || !(await isPaymentImage(file)))
    return bad('เลือกไฟล์ JPG, PNG หรือ WebP ขนาดไม่เกิน 5 MB')
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type]
  const path = `${request.tenant_id}/${id}/${randomUUID()}.${ext}`
  const { error: uploadError } = await db.storage
    .from('billing-proofs')
    .upload(path, file, { contentType: file.type, upsert: false })
  if (uploadError) return bad('อัปโหลดสลิปไม่สำเร็จ กรุณาลองใหม่', 503)
  // Conditional update arbitrates simultaneous uploads and approval/cancellation.
  const { data: saved, error: saveError } = await db
    .from('billing_requests')
    .update({
      proof_path: path,
      proof_uploaded_at: new Date().toISOString(),
      proof_sha256: createHash('sha256')
        .update(Buffer.from(await file.arrayBuffer()))
        .digest('hex'),
    })
    .eq('id', id)
    .eq('status', 'pending')
    .is('proof_path', null)
    .select('id')
    .maybeSingle()
  if (saveError || !saved) {
    await db.storage.from('billing-proofs').remove([path])
    return bad('แนบสลิปไม่ได้ คำสั่งซื้ออาจถูกดำเนินการแล้ว กรุณาโหลดหน้าใหม่', 409)
  }
  return verifySaved({ ...request, proof_path: path }, file)

  async function verifySaved(savedRequest: VerifiableBillingRequest, uploaded?: File) {
    try {
      return NextResponse.json(await verifyBillingRequest(db, id, savedRequest, uploaded), {
        headers: { 'Cache-Control': 'no-store' },
      })
    } catch {
      return NextResponse.json(
        {
          ok: true,
          status: 'pending',
          message:
            'บันทึกสลิปแล้ว แต่ตรวจอัตโนมัติไม่สำเร็จ คำสั่งซื้อยังรอผู้ดูแลตรวจสอบ กรุณาไม่โอนซ้ำ',
        },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
  }
}
