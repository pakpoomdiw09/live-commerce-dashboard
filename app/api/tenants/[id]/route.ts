import { NextRequest, NextResponse } from 'next/server'
import { hasFeature, featureLockedResponse } from '@/lib/feature-access'
import { supabaseAdmin } from '@/lib/supabase/server'
import { getActor, roleAtLeast, tenantRole } from '@/lib/auth'
import { subscribePage } from '@/lib/integrations/facebook/oauth'
import { checkPageToken, fillTokenFromFacebook } from '@/lib/tenant'
import { ADMIN_TENANT_FIELDS, parseTenantInput, STAFF_TENANT_FIELDS, type TenantInput } from '@/lib/validation'
import { TENANT_COLUMNS } from '@/lib/types'
import { UUID } from '@/lib/utils'
import { isSupportedBank, UNSUPPORTED_BANK_MESSAGE } from '@/lib/features/banking/banks'

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
  if (keys.some(key => ['bank_code','account_name','account_number'].includes(key))) return bad('กรุณาเพิ่มหรือแก้ไขบัญชีในรายการบัญชีรับเงินของร้าน')
  if (keys.some((k) => ADMIN_TENANT_FIELDS.includes(k)) && role !== 'admin') return bad('เฉพาะผู้ดูแลแพลตฟอร์มเท่านั้นที่ปรับโควตาเครดิตได้', 403)
  if (keys.some((k) => !STAFF_TENANT_FIELDS.includes(k)) && !roleAtLeast(role, 'owner')) return bad('เฉพาะเจ้าของร้านเท่านั้นที่แก้การตั้งค่านี้ได้', 403)

  const db = supabaseAdmin()
  if (input.auto_verify_enabled === true && !(await hasFeature(db, id, 'slip_auto_pilot'))) return featureLockedResponse('slip_auto_pilot')
  if (input.auto_verify_enabled === true) {
    const { data: accounts, error } = await db.from('bank_accounts').select('bank_code').eq('tenant_id', id).eq('is_active', true)
    if (error) return bad('อ่านบัญชีรับเงินไม่ได้ กรุณาลองใหม่', 503)
    if (!accounts?.length || accounts.some(account => !isSupportedBank(account.bank_code))) return bad(UNSUPPORTED_BANK_MESSAGE)
  }
  const { data: current, error: currentError } = await db.from('tenants').select('page_id').eq('id', id).maybeSingle()
  if (currentError) return bad(currentError.message, 500)
  if (!current) return bad('tenant not found', 404)
  // moving to a Page the user connected with Facebook: take its token
  if (input.page_id !== undefined && input.page_id !== current.page_id) await fillTokenFromFacebook(input, actor.kind === 'user' ? actor.id : null)
  const token = await checkPageToken(input, current.page_id)
  if ('error' in token) return bad(token.error)
  // the saved token belongs to the old Page: moving to another Page without a new token clears it
  if (input.page_id !== undefined && input.page_id !== current.page_id && input.page_access_token === undefined) input.page_access_token = null

  const { data, error } = await db.from('tenants').update(input).eq('id', id).select(TENANT_COLUMNS).maybeSingle()
  if (error?.code === '23505') return bad('Facebook Page นี้ผูกกับร้านอื่นอยู่แล้ว', 409)
  if (error) return bad(`บันทึกไม่สำเร็จ: ${error.message}`, 500)
  if (!data) return bad('tenant not found', 404)
  if (input.page_access_token && data.page_id) {
    const subError = await subscribePage(data.page_id, input.page_access_token)
    if (subError) token.warnings.push(`สมัครรับ webhook ของเพจไม่สำเร็จ (ตั้งใน Meta เองได้): ${subError}`)
  }
  return NextResponse.json({ tenant: data, warnings: token.warnings })
}
