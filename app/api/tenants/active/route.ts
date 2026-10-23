import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { canAccessTenant, getActor } from '@/lib/auth'
import { ACTIVE_TENANT_COOKIE } from '@/lib/tenant'
import { UUID } from '@/lib/utils'

export const runtime = 'nodejs'

/** POST { tenantId }: remember the tenant picked in the Quick Switcher. */
export async function POST(req: NextRequest) {
  const actor = await getActor(req)
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const input = await req.json().catch(() => null)
  const tenantId = String(input?.tenantId ?? '')
  if (!UUID.test(tenantId))
    return NextResponse.json({ error: 'tenantId must be a uuid' }, { status: 400 })
  if (!(await canAccessTenant(actor, tenantId)))
    return NextResponse.json({ error: 'tenant not found' }, { status: 404 })

  // Discard prefetched Page data before the picker navigates and refreshes.
  revalidatePath('/', 'layout')
  const res = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  res.cookies.set(ACTIVE_TENANT_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })
  return res
}
