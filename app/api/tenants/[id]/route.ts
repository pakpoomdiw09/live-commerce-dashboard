import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { getActor, roleAtLeast, tenantRole } from '@/lib/auth'
import { checkPageToken } from '@/lib/tenant'
import { ADMIN_TENANT_FIELDS, parseTenantInput, STAFF_TENANT_FIELDS, type TenantInput } from '@/lib/validation'
import { TENANT_COLUMNS } from '@/lib/types'
import { UUID } from '@/lib/utils'

export const runtime = 'nodejs'

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

/**
 * PATCH application/json: any subset of the tenant settings (e.g. { auto_verify_enabled: false }).
 *   staff  the automation switches only
 *   owner  every shop setting, including the Page and its token
 *   admin  everything, plus slip_quota (credits are sold by the platform)
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor(req)
  if (!actor) return bad('unauthorized', 401)
  const { id } = await params
  if (!UUID.test(id)) return bad('id must be a uuid')
  const role = await tenantRole(actor, id)
  if (!role) return bad('tenant not found', 404) // don't reveal other tenants

  const parsed = parseTenantInput(await req.json().catch(() => null), true)
  if (!parsed.ok) return bad(parsed.error)
  const input: TenantInput = parsed.value
  const keys = Object.keys(input) as (keyof TenantInput)[]
  if (keys.length === 0) return bad('nothing to update')
  if (keys.some((k) => ADMIN_TENANT_FIELDS.includes(k)) && role !== 'admin') return bad('เฉพาะผู้ดูแลแพลตฟอร์มเท่านั้นที่ปรับโควตาเครดิตได้', 403)
  if (keys.some((k) => !STAFF_TENANT_FIELDS.includes(k)) && !roleAtLeast(role, 'owner')) return bad('เฉพาะเจ้าของร้านเท่านั้นที่แก้การตั้งค่านี้ได้', 403)

  const db = supabaseAdmin()
  const { data: current, error: currentError } = await db.from('tenants').select('page_id').eq('id', id).maybeSingle()
  if (currentError) return bad(currentError.message, 500)
  if (!current) return bad('tenant not found', 404)
  const token = await checkPageToken(input, current.page_id)
  if ('error' in token) return bad(token.error)
  // the saved token belongs to the old Page: moving to another Page without a new token clears it
  if (input.page_id !== undefined && input.page_id !== current.page_id && input.page_access_token === undefined) input.page_access_token = null

  const { data, error } = await db.from('tenants').update(input).eq('id', id).select(TENANT_COLUMNS).maybeSingle()
  if (error?.code === '23505') return bad('Facebook Page นี้ผูกกับร้านอื่นอยู่แล้ว', 409)
  if (error) return bad(`บันทึกไม่สำเร็จ: ${error.message}`, 500)
  if (!data) return bad('tenant not found', 404)
  return NextResponse.json({ tenant: data, warnings: token.warnings })
}
