import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { canAccessTenant, getActor } from '@/lib/auth'
import { broadcastAudience, BROADCAST_SEGMENT_VALUES, BROADCAST_WINDOW_VALUES } from '@/lib/broadcast'
import { MESSAGE_TAG_VALUES, type BroadcastSegment, type BroadcastWindow, type MessageTag } from '@/lib/chatbot'
import { UUID } from '@/lib/utils'

export const runtime = 'nodejs'

/** GET ?tenantId=&segment=&tags=a,b&window=&tag= → { total, reachable }: audience size before a broadcast is sent. */
export async function GET(req: NextRequest) {
  const actor = await getActor(req)
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const q = req.nextUrl.searchParams
  const tenantId = q.get('tenantId') ?? ''
  const segment = (q.get('segment') ?? 'all') as BroadcastSegment
  const tags = (q.get('tags') ?? '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20)
  const window = (q.get('window') ?? 'within_24h') as BroadcastWindow
  const tag = (q.get('tag') || null) as MessageTag | null
  if (!UUID.test(tenantId)) return NextResponse.json({ error: 'tenantId must be a uuid' }, { status: 400 })
  if (!BROADCAST_SEGMENT_VALUES.includes(segment)) return NextResponse.json({ error: 'unknown segment' }, { status: 400 })
  if (!BROADCAST_WINDOW_VALUES.includes(window)) return NextResponse.json({ error: 'unknown window' }, { status: 400 })
  if (tag && !MESSAGE_TAG_VALUES.includes(tag)) return NextResponse.json({ error: 'unknown tag' }, { status: 400 })
  if (!(await canAccessTenant(actor, tenantId))) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  try {
    const a = await broadcastAudience(supabaseAdmin(), tenantId, segment, tags, window, tag)
    return NextResponse.json({ total: a.total, reachable: a.reachable.length })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
  }
}
