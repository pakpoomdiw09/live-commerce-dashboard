import { NextRequest, NextResponse } from 'next/server'
import { hasFeature, featureLockedResponse } from '@/lib/feature-access'
import { supabaseAdmin } from '@/lib/supabase/server'
import { canAccessTenant, getActor } from '@/lib/auth'
import { runFollowUps } from '@/lib/features/follow-ups/follow-ups'
import { UUID } from '@/lib/utils'
import { getBilling } from '@/lib/features/billing/billing'
import { canUseFollowUps } from '@/lib/features/billing/plans'

export const runtime = 'nodejs'
export const maxDuration = 60

/** "ประมวลผลตอนนี้" on the follow-ups page: send the due reminders of one tenant. Body: { tenantId } */
export async function POST(req: NextRequest) {
  const actor = await getActor(req)
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const tenantId = String(body?.tenantId ?? '')
  if (!UUID.test(tenantId)) return NextResponse.json({ error: 'tenantId must be a uuid' }, { status: 400 })
  if (!(await canAccessTenant(actor, tenantId))) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!(await hasFeature(supabaseAdmin(), tenantId, 'customer_follow_up'))) return featureLockedResponse('customer_follow_up')
  try {
    if (!canUseFollowUps(await getBilling(supabaseAdmin(), tenantId, actor.kind === 'user' && actor.isPlatformAdmin))) {
      return NextResponse.json({ error: 'กรุณาอัปเกรดแพ็กเกจเพื่อใช้ผู้ช่วยติดตามลูกค้า' }, { status: 403 })
    }
    return NextResponse.json(await runFollowUps(supabaseAdmin(), tenantId, Date.now() + 45_000, actor.kind === 'user' && actor.isPlatformAdmin))
  } catch (e) {
    console.error('[follow-ups run]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
  }
}
