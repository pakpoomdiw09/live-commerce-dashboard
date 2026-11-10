import { NextRequest, NextResponse } from 'next/server'
import { canAccessTenant, getActor, type Actor } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import { UUID } from '@/lib/utils'

export const runtime = 'nodejs'

const reply = (body: unknown, status = 200) => NextResponse.json(body, { status })
const notFound = () => reply({ error: 'auction payment proof not found' }, 404)

type ReviewDecision = 'approve' | 'reject'
type ReviewRpcResult = { data: unknown; error: { code?: string } | null }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let actor: Actor | null
  try {
    actor = await getActor(req)
  } catch {
    return reply({ error: 'authentication unavailable' }, 503)
  }
  if (!actor) return reply({ error: 'unauthorized' }, 401)

  const { id: orderId } = await params
  if (!UUID.test(orderId)) return reply({ error: 'order id must be a uuid' }, 400)

  let input: unknown
  try {
    input = await req.json()
  } catch {
    return reply({ error: 'request body must be valid JSON' }, 400)
  }
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return reply({ error: 'request body must be an object' }, 400)
  const body = input as Record<string, unknown>
  if (
    Object.keys(body).some((key) => !['decision', 'slipId'].includes(key)) ||
    typeof body.decision !== 'string' ||
    (body.decision !== 'approve' && body.decision !== 'reject') ||
    typeof body.slipId !== 'string' ||
    !UUID.test(body.slipId)
  )
    return reply({ error: 'decision and slipId are required' }, 400)

  const decision = body.decision as ReviewDecision
  let db: ReturnType<typeof supabaseAdmin>
  try {
    db = supabaseAdmin()
  } catch {
    return reply({ error: 'auction payment review unavailable' }, 503)
  }
  const orderResult = await db
    .from('orders')
    .select('id,tenant_id')
    .eq('id', orderId)
    .eq('source', 'live_auction')
    .maybeSingle()
  if (orderResult.error) return reply({ error: 'auction order lookup unavailable' }, 503)
  const order = orderResult.data
  if (!order?.tenant_id) return notFound()

  // Hide cross-tenant order/proof existence, then require the merchant review role.
  let hasTenantAccess: boolean
  let canReviewPayments: boolean
  try {
    hasTenantAccess = await canAccessTenant(actor, order.tenant_id, 'staff')
    canReviewPayments = hasTenantAccess
      ? await canAccessTenant(actor, order.tenant_id, 'owner')
      : false
  } catch {
    return reply({ error: 'tenant authorization unavailable' }, 503)
  }
  if (!hasTenantAccess) return notFound()
  if (!canReviewPayments)
    return reply({ error: 'owner access required to review auction payment proofs' }, 403)

  const proofResult = await db
    .from('auction_payment_proofs')
    .select('slip_id,tenant_id')
    .eq('order_id', order.id)
    .eq('tenant_id', order.tenant_id)
    .maybeSingle()
  if (proofResult.error) return reply({ error: 'auction proof lookup unavailable' }, 503)
  const proof = proofResult.data
  if (!proof || proof.tenant_id !== order.tenant_id) return notFound()
  if (proof.slip_id !== body.slipId)
    return reply({ error: 'auction payment proof changed; reload before reviewing' }, 409)

  let result: ReviewRpcResult
  try {
    result = await db.rpc('review_auction_payment_proof', {
      p_order: order.id,
      p_tenant: order.tenant_id,
      p_slip: body.slipId,
      p_decision: decision,
      p_actor: actor.kind === 'user' ? actor.id : null,
    })
  } catch {
    return reply({ error: 'auction payment review unavailable' }, 503)
  }
  if (result.error) {
    if (result.error.code === 'P0002') return notFound()
    if (['40001', '42501', '55000'].includes(result.error.code ?? ''))
      return reply({ error: 'auction payment proof is stale or no longer reviewable' }, 409)
    if (result.error.code === '22023') return reply({ error: 'invalid review decision' }, 400)
    return reply({ error: 'auction payment review unavailable' }, 503)
  }
  if (!result.data || typeof result.data !== 'object')
    return reply({ error: 'auction payment review returned an invalid result' }, 503)
  return reply({ ok: true, review: result.data })
}
