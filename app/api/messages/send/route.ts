import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { canAccessTenant, getActor } from '@/lib/auth'
import { MissingPageTokenError, pageTokenFor, sendText } from '@/lib/facebook'
import { UUID } from '@/lib/utils'

export const runtime = 'nodejs'

const MAX_TEXT = 2000 // Messenger's limit for a text message

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

/**
 * POST application/json
 *   customerId  uuid of the customer to reply to
 *   text        message text, up to 2000 characters
 *   clientId    optional uuid made by the caller: the same clientId is only ever sent once,
 *               so a double click or a retried request can't message the customer twice
 */
export async function POST(req: NextRequest) {
  const actor = await getActor(req)
  if (!actor) return bad('unauthorized', 401)

  const input = await req.json().catch(() => null)
  const customerId = String(input?.customerId ?? '').trim()
  const text = String(input?.text ?? '').trim()
  const clientId = String(input?.clientId ?? '').trim() || null
  if (!UUID.test(customerId)) return bad('customerId must be a uuid')
  if (!text || text.length > MAX_TEXT) return bad(`text must be 1-${MAX_TEXT} characters`)
  if (clientId && !UUID.test(clientId)) return bad('clientId must be a uuid')

  const db = supabaseAdmin()
  const { data: customer } = await db
    .from('customers')
    .select('id, platform_user_id, tenant_id, tenants(page_id, page_access_token)')
    .eq('id', customerId)
    .maybeSingle()
  if (!customer || !(await canAccessTenant(actor, customer.tenant_id))) return bad('customer not found', 404)
  // embedded to-one relation (typed loosely by supabase-js without generated types)
  const tenant = customer.tenants as unknown as { page_id: string | null; page_access_token: string | null } | null
  const token = pageTokenFor(tenant)
  if (!token) return bad(new MissingPageTokenError().message, 409)

  // Claim the row before sending (same idea as the slip notices)
  const { data: row, error } = await db
    .from('messages')
    .insert({ customer_id: customer.id, external_id: clientId && `agent:${clientId}`, sender: 'agent', body: text })
    .select('id')
    .single()
  if (error?.code === '23505') return NextResponse.json({ ok: true, duplicate: true })
  if (error || !row) return bad(`db insert failed: ${error?.message ?? 'no row returned'}`, 500)

  try {
    await sendText(token, customer.platform_user_id, text)
  } catch (e) {
    // not delivered: remove it so the thread only shows what the customer actually received
    await db.from('messages').delete().eq('id', row.id)
    console.error('[send] Send API failed', e)
    // Meta's 24-hour rule is the usual cause (error 10 / subcode 2018278)
    return bad(e instanceof Error ? e.message : 'send failed', 502)
  }
  return NextResponse.json({ ok: true, id: row.id })
}
