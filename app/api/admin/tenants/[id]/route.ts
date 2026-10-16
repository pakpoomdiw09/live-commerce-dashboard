import { NextRequest, NextResponse } from 'next/server'
import { getActor } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import { UUID } from '@/lib/utils'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor()
  if (!actor || actor.kind !== 'user' || !actor.isPlatformAdmin) return NextResponse.json({ error: 'เฉพาะผู้ดูแลระบบเท่านั้น' }, { status: actor ? 403 : 401 })
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'รหัสร้านค้าไม่ถูกต้อง' }, { status: 400 })
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !['plan', 'isActive'].includes(key))
    || (body.plan === undefined && body.isActive === undefined)
    || (body.plan !== undefined && !['free', 'starter', 'pro'].includes(body.plan))
    || (body.isActive !== undefined && typeof body.isActive !== 'boolean')) {
    return NextResponse.json({ error: 'ระบุแพ็กเกจหรือสถานะร้านค้าให้ถูกต้อง' }, { status: 400 })
  }
  const { error } = await supabaseAdmin().rpc('platform_update_tenant', {
    p_tenant: id, p_admin: actor.id, p_plan: body.plan ?? null, p_active: body.isActive ?? null,
  })
  if (error) return NextResponse.json({ error: error.code === 'P0002' ? 'ไม่พบร้านค้านี้' : 'บันทึกการเปลี่ยนแปลงไม่สำเร็จ กรุณาตรวจสอบการติดตั้งระบบ' }, { status: error.code === 'P0002' ? 404 : 500 })
  return NextResponse.json({ ok: true })
}
