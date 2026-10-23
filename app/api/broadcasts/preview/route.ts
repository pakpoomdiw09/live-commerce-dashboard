import { NextRequest, NextResponse } from 'next/server'
import { getActor } from '@/lib/auth'
import {
  broadcastScope,
  previewBroadcast,
  readBroadcast,
} from '@/lib/features/broadcast/broadcast-service'
import { inboxError } from '@/lib/features/inbox/inbox-server'

export async function POST(req: NextRequest) {
  try {
    const input = await req.json()
    const scope = await broadcastScope(await getActor(req), String(input.tenantId ?? ''))
    const draft = await readBroadcast(scope.db, String(input.id ?? ''), scope.tenantId)
    return NextResponse.json(await previewBroadcast(scope, draft), {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    return inboxError(error)
  }
}
