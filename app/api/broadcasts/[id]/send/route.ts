import { NextRequest, NextResponse } from 'next/server'
import { getActor } from '@/lib/auth'
import { broadcastScope, readBroadcast } from '@/lib/features/broadcast/broadcast-service'
import { sendBroadcast } from '@/lib/features/broadcast/broadcast-send'
import { InboxError, inboxError } from '@/lib/features/inbox/inbox-server'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getActor(req)
    if (!actor || actor.kind !== 'user') throw new InboxError('กรุณาเข้าสู่ระบบ', 401)
    const { id } = await params
    const input = await req.json().catch(() => ({}))
    const scope = await broadcastScope(actor, String(input.tenantId ?? ''), true)
    const draft = await readBroadcast(scope.db, id, scope.tenantId)
    return NextResponse.json(await sendBroadcast(scope, draft, input), {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    return inboxError(error)
  }
}
