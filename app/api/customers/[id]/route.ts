import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { canAccessTenant, getActor } from '@/lib/auth'
import { parseCustomerInput } from '@/lib/validation'
import { CUSTOMER_COLUMNS } from '@/lib/types'
import { UUID } from '@/lib/utils'

export const runtime = 'nodejs'

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

/** PATCH application/json: phone, address, tags, notes, order_status (any subset). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor(req)
  if (!actor) return bad('unauthorized', 401)
  const { id } = await params
  if (!UUID.test(id)) return bad('id must be a uuid')
  const parsed = parseCustomerInput(await req.json().catch(() => null))
  if (!parsed.ok) return bad(parsed.error)

  const db = supabaseAdmin()
  const { data: current } = await db.from('customers').select('tenant_id').eq('id', id).maybeSingle()
  if (!current || !(await canAccessTenant(actor, current.tenant_id))) return bad('customer not found', 404)

  const { data, error } = await db.from('customers').update(parsed.value).eq('id', id).select(CUSTOMER_COLUMNS).maybeSingle()
  if (error) return bad(`บันทึกไม่สำเร็จ: ${error.message}`, 500)
  if (!data) return bad('customer not found', 404)
  return NextResponse.json({ customer: data })
}
