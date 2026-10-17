import { NextRequest, NextResponse } from 'next/server'
import { getActor } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import { broadcastScope, readBroadcast } from '@/lib/broadcast-service'
import { sendBroadcast } from '@/lib/broadcast-send'
import { InboxError, inboxError } from '@/lib/inbox-server'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getActor(req)
    if (!actor || actor.kind !== 'user') throw new InboxError('กรุณาเข้าสู่ระบบ', 401)
    const { id } = await params
    const draft = await readBroadcast(supabaseAdmin(), id)
    const scope = await broadcastScope(actor, draft.tenant_id, true)
    const input = await req.json().catch(() => ({}))
    return NextResponse.json(await sendBroadcast(scope, draft, input), { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return inboxError(error) }
}
