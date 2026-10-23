import { NextRequest, NextResponse } from 'next/server'
import { getActor } from '@/lib/auth'
import {
  broadcastScope,
  parseBroadcastDraft,
  previewBroadcast,
} from '@/lib/features/broadcast/broadcast-service'
import type { BroadcastRow } from '@/lib/features/agents/chatbot'
import { InboxError, inboxError } from '@/lib/features/inbox/inbox-server'

/** Legacy UI uses the same policy; rolling back the UI cannot restore old tag permissions. */
export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams
    const scope = await broadcastScope(await getActor(req), q.get('tenantId') ?? '')
    const window = q.get('window') ?? 'within_24h'
    if (!['within_24h', 'outside_24h'].includes(window))
      throw new InboxError('ช่องทางไม่ถูกต้อง', 400)
    const draft = parseBroadcastDraft({
      name: 'ตรวจสอบผู้รับ',
      message: 'ตรวจสอบผู้รับ',
      audience_segment: q.get('segment') ?? 'all',
      audience_tags: (q.get('tags') ?? '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    })
    const result = await previewBroadcast(scope, {
      ...draft,
      tenant_id: scope.tenantId,
      status: 'draft',
      audience_window: window,
      message_tag: q.get('tag') || null,
    } as BroadcastRow)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return inboxError(error)
  }
}
