import { NextRequest, NextResponse } from 'next/server'
import { getActor } from '@/lib/auth'
import { broadcastScope, parseBroadcastDraft, readBroadcast } from '@/lib/broadcast-service'
import { BROADCAST_COLUMNS } from '@/lib/chatbot'
import { InboxError, inboxError } from '@/lib/inbox-server'
import { UUID } from '@/lib/utils'

export async function POST(req: NextRequest) {
  try {
    const input = await req.json(), actor = await getActor(req)
    const scope = await broadcastScope(actor, String(input.tenantId ?? ''), true)
    const draft = parseBroadcastDraft(input)
    if (!UUID.test(String(input.id ?? ''))) throw new InboxError('รหัสฉบับร่างไม่ถูกต้อง', 400)
    const current = await scope.db.from('broadcasts').select('id,status').eq('id', input.id).eq('tenant_id', scope.tenantId).maybeSingle()
    if (current.error) throw new InboxError('อ่านฉบับร่างไม่ได้', 503)
    if (current.data && current.data.status !== 'draft') throw new InboxError('รายการที่เริ่มส่งแล้วแก้เนื้อหาไม่ได้ กรุณาสร้างฉบับร่างใหม่', 409)
    const value = { ...draft, audience_window: 'within_24h', message_tag: null }
    const result = current.data
      ? await scope.db.from('broadcasts').update(value).eq('id', input.id).eq('tenant_id', scope.tenantId).eq('status', 'draft').select(BROADCAST_COLUMNS).single()
      : await scope.db.from('broadcasts').insert({ ...value, id: input.id, tenant_id: scope.tenantId, created_by: scope.actor.id }).select(BROADCAST_COLUMNS).single()
    if (result.error?.code === '23505') {
      const existing = await readBroadcast(scope.db, input.id, scope.tenantId)
      if (existing.name === draft.name && existing.message === draft.message && existing.audience_segment === draft.audience_segment && JSON.stringify(existing.audience_tags) === JSON.stringify(draft.audience_tags)) return NextResponse.json({ broadcast: existing }, { headers: { 'Cache-Control': 'private, no-store' } })
      throw new InboxError('มีฉบับร่างรหัสนี้แล้ว กรุณาโหลดข้อมูลใหม่', 409)
    }
    if (result.error || !result.data) throw new InboxError('บันทึกฉบับร่างไม่ได้ กรุณาลองใหม่', 503)
    return NextResponse.json({ broadcast: result.data }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return inboxError(error) }
}
