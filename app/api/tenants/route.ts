import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { getActor, isPlatformAdmin } from '@/lib/auth'
import { checkPageToken, getTenantsForActor } from '@/lib/tenant'
import { parseTenantInput } from '@/lib/validation'
import { TENANT_COLUMNS } from '@/lib/types'

export const runtime = 'nodejs'

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

/** GET: the tenants the caller may see (all for a platform admin / internal call). */
export async function GET(req: NextRequest) {
  const actor = await getActor(req)
  if (!actor) return bad('unauthorized', 401)
  const { tenants, error } = await getTenantsForActor(actor)
  if (error) return bad(error, 503)
  return NextResponse.json({ tenants }, { headers: { 'Cache-Control': 'private, no-store' } })
}

/**
 * POST application/json: name, bank_code, account_number required; other settings optional.
 * Platform admins only: a new tenant comes with credits, so shops can't create their own.
 * A signed-in admin becomes the tenant's owner, so the new shop shows up for them right away.
 */
export async function POST(req: NextRequest) {
  const actor = await getActor(req)
  if (!actor) return bad('unauthorized', 401)
  if (!isPlatformAdmin(actor)) return bad('เฉพาะผู้ดูแลแพลตฟอร์มเท่านั้นที่เพิ่มร้านค้าได้', 403)
  const parsed = parseTenantInput(await req.json().catch(() => null), false)
  if (!parsed.ok) return bad(parsed.error)
  const token = await checkPageToken(parsed.value, null)
  if ('error' in token) return bad(token.error)

  const db = supabaseAdmin()
  const { data, error } = await db
    .from('tenants')
    .insert(parsed.value)
    .select(TENANT_COLUMNS)
    .single()
  if (error?.code === '23505') return bad('Facebook Page นี้ผูกกับร้านอื่นอยู่แล้ว', 409)
  if (error) return bad(`บันทึกไม่สำเร็จ: ${error.message}`, 500)
  if (actor.kind === 'user') {
    const { error: memberError } = await db
      .from('tenant_members')
      .insert({ tenant_id: data.id, user_id: actor.id, role: 'owner' })
    if (memberError) console.error('[tenants] could not add the creator as owner', memberError)
  }
  return NextResponse.json({ tenant: data, warnings: token.warnings }, { status: 201 })
}
