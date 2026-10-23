import { NextRequest, NextResponse } from 'next/server'
import { getActor } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import { readBroadcast, broadcastScope } from '@/lib/features/broadcast/broadcast-service'
import { broadcastDeliveryStats } from '@/lib/features/broadcast/broadcast-send'
import { inboxError, InboxError } from '@/lib/features/inbox/inbox-server'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getActor(req)
    if (!actor || actor.kind !== 'user') throw new InboxError('กรุณาเข้าสู่ระบบ', 401)
    const { id } = await params,
      tenantId = req.nextUrl.searchParams.get('tenantId')
    const requestedScope = tenantId ? await broadcastScope(actor, tenantId) : null
    const draft = await readBroadcast(
      requestedScope?.db ?? supabaseAdmin(),
      id,
      tenantId ?? undefined,
    )
    const scope = requestedScope ?? (await broadcastScope(actor, draft.tenant_id))
    if (draft.status === 'draft')
      return NextResponse.json(
        { broadcast: draft },
        { headers: { 'Cache-Control': 'private, no-store' } },
      )
    const stats = await broadcastDeliveryStats(scope, id)
    return NextResponse.json(
      { ...stats, deliveries: undefined },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    return inboxError(error)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await broadcastScope(
      await getActor(req),
      req.nextUrl.searchParams.get('tenantId') ?? '',
      true,
    )
    const { id } = await params
    const draft = await readBroadcast(scope.db, id, scope.tenantId)
    if (draft.status !== 'draft')
      throw new InboxError('ลบได้เฉพาะฉบับร่างที่ยังไม่ได้เริ่มส่งเท่านั้น', 409)
    // The status predicate also protects against a concurrent sender claiming this row.
    const result = await scope.db
      .from('broadcasts')
      .delete()
      .eq('id', id)
      .eq('tenant_id', scope.tenantId)
      .eq('status', 'draft')
      .select('id')
      .maybeSingle()
    if (result.error) throw new InboxError('ลบฉบับร่างไม่ได้ กรุณาลองใหม่', 503)
    if (!result.data) throw new InboxError('รายการเปลี่ยนแปลงแล้ว กรุณาโหลดประวัติใหม่', 409)
    return NextResponse.json({ deleted: id }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return inboxError(error)
  }
}
